import { langfuse } from '../integrations/langfuse.js'
import type { IWasagroLLM } from '../integrations/llm/IWasagroLLM.js'
import type { IWhatsAppSender } from '../integrations/whatsapp/IWhatsAppSender.js'
import type { EntradaResumenSemanal } from '../types/dominio/Resumen.js'
import { getFincasActivas, getEventosByFincaRango, getAdminsByFinca } from './supabaseQueries.js'

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function rangoSemanaAnterior(): { desde: Date; hasta: Date } {
  const hasta = new Date()
  hasta.setHours(0, 0, 0, 0)
  const desde = new Date(hasta)
  desde.setDate(desde.getDate() - 7)
  return { desde, hasta }
}

export async function generarYEnviarReportes(llm: IWasagroLLM, sender: IWhatsAppSender): Promise<{ procesadas: number; errores: number }> {
  const { desde, hasta } = rangoSemanaAnterior()
  const fincas = await getFincasActivas()

  let procesadas = 0
  let errores = 0

  for (const finca of fincas) {
    try {
      const enviado = await procesarReporteFinca(finca.finca_id, finca.nombre, finca.cultivo_principal ?? 'no especificado', desde, hasta, llm, sender)
      if (enviado) procesadas++
    } catch (err) {
      console.error(`[reporteSemanal] Error procesando finca ${finca.finca_id}:`, err)
      errores++
    }
  }

  return { procesadas, errores }
}

async function procesarReporteFinca(
  fincaId: string,
  fincaNombre: string,
  cultivoPrincipal: string,
  desde: Date,
  hasta: Date,
  llm: IWasagroLLM,
  sender: IWhatsAppSender,
): Promise<boolean> {
  const trace = langfuse.trace({ name: 'reporte_semanal', metadata: { finca_id: fincaId } })

  const eventos = await getEventosByFincaRango(fincaId, desde, hasta)
  if (eventos.length === 0) {
    trace.event({ name: 'sin_eventos_semana', level: 'DEFAULT', input: { finca_id: fincaId } })
    return false
  }

  const admins = await getAdminsByFinca(fincaId)
  if (admins.length === 0) {
    trace.event({ name: 'sin_admins', level: 'WARNING', input: { finca_id: fincaId } })
    return false
  }

  const entrada: EntradaResumenSemanal = {
    finca_id: fincaId,
    finca_nombre: fincaNombre,
    cultivo_principal: cultivoPrincipal,
    fecha_inicio: formatDate(desde),
    fecha_fin: formatDate(hasta),
    eventos,
  }

  let resumen
  try {
    resumen = await llm.resumirSemana(entrada, trace.id)
  } catch (err) {
    trace.event({ name: 'error_llm_resumen', level: 'ERROR', input: { finca_id: fincaId, error: String(err) } })
    throw err
  }

  // Regla 3: solo enviar si el resumen es puramente informativo (sin recomendaciones ni órdenes)
  if (!resumen.es_solo_informativo) {
    trace.event({ name: 'reporte_bloqueado', level: 'WARNING', input: { finca_id: fincaId, motivo: 'es_solo_informativo !== true' } })
    return false
  }

  for (const admin of admins) {
    try {
      await sender.enviarTexto(admin.phone, resumen.resumen_narrativo)

      if (resumen.requiere_atencion) {
        const alertasAltas = resumen.alertas
          .filter(a => a.severidad === 'alta')
          .map(a => `⚠️ ${a.descripcion}`)
          .join('\n')
        if (alertasAltas) {
          await sender.enviarTexto(admin.phone, alertasAltas)
        }
      }
    } catch (err) {
      trace.event({ name: 'error_envio_whatsapp', level: 'ERROR', input: { admin_phone: admin.phone, finca_id: fincaId, error: String(err) } })
      console.error(`[reporteSemanal] Error enviando a ${admin.phone}:`, err)
    }
  }

  trace.event({
    name: 'reporte_enviado',
    level: 'DEFAULT',
    output: {
      finca_id: fincaId,
      total_eventos: eventos.length,
      admins_notificados: admins.length,
      requiere_atencion: resumen.requiere_atencion,
    },
  })

  return true
}
