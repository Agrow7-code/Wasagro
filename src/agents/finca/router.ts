import { Hono } from 'hono'
import { supabase } from '../../integrations/supabase.js'

export const fincaRouter = new Hono()

// GET /api/finca/:finca_id — datos básicos + centroide como lat/lng numérico
fincaRouter.get('/:finca_id', async (c) => {
  const finca_id = c.req.param('finca_id')
  const { data, error } = await supabase.rpc('get_finca_centroide', { p_finca_id: finca_id })
  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: 'Finca no encontrada' }, 404)
  return c.json({ finca: data })
})

// GET /api/finca/:finca_id/lotes
fincaRouter.get('/:finca_id/lotes', async (c) => {
  const finca_id = c.req.param('finca_id')
  const { data, error } = await supabase
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
  const body = await c.req.json().catch(() => null)

  if (!body?.nombre || !Array.isArray(body?.coordenadas) || body.coordenadas.length < 3) {
    return c.json({ error: 'Faltan nombre y al menos 3 coordenadas [[lat,lng],...]' }, 400)
  }

  const coords: [number, number][] = body.coordenadas

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
  const ring = [...coords, coords[0]]
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

// PUT /api/finca/lotes/:lote_id — renombrar lote
fincaRouter.put('/lotes/:lote_id', async (c) => {
  const lote_id = c.req.param('lote_id')
  const body = await c.req.json().catch(() => null)
  if (!body?.nombre) return c.json({ error: 'Falta nombre' }, 400)
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
  const { error } = await supabase.rpc('eliminar_lote', { p_lote_id: lote_id })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ ok: true })
})
