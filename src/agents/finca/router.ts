import { Hono } from 'hono'
import { z } from 'zod'
import { supabase } from '../../integrations/supabase.js'
import { requireFincaAccessAsync, getUserSupabase } from '../../auth/middleware.js'
import { getEventosRevisionSigatoka, getEventoSigatokaById, actualizarEventoDatos, guardarCorreccionesSigatoka, type CorreccionSigatokaInsert } from '../../pipeline/supabaseQueries.js'
import { getSignedUrlEvento } from '../../integrations/supabaseStorage.js'
import { contarCeldasIlegibles, aplicarAclaraciones, aplicarCorrecciones } from '../../pipeline/handlers/SigatokaHandler.js'
import { langfuse } from '../../integrations/langfuse.js'
import { AclaracionCeldaSchema, type SigatokaMuestreo, type CeldaMuestra } from '../../types/dominio/SigatokaMuestreo.js'

export const fincaRouter = new Hono()

// Schema de una corrección explícita del asesor (pisa celdas ya leídas, P7).
const CorreccionSchema = z.object({
  punto: z.string(),
  campo: z.string(),
  valor: z.number().nullable(),
})

const RevisionPatchSchema = z.object({
  aclaraciones: z.array(AclaracionCeldaSchema).optional(),
  correcciones: z.array(CorreccionSchema).optional(),
  marcar_revisado: z.boolean().optional(),
})

function sigatokaDe(datos: Record<string, unknown>): SigatokaMuestreo | null {
  const s = datos['sigatoka']
  return s && typeof s === 'object' ? (s as SigatokaMuestreo) : null
}

const CoordenadasSchema = z.array(
  z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])
).min(3)

const CrearLoteSchema = z.object({
  nombre: z.string().min(1).max(100),
  hectareas: z.number().positive().optional(),
  coordenadas: CoordenadasSchema,
})

const RenombrarLoteSchema = z.object({
  nombre: z.string().min(1).max(100),
})

// GET /api/finca/:finca_id — datos básicos + centroide como lat/lng numérico
fincaRouter.get('/:finca_id', async (c) => {
  const finca_id = c.req.param('finca_id')
  if (!await requireFincaAccessAsync(c, finca_id)) return c.json({ error: 'Sin acceso a esta finca' }, 403)
  const db = getUserSupabase(c) ?? supabase
  const { data, error } = await db.rpc('get_finca_centroide', { p_finca_id: finca_id })
  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: 'Finca no encontrada' }, 404)
  return c.json({ finca: data })
})

// GET /api/finca/:finca_id/lotes
fincaRouter.get('/:finca_id/lotes', async (c) => {
  const finca_id = c.req.param('finca_id')
  if (!await requireFincaAccessAsync(c, finca_id)) return c.json({ error: 'Sin acceso a esta finca' }, 403)
  const db = getUserSupabase(c) ?? supabase
  const { data, error } = await db
    .from('lotes')
    .select('lote_id, nombre_coloquial, hectareas, activo')
    .eq('finca_id', finca_id)
    .eq('activo', true)
    .order('lote_id')
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ lotes: data ?? [] })
})

// POST /api/finca/:finca_id/lotes — crea un lote con polígono
// Body: { nombre: string, hectareas: number, coordenadas: [[lat,lng],...] }
fincaRouter.post('/:finca_id/lotes', async (c) => {
  const finca_id = c.req.param('finca_id')
  if (!await requireFincaAccessAsync(c, finca_id)) return c.json({ error: 'Sin acceso a esta finca' }, 403)
  const rawBody = await c.req.json().catch(() => null)
  const parsed = CrearLoteSchema.safeParse(rawBody)
  if (!parsed.success) {
    return c.json({ error: 'Datos inválidos', details: parsed.error.issues }, 400)
  }
  const body = parsed.data

  const coords = body.coordenadas

  // Contar lotes existentes para generar el ID siguiente
  const { count } = await supabase
    .from('lotes')
    .select('*', { count: 'exact', head: true })
    .eq('finca_id', finca_id)

  const nextNum = (count ?? 0) + 1
  const lote_id = `${finca_id}-L${String(nextNum).padStart(2, '0')}`

  // Centroide simple (media aritmética)
  const lat_c = coords.reduce((s, [lat]) => s + lat, 0) / coords.length
  const lng_c = coords.reduce((s, [, lng]) => s + lng, 0) / coords.length

  // WKT: POLYGON((lng lat, ...)) — PostGIS usa (lng lat)
  const ring = [...coords, coords[0]!]
  const polygonWkt = `POLYGON((${ring.map(([lat, lng]) => `${lng} ${lat}`).join(',')}))`

  const { error } = await supabase.rpc('insertar_lote', {
    p_lote_id: lote_id,
    p_finca_id: finca_id,
    p_nombre: body.nombre,
    p_hectareas: body.hectareas ?? null,
    p_lat_c: lat_c,
    p_lng_c: lng_c,
    p_polygon_wkt: polygonWkt,
  })

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ lote_id, ok: true }, 201)
})

