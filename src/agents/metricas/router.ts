import { Hono } from 'hono'
import { supabase } from '../../integrations/supabase.js'
import {
  calcularMetrica,
  calcularMetricaPorLotes,
  persistirResultado,
  obtenerCamposDisponibles,
  type Formula,
  type Umbral,
} from '../../pipeline/metricaEngine.js'

export const metricasRouter = new Hono()

// ── GET /api/metricas/campos/:finca_id
// Devuelve los campos numéricos disponibles para esa finca (alimenta el selector de la UI)
metricasRouter.get('/campos/:finca_id', async (c) => {
  const finca_id = c.req.param('finca_id')
  const campos = await obtenerCamposDisponibles(finca_id)
  return c.json({ campos })
})

// ── POST /api/metricas/calcular
// Cálculo ad-hoc (no persiste). Usado por la calculadora del agricultor.
// Body: { formula, finca_id, lote_id?, fecha_inicio, fecha_fin, umbrales? }
metricasRouter.post('/calcular', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.formula || !body?.finca_id || !body?.fecha_inicio || !body?.fecha_fin) {
    return c.json({ error: 'Faltan parámetros: formula, finca_id, fecha_inicio, fecha_fin' }, 400)
  }

  const resultado = await calcularMetrica(
    body.formula as Formula,
    body.finca_id,
    body.lote_id ?? null,
    body.fecha_inicio,
    body.fecha_fin,
    (body.umbrales ?? []) as Umbral[],
  )

  return c.json(resultado)
})

// ── POST /api/metricas/calcular/lotes
// Cálculo ad-hoc desglosado por lote. Usado por admin/gerente.
metricasRouter.post('/calcular/lotes', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.formula || !body?.finca_id || !body?.fecha_inicio || !body?.fecha_fin) {
    return c.json({ error: 'Faltan parámetros: formula, finca_id, fecha_inicio, fecha_fin' }, 400)
  }

  const resultados = await calcularMetricaPorLotes(
    body.formula as Formula,
    body.finca_id,
    body.fecha_inicio,
    body.fecha_fin,
    (body.umbrales ?? []) as Umbral[],
  )

  return c.json({ resultados })
})

// ── GET /api/metricas/:finca_id
// Lista las métricas guardadas de una finca + plantillas públicas de su org.
metricasRouter.get('/:finca_id', async (c) => {
  const finca_id = c.req.param('finca_id')

  const { data: finca } = await supabase
    .from('fincas').select('org_id').eq('finca_id', finca_id).single()

  if (!finca) return c.json({ error: 'Finca no encontrada' }, 404)

  const { data: metricas } = await supabase
    .from('metricas_finca')
    .select('*')
    .eq('activa', true)
    .or(`finca_id.eq.${finca_id},and(org_id.eq.${finca.org_id},es_publica.eq.true,finca_id.is.null)`)
    .order('created_at', { ascending: false })

  return c.json({ metricas: metricas ?? [] })
})

// ── POST /api/metricas
// Guarda una métrica nueva (con o sin umbrales).
// Body: { finca_id, nombre, tipo_evento, formula, unidad?, umbrales?, org_id? }
// org_id es opcional — se resuelve desde finca_id si no viene en el body.
metricasRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.finca_id || !body?.nombre || !body?.tipo_evento || !body?.formula) {
    return c.json({ error: 'Faltan campos requeridos' }, 400)
  }

  let org_id: string = body.org_id ?? ''
  if (!org_id) {
    const { data: finca } = await supabase
      .from('fincas').select('org_id').eq('finca_id', body.finca_id).single()
    if (!finca?.org_id) return c.json({ error: 'Finca no encontrada' }, 404)
    org_id = finca.org_id
  }

  const { data: metrica, error } = await supabase
    .from('metricas_finca')
    .insert({
      org_id,
      finca_id:    body.finca_id,
      nombre:      body.nombre,
      descripcion: body.descripcion ?? null,
      tipo_evento: body.tipo_evento,
      formula:     body.formula,
      unidad:      body.unidad ?? null,
      es_publica:  body.es_publica ?? false,
      created_by:  body.created_by ?? null,
    })
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)

  // Guardar umbrales si vienen en el body
  if (body.umbrales?.length && metrica) {
    const filas = (body.umbrales as Umbral[]).map(u => ({
      metrica_id: metrica.metrica_id,
      finca_id:   body.finca_id,
      nivel:      u.nivel,
      valor_min:  u.valor_min,
      valor_max:  u.valor_max ?? null,
    }))
    await supabase.from('umbrales_metrica').insert(filas)
  }

  return c.json({ metrica }, 201)
})

