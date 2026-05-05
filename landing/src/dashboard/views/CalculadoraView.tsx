import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Topbar, TopbarPeriod } from '../layout/Topbar'
import { lotes } from '../mock/data'
import { addMetrica } from '../store/metricasStore'

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Agregacion = 'sum' | 'avg' | 'count' | 'max' | 'min'
type Operador   = 'add' | 'sub' | 'mul' | 'div'

interface Variable {
  id:          string
  label:       string
  campo:       string
  evento_tipo: string
  categoria:   string
  unidad:      string
}

interface BloqueVar   { tipo: 'var';   variable: Variable; agregacion: Agregacion }
interface BloqueNum   { tipo: 'num';   valor: number; _input: string }
interface BloqueOp    { tipo: 'op';    valor: Operador }
interface BloqueParen { tipo: 'paren'; valor: 'open' | 'close' }

type Bloque = BloqueVar | BloqueNum | BloqueOp | BloqueParen

// ── Variables disponibles ─────────────────────────────────────────────────────

const VARIABLES: Variable[] = [
  { id: 'plaga_individuos', label: 'Individuos encontrados', campo: 'individuos_encontrados',  evento_tipo: 'plaga',             categoria: 'Plagas',  unidad: 'individuos' },
  { id: 'plaga_muestra',    label: 'Tamaño de muestra',      campo: 'tamano_muestra',          evento_tipo: 'plaga',             categoria: 'Plagas',  unidad: 'hijos' },
  { id: 'plaga_area',       label: 'Área afectada',          campo: 'area_afectada_ha',        evento_tipo: 'plaga',             categoria: 'Plagas',  unidad: 'ha' },
  { id: 'plaga_pct',        label: 'Porcentaje afectado',    campo: 'pct_afectado',            evento_tipo: 'plaga',             categoria: 'Plagas',  unidad: '%' },
  { id: 'cosecha_kg',       label: 'Kilos cosechados',       campo: 'kilos_cosechados',        evento_tipo: 'cosecha',           categoria: 'Cosecha', unidad: 'kg' },
  { id: 'cosecha_cajas',    label: 'Cajas cortadas',         campo: 'cajas_cortadas',          evento_tipo: 'cosecha',           categoria: 'Cosecha', unidad: 'cajas' },
  { id: 'cosecha_rend',     label: 'Rendimiento kg/ha',      campo: 'rendimiento_kg_ha',       evento_tipo: 'cosecha',           categoria: 'Cosecha', unidad: 'kg/ha' },
  { id: 'insumo_cantidad',  label: 'Cantidad aplicada',      campo: 'cantidad_aplicada',       evento_tipo: 'aplicacion_insumo', categoria: 'Insumos', unidad: 'L' },
  { id: 'insumo_dosis',     label: 'Dosis',                  campo: 'dosis_cantidad',          evento_tipo: 'aplicacion_insumo', categoria: 'Insumos', unidad: 'L/ha' },
  { id: 'gasto_monto',      label: 'Monto del gasto',        campo: 'costo_monto',             evento_tipo: 'gasto',             categoria: 'Gastos',  unidad: '$' },
  { id: 'labor_jornales',   label: 'Jornales',               campo: 'jornales',                evento_tipo: 'labor',             categoria: 'Labor',   unidad: 'jornales' },
]

const CATEGORIAS = ['Plagas', 'Cosecha', 'Insumos', 'Gastos', 'Labor']

const CAT_COLOR: Record<string, string> = {
  Plagas: '#D45828', Cosecha: '#3EBB6A', Insumos: '#2A50D4', Gastos: '#C9A800', Labor: '#0D0F0C',
}
const CAT_BG: Record<string, string> = {
  Plagas: '#FFF4F0', Cosecha: '#F0FFF4', Insumos: '#F0F4FF', Gastos: '#FFFBF0', Labor: '#F5F1E8',
}

const LABEL_AGR: Record<Agregacion, string> = {
  sum: 'Σ Suma', avg: 'x̄ Prom', count: '# Conteo', max: '↑ Máx', min: '↓ Mín',
}
const LABEL_OP: Record<Operador, string> = { add: '+', sub: '−', mul: '×', div: '÷' }

// ── Mock de datos por lote ────────────────────────────────────────────────────