// PATCH /api/finca/:finca_id/coordenadas — guardar centro del mapa cuando el admin lo ubica manualmente
fincaRouter.patch('/:finca_id/coordenadas', async (c) => {
  const finca_id = c.req.param('finca_id')
  if (!await requireFincaAccessAsync(c, finca_id)) return c.json({ error: 'Sin acceso a esta finca' }, 403)
  const body = await c.req.json().catch(() => null)
  const lat = typeof body?.lat === 'number' ? body.lat : null
  const lng = typeof body?.lng === 'number' ? body.lng : null
  if (lat === null || lng === null) return c.json({ error: 'Faltan lat y lng numéricos' }, 400)
  const { error } = await supabase.rpc('update_finca_coordenadas', { p_finca_id: finca_id, p_lat: lat, p_lng: lng })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ ok: true })
})

// ── Cola de revisión de muestreos de Sigatoka (D30) ──────────────────────────

// GET /api/finca/:finca_id/sigatoka/revision — lista de muestreos requires_review
fincaRouter.get('/:finca_id/sigatoka/revision', async (c) => {
  const finca_id = c.req.param('finca_id')
  if (!await requireFincaAccessAsync(c, finca_id)) return c.json({ error: 'Sin acceso a esta finca' }, 403)
  const eventos = await getEventosRevisionSigatoka(finca_id)
  const items = eventos.map(e => {
    const sig = sigatokaDe(e.datos_evento)
    const ilegibles = sig ? contarCeldasIlegibles(sig.puntosMuestreo, sig.plantas11sem, sig.plantas00sem ?? []) : { total: 0, ubicaciones: [], ruta: 'completo' as const }
    return {
      id: e.id,
      created_at: e.created_at,
      confidence_score: e.confidence_score,
      semana: sig?.semana ?? null,
      nombre_finca: sig?.nombreFinca ?? null,
      tiene_imagen: e.imagen_path != null,
      ilegibles: { total: ilegibles.total, ruta: ilegibles.ruta },
    }
  })
  return c.json({ eventos: items })
})

// GET /api/finca/:finca_id/sigatoka/revision/:evento_id — detalle + URL firmada
fincaRouter.get('/:finca_id/sigatoka/revision/:evento_id', async (c) => {
  const finca_id = c.req.param('finca_id')
  const evento_id = c.req.param('evento_id')
  if (!await requireFincaAccessAsync(c, finca_id)) return c.json({ error: 'Sin acceso a esta finca' }, 403)

  const evento = await getEventoSigatokaById(evento_id)
  if (!evento || evento.finca_id !== finca_id) return c.json({ error: 'Evento no encontrado' }, 404)

  const sig = sigatokaDe(evento.datos_evento)
  const imagen_url = await getSignedUrlEvento(evento.imagen_path)
  const ilegibles = sig ? contarCeldasIlegibles(sig.puntosMuestreo, sig.plantas11sem, sig.plantas00sem ?? []) : { total: 0, ubicaciones: [], ruta: 'completo' as const }

  return c.json({
    id: evento.id,
    status: evento.status,
    created_at: evento.created_at,
    confidence_score: evento.confidence_score,
    sigatoka: sig,
    imagen_url,
    ilegibles,
  })
})

