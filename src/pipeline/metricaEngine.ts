import { supabase } from '../integrations/supabase.js'

// ── Tipos de fórmula ──────────────────────────────────────────────────────────

type BloqueAgregacion = 'sum' | 'avg' | 'count' | 'max' | 'min'
type BloqueOperador   = 'add' | 'sub' | 'mul' | 'div'

export type BloqueCampo = {
  tipo:        'campo'
  evento_tipo: string
  campo:       string
  agregacion:  BloqueAgregacion
}

export type BloqueNumero = {
  tipo:  'numero'
  valor: number
}

export type BloqueOperadorDef = {
  tipo:  'operador'
  valor: BloqueOperador
}

export type BloqueFormula = BloqueCampo | BloqueNumero | BloqueOperadorDef

export type Formula = {
  operaciones: BloqueFormula[]
}

export type NivelUmbral = 'bajo' | 'medio' | 'alto' | 'critico'

export type Umbral = {
  nivel:     NivelUmbral
  valor_min: number
  valor_max: number | null
}

export type ResultadoCalculo = {
  valor:        number | null
  nivel_actual: NivelUmbral | null
  error?:       string
}

export type ResultadoPorLote = {
  lote_id:   string | null
  lote_nombre: string | null
} & ResultadoCalculo

// ── Resolución de campo desde datos_evento JSONB ──────────────────────────────

async function resolverBloqueCampo(
  bloque: BloqueCampo,
  finca_id: string,
  lote_id: string | null,
  fecha_inicio: string,
  fecha_fin: string,
): Promise<number | null> {
  let query = supabase
    .from('eventos_campo')
    .select(`datos_evento`)
    .eq('finca_id', finca_id)
    .eq('tipo_evento', bloque.evento_tipo)
    .gte('fecha_evento', fecha_inicio)
    .lte('fecha_evento', fecha_fin)
    .not('datos_evento', 'is', null)

  if (lote_id) query = query.eq('lote_id', lote_id)

  const { data, error } = await query
  if (error || !data?.length) return null

  const valores: number[] = []
  for (const row of data) {
    const raw = (row.datos_evento as Record<string, unknown>)?.[bloque.campo]
    const n = Number(raw)
    if (!isNaN(n)) valores.push(n)
  }

  if (!valores.length) return null

  switch (bloque.agregacion) {
    case 'sum':   return valores.reduce((a, b) => a + b, 0)
    case 'avg':   return valores.reduce((a, b) => a + b, 0) / valores.length
    case 'count': return valores.length
    case 'max':   return Math.max(...valores)
    case 'min':   return Math.min(...valores)
  }
}

// ── Evaluación izquierda a derecha ────────────────────────────────────────────

function aplicarOperador(a: number, op: BloqueOperador, b: number): number {
  switch (op) {
    case 'add': return a + b
    case 'sub': return a - b
    case 'mul': return a * b
    case 'div': return b !== 0 ? a / b : NaN
  }
}

// ── Nivel según umbrales ──────────────────────────────────────────────────────

function resolverNivel(valor: number, umbrales: Umbral[]): NivelUmbral | null {
  for (const u of umbrales) {
    const dentroMin = valor >= u.valor_min
    const dentroMax = u.valor_max === null || valor <= u.valor_max
    if (dentroMin && dentroMax) return u.nivel
  }
  return null
}

// ── Engine principal ──────────────────────────────────────────────────────────

