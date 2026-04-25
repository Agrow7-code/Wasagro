import { langfuse } from '../integrations/langfuse.js'
import type { IWhatsAppSender } from '../integrations/whatsapp/IWhatsAppSender.js'
import { getFincasActivas, getAdminsByFinca } from './supabaseQueries.js'
import { getUltimosPreciosBanano } from '../integrations/market/BananaTradersClient.js'

type GetPreciosFn = typeof getUltimosPreciosBanano

function buildMensajePrecio(
  nombre: string | null,
  precioActual: number,
  precioAnterior: number,
  fecha: string,
): string | null {
  if (precioActual === precioAnterior) return null

  const primerNombre = nombre?.split(' ')[0] ?? null
  const saludo = primerNombre ? `${primerNombre}, ` : ''
  const subio = precioActual > precioAnterior
  const emoji = subio ? '📈' : '📉'
  const movimiento = subio ? 'subió' : 'bajó'

  return `${emoji} ${saludo}el precio de referencia de cajas de banano ${movimiento} a $${precioActual.toFixed(2)} (antes $${precioAnterior.toFixed(2)}). Fecha: ${fecha}.`
}

export async function enviarAlertasPrecio(
  sender: IWhatsAppSender,
  deps: { getPreciosFn?: GetPreciosFn } = {},
): Promise<{ enviadas: number; errores: number }> {
  const getPreciosFn = deps.getPreciosFn ?? getUltimosPreciosBanano
  const trace = langfuse.trace({ name: 'alertas_precio' })

  let precios
  try {
    precios = await getPreciosFn()
  } catch (err) {
    console.error('[alertaPrecio] Error obteniendo precios:', err)
    trace.event({ name: 'error_fetch_precios', level: 'ERROR', input: { error: String(err) } })
    return { enviadas: 0, errores: 1 }
  }

  if (!precios) {
    trace.event({ name: 'precios_no_disponibles', level: 'WARNING' })
    return { enviadas: 0, errores: 0 }
  }

  const [ultimo, anterior] = precios
  let enviadas = 0
  let errores = 0

  // Solo fincas bananeras activas
  const todasFincas = await getFincasActivas()
  const fincasBanano = todasFincas.filter(f => {
    const cultivo = f.cultivo_principal?.toLowerCase() ?? ''
    return cultivo.includes('banano') || cultivo.includes('banana')
  })

  for (const finca of fincasBanano) {
    try {
      const admins = await getAdminsByFinca(finca.finca_id)
      for (const admin of admins) {
        const mensaje = buildMensajePrecio(admin.nombre, ultimo.precio, anterior.precio, ultimo.fecha)
        if (!mensaje) continue

        await sender.enviarTexto(admin.phone, mensaje)
        enviadas++
        trace.event({
          name: 'alerta_precio_enviada',
          input: { finca_id: finca.finca_id, phone: admin.phone, precio: ultimo.precio, anterior: anterior.precio },
        })
      }
    } catch (err) {
      console.error(`[alertaPrecio] Error procesando finca ${finca.finca_id}:`, err)
      trace.event({ name: 'alerta_precio_error', level: 'ERROR', input: { finca_id: finca.finca_id, error: String(err) } })
      errores++
    }
  }

  trace.event({ name: 'alertas_precio_completado', output: { enviadas, errores } })
  return { enviadas, errores }
}

export { buildMensajePrecio }
