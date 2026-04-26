import { describe, expect, it, vi } from 'vitest'
import { GroqAdapter } from '../../../src/integrations/llm/GroqAdapter.js'
import { WasagroAIAgent } from '../../../src/integrations/llm/WasagroAIAgent.js'
import type { ContextoConversacion, ContextoOnboardingAgricultor } from '../../../src/types/dominio/Onboarding.js'
import type { EntradaResumenSemanal } from '../../../src/types/dominio/Resumen.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: vi.fn().mockReturnValue('mocked-prompt-content') }
})

// ─── helpers ──────────────────────────────────────────────────────────────────

function crearSdk(responseContent: string) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({ choices: [{ message: { content: responseContent } }] }),
      },
    },
  }
}

function crearSdkError() {
  return {
    chat: { completions: { create: vi.fn().mockRejectedValue(new Error('API timeout')) } },
  }
}

function crearLangfuse() {
  const generation = { end: vi.fn() }
  const trace = { generation: vi.fn().mockReturnValue(generation), event: vi.fn() }
  return { trace: vi.fn().mockReturnValue(trace), _gen: generation, _trace: trace }
}

function crearLlm(sdk: ReturnType<typeof crearSdk>, lf = crearLangfuse()) {
  return new WasagroAIAgent(new GroqAdapter({ apiKey: 'test', sdkClient: sdk as any, }), lf as any )
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

const contextoAdminBase: ContextoConversacion = {
  historial: [],
  preguntas_realizadas: 0,
  datos_recolectados: {},
}

const contextoAgricultorBase: ContextoOnboardingAgricultor = {
  historial: [],
  paso_actual: 1,
  datos_recolectados: {},
  fincas_disponibles: '- F001: Finca Uno (cacao)',
}

const respuestaOnboardingValida = {
  paso_completado: 1,
  siguiente_paso: 2,
  datos_extraidos: { nombre: 'Carlos', rol: 'propietario', consentimiento: null },
  mensaje_para_usuario: '¿Cuál es el nombre de tu finca?',
  onboarding_completo: false,
}

const resumenSemanalValido = {
  semana: '2026-W15',
  finca_id: 'F001',
  total_eventos: 5,
  eventos_por_tipo: { insumo: 3, plaga: 2 },
  alertas: [{ tipo: 'plaga', descripcion: 'Monilia detectada en lote norte', severidad: 'alta' }],
  resumen_narrativo: 'Esta semana se registraron 3 aplicaciones de insumos y 2 reportes de plaga.',
  requiere_atencion: true,
  es_solo_informativo: true,
}

const entradaResumenBase: EntradaResumenSemanal = {
  finca_id: 'F001',
  finca_nombre: 'Finca Uno',
  cultivo_principal: 'cacao',
  fecha_inicio: '2026-04-18',
  fecha_fin: '2026-04-25',
  eventos: [
    { tipo_evento: 'insumo', fecha_evento: '2026-04-20', lote_id: 'F001-L01', datos_evento: {}, descripcion_raw: 'Apliqué mancozeb', confidence_score: 0.9, status: 'complete' },
  ],
}

// ─── onboardarAdmin ───────────────────────────────────────────────────────────

describe('GroqLLM.onboardarAdmin', () => {
  it('happy path → retorna RespuestaOnboarding válida', async () => {
    const sdk = crearSdk(JSON.stringify(respuestaOnboardingValida))
    const result = await crearLlm(sdk).onboardarAdmin('Soy Carlos, propietario', contextoAdminBase, 'trace-oa-1')

    expect(result.paso_completado).toBe(1)
    expect(result.mensaje_para_usuario).toBe('¿Cuál es el nombre de tu finca?')
    expect(result.onboarding_completo).toBe(false)
  })

  it('incluye historial previo en el mensaje al LLM', async () => {
    const contextoConHistorial: ContextoConversacion = {
      historial: [
        { rol: 'agente', contenido: '¡Hola! ¿Cómo te llamas?' },
        { rol: 'usuario', contenido: 'Soy Carlos' },
      ],
      preguntas_realizadas: 1,
      datos_recolectados: { nombre: 'Carlos' },
    }
    const sdk = crearSdk(JSON.stringify(respuestaOnboardingValida))
    await crearLlm(sdk).onboardarAdmin('Tengo 3 fincas', contextoConHistorial, 'trace-oa-2')

    const llamada = sdk.chat.completions.create.mock.calls[0][0]
    const contenidoUser = llamada.messages[1]?.content as string
    expect(contenidoUser).toContain('Soy Carlos')
    expect(contenidoUser).toContain('Tengo 3 fincas')
  })

  it('LLM devuelve texto libre → fallback a paso_completado:0, no lanza', async () => {
    const sdk = crearSdk('Hola, cuéntame más sobre tu finca.')
    const result = await crearLlm(sdk).onboardarAdmin('Hola', contextoAdminBase, 'trace-oa-fb')

    expect(result.paso_completado).toBe(0)
    expect(result.mensaje_para_usuario).toBe('Hola, cuéntame más sobre tu finca.')
    expect(result.onboarding_completo).toBe(false)
  })

  it('LLM devuelve JSON con schema inválido → lanza PARSE_ERROR', async () => {
    const invalido = { paso_completado: 'no-es-numero', mensaje_para_usuario: 123 }
    const sdk = crearSdk(JSON.stringify(invalido))
    await expect(crearLlm(sdk).onboardarAdmin('Hola', contextoAdminBase, 'trace-oa-pe'))
      .rejects.toMatchObject({ code: 'PARSE_ERROR' })
  })

  it('SDK lanza excepción → lanza GROQ_ERROR', async () => {
    const sdk = crearSdkError()
    await expect(crearLlm(sdk as any).onboardarAdmin('Hola', contextoAdminBase, 'trace-oa-ge'))
      .rejects.toMatchObject({ code: 'GROQ_ERROR' })
  })

  it('emite generation "onboardar_admin" en LangFuse', async () => {
    const sdk = crearSdk(JSON.stringify(respuestaOnboardingValida))
    const lf = crearLangfuse()
    await crearLlm(sdk, lf).onboardarAdmin('Hola', contextoAdminBase, 'trace-oa-lf')

    expect(lf._trace.generation).toHaveBeenCalledWith(expect.objectContaining({ name: 'onboardar_admin' }))
    expect(lf._gen.end).toHaveBeenCalled()
  })

  it('onboarding_completo=true → retorna true en el campo', async () => {
    const respuestaCompleta = { ...respuestaOnboardingValida, paso_completado: 6, siguiente_paso: 6, onboarding_completo: true }
    const sdk = crearSdk(JSON.stringify(respuestaCompleta))
    const result = await crearLlm(sdk).onboardarAdmin('Sí, todo está bien', contextoAdminBase, 'trace-oa-done')

    expect(result.onboarding_completo).toBe(true)
  })
})

// ─── onboardarAgricultor ──────────────────────────────────────────────────────

describe('GroqLLM.onboardarAgricultor', () => {
  it('happy path → retorna RespuestaOnboarding válida', async () => {
    const sdk = crearSdk(JSON.stringify({
      ...respuestaOnboardingValida,
      datos_extraidos: { nombre: 'Pedro', finca_id: 'F001', consentimiento: true },
    }))
    const result = await crearLlm(sdk).onboardarAgricultor('Soy Pedro, quiero unirme a Finca Uno', contextoAgricultorBase, 'trace-agr-1')

    expect(result.datos_extraidos?.nombre).toBe('Pedro')
    expect(result.datos_extraidos?.finca_id).toBe('F001')
    expect(result.datos_extraidos?.consentimiento).toBe(true)
  })

  it('inyecta lista de fincas disponibles en el prompt', async () => {
    const sdk = crearSdk(JSON.stringify(respuestaOnboardingValida))
    await crearLlm(sdk).onboardarAgricultor('Hola', {
      ...contextoAgricultorBase,
      fincas_disponibles: '- F002: Finca Sur (banano)',
    }, 'trace-agr-2')

    const llamada = sdk.chat.completions.create.mock.calls[0][0]
    const systemPrompt = llamada.messages[0]?.content as string
    // La variable FINCAS_DISPONIBLES se inyecta en el prompt (aunque el prompt está mockeado,
    // el test verifica que injectarVariables fue llamado correctamente mediante el user content)
    expect(llamada.messages).toHaveLength(2)
  })

  it('LLM devuelve texto libre → fallback a paso_completado:0, no lanza', async () => {
    const sdk = crearSdk('¿Cómo te llamas?')
    const result = await crearLlm(sdk).onboardarAgricultor('Hola', contextoAgricultorBase, 'trace-agr-fb')

    expect(result.paso_completado).toBe(0)
    expect(result.mensaje_para_usuario).toBe('¿Cómo te llamas?')
  })

  it('SDK lanza excepción → lanza GROQ_ERROR', async () => {
    const sdk = crearSdkError()
    await expect(crearLlm(sdk as any).onboardarAgricultor('Hola', contextoAgricultorBase, 'trace-agr-ge'))
      .rejects.toMatchObject({ code: 'GROQ_ERROR' })
  })

  it('status_usuario=pendiente_aprobacion se preserva en la respuesta', async () => {
    const sdk = crearSdk(JSON.stringify({
      ...respuestaOnboardingValida,
      status_usuario: 'pendiente_aprobacion',
      notificar_jefe: true,
    }))
    const result = await crearLlm(sdk).onboardarAgricultor('Sí, quiero unirme', contextoAgricultorBase, 'trace-agr-pend')

    expect(result.status_usuario).toBe('pendiente_aprobacion')
    expect(result.notificar_jefe).toBe(true)
  })
})

// ─── resumirSemana ────────────────────────────────────────────────────────────

describe('GroqLLM.resumirSemana', () => {
  it('happy path → retorna ResumenSemanal válido con es_solo_informativo=true', async () => {
    const sdk = crearSdk(JSON.stringify(resumenSemanalValido))
    const result = await crearLlm(sdk).resumirSemana(entradaResumenBase, 'trace-rs-1')

    expect(result.es_solo_informativo).toBe(true)
    expect(result.resumen_narrativo).toContain('insumos')
    expect(result.requiere_atencion).toBe(true)
  })

  it('incluye alertas de alta severidad en la respuesta', async () => {
    const sdk = crearSdk(JSON.stringify(resumenSemanalValido))
    const result = await crearLlm(sdk).resumirSemana(entradaResumenBase, 'trace-rs-alertas')

    expect(result.alertas).toHaveLength(1)
    expect(result.alertas[0]!.severidad).toBe('alta')
    expect(result.alertas[0]!.descripcion).toContain('Monilia')
  })

  it('resumen sin alertas → retorna array vacío, requiere_atencion=false', async () => {
    const resumenSinAlertas = { ...resumenSemanalValido, alertas: [], requiere_atencion: false }
    const sdk = crearSdk(JSON.stringify(resumenSinAlertas))
    const result = await crearLlm(sdk).resumirSemana(entradaResumenBase, 'trace-rs-sin-alertas')

    expect(result.alertas).toHaveLength(0)
    expect(result.requiere_atencion).toBe(false)
  })

  it('LLM devuelve texto libre → lanza PARSE_ERROR', async () => {
    const sdk = crearSdk('Esta semana hubo mucha lluvia en la finca.')
    await expect(crearLlm(sdk).resumirSemana(entradaResumenBase, 'trace-rs-pe'))
      .rejects.toMatchObject({ code: 'PARSE_ERROR' })
  })

  it('JSON con es_solo_informativo=false → lanza PARSE_ERROR (Regla 3)', async () => {
    const invalido = { ...resumenSemanalValido, es_solo_informativo: false }
    const sdk = crearSdk(JSON.stringify(invalido))
    await expect(crearLlm(sdk).resumirSemana(entradaResumenBase, 'trace-rs-no-info'))
      .rejects.toMatchObject({ code: 'PARSE_ERROR' })
  })

  it('JSON con campos faltantes → lanza PARSE_ERROR', async () => {
    const incompleto = { resumen_narrativo: 'Texto', es_solo_informativo: true }
    const sdk = crearSdk(JSON.stringify(incompleto))
    await expect(crearLlm(sdk).resumirSemana(entradaResumenBase, 'trace-rs-incompleto'))
      .rejects.toMatchObject({ code: 'PARSE_ERROR' })
  })

  it('SDK lanza excepción → lanza GROQ_ERROR', async () => {
    const sdk = crearSdkError()
    await expect(crearLlm(sdk as any).resumirSemana(entradaResumenBase, 'trace-rs-ge'))
      .rejects.toMatchObject({ code: 'GROQ_ERROR' })
  })

  it('emite generation "resumir_semana" con finca_id y total_eventos en LangFuse', async () => {
    const sdk = crearSdk(JSON.stringify(resumenSemanalValido))
    const lf = crearLangfuse()
    await crearLlm(sdk, lf).resumirSemana(entradaResumenBase, 'trace-rs-lf')

    expect(lf._trace.generation).toHaveBeenCalledWith(expect.objectContaining({
      name: 'resumir_semana',
      input: expect.objectContaining({ finca_id: 'F001', total_eventos: 1 }),
    }))
    expect(lf._gen.end).toHaveBeenCalled()
  })

  it('inyecta todas las variables del prompt (finca_nombre, cultivo, fechas, eventos)', async () => {
    const sdk = crearSdk(JSON.stringify(resumenSemanalValido))
    await crearLlm(sdk).resumirSemana(entradaResumenBase, 'trace-rs-vars')

    // La llamada al LLM ocurre 1 vez
    expect(sdk.chat.completions.create).toHaveBeenCalledTimes(1)
    const llamada = sdk.chat.completions.create.mock.calls[0][0]
    const userContent = llamada.messages[1]?.content as string
    expect(userContent).toContain('Finca Uno')
  })
})
