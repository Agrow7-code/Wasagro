import { describe, expect, it, vi, beforeEach } from 'vitest'
import { generarYEnviarReportes } from '../../src/pipeline/reporteSemanal.js'

vi.mock('../../src/pipeline/supabaseQueries.js', () => ({
  getFincasActivas: vi.fn(),
  getEventosByFincaRango: vi.fn(),
  getAdminsByFinca: vi.fn(),
}))

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: { trace: vi.fn().mockReturnValue({ event: vi.fn(), id: 'trace-mock' }) },
}))

import * as queries from '../../src/pipeline/supabaseQueries.js'

// ─── fixtures ─────────────────────────────────────────────────────────────────

const fincaBase = { finca_id: 'F001', org_id: 'ORG001', nombre: 'Finca Uno', pais: 'EC', cultivo_principal: 'cacao' }

const eventosBase = [
  { tipo_evento: 'insumo', fecha_evento: '2026-04-20', lote_id: 'F001-L01', datos_evento: {}, descripcion_raw: 'Apliqué mancozeb', confidence_score: 0.9, status: 'complete' },
  { tipo_evento: 'plaga', fecha_evento: '2026-04-21', lote_id: 'F001-L01', datos_evento: {}, descripcion_raw: 'Monilia detectada', confidence_score: 0.85, status: 'complete' },
]

const adminsBase = [
  { id: 'u1', phone: '593987654321', nombre: 'Don Marco', rol: 'propietario' },
]

const resumenBase = {
  semana: '2026-W16',
  finca_id: 'F001',
  total_eventos: 2,
  eventos_por_tipo: { insumo: 1, plaga: 1 },
  alertas: [],
  resumen_narrativo: 'Esta semana se registraron 2 eventos: 1 insumo y 1 plaga.',
  requiere_atencion: false,
  es_solo_informativo: true as const,
}

function crearSender() {
  return { enviarTexto: vi.fn().mockResolvedValue(undefined) }
}

