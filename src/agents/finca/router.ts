import { Hono } from 'hono'
import { z } from 'zod'
import { supabase } from '../../integrations/supabase.js'
import { requireFincaAccessAsync, getUserSupabase } from '../../auth/middleware.js'
import { getEventosRevisionSigatoka, getEventoSigatokaById, actualizarEventoDatos } from '../../pipeline/supabaseQueries.js'
import { getSignedUrlEvento } from '../../integrations/supabaseStorage.js'
import { contarCeldasIlegibles, aplicarAclaraciones } from '../../pipeline/handlers/SigatokaHandler.js'
import { AclaracionCeldaSchema, type SigatokaMuestreo } from '../../types/dominio/SigatokaMuestreo.js'

export const fincaRouter = new Hono()

const RevisionPatchSchema = z.object({
  aclaraciones: z.array(AclaracionCeldaSchema).optional(),
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
// Body: { aclaraciones?: [{punto, campo, valor}], marcar_revisado?: boolean }
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

  const actualizado = parsed.data.aclaraciones?.length
    ? aplicarAclaraciones(sigatokaPrev, parsed.data.aclaraciones)
    : sigatokaPrev

  const datos = { ...evento.datos_evento, sigatoka: actualizado }

  // marcar_revisado = aprobación humana explícita del asesor (P7): cierra el
  // evento aunque queden discrepancias. Si no, el status sale de la lógica.
  const requiere = parsed.data.marcar_revisado ? false : actualizado.requiereValidacion
  const status = requiere ? 'requires_review' : 'complete'
  await actualizarEventoDatos(evento_id, datos, status, requiere)

  return c.json({ ok: true, status, ilegibles: contarCeldasIlegibles(actualizado.puntosMuestreo, actualizado.plantas11sem, actualizado.plantas00sem ?? []) })
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