// PATCH /api/finca/:finca_id/sigatoka/revision/:evento_id — corrige celdas y/o cierra
// Body: {
//   aclaraciones?: [{punto, campo, valor}]  — solo celdas ilegibles (no pisa leídas)
//   correcciones?: [{punto, campo, valor}]  — acción humana explícita, puede pisar leídas (P7)
//   marcar_revisado?: boolean               — cierra aunque queden discrepancias
// }
fincaRouter.patch('/:finca_id/sigatoka/revision/:evento_id', async (c) => {
  const finca_id = c.req.param('finca_id')
  const evento_id = c.req.param('evento_id')
  if (!await requireFincaAccessAsync(c, finca_id)) return c.json({ error: 'Sin acceso a esta finca' }, 403)

  const parsed = RevisionPatchSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Datos inválidos', details: parsed.error.issues }, 400)

  const evento = await getEventoSigatokaById(evento_id)
  if (!evento || evento.finca_id !== finca_id) return c.json({ error: 'Evento no encontrado' }, 404)

  const sigatokaPrev = sigatokaDe(evento.datos_evento)
  if (!sigatokaPrev) return c.json({ error: 'El evento no es un muestreo de Sigatoka' }, 422)

  // Capturar valores previos ANTES de aplicar cualquier cambio para el flywheel de feedback.
  // Un helper inline lee la celda actual del sigatoka sin modificarlo.
  const leerCeldaPrev = (sig: SigatokaMuestreo, punto: string, campo: string): { valor: number | null; estado: string | null } => {
    if (punto.startsWith('11sem-') || punto.startsWith('00sem-')) {
      const es11 = punto.startsWith('11sem-')
      const m = punto.match(/^\d{2}sem-(\d+)$/)
      const numFila = m ? parseInt(m[1]!, 10) : -1
      const filas = es11 ? (sig.plantas11sem ?? []) : (sig.plantas00sem ?? [])
      const fila = filas.find((f, idx) => (f.fila ?? idx + 1) === numFila)
      if (!fila) return { valor: null, estado: null }
      const celda = (fila as unknown as Record<string, CeldaMuestra>)[campo]
      return { valor: celda?.valor ?? null, estado: celda?.estado ?? null }
    } else {
      const p = sig.puntosMuestreo.find(pt => pt.punto === punto)
      if (!p) return { valor: null, estado: null }
      const celda = (p as unknown as Record<string, CeldaMuestra>)[campo]
      return { valor: celda?.valor ?? null, estado: celda?.estado ?? null }
    }
  }

  // Obtener usuario autenticado para la trazabilidad de quién corrigió (puede ser null).
  const authHeader = c.req.header('authorization') ?? ''
  const userSupabase = getUserSupabase(c)
  let creadoPor: string | null = null
  if (userSupabase) {
    const { data: { user } } = await userSupabase.auth.getUser()
    creadoPor = user?.id ?? null
  }

  // Construir registros de feedback ANTES de aplicar cambios (captura estado previo).
  const feedbackRows: CorreccionSigatokaInsert[] = []

  for (const acl of parsed.data.aclaraciones ?? []) {
    const prev = leerCeldaPrev(sigatokaPrev, acl.punto, acl.campo)
    feedbackRows.push({
      evento_id, finca_id,
      punto: acl.punto, campo: acl.campo,
      valor_extraido: prev.valor, estado_extraido: prev.estado,
      valor_corregido: acl.valor,
      fuente: 'asesor_ui', creado_por: creadoPor,
    })
  }
  for (const cor of parsed.data.correcciones ?? []) {
    const prev = leerCeldaPrev(sigatokaPrev, cor.punto, cor.campo)
    feedbackRows.push({
      evento_id, finca_id,
      punto: cor.punto, campo: cor.campo,
      valor_extraido: prev.valor, estado_extraido: prev.estado,
      valor_corregido: cor.valor,
      fuente: 'asesor_ui', creado_por: creadoPor,
    })
  }

  // Deduplicar feedbackRows por (punto, campo): si el mismo par viene en
  // aclaraciones y correcciones, conservar el de correcciones (fue el último en
  // insertarse al array, ya que el loop de correcciones corre después).
  // Recorremos en orden inverso y usamos el primer hit encontrado por clave.
  const feedbackDeduped: CorreccionSigatokaInsert[] = []
  const vistosFC = new Set<string>()
  for (let i = feedbackRows.length - 1; i >= 0; i--) {
    const r = feedbackRows[i]!
    const clave = `${r.punto}||${r.campo}`
    if (!vistosFC.has(clave)) {
      vistosFC.add(clave)
      feedbackDeduped.unshift(r)
    }
  }

  // Persistir feedback — nunca debe tumbar el PATCH (P4).
  if (feedbackDeduped.length > 0) {
    guardarCorreccionesSigatoka(feedbackDeduped).catch(err => {
      const trace = langfuse.trace({ id: `feedback-err-${evento_id}` })
      trace.event({ name: 'sigatoka_feedback_error', level: 'WARNING', input: { error: String(err), evento_id } })
    })
  }

  // Aplicar aclaraciones (solo ilegibles) y después correcciones (puede pisar leídas).
  let actualizado = sigatokaPrev
  let correcciones_aplicadas: string[] = []
  let correcciones_ignoradas: string[] = []
  if (parsed.data.aclaraciones?.length) {
    actualizado = aplicarAclaraciones(actualizado, parsed.data.aclaraciones)
  }
  if (parsed.data.correcciones?.length) {
    const resultado = aplicarCorrecciones(actualizado, parsed.data.correcciones)
    actualizado = resultado.sigatoka
    correcciones_aplicadas = resultado.aplicadas
    correcciones_ignoradas = resultado.ignoradas
  }

  const datos = { ...evento.datos_evento, sigatoka: actualizado }

  // marcar_revisado = aprobación humana explícita del asesor (P7): cierra el
  // evento aunque queden discrepancias. Si no, el status sale de la lógica.
  const requiere = parsed.data.marcar_revisado ? false : actualizado.requiereValidacion
  const status = requiere ? 'requires_review' : 'complete'
  await actualizarEventoDatos(evento_id, datos, status, requiere)

  return c.json({ ok: true, status, correcciones_aplicadas, correcciones_ignoradas, ilegibles: contarCeldasIlegibles(actualizado.puntosMuestreo, actualizado.plantas11sem, actualizado.plantas00sem ?? []) })
})

