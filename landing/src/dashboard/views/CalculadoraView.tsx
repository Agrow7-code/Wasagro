import { useState } from 'react'
import { Topbar, TopbarPeriod } from '../layout/Topbar'
import { lotes } from '../mock/data'

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

interface BloqueVar {
  tipo:       'var'
  variable:   Variable
  agregacion: Agregacion
}

interface BloqueNum {
  tipo:   'num'
  valor:  number
  _input: string
}

interface BloqueOp {
  tipo:  'op'
  valor: Operador
}

type Bloque = BloqueVar | BloqueNum | BloqueOp

// ── Datos de variables disponibles ───────────────────────────────────────────

const VARIABLES: Variable[] = [
  // Plagas
  { id: 'plaga_individuos',  label: 'Individuos encontrados', campo: 'individuos_encontrados',  evento_tipo: 'plaga',   categoria: 'Plagas',   unidad: 'individuos' },
  { id: 'plaga_muestra',     label: 'Tamaño de muestra',      campo: 'tamano_muestra',          evento_tipo: 'plaga',   categoria: 'Plagas',   unidad: 'hijos' },
  { id: 'plaga_area',        label: 'Área afectada',          campo: 'area_afectada_ha',        evento_tipo: 'plaga',   categoria: 'Plagas',   unidad: 'ha' },
  { id: 'plaga_pct',         label: 'Porcentaje afectado',    campo: 'pct_afectado',            evento_tipo: 'plaga',   categoria: 'Plagas',   unidad: '%' },
  // Cosecha
  { id: 'cosecha_kg',        label: 'Kilos cosechados',       campo: 'kilos_cosechados',        evento_tipo: 'cosecha', categoria: 'Cosecha',  unidad: 'kg' },
  { id: 'cosecha_cajas',     label: 'Cajas cortadas',         campo: 'cajas_cortadas',          evento_tipo: 'cosecha', categoria: 'Cosecha',  unidad: 'cajas' },
  { id: 'cosecha_rend',      label: 'Rendimiento kg/ha',      campo: 'rendimiento_kg_ha',       evento_tipo: 'cosecha', categoria: 'Cosecha',  unidad: 'kg/ha' },
  // Insumos
  { id: 'insumo_cantidad',   label: 'Cantidad aplicada',      campo: 'cantidad_aplicada',       evento_tipo: 'aplicacion_insumo', categoria: 'Insumos', unidad: 'L' },
  { id: 'insumo_dosis',      label: 'Dosis',                  campo: 'dosis_cantidad',          evento_tipo: 'aplicacion_insumo', categoria: 'Insumos', unidad: 'L/ha' },
  // Gastos
  { id: 'gasto_monto',       label: 'Monto del gasto',        campo: 'costo_monto',             evento_tipo: 'gasto',   categoria: 'Gastos',   unidad: '$' },
  // Labor
  { id: 'labor_jornales',    label: 'Jornales',               campo: 'jornales',                evento_tipo: 'labor',   categoria: 'Labor',    unidad: 'jornales' },
]

const CATEGORIAS = ['Plagas', 'Cosecha', 'Insumos', 'Gastos', 'Labor']

const CAT_COLOR: Record<string, string> = {
  Plagas:  '#D45828',
  Cosecha: '#3EBB6A',
  Insumos: '#2A50D4',
  Gastos:  '#C9A800',
  Labor:   '#0D0F0C',
}

const CAT_BG: Record<string, string> = {
  Plagas:  '#FFF4F0',
  Cosecha: '#F0FFF4',
  Insumos: '#F0F4FF',
  Gastos:  '#FFFBF0',
  Labor:   '#F5F1E8',
}

const LABEL_AGR: Record<Agregacion, string> = {
  sum:   'Σ Suma',
  avg:   'x̄ Prom',
  count: '# Conteo',
  max:   '↑ Máx',
  min:   '↓ Mín',
}

const LABEL_OP: Record<Operador, string> = {
  add: '+',
  sub: '−',
  mul: '×',
  div: '÷',
}

// ── Mock de resultados por lote ───────────────────────────────────────────────

