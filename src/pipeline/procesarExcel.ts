import { langfuse } from '../integrations/langfuse.js'
import type { NormalizedMessage } from '../integrations/whatsapp/NormalizedMessage.js'
import type { IWhatsAppSender } from '../integrations/whatsapp/IWhatsAppSender.js'
import type { IWasagroLLM } from '../integrations/llm/IWasagroLLM.js'
import type { FilaExcel, EntradaClasificacionExcel } from '../types/dominio/Excel.js'
import {
  getOrCreateSession,
  updateSession,
  actualizarMensaje,
  saveEvento,
} from './supabaseQueries.js'

const MAX_MUESTRA_FILAS = 5
const MAX_FILAS_BATCH = 500

// ─── Parseo de XLSX / CSV sin dependencia externa ──────────────────────────
// Soporta CSV nativo. Para XLSX binario se requiere la librería 'xlsx'.
// En H0, la mayoría de archivos agrícolas son CSV o XLSX básico.

async function descargarArchivo(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Error descargando archivo: ${res.status} ${res.statusText}`)
  const buffer = await res.arrayBuffer()
  return Buffer.from(buffer)
}

function parsearCSV(contenido: string): { columnas: string[]; filas: FilaExcel[] } {
  const lineas = contenido.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  if (lineas.length < 2) return { columnas: [], filas: [] }

  const separador = lineas[0]!.includes(';') ? ';' : ','
  const columnas = lineas[0]!.split(separador).map(c => c.trim().replace(/^["']|["']$/g, ''))

  const filas: FilaExcel[] = lineas.slice(1).map(linea => {
    const valores = linea.split(separador).map(v => v.trim().replace(/^["']|["']$/g, ''))
    const fila: FilaExcel = {}
    for (const [i, col] of columnas.entries()) {
      const val = valores[i] ?? ''
      const num = parseFloat(val)
      fila[col] = val === '' ? null : isNaN(num) ? val : num
    }
    return fila
  })

  return { columnas, filas }
}

async function parsearArchivo(buffer: Buffer, mimetype: string, nombre: string): Promise<{ columnas: string[]; filas: FilaExcel[] }> {
  const esCSV = mimetype.includes('csv') || nombre.endsWith('.csv')
  if (esCSV) {
    return parsearCSV(buffer.toString('utf-8'))
  }

  // XLSX — requiere librería 'xlsx'. Si no está disponible, error descriptivo.
  try {
    // Dynamic import para no requerir la librería si no se usa
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const XLSX: any = await import('xlsx' as string).catch(() => null)
    if (!XLSX) throw new Error('XLSX_NO_DISPONIBLE')
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const hoja = workbook.Sheets[workbook.SheetNames[0]]
    if (!hoja) return { columnas: [], filas: [] }
    const datos: FilaExcel[] = XLSX.utils.sheet_to_json(hoja, { defval: null })
    const columnas = datos.length > 0 ? Object.keys(datos[0] as object) : []
    return { columnas, filas: datos }
  } catch (err) {
    if (err instanceof Error && err.message === 'XLSX_NO_DISPONIBLE') {
      throw new Error('Por ahora solo proceso archivos CSV. Guarda tu Excel como CSV y vuelve a enviarlo. ✅')
    }
    throw err
  }
}

// ─── Flujo principal ───────────────────────────────────────────────────────

export async function handleDocumento(
  msg: NormalizedMessage,
  usuario: { id: string; finca_id: string | null; finca_nombre?: string; cultivo_principal?: string },
  mensajeId: string,
  traceId: string,
  sender: IWhatsAppSender,
  llm: IWasagroLLM,
): Promise<void> {
  const trace = langfuse.trace({ id: traceId })

  if (!usuario.finca_id) {
    await sender.enviarTexto(msg.from, 'Para procesar archivos primero necesitas registrar tu finca. ⚠️')
    await actualizarMensaje(mensajeId, { status: 'processed' })
    return
  }

  try {
    const buffer = await descargarArchivo(msg.documentoUrl!)
    const { columnas, filas } = await parsearArchivo(buffer, msg.documentoMimetype ?? '', msg.documentoNombre ?? '')

    if (filas.length === 0 || columnas.length === 0) {
      await sender.enviarTexto(msg.from, 'Tu archivo parece estar vacío o no pude leerlo. ¿Puedes enviarlo de nuevo? ⚠️')
      await actualizarMensaje(mensajeId, { status: 'processed' })
      return
    }

    const muestra = filas.slice(0, MAX_MUESTRA_FILAS)
    const entradaExcel: EntradaClasificacionExcel = {
      nombre_archivo: msg.documentoNombre ?? 'archivo',
      columnas,
      muestra_filas: muestra,
      total_filas: Math.min(filas.length, MAX_FILAS_BATCH),
    }
    if (usuario.finca_nombre !== undefined) entradaExcel.finca_nombre = usuario.finca_nombre
    if (usuario.cultivo_principal !== undefined) entradaExcel.cultivo_principal = usuario.cultivo_principal
    const clasificacion = await llm.clasificarExcel(entradaExcel, traceId)

    trace.event({ name: 'excel_clasificado', input: { tipo: clasificacion.tipo_datos, filas: clasificacion.filas_detectadas, confianza: clasificacion.confianza } })

    if (clasificacion.tipo_datos === 'desconocido') {
      await sender.enviarTexto(msg.from, clasificacion.mensaje_confirmacion)
      await actualizarMensaje(mensajeId, { status: 'processed' })
      return
    }

    // Guardar filas + clasificación en sesión para procesar cuando el usuario confirme
    const session = await getOrCreateSession(msg.from, 'reporte')
    await updateSession(session.session_id, {
      status: 'pending_excel_confirm',
      contexto_parcial: {
        excel_tipo: clasificacion.tipo_datos,
        excel_columnas: columnas,
        excel_filas: filas.slice(0, MAX_FILAS_BATCH),
        excel_nombre: msg.documentoNombre ?? 'archivo',
        excel_mensaje_id: mensajeId,
      },
    })

    await sender.enviarTexto(msg.from, clasificacion.mensaje_confirmacion)
    await actualizarMensaje(mensajeId, { status: 'awaiting_confirmation' })
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err)
    // Error descriptivo (ej. CSV solamente) → enviar al usuario directamente
    if (mensaje.includes('solo proceso') || mensaje.includes('CSV')) {
      trace.event({ name: 'excel_formato_no_soportado', level: 'WARNING', input: { error: mensaje } })
      await sender.enviarTexto(msg.from, mensaje)
      await actualizarMensaje(mensajeId, { status: 'processed' })
      return
    }
    trace.event({ name: 'excel_error', level: 'ERROR', input: { error: mensaje } })
    throw err
  }
}

// ─── Procesar filas confirmadas ────────────────────────────────────────────

export async function procesarFilasExcelConfirmadas(
  sessionContexto: Record<string, unknown>,
  usuarioId: string,
  fincaId: string,
  traceId: string,
): Promise<{ insertados: number; errores: number }> {
  const tipo = sessionContexto['excel_tipo'] as string
  const filas = sessionContexto['excel_filas'] as FilaExcel[]

  let insertados = 0
  let errores = 0

  const trace = langfuse.trace({ id: traceId })

  for (const fila of filas) {
    try {
      const descripcionRaw = Object.entries(fila)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')

      await saveEvento({
        finca_id: fincaId,
        lote_id: null,
        tipo_evento: tipo === 'mixto' ? 'nota_libre' : tipo,
        status: 'requires_review',
        datos_evento: fila as Record<string, unknown>,
        descripcion_raw: descripcionRaw,
        confidence_score: 0.5,
        requiere_validacion: true,
        created_by: usuarioId,
      })
      insertados++
    } catch (err) {
      console.error('[procesarExcel] Error insertando fila:', err)
      trace.event({
        name: 'excel_fila_error',
        level: 'ERROR',
        input: { error: String(err), columnas: Object.keys(fila) },
      })
      errores++
    }
  }

  trace.event({
    name: 'excel_procesado',
    input: { tipo, total: filas.length, insertados, errores },
  })

  return { insertados, errores }
}