const MOCK_BASE: Record<string, Record<string, number>> = {
  L1: { individuos_encontrados: 8,  tamano_muestra: 20, area_afectada_ha: 0.30, pct_afectado: 14, kilos_cosechados: 310, cajas_cortadas: 6, rendimiento_kg_ha: 148, cantidad_aplicada: 4.2, dosis_cantidad: 2.0, costo_monto: 210, jornales: 5 },
  L2: { individuos_encontrados: 3,  tamano_muestra: 20, area_afectada_ha: 0.10, pct_afectado: 5,  kilos_cosechados: 280, cajas_cortadas: 5, rendimiento_kg_ha: 155, cantidad_aplicada: 3.6, dosis_cantidad: 2.0, costo_monto: 180, jornales: 3 },
  L3: { individuos_encontrados: 12, tamano_muestra: 20, area_afectada_ha: 0.50, pct_afectado: 21, kilos_cosechados: 504, cajas_cortadas: 9, rendimiento_kg_ha: 210, cantidad_aplicada: 6.0, dosis_cantidad: 2.5, costo_monto: 320, jornales: 7 },
  L4: { individuos_encontrados: 9,  tamano_muestra: 20, area_afectada_ha: 0.40, pct_afectado: 18, kilos_cosechados: 375, cajas_cortadas: 7, rendimiento_kg_ha: 250, cantidad_aplicada: 7.5, dosis_cantidad: 3.0, costo_monto: 290, jornales: 6 },
  L5: { individuos_encontrados: 5,  tamano_muestra: 20, area_afectada_ha: 0.20, pct_afectado: 10, kilos_cosechados: 420, cajas_cortadas: 8, rendimiento_kg_ha: 210, cantidad_aplicada: 5.0, dosis_cantidad: 2.5, costo_monto: 240, jornales: 4 },
  L6: { individuos_encontrados: 2,  tamano_muestra: 20, area_afectada_ha: 0.10, pct_afectado: 4,  kilos_cosechados: 250, cajas_cortadas: 4, rendimiento_kg_ha: 131, cantidad_aplicada: 2.8, dosis_cantidad: 1.5, costo_monto: 150, jornales: 3 },
  L7: { individuos_encontrados: 18, tamano_muestra: 20, area_afectada_ha: 0.80, pct_afectado: 35, kilos_cosechados: 490, cajas_cortadas: 9, rendimiento_kg_ha: 213, cantidad_aplicada: 5.8, dosis_cantidad: 2.5, costo_monto: 380, jornales: 8 },
  L8: { individuos_encontrados: 4,  tamano_muestra: 20, area_afectada_ha: 0.15, pct_afectado: 7,  kilos_cosechados: 320, cajas_cortadas: 6, rendimiento_kg_ha: 200, cantidad_aplicada: 3.2, dosis_cantidad: 2.0, costo_monto: 190, jornales: 4 },
  L9: { individuos_encontrados: 3,  tamano_muestra: 20, area_afectada_ha: 0.10, pct_afectado: 6,  kilos_cosechados: 290, cajas_cortadas: 5, rendimiento_kg_ha: 145, cantidad_aplicada: 3.0, dosis_cantidad: 1.5, costo_monto: 160, jornales: 3 },
}

// ── Evaluador Shunting-yard (soporta precedencia + paréntesis) ────────────────

type Token = { t: 'num'; v: number } | { t: 'op'; v: Operador } | { t: 'paren'; v: 'open' | 'close' }

const PREC: Record<Operador, number> = { add: 1, sub: 1, mul: 2, div: 2 }

function applyOp(stack: number[], op: Operador) {
  const b = stack.pop() ?? 0
  const a = stack.pop() ?? 0
  if (op === 'add') stack.push(a + b)
  else if (op === 'sub') stack.push(a - b)
  else if (op === 'mul') stack.push(a * b)
  else if (op === 'div') stack.push(b !== 0 ? a / b : 0)
}