const MOCK_BASE: Record<string, Record<string, number>> = {
  L1: { individuos_encontrados: 8,  tamano_muestra: 20, area_afectada_ha: 0.3, pct_afectado: 14, kilos_cosechados: 310, cajas_cortadas: 6, rendimiento_kg_ha: 148, cantidad_aplicada: 4.2, dosis_cantidad: 2.0, costo_monto: 210, jornales: 5 },
  L2: { individuos_encontrados: 3,  tamano_muestra: 20, area_afectada_ha: 0.1, pct_afectado: 5,  kilos_cosechados: 280, cajas_cortadas: 5, rendimiento_kg_ha: 155, cantidad_aplicada: 3.6, dosis_cantidad: 2.0, costo_monto: 180, jornales: 3 },
  L3: { individuos_encontrados: 12, tamano_muestra: 20, area_afectada_ha: 0.5, pct_afectado: 21, kilos_cosechados: 504, cajas_cortadas: 9, rendimiento_kg_ha: 210, cantidad_aplicada: 6.0, dosis_cantidad: 2.5, costo_monto: 320, jornales: 7 },
  L4: { individuos_encontrados: 9,  tamano_muestra: 20, area_afectada_ha: 0.4, pct_afectado: 18, kilos_cosechados: 375, cajas_cortadas: 7, rendimiento_kg_ha: 250, cantidad_aplicada: 7.5, dosis_cantidad: 3.0, costo_monto: 290, jornales: 6 },
  L5: { individuos_encontrados: 5,  tamano_muestra: 20, area_afectada_ha: 0.2, pct_afectado: 10, kilos_cosechados: 420, cajas_cortadas: 8, rendimiento_kg_ha: 210, cantidad_aplicada: 5.0, dosis_cantidad: 2.5, costo_monto: 240, jornales: 4 },
  L6: { individuos_encontrados: 2,  tamano_muestra: 20, area_afectada_ha: 0.1, pct_afectado: 4,  kilos_cosechados: 250, cajas_cortadas: 4, rendimiento_kg_ha: 131, cantidad_aplicada: 2.8, dosis_cantidad: 1.5, costo_monto: 150, jornales: 3 },
  L7: { individuos_encontrados: 18, tamano_muestra: 20, area_afectada_ha: 0.8, pct_afectado: 35, kilos_cosechados: 490, cajas_cortadas: 9, rendimiento_kg_ha: 213, cantidad_aplicada: 5.8, dosis_cantidad: 2.5, costo_monto: 380, jornales: 8 },
  L8: { individuos_encontrados: 4,  tamano_muestra: 20, area_afectada_ha: 0.15,pct_afectado: 7,  kilos_cosechados: 320, cajas_cortadas: 6, rendimiento_kg_ha: 200, cantidad_aplicada: 3.2, dosis_cantidad: 2.0, costo_monto: 190, jornales: 4 },
  L9: { individuos_encontrados: 3,  tamano_muestra: 20, area_afectada_ha: 0.1, pct_afectado: 6,  kilos_cosechados: 290, cajas_cortadas: 5, rendimiento_kg_ha: 145, cantidad_aplicada: 3.0, dosis_cantidad: 1.5, costo_monto: 160, jornales: 3 },
}

function evaluarFormula(bloques: Bloque[], loteId: string): number | null {
  if (!bloques.length) return null
  const vals = bloques.map(b => {
    if (b.tipo === 'var') {
      const base = MOCK_BASE[loteId]
      if (!base) return 0
      return base[b.variable.campo] ?? 0
    }
    if (b.tipo === 'num') return b.valor
    return b.valor
  })

  let result = 0
  let pendingOp: Operador | null = null
  for (const b of bloques) {
    if (b.tipo === 'op') { pendingOp = b.valor; continue }
    const val = b.tipo === 'var' ? (MOCK_BASE[loteId]?.[b.variable.campo] ?? 0) : b.valor
    if (pendingOp === null) { result = val }
    else if (pendingOp === 'add') result += val
    else if (pendingOp === 'sub') result -= val
    else if (pendingOp === 'mul') result *= val
    else if (pendingOp === 'div') result = val !== 0 ? result / val : 0
    pendingOp = null
  }
  return Math.round(result * 100) / 100
}

