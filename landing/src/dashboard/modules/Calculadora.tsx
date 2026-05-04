import React, { useState, useEffect } from 'react'

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Agregacion = 'sum' | 'avg' | 'count' | 'max' | 'min'
type Operador   = 'add' | 'sub' | 'mul' | 'div'

type BloqueCampo = {
  tipo:        'campo'
  evento_tipo: string
  campo:       string
  agregacion:  Agregacion
}

type BloqueNumero = {
  tipo:  'numero'
  valor: number
  _input?: string
}

type BloqueOperador = {
  tipo:  'operador'
  valor: Operador
}

type Bloque = BloqueCampo | BloqueNumero | BloqueOperador

type CampoDisponible = {
  tipo_evento: string
  campo:       string
  conteo:      number
}

type ResultadoPorLote = {
  lote_id:      string | null
  lote_nombre:  string | null
  valor:        number | null
  nivel_actual: string | null
  error?:       string
}

interface CalculadoraProps {
  finca_id:    string
  apiBase:     string
}

// ── Labels legibles ───────────────────────────────────────────────────────────

const LABEL_CAMPO: Record<string, string> = {
  individuos_encontrados: 'Individuos encontrados',
  tamano_muestra:         'Tamaño de muestra',
  area_afectada_ha:       'Área afectada (ha)',
  pct_afectado:           'Porcentaje afectado',
  costo_monto:            'Monto del gasto',
  cantidad_aplicada:      'Cantidad aplicada',
  dosis_cantidad:         'Dosis',
  kilos_cosechados:       'Kilos cosechados',
  cajas_cortadas:         'Cajas cortadas',
  rendimiento_kg_ha:      'Rendimiento kg/ha',
}

const LABEL_EVENTO: Record<string, string> = {
  plaga:           'Plaga',
  gasto:           'Gasto',
  cosecha:         'Cosecha',
  aplicacion_insumo: 'Insumo',
  labor:           'Labor',
  observacion:     'Observación',
}

const LABEL_OP: Record<Operador, string> = {
  add: '+',
  sub: '−',
  mul: '×',
  div: '÷',
}

const LABEL_AGR: Record<Agregacion, string> = {
  sum:   'Suma',
  avg:   'Promedio',
  count: 'Conteo',
  max:   'Máximo',
  min:   'Mínimo',
}

const NIVEL_COLOR: Record<string, string> = {
  bajo:    '#3EBB6A',
  medio:   '#F5A623',
  alto:    '#E85D04',
  critico: '#D62828',
}

// ── Estilos compartidos ───────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#F5F1E8',
  border: '2px solid #0D0F0C',
  boxShadow: '4px 4px 0 0 #0D0F0C',
  padding: 20,
}

const btn: React.CSSProperties = {
  background: '#0D0F0C',
  color: '#F5F1E8',
  border: '2px solid #0D0F0C',
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
}

const btnSecondary: React.CSSProperties = {
  background: 'transparent',
  color: '#0D0F0C',
  border: '2px solid #0D0F0C',
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
}

const select: React.CSSProperties = {
  background: '#F5F1E8',
  border: '2px solid #0D0F0C',
  padding: '6px 10px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  appearance: 'none' as const,
}

const label12: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.07em',
  color: 'rgba(13,15,12,0.45)',
}

// ── Componente principal ──────────────────────────────────────────────────────