function evaluarTokens(tokens: Token[]): number | null {
  const output: number[]  = []
  const ops:    string[]  = []   // Operador | 'open'

  for (const tok of tokens) {
    if (tok.t === 'num') {
      output.push(tok.v)
    } else if (tok.t === 'op') {
      while (ops.length > 0 && ops[ops.length - 1] !== 'open' && PREC[ops[ops.length - 1] as Operador] >= PREC[tok.v]) {
        applyOp(output, ops.pop() as Operador)
      }
      ops.push(tok.v)
    } else if (tok.v === 'open') {
      ops.push('open')
    } else {
      while (ops.length > 0 && ops[ops.length - 1] !== 'open') {
        applyOp(output, ops.pop() as Operador)
      }
      ops.pop() // quitar '('
    }
  }

  while (ops.length > 0) applyOp(output, ops.pop() as Operador)

  if (output.length !== 1) return null
  return Math.round(output[0] * 100) / 100
}

function evaluarFormula(bloques: Bloque[], loteId: string): number | null {
  const tokens: Token[] = bloques.map(b => {
    if (b.tipo === 'var')   return { t: 'num', v: MOCK_BASE[loteId]?.[b.variable.campo] ?? 0 }
    if (b.tipo === 'num')   return { t: 'num', v: b.valor }
    if (b.tipo === 'op')    return { t: 'op',  v: b.valor }
    if (b.tipo === 'paren') return { t: 'paren', v: b.valor }
    return null
  }).filter((x): x is Token => x !== null)
  return evaluarTokens(tokens)
}

// ── Helpers de inserción ──────────────────────────────────────────────────────

function ultimoTipo(bloques: Bloque[]): Bloque['tipo'] | null {
  if (!bloques.length) return null
  return bloques[bloques.length - 1].tipo
}

function esValor(tipo: Bloque['tipo'] | null) {
  return tipo === 'var' || tipo === 'num' || tipo === 'paren'
  // 'paren' solo el close actúa como valor — refinado en lógica de inserción
}

// ── Componente principal ──────────────────────────────────────────────────────