// ── Componente ────────────────────────────────────────────────────────────────

export function CalculadoraView() {
  const [categoriaActiva, setCategoriaActiva] = useState<string>('Cosecha')
  const [bloques, setBloques]   = useState<Bloque[]>([])
  const [fechaInicio, setFechaInicio] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) })
  const [fechaFin, setFechaFin] = useState(() => new Date().toISOString().slice(0, 10))
  const [resultados, setResultados] = useState<{ loteId: string; nombre: string; ha: number; valor: number | null }[] | null>(null)
  const [calculando, setCalculando] = useState(false)
  const [nombreMetrica, setNombreMetrica] = useState('')
  const [guardado, setGuardado] = useState(false)

  const varsByCat = VARIABLES.filter(v => v.categoria === categoriaActiva)

  function agregarVariable(v: Variable) {
    setBloques(prev => [
      ...prev,
      ...(prev.length > 0 ? [{ tipo: 'op', valor: 'add' } as BloqueOp] : []),
      { tipo: 'var', variable: v, agregacion: 'sum' } as BloqueVar,
    ])
    setResultados(null)
  }

  function agregarNumero() {
    setBloques(prev => [
      ...prev,
      ...(prev.length > 0 ? [{ tipo: 'op', valor: 'mul' } as BloqueOp] : []),
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

  function limpiar() {
    setBloques([])
    setResultados(null)
    setNombreMetrica('')
  }

  function calcular() {
    if (!bloques.length) return
    setCalculando(true)
    setTimeout(() => {
      const res = lotes.map(l => ({
        loteId:  l.id,
        nombre:  l.nombre,
        ha:      l.hectareas,
        valor:   evaluarFormula(bloques, l.id),
      }))
      setResultados(res)
      setCalculando(false)
    }, 600)
  }

  function guardar() {
    if (!nombreMetrica.trim()) return
    setGuardado(true)
    setTimeout(() => setGuardado(false), 3000)
  }

  const valoresValidos = resultados?.filter(r => r.valor !== null).map(r => r.valor as number) ?? []
  const maxValor = valoresValidos.length ? Math.max(...valoresValidos) : 1

  const primeraVar = bloques.find(b => b.tipo === 'var') as BloqueVar | undefined
  const unidadResult = primeraVar?.variable.unidad ?? ''

  const formulaTexto = bloques.map(b => {
    if (b.tipo === 'var')  return `${LABEL_AGR[b.agregacion]}(${b.variable.label})`
    if (b.tipo === 'num')  return String(b.valor)
    if (b.tipo === 'op')   return LABEL_OP[b.valor]
    return ''
  }).join(' ')

  return (
    <>
      <Topbar
        title="Calculadora"
        badge="H0-R"
        avatarInitials="CM"
        rightSlot={<TopbarPeriod>29 Abr 2026</TopbarPeriod>}
      />

      <main style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Encabezado */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(13,15,12,0.4)', marginBottom: 4 }}>
            Calculadora de métricas
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0D0F0C', lineHeight: 1.2 }}>
            Construí tu propia métrica con datos reales del campo
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, alignItems: 'start' }}>

          {/* ── Panel izquierdo: selector de variables ─────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C' }}>
              {/* Categorías */}
              <div style={{ borderBottom: '2px solid #0D0F0C', padding: '12px 16px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(13,15,12,0.45)', marginBottom: 8 }}>
                  Variables
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {CATEGORIAS.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setCategoriaActiva(cat)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 10px',
                        background: categoriaActiva === cat ? CAT_BG[cat] : 'transparent',
                        border: categoriaActiva === cat ? `2px solid ${CAT_COLOR[cat]}` : '2px solid transparent',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ width: 8, height: 8, background: CAT_COLOR[cat], flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: categoriaActiva === cat ? CAT_COLOR[cat] : '#0D0F0C' }}>
                        {cat}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Chips de la categoría activa */}
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {varsByCat.map(v => {
                  const enFormula = bloques.some(b => b.tipo === 'var' && b.variable.id === v.id)
                  return (
                    <button
                      key={v.id}
                      onClick={() => agregarVariable(v)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: enFormula ? CAT_BG[v.categoria] : '#fff',
                        border: `2px solid ${enFormula ? CAT_COLOR[v.categoria] : 'rgba(13,15,12,0.15)'}`,
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'border-color 0.1s',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#0D0F0C' }}>{v.label}</div>
                        <div style={{ fontSize: 10, color: 'rgba(13,15,12,0.45)', marginTop: 1 }}>{v.unidad}</div>
                      </div>
                      <span style={{
                        fontSize: 16, fontWeight: 300, color: enFormula ? CAT_COLOR[v.categoria] : 'rgba(13,15,12,0.25)',
                        lineHeight: 1,
                      }}>
                        {enFormula ? '✓' : '+'}
                      </span>
                    </button>
                  )
                })}
                <button
                  onClick={agregarNumero}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 12px', marginTop: 4,
                    background: 'transparent',
                    border: '2px dashed rgba(13,15,12,0.2)',
                    cursor: 'pointer', color: 'rgba(13,15,12,0.5)', fontSize: 12, fontWeight: 600,
                  }}
                >
                  + Agregar constante
                </button>
              </div>
            </div>
          </div>

          {/* ── Panel derecho: fórmula + resultados ───────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Constructor de fórmula */}
            <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Fórmula</span>
                {bloques.length > 0 && (
                  <button onClick={limpiar} style={{ fontSize: 11, fontWeight: 600, color: 'rgba(13,15,12,0.45)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    Limpiar todo
                  </button>
                )}
              </div>

              {bloques.length === 0 ? (
                <div style={{
                  padding: '28px 20px', border: '2px dashed rgba(13,15,12,0.15)',
                  textAlign: 'center', color: 'rgba(13,15,12,0.35)', fontSize: 13,
                }}>
                  Seleccioná una variable del panel izquierdo para empezar
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', minHeight: 48 }}>
                  {bloques.map((b, idx) => {
                    if (b.tipo === 'op') {
                      return (
                        <select
                          key={idx}
                          value={b.valor}
                          onChange={e => actualizar(idx, { valor: e.target.value as Operador })}
                          style={{
                            background: '#0D0F0C', color: '#C9F03B',
                            border: '2px solid #0D0F0C', padding: '6px 8px',
                            fontSize: 16, fontWeight: 800, cursor: 'pointer', appearance: 'none' as const,
                            width: 44, textAlign: 'center',
                          }}
                        >
                          {(['add','sub','mul','div'] as Operador[]).map(op => (
                            <option key={op} value={op}>{LABEL_OP[op]}</option>
                          ))}
                        </select>
                      )
                    }

                    if (b.tipo === 'num') {
                      return (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#EEE9D8', border: '2px solid #0D0F0C', padding: '4px 10px' }}>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={b._input}
                            onChange={e => {
                              const n = parseFloat(e.target.value)
                              actualizar(idx, { _input: e.target.value, valor: isNaN(n) ? 0 : n } as Partial<BloqueNum>)
                            }}
                            style={{ border: 'none', background: 'transparent', width: 56, fontSize: 14, fontWeight: 700, textAlign: 'center', outline: 'none' }}
                          />
                          <button onClick={() => eliminar(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(13,15,12,0.4)', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                        </div>
                      )
                    }

                    // tipo === 'var'
                    const bv = b as BloqueVar
                    return (
                      <div key={idx} style={{
                        display: 'flex', flexDirection: 'column', gap: 4,
                        background: CAT_BG[bv.variable.categoria],
                        border: `2px solid ${CAT_COLOR[bv.variable.categoria]}`,
                        padding: '6px 10px',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 6, height: 6, background: CAT_COLOR[bv.variable.categoria] }} />
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#0D0F0C' }}>{bv.variable.label}</span>
                          <button onClick={() => eliminar(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(13,15,12,0.35)', fontSize: 14, padding: 0, lineHeight: 1, marginLeft: 2 }}>×</button>
                        </div>
                        <select
                          value={bv.agregacion}
                          onChange={e => actualizar(idx, { agregacion: e.target.value as Agregacion })}
                          style={{
                            background: 'transparent', border: `1px solid ${CAT_COLOR[bv.variable.categoria]}40`,
                            padding: '2px 6px', fontSize: 10, fontWeight: 700,
                            color: CAT_COLOR[bv.variable.categoria], cursor: 'pointer', appearance: 'none' as const,
                          }}
                        >
                          {(['sum','avg','count','max','min'] as Agregacion[]).map(a => (
                            <option key={a} value={a}>{LABEL_AGR[a]}</option>
                          ))}
                        </select>
                      </div>
                    )
                  })}
                </div>
              )}

              {bloques.length > 0 && (
                <div style={{ marginTop: 10, padding: '6px 10px', background: 'rgba(13,15,12,0.04)', fontSize: 11, fontWeight: 600, color: 'rgba(13,15,12,0.5)', fontFamily: 'monospace' }}>
                  {formulaTexto}
                </div>
              )}
            </div>

            {/* Rango de fechas + Calcular */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(13,15,12,0.45)' }}>Desde</span>
                <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)}
                  style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', padding: '7px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(13,15,12,0.45)' }}>Hasta</span>
                <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)}
                  style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', padding: '7px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} />
              </div>
              <button
                onClick={calcular}
                disabled={bloques.length === 0 || calculando}
                style={{
                  background: bloques.length === 0 ? 'rgba(13,15,12,0.15)' : '#0D0F0C',
                  color: bloques.length === 0 ? 'rgba(13,15,12,0.4)' : '#F5F1E8',
                  border: '2px solid transparent', padding: '9px 20px',
                  fontSize: 13, fontWeight: 700, cursor: bloques.length === 0 ? 'default' : 'pointer',
                }}
              >
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

                {/* Barras */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {resultados
                    .filter(r => r.valor !== null)
                    .sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0))
                    .map(r => {
                      const pct = maxValor > 0 ? ((r.valor ?? 0) / maxValor) * 100 : 0
                      const color = primeraVar ? CAT_COLOR[primeraVar.variable.categoria] : '#0D0F0C'
                      return (
                        <div key={r.loteId} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, width: 52, flexShrink: 0, color: '#0D0F0C' }}>{r.nombre}</span>
                          <div style={{ flex: 1, height: 28, background: 'rgba(13,15,12,0.06)', position: 'relative' }}>
                            <div style={{
                              position: 'absolute', left: 0, top: 0, bottom: 0,
                              width: `${pct}%`, background: color,
                              transition: 'width 0.4s ease',
                            }} />
                            <span style={{
                              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                              fontSize: 11, fontWeight: 800,
                              color: pct > 30 ? '#fff' : '#0D0F0C',
                            }}>
                              {r.valor?.toLocaleString('es-EC', { maximumFractionDigits: 2 })} {unidadResult}
                            </span>
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(13,15,12,0.4)', width: 28, textAlign: 'right', flexShrink: 0 }}>
                            {r.ha} ha
                          </span>
                        </div>
                      )
                    })
                  }
                </div>

                {/* Guardar como métrica */}
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: '2px solid rgba(13,15,12,0.1)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Guardar como métrica permanente</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      placeholder="Nombre de la métrica…"
                      value={nombreMetrica}
                      onChange={e => setNombreMetrica(e.target.value)}
                      style={{
                        background: '#fff', border: '2px solid rgba(13,15,12,0.2)',
                        padding: '7px 12px', fontSize: 13, flex: 1, minWidth: 180, outline: 'none',
                      }}
                    />
                    <button
                      onClick={guardar}
                      disabled={!nombreMetrica.trim()}
                      style={{
                        background: guardado ? '#3EBB6A' : nombreMetrica.trim() ? '#0D0F0C' : 'rgba(13,15,12,0.15)',
                        color: guardado ? '#fff' : nombreMetrica.trim() ? '#F5F1E8' : 'rgba(13,15,12,0.4)',
                        border: '2px solid transparent', padding: '8px 16px',
                        fontSize: 13, fontWeight: 700, cursor: nombreMetrica.trim() ? 'pointer' : 'default',
                      }}
                    >
                      {guardado ? '✓ Guardada' : 'Guardar métrica'}
                    </button>
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: 11, color: 'rgba(13,15,12,0.4)' }}>
                    Al guardar, podés configurar umbrales para que genere alertas automáticas.
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