export async function calcularMetrica(
  formula: Formula,
  finca_id: string,
  lote_id: string | null,
  fecha_inicio: string,
  fecha_fin: string,
  umbrales: Umbral[] = [],
): Promise<ResultadoCalculo> {
  const stack: number[] = []
  let operadorPendiente: BloqueOperador | null = null

  for (const bloque of formula.operaciones) {
    if (bloque.tipo === 'operador') {
      operadorPendiente = bloque.valor
      continue
    }

    let valor: number | null = null

    if (bloque.tipo === 'numero') {
      valor = bloque.valor
    } else if (bloque.tipo === 'campo') {
      valor = await resolverBloqueCampo(bloque, finca_id, lote_id, fecha_inicio, fecha_fin)
    }

    if (valor === null) {
      return { valor: null, nivel_actual: null, error: `Sin datos para campo "${(bloque as BloqueCampo).campo ?? ''}"` }
    }

    if (stack.length === 0) {
      stack.push(valor)
    } else if (operadorPendiente) {
      const anterior = stack.pop()!
      stack.push(aplicarOperador(anterior, operadorPendiente, valor))
      operadorPendiente = null
    } else {
      stack.push(valor)
    }
  }

  const resultado = stack[0] ?? null
  if (resultado === null || isNaN(resultado)) {
    return { valor: null, nivel_actual: null, error: 'División por cero o fórmula vacía' }
  }

  const redondeado = Math.round(resultado * 100) / 100
  return {
    valor: redondeado,
    nivel_actual: umbrales.length ? resolverNivel(redondeado, umbrales) : null,
  }
}

// ── Cálculo por lote (para el dashboard de admin/gerente) ─────────────────────

export async function calcularMetricaPorLotes(
  formula: Formula,
  finca_id: string,
  fecha_inicio: string,
  fecha_fin: string,
  umbrales: Umbral[] = [],
): Promise<ResultadoPorLote[]> {
  const { data: lotes } = await supabase
    .from('lotes')
    .select('lote_id, nombre')
    .eq('finca_id', finca_id)
    .eq('activo', true)

  const resultados: ResultadoPorLote[] = []

  // Por lote
  for (const lote of lotes ?? []) {
    const r = await calcularMetrica(formula, finca_id, lote.lote_id, fecha_inicio, fecha_fin, umbrales)
    resultados.push({ lote_id: lote.lote_id, lote_nombre: lote.nombre, ...r })
  }

  // Total finca
  const total = await calcularMetrica(formula, finca_id, null, fecha_inicio, fecha_fin, umbrales)
  resultados.push({ lote_id: null, lote_nombre: 'Toda la finca', ...total })

  return resultados
}

// ── Persistir resultado en caché ──────────────────────────────────────────────

export async function persistirResultado(
  metrica_id: string,
  finca_id: string,
  lote_id: string | null,
  fecha_inicio: string,
  fecha_fin: string,
  resultado: ResultadoCalculo,
): Promise<void> {
  await supabase
    .from('resultados_metricas')
    .upsert({
      metrica_id,
      finca_id,
      lote_id,
      fecha_inicio,
      fecha_fin,
      valor: resultado.valor,
      nivel_actual: resultado.nivel_actual,
      calculado_at: new Date().toISOString(),
    }, { onConflict: 'metrica_id,finca_id,lote_id,fecha_inicio,fecha_fin' })
}

// ── Campos disponibles para una finca (para el selector de la UI) ─────────────

export async function obtenerCamposDisponibles(
  finca_id: string,
): Promise<{ tipo_evento: string; campo: string; conteo: number }[]> {
  const { data } = await supabase
    .from('eventos_campo')
    .select('tipo_evento, datos_evento')
    .eq('finca_id', finca_id)
    .not('datos_evento', 'is', null)
    .limit(500)

  if (!data?.length) return []

  const mapa = new Map<string, number>()

  for (const row of data) {
    const tipo = row.tipo_evento as string
    const datos = row.datos_evento as Record<string, unknown>
    for (const [campo, val] of Object.entries(datos)) {
      if (typeof val === 'number' || (!isNaN(Number(val)) && val !== null && val !== '')) {
        const key = `${tipo}::${campo}`
        mapa.set(key, (mapa.get(key) ?? 0) + 1)
      }
    }
  }

  return Array.from(mapa.entries())
    .map(([key, conteo]) => {
      const [tipo_evento, campo] = key.split('::') as [string, string]
      return { tipo_evento, campo, conteo }
    })
    .sort((a, b) => b.conteo - a.conteo)
}