export function CalculadoraView() {
  const navigate = useNavigate()
  const [categoriaActiva, setCategoriaActiva] = useState('Cosecha')
  const [bloques, setBloques]       = useState<Bloque[]>([])
  const [fechaInicio, setFechaInicio] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) })
  const [fechaFin, setFechaFin]     = useState(() => new Date().toISOString().slice(0, 10))
  const [resultados, setResultados] = useState<{ loteId: string; nombre: string; ha: number; valor: number | null }[] | null>(null)
  const [calculando, setCalculando] = useState(false)
  const [nombreMetrica, setNombreMetrica] = useState('')
  const [guardado, setGuardado]     = useState(false)

  // ── Modificadores de fórmula ────────────────────────────────────────────────

  function push(...items: Bloque[]) {
    setBloques(prev => [...prev, ...items])
    setResultados(null)
  }

  function agregarVariable(v: Variable) {
    setBloques(prev => {
      const last = prev.length ? prev[prev.length - 1] : null
      const needsOp = last && (last.tipo === 'var' || last.tipo === 'num' || (last.tipo === 'paren' && last.valor === 'close'))
      return [
        ...prev,
        ...(needsOp ? [{ tipo: 'op', valor: 'mul' } as BloqueOp] : []),
        { tipo: 'var', variable: v, agregacion: 'sum' } as BloqueVar,
      ]
    })
    setResultados(null)
  }

  function agregarOperador(op: Operador) {
    const last = ultimoTipo(bloques)
    if (!last) return                       // no tiene sentido un operador al inicio
    if (last === 'op') return               // no dos operadores seguidos
    if (last === 'paren') {
      const prev = bloques[bloques.length - 1] as BloqueParen
      if (prev.valor === 'open') return     // op justo después de '(' no válido
    }
    push({ tipo: 'op', valor: op })
  }

  function agregarParenAbierto() {
    const last = ultimoTipo(bloques)
    // Después de un valor cerrado necesitamos operador primero
    const needsOp = last === 'var' || last === 'num' || (last === 'paren' && (bloques[bloques.length - 1] as BloqueParen).valor === 'close')
    setBloques(prev => [
      ...prev,
      ...(needsOp ? [{ tipo: 'op', valor: 'mul' } as BloqueOp] : []),
      { tipo: 'paren', valor: 'open' } as BloqueParen,
    ])
    setResultados(null)
  }

  function agregarParenCerrado() {
    const last = ultimoTipo(bloques)
    if (!last) return
    if (last === 'op' || (last === 'paren' && (bloques[bloques.length - 1] as BloqueParen).valor === 'open')) return
    // Contar paréntesis abiertos sin cerrar
    let open = 0
    for (const b of bloques) {
      if (b.tipo === 'paren') open += b.valor === 'open' ? 1 : -1
    }
    if (open <= 0) return
    push({ tipo: 'paren', valor: 'close' })
  }

  function agregarNumero() {
    const last = ultimoTipo(bloques)
    const needsOp = last === 'var' || last === 'num' || (last === 'paren' && (bloques[bloques.length - 1] as BloqueParen).valor === 'close')
    setBloques(prev => [
      ...prev,
      ...(needsOp ? [{ tipo: 'op', valor: 'mul' } as BloqueOp] : []),
      { tipo: 'num', valor: 1, _input: '1' } as BloqueNum,
    ])
    setResultados(null)
  }

  function eliminar(idx: number) {
    setBloques(prev => {
      const next = [...prev]
      if (idx > 0 && next[idx - 1]?.tipo === 'op') next.splice(idx - 1, 2)
      else if (idx < next.length - 1 && next[idx + 1]?.tipo === 'op') next.splice(idx, 2)
      else next.splice(idx, 1)
      return next
    })
    setResultados(null)
  }

  function actualizar(idx: number, cambios: Partial<Bloque>) {
    setBloques(prev => prev.map((b, i) => i === idx ? { ...b, ...cambios } as Bloque : b))
    setResultados(null)
  }

  function limpiar() { setBloques([]); setResultados(null); setNombreMetrica('') }

  // ── Cálculo ─────────────────────────────────────────────────────────────────

  function calcular() {
    if (!bloques.length) return
    setCalculando(true)
    setTimeout(() => {
      setResultados(lotes.map(l => ({
        loteId: l.id, nombre: l.nombre, ha: l.hectareas,
        valor: evaluarFormula(bloques, l.id),
      })))
      setCalculando(false)
    }, 500)
  }

  // ── Preview de fórmula en texto ──────────────────────────────────────────────

  const formulaTexto = bloques.map(b => {
    if (b.tipo === 'var')   return `${LABEL_AGR[b.agregacion]}(${b.variable.label})`
    if (b.tipo === 'num')   return String(b.valor)
    if (b.tipo === 'op')    return LABEL_OP[b.valor]
    if (b.tipo === 'paren') return b.valor === 'open' ? '(' : ')'
    return ''
  }).join(' ')

  const valoresValidos = resultados?.filter(r => r.valor !== null).map(r => r.valor as number) ?? []
  const maxValor = valoresValidos.length ? Math.max(...valoresValidos) : 1
  const primeraVar = bloques.find(b => b.tipo === 'var') as BloqueVar | undefined
  const unidadResult = primeraVar?.variable.unidad ?? ''

  function guardar() {
    if (!nombreMetrica.trim() || !resultados) return
    addMetrica({
      id:           `metrica-${Date.now()}`,
      nombre:       nombreMetrica.trim(),
      unidad:       unidadResult,
      formulaTexto: formulaTexto,
      categoria:    primeraVar?.variable.categoria ?? 'Cosecha',
      resultados:   resultados,
      creadaEn:     new Date().toISOString().slice(0, 10),
    })
    setGuardado(true)
    setTimeout(() => {
      setGuardado(false)
      navigate('/dashboard')
    }, 1500)
  }

  // ── Conteo de paréntesis abiertos sin cerrar ──────────────────────────────

  let openParens = 0
  for (const b of bloques) if (b.tipo === 'paren') openParens += b.valor === 'open' ? 1 : -1

  const lastTipo = ultimoTipo(bloques)
  const canAddOp   = lastTipo === 'var' || lastTipo === 'num' || (lastTipo === 'paren' && (bloques[bloques.length - 1] as BloqueParen | undefined)?.valor === 'close')
  const canAddOpen = true
  const canAddClose = openParens > 0 && canAddOp

  // ── Render ───────────────────────────────────────────────────────────────────

  const varsByCat = VARIABLES.filter(v => v.categoria === categoriaActiva)

  return (
    <>
      <Topbar
        title="Calculadora"
        badge="H0-R"
        avatarInitials="CM"
        rightSlot={<TopbarPeriod>29 Abr 2026</TopbarPeriod>}
      />

      <main style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 24 }}>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.4)', marginBottom: 4 }}>
            Calculadora de métricas
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0D0F0C', lineHeight: 1.2 }}>
            Construí tu propia métrica con datos reales del campo
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, alignItems: 'start' }}>

          {/* ── Panel izquierdo: variables ───────────────────────────── */}
          <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C' }}>
            <div style={{ borderBottom: '2px solid #0D0F0C', padding: '12px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(13,15,12,0.45)', marginBottom: 8 }}>
                Variables
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {CATEGORIAS.map(cat => (
                  <button key={cat} onClick={() => setCategoriaActiva(cat)} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                    background: categoriaActiva === cat ? CAT_BG[cat] : 'transparent',
                    border: categoriaActiva === cat ? `2px solid ${CAT_COLOR[cat]}` : '2px solid transparent',
                    cursor: 'pointer', textAlign: 'left',
                  }}>
                    <div style={{ width: 8, height: 8, background: CAT_COLOR[cat], flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: categoriaActiva === cat ? CAT_COLOR[cat] : '#0D0F0C' }}>
                      {cat}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {varsByCat.map(v => {
                const enFormula = bloques.some(b => b.tipo === 'var' && b.variable.id === v.id)
                return (
                  <button key={v.id} onClick={() => agregarVariable(v)} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', background: enFormula ? CAT_BG[v.categoria] : '#fff',
                    border: `2px solid ${enFormula ? CAT_COLOR[v.categoria] : 'rgba(13,15,12,0.15)'}`,
                    cursor: 'pointer', textAlign: 'left',
                  }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#0D0F0C' }}>{v.label}</div>
                      <div style={{ fontSize: 10, color: 'rgba(13,15,12,0.45)', marginTop: 1 }}>{v.unidad}</div>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 300, color: enFormula ? CAT_COLOR[v.categoria] : 'rgba(13,15,12,0.25)', lineHeight: 1 }}>
                      {enFormula ? '✓' : '+'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Panel derecho ────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Constructor de fórmula */}
            <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C' }}>

              {/* Cabecera */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '2px solid #0D0F0C' }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Fórmula</span>
                {bloques.length > 0 && (
                  <button onClick={limpiar} style={{ fontSize: 11, fontWeight: 600, color: 'rgba(13,15,12,0.45)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    Limpiar todo
                  </button>
                )}
              </div>

              {/* Zona de bloques */}
              <div style={{ padding: '16px 20px', minHeight: 80 }}>
                {bloques.length === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'rgba(13,15,12,0.3)', fontSize: 13 }}>
                    Seleccioná una variable del panel izquierdo para empezar
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {bloques.map((b, idx) => {

                      if (b.tipo === 'op') {
                        return (
                          <select key={idx} value={b.valor} onChange={e => actualizar(idx, { valor: e.target.value as Operador })}
                            style={{ background: '#0D0F0C', color: '#C9F03B', border: '2px solid #0D0F0C', padding: '6px 8px', fontSize: 16, fontWeight: 800, cursor: 'pointer', appearance: 'none' as const, width: 44, textAlign: 'center' }}>
                            {(['add','sub','mul','div'] as Operador[]).map(op => (
                              <option key={op} value={op}>{LABEL_OP[op]}</option>
                            ))}
                          </select>
                        )
                      }

                      if (b.tipo === 'paren') {
                        return (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 3, background: '#EEE9D8', border: '2px solid rgba(13,15,12,0.3)', padding: '5px 8px' }}>
                            <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, color: '#0D0F0C' }}>
                              {b.valor === 'open' ? '(' : ')'}
                            </span>
                            <button onClick={() => eliminar(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(13,15,12,0.35)', fontSize: 13, padding: 0, lineHeight: 1 }}>×</button>
                          </div>
                        )
                      }

                      if (b.tipo === 'num') {
                        return (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#EEE9D8', border: '2px solid #0D0F0C', padding: '5px 10px' }}>
                            <input
                              type="text" inputMode="decimal" value={b._input}
                              onChange={e => {
                                const n = parseFloat(e.target.value)
                                actualizar(idx, { _input: e.target.value, valor: isNaN(n) ? 0 : n } as Partial<BloqueNum>)
                              }}
                              style={{ border: 'none', background: 'transparent', width: 64, fontSize: 14, fontWeight: 800, textAlign: 'center', outline: 'none', color: '#0D0F0C' }}
                            />
                            <button onClick={() => eliminar(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(13,15,12,0.4)', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                          </div>
                        )
                      }

                      // tipo === 'var'
                      const bv = b as BloqueVar
                      return (
                        <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4, background: CAT_BG[bv.variable.categoria], border: `2px solid ${CAT_COLOR[bv.variable.categoria]}`, padding: '6px 10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 6, height: 6, background: CAT_COLOR[bv.variable.categoria] }} />
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#0D0F0C' }}>{bv.variable.label}</span>
                            <button onClick={() => eliminar(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(13,15,12,0.35)', fontSize: 14, padding: 0, lineHeight: 1, marginLeft: 2 }}>×</button>
                          </div>
                          <select value={bv.agregacion} onChange={e => actualizar(idx, { agregacion: e.target.value as Agregacion })}
                            style={{ background: 'transparent', border: `1px solid ${CAT_COLOR[bv.variable.categoria]}60`, padding: '2px 6px', fontSize: 10, fontWeight: 700, color: CAT_COLOR[bv.variable.categoria], cursor: 'pointer', appearance: 'none' as const }}>
                            {(['sum','avg','count','max','min'] as Agregacion[]).map(a => (
                              <option key={a} value={a}>{LABEL_AGR[a]}</option>
                            ))}
                          </select>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Preview legible */}
                {bloques.length > 0 && (
                  <div style={{ marginTop: 12, padding: '6px 10px', background: 'rgba(13,15,12,0.04)', fontSize: 11, fontWeight: 600, color: 'rgba(13,15,12,0.5)', fontFamily: 'monospace' }}>
                    {formulaTexto}
                  </div>
                )}
              </div>

              {/* ── Toolbar de inserción ───────────────────────────────── */}
              <div style={{ padding: '12px 20px', borderTop: '2px solid rgba(13,15,12,0.08)', background: 'rgba(13,15,12,0.02)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(13,15,12,0.35)', marginRight: 4 }}>Agregar</span>

                {/* Operadores */}
                {(['add','sub','mul','div'] as Operador[]).map(op => (
                  <button key={op} onClick={() => agregarOperador(op)} disabled={!canAddOp}
                    title={`Operador ${LABEL_OP[op]}`}
                    style={{
                      width: 36, height: 36, background: canAddOp ? '#0D0F0C' : 'rgba(13,15,12,0.08)',
                      color: canAddOp ? '#C9F03B' : 'rgba(13,15,12,0.25)',
                      border: '2px solid transparent', fontSize: 18, fontWeight: 800,
                      cursor: canAddOp ? 'pointer' : 'default', lineHeight: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                    {LABEL_OP[op]}
                  </button>
                ))}

                <div style={{ width: 1, height: 24, background: 'rgba(13,15,12,0.12)', margin: '0 2px' }} />

                {/* Paréntesis */}
                <button onClick={agregarParenAbierto} disabled={!canAddOpen}
                  title="Abrir paréntesis"
                  style={{
                    height: 36, padding: '0 12px', background: canAddOpen ? '#EEE9D8' : 'rgba(13,15,12,0.04)',
                    border: `2px solid ${canAddOpen ? 'rgba(13,15,12,0.3)' : 'rgba(13,15,12,0.1)'}`,
                    fontSize: 18, fontWeight: 800, cursor: canAddOpen ? 'pointer' : 'default',
                    color: canAddOpen ? '#0D0F0C' : 'rgba(13,15,12,0.2)', lineHeight: 1,
                  }}>
                  (
                </button>
                <button onClick={agregarParenCerrado} disabled={!canAddClose}
                  title={canAddClose ? 'Cerrar paréntesis' : openParens > 0 ? 'Necesitás un valor antes de cerrar' : 'No hay paréntesis abiertos'}
                  style={{
                    height: 36, padding: '0 12px', background: canAddClose ? '#EEE9D8' : 'rgba(13,15,12,0.04)',
                    border: `2px solid ${canAddClose ? 'rgba(13,15,12,0.3)' : 'rgba(13,15,12,0.1)'}`,
                    fontSize: 18, fontWeight: 800, cursor: canAddClose ? 'pointer' : 'default',
                    color: canAddClose ? '#0D0F0C' : 'rgba(13,15,12,0.2)', lineHeight: 1,
                  }}>
                  )
                </button>

                <div style={{ width: 1, height: 24, background: 'rgba(13,15,12,0.12)', margin: '0 2px' }} />

                {/* Número constante */}
                <button onClick={agregarNumero}
                  title="Agregar número constante"
                  style={{
                    height: 36, padding: '0 12px',
                    background: '#F5F1E8', border: '2px solid rgba(13,15,12,0.3)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#0D0F0C',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                  <span style={{ fontSize: 14 }}>#</span>
                  Número
                </button>

                {openParens > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#D45828', marginLeft: 4 }}>
                    {openParens} paréntesis abierto{openParens > 1 ? 's' : ''} sin cerrar
                  </span>
                )}
              </div>
            </div>

            {/* Rango + botón calcular */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {[{ label: 'Desde', val: fechaInicio, set: setFechaInicio }, { label: 'Hasta', val: fechaFin, set: setFechaFin }].map(f => (
                <div key={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(13,15,12,0.45)' }}>{f.label}</span>
                  <input type="date" value={f.val} onChange={e => f.set(e.target.value)}
                    style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', padding: '7px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} />
                </div>
              ))}
              <button onClick={calcular} disabled={bloques.length === 0 || calculando}
                style={{
                  background: bloques.length === 0 ? 'rgba(13,15,12,0.12)' : '#0D0F0C',
                  color: bloques.length === 0 ? 'rgba(13,15,12,0.35)' : '#F5F1E8',
                  border: '2px solid transparent', padding: '9px 24px',
                  fontSize: 13, fontWeight: 700, cursor: bloques.length === 0 ? 'default' : 'pointer',
                }}>
                {calculando ? 'Calculando…' : 'Calcular por lote'}
              </button>
            </div>

            {/* Resultados */}
            {resultados && (
              <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Resultado por lote</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(13,15,12,0.45)', fontFamily: 'monospace' }}>
                    {fechaInicio} → {fechaFin}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {resultados
                    .filter(r => r.valor !== null)
                    .sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0))
                    .map(r => {
                      const pct = maxValor > 0 ? ((r.valor ?? 0) / maxValor) * 100 : 0
                      const color = primeraVar ? CAT_COLOR[primeraVar.variable.categoria] : '#0D0F0C'
                      return (
                        <div key={r.loteId} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, width: 52, flexShrink: 0 }}>{r.nombre}</span>
                          <div style={{ flex: 1, height: 28, background: 'rgba(13,15,12,0.06)', position: 'relative' }}>
                            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: color, transition: 'width 0.4s ease' }} />
                            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 800, color: pct > 30 ? '#fff' : '#0D0F0C' }}>
                              {r.valor?.toLocaleString('es-EC', { maximumFractionDigits: 2 })} {unidadResult}
                            </span>
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(13,15,12,0.4)', width: 32, textAlign: 'right', flexShrink: 0 }}>
                            {r.ha} ha
                          </span>
                        </div>
                      )
                    })
                  }
                </div>

                <div style={{ marginTop: 20, paddingTop: 16, borderTop: '2px solid rgba(13,15,12,0.1)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Guardar como métrica permanente</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input type="text" placeholder="Nombre de la métrica…" value={nombreMetrica} onChange={e => setNombreMetrica(e.target.value)}
                      style={{ background: '#fff', border: '2px solid rgba(13,15,12,0.2)', padding: '7px 12px', fontSize: 13, flex: 1, minWidth: 180, outline: 'none' }} />
                    <button onClick={guardar} disabled={!nombreMetrica.trim()}
                      style={{
                        background: guardado ? '#3EBB6A' : nombreMetrica.trim() ? '#0D0F0C' : 'rgba(13,15,12,0.12)',
                        color: guardado ? '#fff' : nombreMetrica.trim() ? '#F5F1E8' : 'rgba(13,15,12,0.35)',
                        border: '2px solid transparent', padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: nombreMetrica.trim() ? 'pointer' : 'default',
                      }}>
                      {guardado ? '✓ Guardada — volviendo al resumen…' : 'Guardar métrica'}
                    </button>
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: 11, color: 'rgba(13,15,12,0.4)' }}>
                    Al guardar, podés configurar umbrales para alertas automáticas.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