async function loteToFincaId(lote_id: string): Promise<string | null> {
  const { data } = await supabase
    .from('lotes')
    .select('finca_id')
    .eq('lote_id', lote_id)
    .single()
  return data?.finca_id ?? null
}

// PUT /api/finca/lotes/:lote_id — renombrar lote
fincaRouter.put('/lotes/:lote_id', async (c) => {
  const lote_id = c.req.param('lote_id')
  const finca_id = await loteToFincaId(lote_id)
  if (!finca_id) return c.json({ error: 'Lote no encontrado' }, 404)
  if (!await requireFincaAccessAsync(c, finca_id)) return c.json({ error: 'Sin acceso a este lote' }, 403)

  const rawBody = await c.req.json().catch(() => null)
  const parsed = RenombrarLoteSchema.safeParse(rawBody)
  if (!parsed.success) return c.json({ error: 'Nombre inválido', details: parsed.error.issues }, 400)
  const body = parsed.data
  const { error } = await supabase
    .from('lotes')
    .update({ nombre_coloquial: body.nombre, updated_at: new Date().toISOString() })
    .eq('lote_id', lote_id)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ ok: true })
})

// DELETE /api/finca/lotes/:lote_id — desactivar lote
fincaRouter.delete('/lotes/:lote_id', async (c) => {
  const lote_id = c.req.param('lote_id')
  const finca_id = await loteToFincaId(lote_id)
  if (!finca_id) return c.json({ error: 'Lote no encontrado' }, 404)
  if (!await requireFincaAccessAsync(c, finca_id)) return c.json({ error: 'Sin acceso a este lote' }, 403)

  const { error } = await supabase.rpc('eliminar_lote', { p_lote_id: lote_id })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ ok: true })
})