export const Calculadora: React.FC<CalculadoraProps> = ({ finca_id, apiBase }) => {
  const [campos, setCampos]             = useState<CampoDisponible[]>([])
  const [bloques, setBloques]           = useState<Bloque[]>([])
  const [unidad, setUnidad]             = useState('')
  const [nombre, setNombre]             = useState('')
  const [fechaInicio, setFechaInicio]   = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [fechaFin, setFechaFin]         = useState(() => new Date().toISOString().slice(0, 10))
  const [resultado, setResultado]       = useState<ResultadoPorLote[] | null>(null)
  const [calculando, setCalculando]     = useState(false)
  const [guardando, setGuardando]       = useState(false)
  const [guardado, setGuardado]         = useState(false)
  const [error, setError]               = useState<string | null>(null)

  useEffect(() => {
    fetch(`${apiBase}/api/metricas/campos/${finca_id}`)
      .then(r => r.json())
      .then(d => setCampos(d.campos ?? []))
      .catch(() => {})
  }, [finca_id, apiBase])

  // ── Construcción de la fórmula ──────────────────────────────────────────────

  function agregarCampo() {
    if (!campos.length) return
    const c = campos[0]!
    setBloques(prev => [
      ...prev,
      ...(prev.length > 0 ? [{ tipo: 'operador', valor: 'mul' } as BloqueOperador] : []),
      { tipo: 'campo', evento_tipo: c.tipo_evento, campo: c.campo, agregacion: 'sum' } as BloqueCampo,
    ])
  }

  function agregarNumero() {
    setBloques(prev => [
      ...prev,
      ...(prev.length > 0 ? [{ tipo: 'operador', valor: 'mul' } as BloqueOperador] : []),
      { tipo: 'numero', valor: 100, _input: '100' } as BloqueNumero,
    ])
  }

  function eliminarBloque(idx: number) {
    setBloques(prev => {
      const next = [...prev]
      // Eliminar el bloque y el operador que lo precede (si existe)
      if (idx > 0 && next[idx - 1]?.tipo === 'operador') {
        next.splice(idx - 1, 2)
      } else if (next[idx + 1]?.tipo === 'operador') {
        next.splice(idx, 2)
      } else {
        next.splice(idx, 1)
      }
      return next
    })
  }

  function actualizarBloque(idx: number, cambios: Partial<Bloque>) {
    setBloques(prev => prev.map((b, i) => i === idx ? { ...b, ...cambios } as Bloque : b))
  }

  // ── Cálculo ─────────────────────────────────────────────────────────────────

  async function calcular() {
    const formula = { operaciones: bloques }
    setCalculando(true)
    setError(null)
    setResultado(null)

    try {
      const res = await fetch(`${apiBase}/api/metricas/calcular/lotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formula, finca_id, fecha_inicio: fechaInicio, fecha_fin: fechaFin }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Error en el cálculo'); return }
      setResultado(data.resultados)
    } catch {
      setError('No se pudo conectar con el servidor')
    } finally {
      setCalculando(false)
    }
  }

  // ── Guardar como métrica ────────────────────────────────────────────────────

  async function guardarMetrica() {
    if (!nombre.trim()) { setError('Ponele un nombre a la métrica'); return }
    setGuardando(true)
    setError(null)

    try {
      const res = await fetch(`${apiBase}/api/metricas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finca_id,
          nombre: nombre.trim(),
          tipo_evento: bloques.find(b => b.tipo === 'campo')
            ? (bloques.find(b => b.tipo === 'campo') as BloqueCampo).evento_tipo
            : 'observacion',
          formula: { operaciones: bloques },
          unidad: unidad.trim() || null,
        }),
      })
      if (res.ok) {
        setGuardado(true)
        setTimeout(() => setGuardado(false), 3000)
      } else {
        const d = await res.json()
        setError(d.error ?? 'Error al guardar')
      }
    } catch {
      setError('No se pudo guardar la métrica')
    } finally {
      setGuardando(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const formulaLegible = bloques
    .map(b => {
      if (b.tipo === 'campo')    return `${LABEL_AGR[b.agregacion]}(${LABEL_CAMPO[b.campo] ?? b.campo})`
      if (b.tipo === 'numero')   return String(b.valor)
      if (b.tipo === 'operador') return LABEL_OP[b.valor]
      return ''
    })
    .join(' ')

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={label12}>Calculadora de datos</span>
      </div>

      {/* Constructor de fórmula */}
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Armá tu cálculo</span>

        {/* Bloques actuales */}
        {bloques.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {bloques.map((bloque, idx) => {
              if (bloque.tipo === 'operador') {
                return (
                  <select
                    key={idx}
                    value={bloque.valor}
                    onChange={e => actualizarBloque(idx, { valor: e.target.value as Operador })}
                    style={{ ...select, width: 52, textAlign: 'center', padding: '6px 4px', fontSize: 16, fontWeight: 800 }}
                  >
                    {(['add','sub','mul','div'] as Operador[]).map(op => (
                      <option key={op} value={op}>{LABEL_OP[op]}</option>
                    ))}
                  </select>
                )
              }

              if (bloque.tipo === 'numero') {
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#E8F0FF', border: '2px solid #0D0F0C', padding: '4px 8px' }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={(bloque as BloqueNumero)._input ?? String(bloque.valor)}
                      onChange={e => {
                        const raw = e.target.value
                        const n = parseFloat(raw)
                        actualizarBloque(idx, { _input: raw, valor: isNaN(n) ? 0 : n } as Partial<BloqueNumero>)
                      }}
                      style={{ border: 'none', background: 'transparent', width: 70, fontSize: 14, fontWeight: 700, textAlign: 'center', outline: 'none' }}
                    />
                    <button onClick={() => eliminarBloque(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'rgba(13,15,12,0.4)', padding: 0 }}>×</button>
                  </div>
                )
              }

              // tipo === 'campo'
              const bc = bloque as BloqueCampo
              const camposFiltrados = campos.filter(c => c.tipo_evento === bc.evento_tipo)
              return (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4, background: '#E8FFE8', border: '2px solid #0D0F0C', padding: '6px 10px' }}>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {/* Tipo de evento */}
                    <select
                      value={bc.evento_tipo}
                      onChange={e => {
                        const nuevo_tipo = e.target.value
                        const primero = campos.find(c => c.tipo_evento === nuevo_tipo)
                        actualizarBloque(idx, { evento_tipo: nuevo_tipo, campo: primero?.campo ?? bc.campo })
                      }}
                      style={{ ...select, fontSize: 11 }}
                    >
                      {Array.from(new Set(campos.map(c => c.tipo_evento))).map(t => (
                        <option key={t} value={t}>{LABEL_EVENTO[t] ?? t}</option>
                      ))}
                    </select>
                    {/* Campo */}
                    <select
                      value={bc.campo}
                      onChange={e => actualizarBloque(idx, { campo: e.target.value })}
                      style={{ ...select, fontSize: 11 }}
                    >
                      {(camposFiltrados.length ? camposFiltrados : campos).map(c => (
                        <option key={c.campo} value={c.campo}>{LABEL_CAMPO[c.campo] ?? c.campo}</option>
                      ))}
                    </select>
                    <button onClick={() => eliminarBloque(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'rgba(13,15,12,0.4)', padding: 0 }}>×</button>
                  </div>
                  {/* Agregación */}
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'rgba(13,15,12,0.45)', fontWeight: 700 }}>FUNCIÓN</span>
                    <select
                      value={bc.agregacion}
                      onChange={e => actualizarBloque(idx, { agregacion: e.target.value as Agregacion })}
                      style={{ ...select, fontSize: 11 }}
                    >
                      {(['sum','avg','count','max','min'] as Agregacion[]).map(a => (
                        <option key={a} value={a}>{LABEL_AGR[a]}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Fórmula legible */}
        {bloques.length > 0 && (
          <div style={{ padding: '8px 12px', background: 'rgba(13,15,12,0.04)', border: '1px dashed rgba(13,15,12,0.2)', fontSize: 12, fontWeight: 600, color: 'rgba(13,15,12,0.6)' }}>
            {formulaLegible}
          </div>
        )}

        {/* Botones para agregar bloques */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={agregarCampo} style={btnSecondary} disabled={!campos.length}>
            + Dato de campo
          </button>
          <button onClick={agregarNumero} style={btnSecondary}>
            + Número
          </button>
          {bloques.length > 0 && (
            <button onClick={() => { setBloques([]); setResultado(null) }} style={{ ...btnSecondary, borderColor: 'rgba(13,15,12,0.3)', color: 'rgba(13,15,12,0.5)' }}>
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Rango de fechas */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label12}>Desde</span>
          <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)}
            style={{ ...select, background: '#F5F1E8' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label12}>Hasta</span>
          <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)}
            style={{ ...select, background: '#F5F1E8' }} />
        </div>
        <button
          onClick={calcular}
          disabled={bloques.length === 0 || calculando}
          style={{ ...btn, opacity: (bloques.length === 0 || calculando) ? 0.5 : 1 }}
        >
          {calculando ? 'Calculando...' : 'Calcular'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 14px', background: '#FFE5E5', border: '2px solid #D62828', fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {/* Resultados */}
      {resultado && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={label12}>Resultado por lote</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {resultado.map(r => (
              <div
                key={r.lote_id ?? 'total'}
                style={{
                  ...card,
                  borderLeft: r.nivel_actual ? `6px solid ${NIVEL_COLOR[r.nivel_actual] ?? '#0D0F0C'}` : undefined,
                  padding: 16,
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>
                  {r.lote_nombre ?? 'Toda la finca'}
                </span>
                {r.error ? (
                  <span style={{ fontSize: 12, color: 'rgba(13,15,12,0.4)', marginTop: 4, display: 'block' }}>Sin datos</span>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                    <span style={{ fontSize: 28, fontWeight: 800 }}>{r.valor?.toLocaleString('es-EC', { maximumFractionDigits: 2 })}</span>
                    {unidad && <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(13,15,12,0.5)' }}>{unidad}</span>}
                  </div>
                )}
                {r.nivel_actual && (
                  <span style={{ marginTop: 6, display: 'inline-block', padding: '2px 8px', background: NIVEL_COLOR[r.nivel_actual], color: '#fff', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>
                    {r.nivel_actual}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Guardar como métrica */}
          <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>¿Querés guardar este cálculo?</span>
            <p style={{ margin: 0, fontSize: 12, color: 'rgba(13,15,12,0.55)' }}>
              Si lo guardás, podés verlo siempre en el dashboard y configurar alertas cuando supere un umbral.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label12}>Nombre</span>
                <input
                  type="text"
                  placeholder="Ej: Intensidad de trips por hijo"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  style={{ ...select, background: '#F5F1E8', width: 240 }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label12}>Unidad (opcional)</span>
                <input
                  type="text"
                  placeholder="trips/hijo, $/ha, %..."
                  value={unidad}
                  onChange={e => setUnidad(e.target.value)}
                  style={{ ...select, background: '#F5F1E8', width: 140 }}
                />
              </div>
              <button onClick={guardarMetrica} disabled={guardando} style={{ ...btn, opacity: guardando ? 0.6 : 1 }}>
                {guardado ? '✓ Guardado' : guardando ? 'Guardando...' : 'Guardar métrica'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