function crearLlm(resumen = resumenBase) {
  return { resumirSemana: vi.fn().mockResolvedValue(resumen) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(queries.getFincasActivas).mockResolvedValue([fincaBase])
  vi.mocked(queries.getEventosByFincaRango).mockResolvedValue(eventosBase)
  vi.mocked(queries.getAdminsByFinca).mockResolvedValue(adminsBase)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generarYEnviarReportes', () => {

  describe('condiciones de corte — sin enviar', () => {
    it('finca sin eventos → no llama LLM ni WhatsApp, procesadas: 0', async () => {
      vi.mocked(queries.getEventosByFincaRango).mockResolvedValue([])
      const sender = crearSender()
      const llm = crearLlm()

      const result = await generarYEnviarReportes(llm as any, sender)

      expect(llm.resumirSemana).not.toHaveBeenCalled()
      expect(sender.enviarTexto).not.toHaveBeenCalled()
      expect(result).toEqual({ procesadas: 0, errores: 0 })
    })

    it('finca con eventos pero sin admins → no llama LLM ni WhatsApp, procesadas: 0', async () => {
      vi.mocked(queries.getAdminsByFinca).mockResolvedValue([])
      const sender = crearSender()
      const llm = crearLlm()

      const result = await generarYEnviarReportes(llm as any, sender)

      expect(llm.resumirSemana).not.toHaveBeenCalled()
      expect(sender.enviarTexto).not.toHaveBeenCalled()
      expect(result).toEqual({ procesadas: 0, errores: 0 })
    })

    it('LLM retorna resumen con es_solo_informativo=false → reporte bloqueado (Regla 3)', async () => {
      const resumenBloqueado = { ...resumenBase, es_solo_informativo: false }
      const sender = crearSender()
      const llm = crearLlm(resumenBloqueado as any)

      const result = await generarYEnviarReportes(llm as any, sender)

      expect(sender.enviarTexto).not.toHaveBeenCalled()
      expect(result).toEqual({ procesadas: 0, errores: 0 })
    })
  })

  describe('happy path — envío exitoso', () => {
    it('envía resumen_narrativo al admin de la finca', async () => {
      const sender = crearSender()
      const llm = crearLlm()

      const result = await generarYEnviarReportes(llm as any, sender)

      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', resumenBase.resumen_narrativo)
      expect(result).toEqual({ procesadas: 1, errores: 0 })
    })

    it('envía el resumen a todos los admins cuando hay múltiples', async () => {
      vi.mocked(queries.getAdminsByFinca).mockResolvedValue([
        { id: 'u1', phone: '593987654321', nombre: 'Don Marco', rol: 'propietario' },
        { id: 'u2', phone: '593987000001', nombre: 'Ana', rol: 'administrador' },
      ])
      const sender = crearSender()
      const llm = crearLlm()

      await generarYEnviarReportes(llm as any, sender)

      expect(sender.enviarTexto).toHaveBeenCalledWith('593987654321', expect.any(String))
      expect(sender.enviarTexto).toHaveBeenCalledWith('593987000001', expect.any(String))
    })

    it('pasa los datos correctos al LLM (finca_id, nombre, fechas, eventos)', async () => {
      const sender = crearSender()
      const llm = crearLlm()

      await generarYEnviarReportes(llm as any, sender)

      expect(llm.resumirSemana).toHaveBeenCalledWith(
        expect.objectContaining({
          finca_id: 'F001',
          finca_nombre: 'Finca Uno',
          cultivo_principal: 'cacao',
          eventos: eventosBase,
        }),
        expect.any(String),
      )
    })
  })

  describe('alertas de alta severidad', () => {
    it('requiere_atencion=true + alerta alta → envía segundo mensaje con las alertas', async () => {
      const resumenConAlerta = {
        ...resumenBase,
        requiere_atencion: true,
        alertas: [{ tipo: 'plaga', descripcion: 'Monilia severa en lote norte', severidad: 'alta' as const }],
      }
      const sender = crearSender()
      const llm = crearLlm(resumenConAlerta)

      await generarYEnviarReportes(llm as any, sender)

      // Primer mensaje: resumen narrativo
      expect(sender.enviarTexto).toHaveBeenNthCalledWith(1, '593987654321', resumenConAlerta.resumen_narrativo)
      // Segundo mensaje: alertas
      expect(sender.enviarTexto).toHaveBeenNthCalledWith(2, '593987654321', expect.stringContaining('Monilia severa'))
      expect(sender.enviarTexto).toHaveBeenCalledTimes(2)
    })

    it('requiere_atencion=true pero solo alertas de severidad media → NO envía segundo mensaje', async () => {
      const resumenSoloMedia = {
        ...resumenBase,
        requiere_atencion: true,
        alertas: [{ tipo: 'clima', descripcion: 'Lluvia moderada esperada', severidad: 'media' as const }],
      }
      const sender = crearSender()
      const llm = crearLlm(resumenSoloMedia)

      await generarYEnviarReportes(llm as any, sender)

      expect(sender.enviarTexto).toHaveBeenCalledTimes(1) // solo el narrativo
    })

    it('requiere_atencion=false con alertas altas → NO envía segundo mensaje', async () => {
      const resumenSinAtencion = {
        ...resumenBase,
        requiere_atencion: false,
        alertas: [{ tipo: 'plaga', descripcion: 'Revisar lote', severidad: 'alta' as const }],
      }
      const sender = crearSender()
      const llm = crearLlm(resumenSinAtencion)

      await generarYEnviarReportes(llm as any, sender)

      expect(sender.enviarTexto).toHaveBeenCalledTimes(1) // solo el narrativo
    })

    it('múltiples alertas altas → se concatenan en un solo segundo mensaje', async () => {
      const resumenMultiAlerta = {
        ...resumenBase,
        requiere_atencion: true,
        alertas: [
          { tipo: 'plaga', descripcion: 'Monilia en lote norte', severidad: 'alta' as const },
          { tipo: 'plaga', descripcion: 'Trips en lote sur', severidad: 'alta' as const },
          { tipo: 'clima', descripcion: 'Lluvia leve', severidad: 'baja' as const },
        ],
      }
      const sender = crearSender()
      const llm = crearLlm(resumenMultiAlerta)

      await generarYEnviarReportes(llm as any, sender)

      const segundoMsg = sender.enviarTexto.mock.calls[1]?.[1] as string
      expect(segundoMsg).toContain('Monilia en lote norte')
      expect(segundoMsg).toContain('Trips en lote sur')
      expect(segundoMsg).not.toContain('Lluvia leve') // baja se filtra
    })
  })

  describe('manejo de errores', () => {
    it('LLM lanza excepción → errores: 1, no envía', async () => {
      const sender = crearSender()
      const llm = { resumirSemana: vi.fn().mockRejectedValue(new Error('LLM timeout')) }

      const result = await generarYEnviarReportes(llm as any, sender)

      expect(sender.enviarTexto).not.toHaveBeenCalled()
      expect(result).toEqual({ procesadas: 0, errores: 1 })
    })

    it('envío WhatsApp falla para un admin → continúa con el siguiente, no cuenta en errores', async () => {
      vi.mocked(queries.getAdminsByFinca).mockResolvedValue([
        { id: 'u1', phone: '593987654321', nombre: 'Marco', rol: 'propietario' },
        { id: 'u2', phone: '593987000001', nombre: 'Ana', rol: 'administrador' },
      ])
      const sender = crearSender()
      sender.enviarTexto
        .mockRejectedValueOnce(new Error('WhatsApp error'))  // falla para Marco
        .mockResolvedValueOnce(undefined)                    // ok para Ana

      const result = await generarYEnviarReportes(crearLlm() as any, sender)

      expect(sender.enviarTexto).toHaveBeenCalledTimes(2) // intentó a ambos
      expect(result).toEqual({ procesadas: 1, errores: 0 }) // el fallo de envío no sube errores
    })

    it('múltiples fincas — procesadas y errores contados independientemente', async () => {
      vi.mocked(queries.getFincasActivas).mockResolvedValue([
        { finca_id: 'F001', org_id: 'ORG001', nombre: 'Finca Uno', pais: 'EC', cultivo_principal: 'cacao' },
        { finca_id: 'F002', org_id: 'ORG001', nombre: 'Finca Dos', pais: 'EC', cultivo_principal: 'banano' },
        { finca_id: 'F003', org_id: 'ORG001', nombre: 'Finca Tres', pais: 'EC', cultivo_principal: 'cacao' },
      ])
      // F003 no tiene eventos → no cuenta como procesada ni error
      vi.mocked(queries.getEventosByFincaRango)
        .mockResolvedValueOnce(eventosBase)   // F001 → ok
        .mockResolvedValueOnce(eventosBase)   // F002 → ok
        .mockResolvedValueOnce([])            // F003 → sin eventos

      vi.mocked(queries.getAdminsByFinca).mockResolvedValue(adminsBase)

      const llm = {
        resumirSemana: vi.fn()
          .mockResolvedValueOnce(resumenBase)            // F001 ok
          .mockRejectedValueOnce(new Error('timeout')),  // F002 falla
      }
      const sender = crearSender()

      const result = await generarYEnviarReportes(llm as any, sender)

      expect(result.procesadas).toBe(1)  // solo F001
      expect(result.errores).toBe(1)     // F002 falló
    })

    it('consulta a getAdminsByFinca falla → errores: 1', async () => {
      vi.mocked(queries.getAdminsByFinca).mockRejectedValue(new Error('DB error'))
      const sender = crearSender()
      const llm = crearLlm()

      const result = await generarYEnviarReportes(llm as any, sender)

      expect(result.errores).toBe(1)
      expect(sender.enviarTexto).not.toHaveBeenCalled()
    })
  })
})