// ── PUT /api/metricas/:metrica_id/umbrales
// Actualiza o crea umbrales para una métrica + finca.
metricasRouter.put('/:metrica_id/umbrales', async (c) => {
  const metrica_id = c.req.param('metrica_id')
  const body = await c.req.json().catch(() => null)
  if (!body?.finca_id || !body?.umbrales?.length) {
    return c.json({ error: 'Faltan finca_id y umbrales' }, 400)
  }

  // Upsert por nivel — preserva el historial, no hace DELETE duro
  const filas = (body.umbrales as Umbral[]).map(u => ({
    metrica_id,
    finca_id:  body.finca_id,
    nivel:     u.nivel,
    valor_min: u.valor_min,
    valor_max: u.valor_max ?? null,
  }))

  const { error } = await supabase
    .from('umbrales_metrica')
    .upsert(filas, { onConflict: 'metrica_id,finca_id,nivel' })
  if (error) return c.json({ error: error.message }, 500)

  return c.json({ ok: true })
})

// ── GET /api/metricas/:metrica_id/resultados
// Resultados guardados en caché con filtro de fechas.
// Query params: finca_id, fecha_inicio, fecha_fin, lote_id?
metricasRouter.get('/:metrica_id/resultados', async (c) => {
  const metrica_id  = c.req.param('metrica_id')
  const finca_id    = c.req.query('finca_id')
  const fecha_inicio = c.req.query('fecha_inicio')
  const fecha_fin   = c.req.query('fecha_fin')
  const lote_id     = c.req.query('lote_id')

  if (!finca_id || !fecha_inicio || !fecha_fin) {
    return c.json({ error: 'Faltan finca_id, fecha_inicio, fecha_fin' }, 400)
  }

  let query = supabase
    .from('resultados_metricas')
    .select('*')
    .eq('metrica_id', metrica_id)
    .eq('finca_id', finca_id)
    .gte('fecha_inicio', fecha_inicio)
    .lte('fecha_fin', fecha_fin)
    .order('fecha_fin', { ascending: false })

  if (lote_id) query = query.eq('lote_id', lote_id)

  const { data } = await query
  return c.json({ resultados: data ?? [] })
})

// ── POST /api/metricas/:metrica_id/recalcular
// Recalcula y persiste el resultado para una métrica guardada.
// Body: { finca_id, fecha_inicio, fecha_fin }
metricasRouter.post('/:metrica_id/recalcular', async (c) => {
  const metrica_id = c.req.param('metrica_id')
  const body = await c.req.json().catch(() => null)
  if (!body?.finca_id || !body?.fecha_inicio || !body?.fecha_fin) {
    return c.json({ error: 'Faltan finca_id, fecha_inicio, fecha_fin' }, 400)
  }

  const { data: metrica } = await supabase
    .from('metricas_finca')
    .select('formula')
    .eq('metrica_id', metrica_id)
    .single()

  if (!metrica) return c.json({ error: 'Métrica no encontrada' }, 404)

  const { data: umbralesRaw } = await supabase
    .from('umbrales_metrica')
    .select('nivel, valor_min, valor_max')
    .eq('metrica_id', metrica_id)
    .eq('finca_id', body.finca_id)

  const umbrales = (umbralesRaw ?? []) as Umbral[]

  const resultados = await calcularMetricaPorLotes(
    metrica.formula as Formula,
    body.finca_id,
    body.fecha_inicio,
    body.fecha_fin,
    umbrales,
  )

  for (const r of resultados) {
    await persistirResultado(metrica_id, body.finca_id, r.lote_id, body.fecha_inicio, body.fecha_fin, r)
  }

  return c.json({ resultados })
})

// ── DELETE /api/metricas/:metrica_id
// Desactiva (soft delete) una métrica.
metricasRouter.delete('/:metrica_id', async (c) => {
  const metrica_id = c.req.param('metrica_id')
  const { error } = await supabase
    .from('metricas_finca')
    .update({ activa: false })
    .eq('metrica_id', metrica_id)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ ok: true })
})
