import { useState, useEffect, useCallback } from 'react'
import { Topbar } from '../layout/Topbar'
import { useAuth } from '../../auth/useAuth'

// Vista de revisión de muestreos Sigatoka (D30).
// - Lista: cola de eventos requires_review de la finca.
// - Detalle: ficha completa digitalizada + imagen original en paralelo.
//   Muestra TODOS los bloques: encabezado, matriz de puntos, tablas 11/00 sem,
//   DATOS A–M, plagas foliares, seguimiento.
//   Modo edición: cualquier celda de la matriz y tablas semana es editable.
//   Celdas ilegibles: ámbar. Celdas corregidas por el usuario: borde azul.
//   Todo se envía como `correcciones` — no se bifurca en aclaraciones/correcciones.

const API = (import.meta.env.VITE_API_URL ?? '') as string

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('wasagro_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ─── Tipos locales ────────────────────────────────────────────────────────────

interface CeldaMuestra { valor: number | null; estado: 'leida' | 'vacia' | 'ilegible' }

/** Normaliza el valor crudo de una celda.
 *  Eventos viejos persistidos tienen las celdas como número plano o null.
 *  Eventos nuevos tienen { valor, estado }. Nunca arroja. */
function asCelda(v: unknown): CeldaMuestra {
  if (v !== null && typeof v === 'object' && 'estado' in (v as object)) {
    return v as CeldaMuestra
  }
  const num = typeof v === 'number' ? v : null
  return { valor: num, estado: num === null ? 'vacia' : 'leida' }
}

function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return String(v)
}

interface FilaSemana {
  fila?: number | null
  sector?: string | null
  lote_id?: string | null
  ht: unknown
  hVle: unknown
  q5menos: unknown
  q5mas: unknown
  lc: unknown
}

interface TotalesSemana {
  ht?: number | null
  hVle?: number | null
  q5menos?: number | null
  q5mas?: number | null
  lc?: number | null
}

interface ColumnaChecksum {
  columna: string
  sumaFilas: number
  totalFicha: number | null
  cuadra: boolean | null
}

interface VerificacionTabla {
  columnas: ColumnaChecksum[]
  cuadraTodo: boolean | null
}

interface PuntoMuestreo {
  punto: string
  sector?: string | null
  lote_id?: string | null
  planta1_estadio: unknown
  planta1_piscas: unknown
  planta2_estadio: unknown
  planta2_piscas: unknown
  planta3_estadio: unknown
  planta3_piscas: unknown
  hVle: unknown
  hVlq: unknown
  func: unknown
  marcaEspecial?: string | null
}

interface ResumenColumna {
  A?: number | null; B?: number | null; C?: number | null
  D?: number | null; E?: number | null; F?: number | null; G?: number | null
  H_formulario?: number | null; I_formulario?: number | null
  J_formulario?: number | null; K_formulario?: number | null
  L_formulario?: number | null; M_formulario?: number | null
  H_calculado?: number | null; I_calculado?: number | null
  J_calculado?: number | null; K_calculado?: number | null
  L_calculado?: number | null; M_calculado?: number | null
}

interface PlagaFoliar { h?: number | null; p?: number | null; m?: number | null; g?: number | null }
interface PlagasFoliares { ceramida?: PlagaFoliar; sibine?: PlagaFoliar }

interface SigatokaMuestreo {
  zona?: string | null
  codigoFinca?: string | null
  nombreFinca?: string | null
  semana?: number | null
  periodo?: number | null
  fecha?: string | null
  supervisor?: string | null
  puntosMuestreo?: PuntoMuestreo[]
  plantas11sem?: FilaSemana[]
  plantas00sem?: FilaSemana[]
  totales11sem?: TotalesSemana | null
  promedios11sem?: TotalesSemana | null
  totales00sem?: TotalesSemana | null
  promedios00sem?: TotalesSemana | null
  verificacion11sem?: VerificacionTabla | null
  verificacion00sem?: VerificacionTabla | null
  resumenColumnas?: ResumenColumna[]
  plagasFoliares?: PlagasFoliares | null
  pEfFinca?: number | null
  pEfFincaT?: number | null
  pEfFincaFrec?: number | null
  erradicadasBsv?: number | null
}

interface Ubicacion { punto: string; sector: string | null; campo: string }

interface ItemLista {
  id: string
  created_at: string
  confidence_score: number | null
  semana: number | null
  nombre_finca: string | null
  tiene_imagen: boolean
  ilegibles: { total: number; ruta: 'completo' | 'preguntar' | 'manual' }
}

interface Detalle {
  id: string
  status: string
  created_at: string
  confidence_score: number | null
  sigatoka: SigatokaMuestreo | null
  imagen_url: string | null
  ilegibles: { total: number; ubicaciones: Ubicacion[]; ruta: string }
}

// ─── Helpers de estilo ────────────────────────────────────────────────────────

const card = {
  background: '#F5F1E8',
  border: '2px solid #0D0F0C',
  boxShadow: '4px 4px 0 0 #0D0F0C',
} as const

const labelStyle = {
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  color: 'rgba(13,15,12,0.4)',
}

const thStyle: React.CSSProperties = {
  padding: '6px 8px',
  textAlign: 'left',
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'rgba(13,15,12,0.4)',
  whiteSpace: 'nowrap',
  borderBottom: '2px solid rgba(13,15,12,0.15)',
  background: 'rgba(13,15,12,0.03)',
}

const tdBase: React.CSSProperties = {
  padding: '5px 8px',
  fontSize: 12,
  fontFamily: 'monospace',
  borderBottom: '1px solid rgba(13,15,12,0.06)',
  whiteSpace: 'nowrap',
}

const RUTA_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  completo:  { label: 'Completo',  color: '#1F8040', bg: '#EDFBF3' },
  preguntar: { label: 'A revisar', color: '#8A6000', bg: '#FDF6DD' },
  manual:    { label: 'Manual',    color: '#7A1810', bg: '#FFEEEA' },
}

const LABEL_CAMPO: Record<string, string> = {
  planta1_estadio: 'P1 estadio', planta1_piscas: 'P1 piscas',
  planta2_estadio: 'P2 estadio', planta2_piscas: 'P2 piscas',
  planta3_estadio: 'P3 estadio', planta3_piscas: 'P3 piscas',
  hVle: 'H+VLE', hVlq: 'H+VLQ', func: 'Func',
  ht: 'H.T', q5menos: 'Q<5%', q5mas: 'Q>5%', lc: 'L.C.',
}

function getInitials(n: string) {
  return n.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('')
}

// ─── Input inline para celda editable ────────────────────────────────────────

function CeldaInput({
  valorBase,
  editKey,
  correcciones,
  onCorreccion,
  ilegible,
}: {
  valorBase: number | null
  editKey: string
  correcciones: Record<string, string>
  onCorreccion: (k: string, v: string) => void
  ilegible: boolean
}) {
  const dirty = editKey in correcciones
  const displayVal = dirty ? correcciones[editKey] : (valorBase != null ? String(valorBase) : '')

  const bgStyle: React.CSSProperties = ilegible
    ? { background: 'rgba(251,191,36,0.18)' }
    : {}
  const borderStyle: React.CSSProperties = dirty
    ? { outline: '2px solid #2563EB' }
    : ilegible
      ? { outline: '1.5px solid #D97706' }
      : { outline: '1.5px solid rgba(13,15,12,0.25)' }

  return (
    <td style={{ ...tdBase, ...bgStyle, ...borderStyle, padding: '3px 5px' }}>
      <input
        type="number"
        inputMode="decimal"
        value={displayVal}
        onChange={e => onCorreccion(editKey, e.target.value)}
        placeholder={ilegible ? '?' : '—'}
        style={{
          width: 46,
          padding: '2px 4px',
          border: 'none',
          outline: 'none',
          fontSize: 11,
          fontFamily: 'monospace',
          background: 'transparent',
          color: dirty ? '#2563EB' : '#0D0F0C',
          fontWeight: dirty ? 700 : 400,
        }}
      />
    </td>
  )
}

// ─── Celda de solo lectura con estilo por estado ──────────────────────────────

function CeldaTd({
  celda,
  ilegibleKey,
  valores,
  onInput,
}: {
  celda: CeldaMuestra
  ilegibleKey?: string
  valores?: Record<string, string>
  onInput?: (k: string, v: string) => void
}) {
  if (celda.estado === 'vacia') {
    return <td style={{ ...tdBase, color: 'rgba(13,15,12,0.3)' }}>—</td>
  }
  if (celda.estado === 'ilegible') {
    const k = ilegibleKey ?? ''
    return (
      <td style={{ ...tdBase, background: 'rgba(251,191,36,0.18)', outline: '1.5px solid #D97706' }}>
        {k && onInput && valores
          ? <input
              type="number"
              inputMode="decimal"
              value={valores[k] ?? ''}
              onChange={e => onInput(k, e.target.value)}
              placeholder="?"
              style={{
                width: 46,
                padding: '2px 4px',
                border: '1.5px solid #D97706',
                fontSize: 11,
                fontFamily: 'monospace',
                background: 'transparent',
              }}
            />
          : <span style={{ color: '#D97706', fontWeight: 700 }}>?</span>
        }
      </td>
    )
  }
  return <td style={tdBase}>{fmtNum(celda.valor)}</td>
}

// ─── Sección: Encabezado ──────────────────────────────────────────────────────

function SeccionEncabezado({ s, conf }: { s: SigatokaMuestreo; conf: number | null }) {
  const campos = [
    { label: 'Zona',       value: s.zona ?? '—' },
    { label: 'Finca',      value: s.nombreFinca ?? '—' },
    { label: 'Código',     value: s.codigoFinca ?? '—' },
    { label: 'Semana',     value: s.semana != null ? String(s.semana) : '—' },
    { label: 'Período',    value: s.periodo != null ? String(s.periodo) : '—' },
    { label: 'Fecha',      value: s.fecha ?? '—' },
    { label: 'Supervisor', value: s.supervisor ?? '—' },
    { label: 'Confianza',  value: conf != null ? `${Math.round(conf * 100)}%` : '—' },
  ]
  return (
    <div>
      <div style={{ ...labelStyle, marginBottom: 8 }}>Encabezado</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px 12px' }}>
        {campos.map(c => (
          <div key={c.label} style={{ background: 'rgba(255,255,255,0.55)', padding: '6px 10px' }}>
            <div style={labelStyle}>{c.label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0D0F0C', marginTop: 2 }}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Sección: Matriz de puntos ────────────────────────────────────────────────

function SeccionMatriz({
  puntos,
  ilegibleKeys,
  valores,
  onInput,
  modoEdicion,
  correcciones,
  onCorreccion,
}: {
  puntos: PuntoMuestreo[]
  ilegibleKeys: Set<string>
  valores: Record<string, string>
  onInput: (k: string, v: string) => void
  modoEdicion: boolean
  correcciones: Record<string, string>
  onCorreccion: (k: string, v: string) => void
}) {
  if (!puntos.length) return null
  const cols: Array<{ label: string; campo: keyof PuntoMuestreo }> = [
    { label: 'P1 est.', campo: 'planta1_estadio' },
    { label: 'P1 pis.', campo: 'planta1_piscas' },
    { label: 'P2 est.', campo: 'planta2_estadio' },
    { label: 'P2 pis.', campo: 'planta2_piscas' },
    { label: 'P3 est.', campo: 'planta3_estadio' },
    { label: 'P3 pis.', campo: 'planta3_piscas' },
    { label: 'H+VLE', campo: 'hVle' },
    { label: 'H+VLQ', campo: 'hVlq' },
    { label: 'Func.', campo: 'func' },
  ]

  return (
    <div>
      <div style={{ ...labelStyle, marginBottom: 8 }}>Estado evolutivo (matriz de puntos)</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>Punto</th>
              <th style={thStyle}>Sector</th>
              {cols.map(c => <th key={c.campo} style={thStyle}>{c.label}</th>)}
              <th style={thStyle}>Nota</th>
            </tr>
          </thead>
          <tbody>
            {puntos.map(p => (
              <tr key={p.punto} style={{ borderBottom: '1px solid rgba(13,15,12,0.05)' }}>
                <td style={{ ...tdBase, fontWeight: 800, color: '#0D0F0C' }}>{p.punto}</td>
                <td style={{ ...tdBase, color: 'rgba(13,15,12,0.55)' }}>{p.sector ?? '—'}</td>
                {cols.map(c => {
                  const celda = asCelda((p as unknown as Record<string, unknown>)[c.campo])
                  const k = `${p.punto}.${c.campo}`
                  const isIleg = ilegibleKeys.has(k)

                  if (modoEdicion) {
                    return (
                      <CeldaInput
                        key={c.campo}
                        valorBase={celda.valor}
                        editKey={k}
                        correcciones={correcciones}
                        onCorreccion={onCorreccion}
                        ilegible={isIleg}
                      />
                    )
                  }

                  return (
                    <CeldaTd
                      key={c.campo}
                      celda={celda}
                      ilegibleKey={isIleg ? k : undefined}
                      valores={valores}
                      onInput={onInput}
                    />
                  )
                })}
                <td style={{ ...tdBase, color: 'rgba(13,15,12,0.45)', fontSize: 10 }}>
                  {p.marcaEspecial ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Sección: Tabla de semanas (11 o 00) ─────────────────────────────────────

function SeccionTablaSemanas({
  titulo,
  filas,
  totales,
  promedios,
  verificacion,
  prefijo,
  ilegibleKeys,
  valores,
  onInput,
  modoEdicion,
  correcciones,
  onCorreccion,
}: {
  titulo: string
  filas: FilaSemana[]
  totales?: TotalesSemana | null
  promedios?: TotalesSemana | null
  verificacion?: VerificacionTabla | null
  prefijo: string   // '11sem' | '00sem'
  ilegibleKeys: Set<string>
  valores: Record<string, string>
  onInput: (k: string, v: string) => void
  modoEdicion: boolean
  correcciones: Record<string, string>
  onCorreccion: (k: string, v: string) => void
}) {
  if (!filas.length && !totales && !promedios) return null

  const checksumMap: Record<string, ColumnaChecksum | undefined> = {}
  if (verificacion?.columnas) {
    for (const c of verificacion.columnas) checksumMap[c.columna] = c
  }

  const colsDef: Array<{ label: string; campo: 'ht' | 'hVle' | 'q5menos' | 'q5mas' | 'lc' }> = [
    { label: 'H.T',   campo: 'ht'      },
    { label: 'H+VLE', campo: 'hVle'    },
    { label: 'Q<5%',  campo: 'q5menos' },
    { label: 'Q>5%',  campo: 'q5mas'   },
    { label: 'L.C.',  campo: 'lc'      },
  ]

  function checksumStyle(campo: string): React.CSSProperties {
    const cs = checksumMap[campo]
    if (!cs || cs.cuadra === null) return {}
    return cs.cuadra === false
      ? { background: 'rgba(196,48,32,0.08)', outline: '1.5px solid #C43020' }
      : {}
  }

  function checksumTh(campo: string): React.CSSProperties {
    const cs = checksumMap[campo]
    if (!cs || cs.cuadra === null) return thStyle
    if (cs.cuadra === false) return { ...thStyle, color: '#C43020' }
    return { ...thStyle, color: '#1F8040' }
  }

  function checksumIcon(campo: string): string | null {
    const cs = checksumMap[campo]
    if (!cs || cs.cuadra === null) return null
    return cs.cuadra === false ? ' ✗' : ' ✓'
  }

  function sumaCalc(campo: 'ht' | 'hVle' | 'q5menos' | 'q5mas' | 'lc'): number | null {
    let sum = 0
    let conValor = false
    for (const f of filas) {
      const c = asCelda(f[campo])
      if (c.valor === null) continue
      sum += c.valor
      conValor = true
    }
    return conValor ? sum : null
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={labelStyle}>{titulo}</span>
        {verificacion?.cuadraTodo === true && (
          <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', background: '#EDFBF3', color: '#1F8040', border: '1px solid #1F8040' }}>
            totales cuadran ✓
          </span>
        )}
        {verificacion?.cuadraTodo === false && (
          <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', background: '#FFEEEA', color: '#C43020', border: '1px solid #C43020' }}>
            totales no cuadran ✗
          </span>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>Fila</th>
              <th style={thStyle}>Sector</th>
              {colsDef.map(c => (
                <th key={c.campo} style={checksumTh(c.campo)} title={
                  checksumMap[c.campo]?.cuadra === false
                    ? `No cuadra — suma filas: ${checksumMap[c.campo]?.sumaFilas}, total ficha: ${checksumMap[c.campo]?.totalFicha}`
                    : undefined
                }>
                  {c.label}{checksumIcon(c.campo)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid rgba(13,15,12,0.05)' }}>
                <td style={{ ...tdBase, fontWeight: 700, color: '#0D0F0C' }}>
                  {f.fila ?? idx + 1}
                </td>
                <td style={{ ...tdBase, color: 'rgba(13,15,12,0.55)' }}>{f.sector ?? '—'}</td>
                {colsDef.map(c => {
                  const celda = asCelda(f[c.campo])
                  const k = `${prefijo}-${f.fila ?? idx + 1}.${c.campo}`
                  const isIleg = ilegibleKeys.has(k)

                  if (modoEdicion) {
                    return (
                      <CeldaInput
                        key={c.campo}
                        valorBase={celda.valor}
                        editKey={k}
                        correcciones={correcciones}
                        onCorreccion={onCorreccion}
                        ilegible={isIleg}
                      />
                    )
                  }

                  return (
                    <CeldaTd
                      key={c.campo}
                      celda={celda}
                      ilegibleKey={isIleg ? k : undefined}
                      valores={valores}
                      onInput={onInput}
                    />
                  )
                })}
              </tr>
            ))}

            {/* Suma calculada por Wasagro */}
            <tr style={{ borderTop: '2px solid rgba(13,15,12,0.12)', background: 'rgba(13,15,12,0.03)' }}>
              <td colSpan={2} style={{ ...tdBase, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)', letterSpacing: '0.06em' }}>
                Suma calc.
              </td>
              {colsDef.map(c => {
                const suma = sumaCalc(c.campo)
                const cs = checksumMap[c.campo]
                const noC = cs && cs.cuadra === false
                return (
                  <td key={c.campo} style={{ ...tdBase, fontWeight: 700, ...checksumStyle(c.campo), color: noC ? '#C43020' : '#0D0F0C' }}>
                    {fmtNum(suma)}
                    {noC && suma !== null && <span style={{ fontSize: 9, color: '#C43020' }}> ≠ {cs.totalFicha}</span>}
                  </td>
                )
              })}
            </tr>

            {/* T= de la ficha */}
            {totales && (
              <tr style={{ background: 'rgba(13,15,12,0.02)', borderTop: '1px dashed rgba(13,15,12,0.1)' }}>
                <td colSpan={2} style={{ ...tdBase, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: 'rgba(13,15,12,0.4)', letterSpacing: '0.06em' }}>
                  T= (ficha)
                </td>
                {colsDef.map(c => (
                  <td key={c.campo} style={{ ...tdBase, color: 'rgba(13,15,12,0.65)' }}>
                    {fmtNum(totales[c.campo])}
                  </td>
                ))}
              </tr>
            )}

            {/* Pr= de la ficha */}
            {promedios && (
              <tr style={{ background: 'rgba(13,15,12,0.02)' }}>
                <td colSpan={2} style={{ ...tdBase, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: 'rgba(13,15,12,0.4)', letterSpacing: '0.06em' }}>
                  Pr= (ficha)
                </td>
                {colsDef.map(c => (
                  <td key={c.campo} style={{ ...tdBase, color: 'rgba(13,15,12,0.65)' }}>
                    {fmtNum(promedios[c.campo])}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Sección: DATOS A–M (3 columnas) ─────────────────────────────────────────

function SeccionDatos({ columnas }: { columnas: ResumenColumna[] }) {
  if (!columnas.length) return null

  type CampoAG = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
  type CampoHM = 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  const camposAG: CampoAG[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
  const camposHM: CampoHM[] = ['H', 'I', 'J', 'K', 'L', 'M']

  function alertaHIM(campo: CampoHM, val: number | null | undefined): React.CSSProperties {
    if (val == null) return {}
    if (campo === 'J' && val > 10) return { color: '#C43020', fontWeight: 800 }
    if (campo === 'I' && val > 5)  return { color: '#E06820', fontWeight: 800 }
    if (campo === 'M' && val < 9)  return { color: '#C43020', fontWeight: 800 }
    return {}
  }

  function difiere(form: number | null | undefined, calc: number | null | undefined): boolean {
    if (form == null || calc == null) return false
    return Math.abs(form - calc) >= 0.05
  }

  return (
    <div>
      <div style={{ ...labelStyle, marginBottom: 8 }}>Datos (A–M) — 3 columnas / plantas</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>Campo</th>
              {columnas.map((_, i) => (
                <th key={i} style={thStyle}>Col {i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {camposAG.map(campo => (
              <tr key={campo} style={{ borderBottom: '1px solid rgba(13,15,12,0.05)' }}>
                <td style={{ ...tdBase, fontWeight: 700, color: '#0D0F0C' }}>{campo}</td>
                {columnas.map((col, i) => (
                  <td key={i} style={tdBase}>{fmtNum(col[campo])}</td>
                ))}
              </tr>
            ))}
            <tr style={{ borderTop: '1px dashed rgba(13,15,12,0.12)' }}>
              <td colSpan={columnas.length + 1} style={{ ...tdBase, fontSize: 8, color: 'rgba(13,15,12,0.35)', paddingTop: 2, paddingBottom: 2 }}>
                H–M: formulario (ficha) / calculado por Wasagro — se resalta si difieren
              </td>
            </tr>
            {camposHM.map(campo => {
              const fKey = `${campo}_formulario` as keyof ResumenColumna
              const cKey = `${campo}_calculado` as keyof ResumenColumna
              return (
                <tr key={campo} style={{ borderBottom: '1px solid rgba(13,15,12,0.05)' }}>
                  <td style={{ ...tdBase, fontWeight: 700, color: '#0D0F0C' }}>{campo}</td>
                  {columnas.map((col, i) => {
                    const form = col[fKey] as number | null | undefined
                    const calc = col[cKey] as number | null | undefined
                    const hay = form != null || calc != null
                    const diff = difiere(form, calc)
                    return (
                      <td key={i} style={{ ...tdBase, ...alertaHIM(campo, calc ?? form) }}>
                        {!hay
                          ? '—'
                          : diff
                            ? <span>
                                <span style={{ color: 'rgba(13,15,12,0.55)', textDecoration: 'line-through', marginRight: 4 }}>{fmtNum(form)}</span>
                                <span style={{ fontWeight: 800 }}>{fmtNum(calc)}</span>
                              </span>
                            : <span>{fmtNum(calc ?? form)}</span>
                        }
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Sección: Plagas foliares ─────────────────────────────────────────────────

function SeccionPlagas({ pf }: { pf?: PlagasFoliares | null }) {
  if (!pf) return null
  const cer = pf.ceramida
  const sib = pf.sibine
  const todoNull = [cer?.h, cer?.p, cer?.m, cer?.g, sib?.h, sib?.p, sib?.m, sib?.g]
    .every(v => v == null)
  if (todoNull) return null

  function FilaPlaga({ nombre, d }: { nombre: string; d?: PlagaFoliar | null }) {
    return (
      <tr style={{ borderBottom: '1px solid rgba(13,15,12,0.06)' }}>
        <td style={{ ...tdBase, fontWeight: 700, color: '#0D0F0C' }}>{nombre}</td>
        <td style={tdBase}>{fmtNum(d?.h)}</td>
        <td style={tdBase}>{fmtNum(d?.p)}</td>
        <td style={tdBase}>{fmtNum(d?.m)}</td>
        <td style={tdBase}>{fmtNum(d?.g ?? null)}</td>
      </tr>
    )
  }

  return (
    <div>
      <div style={{ ...labelStyle, marginBottom: 8 }}>Plagas foliares</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>Plaga</th>
              <th style={thStyle}>H</th>
              <th style={thStyle}>P</th>
              <th style={thStyle}>M</th>
              <th style={thStyle}>G</th>
            </tr>
          </thead>
          <tbody>
            <FilaPlaga nombre="Ceramida" d={cer} />
            <FilaPlaga nombre="Sibine"   d={sib} />
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Sección: Seguimiento ─────────────────────────────────────────────────────

function SeccionSeguimiento({ s }: { s: SigatokaMuestreo }) {
  const campos = [
    { label: 'P-EF-FINCA',      value: s.pEfFinca   },
    { label: 'P-EF-FINCA T=',   value: s.pEfFincaT  },
    { label: 'P-EF-FINCA Frec', value: s.pEfFincaFrec },
    { label: 'Erradicadas BSV', value: s.erradicadasBsv },
  ]
  const alguno = campos.some(c => c.value != null)
  if (!alguno) return null

  return (
    <div>
      <div style={{ ...labelStyle, marginBottom: 8 }}>Seguimiento</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {campos.map(c => (
          <div key={c.label} style={{ background: 'rgba(255,255,255,0.55)', padding: '6px 10px', minWidth: 120 }}>
            <div style={labelStyle}>{c.label}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#0D0F0C', marginTop: 2 }}>
              {fmtNum(c.value ?? null)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────

export function SigatokaRevisionView() {
  const { user } = useAuth()
  const fincaId = user?.finca_id ?? null

  const [items, setItems]             = useState<ItemLista[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [loadingDetalle, setLoadingDetalle] = useState(false)

  const [detalle, setDetalle]         = useState<Detalle | null>(null)

  // Ilegibles: inputs para el flujo previo (mantenido por compatibilidad, se
  // envían como parte de correcciones en el PATCH)
  const [valores, setValores]         = useState<Record<string, string>>({})

  // Modo edición: permite editar CUALQUIER celda de la matriz y tablas semana
  const [modoEdicion, setModoEdicion] = useState(false)
  // Mapa de correcciones acumuladas en modo edición: key → valor string
  const [correcciones, setCorrecciones] = useState<Record<string, string>>({})

  const [saving, setSaving]           = useState(false)
  const [okMsg, setOkMsg]             = useState<string | null>(null)
  const [warnMsg, setWarnMsg]         = useState<string | null>(null)

  // Set de keys ilegibles para lookup O(1) en las tablas
  const ilegibleKeys: Set<string> = new Set(
    detalle?.ilegibles.ubicaciones.map(u => `${u.punto}.${u.campo}`) ?? []
  )

  function handleInput(k: string, v: string) {
    setValores(prev => ({ ...prev, [k]: v }))
  }

  function handleCorreccion(k: string, v: string) {
    setCorrecciones(prev => ({ ...prev, [k]: v }))
  }

  function activarEdicion() {
    // Pre-populate correcciones con los valores actuales de ilegibles ya ingresados
    setCorrecciones(prev => ({ ...valores, ...prev }))
    setModoEdicion(true)
    setOkMsg(null)
  }

  function cancelarEdicion() {
    setModoEdicion(false)
    setCorrecciones({})
  }

  const cargarLista = useCallback(async () => {
    if (!fincaId) { setLoadingList(false); return }
    setLoadingList(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/finca/${fincaId}/sigatoka/revision`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data = await res.json()
      setItems(data.eventos ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la cola de revisión')
    } finally {
      setLoadingList(false)
    }
  }, [fincaId])

  useEffect(() => { void cargarLista() }, [cargarLista])

  async function abrirDetalle(id: string) {
    if (!fincaId) return
    setDetalle(null)
    setValores({})
    setOkMsg(null)
    setModoEdicion(false)
    setCorrecciones({})
    setLoadingDetalle(true)
    try {
      const res = await fetch(`${API}/api/finca/${fincaId}/sigatoka/revision/${id}`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setDetalle(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el muestreo')
    } finally {
      setLoadingDetalle(false)
    }
  }

  /** Construye el array de correcciones para el PATCH.
   *  Combina:
   *  - `correcciones` del modo edición (cualquier celda, incluidas ilegibles)
   *  - `valores` del panel lateral de ilegibles (si no están ya en correcciones)
   *  Todo va como `correcciones` — el backend trata aclaraciones y correcciones
   *  igual en cuanto a persistencia; usar solo `correcciones` simplifica el cliente.
   *  Acepta coma decimal (ej. "6,6" → 6.6). Filtra items no numéricos y
   *  actualiza `warnMsg` si alguno fue descartado.
   */
  function buildCorrecciones(): Array<{ punto: string; campo: string; valor: number | null }> {
    if (!detalle) return []

    const merged: Record<string, string> = {}

    // Prioridad 1: valores del panel de ilegibles
    for (const u of detalle.ilegibles.ubicaciones) {
      const key = `${u.punto}.${u.campo}`
      const raw = valores[key]?.trim()
      if (raw) merged[key] = raw
    }

    // Prioridad 2 (override): correcciones del modo edición
    for (const [k, v] of Object.entries(correcciones)) {
      if (v.trim() !== '') merged[k] = v.trim()
    }

    let descartados = 0
    const result: Array<{ punto: string; campo: string; valor: number | null }> = []

    for (const [key, raw] of Object.entries(merged)) {
      // key formato: "P3.planta1_estadio" o "11sem-14.ht" o "00sem-3.lc"
      const dotIdx = key.indexOf('.')
      const punto = key.slice(0, dotIdx)
      const campo = key.slice(dotIdx + 1)
      // Normalizar coma decimal antes de convertir
      const normalizado = raw.replace(',', '.')
      const num = Number(normalizado)
      if (!Number.isFinite(num)) {
        descartados++
        continue  // filtrar, no enviar null
      }
      result.push({ punto, campo, valor: num })
    }

    if (descartados > 0) {
      setWarnMsg(`${descartados} valor${descartados !== 1 ? 'es' : ''} no numérico${descartados !== 1 ? 's' : ''} ignorado${descartados !== 1 ? 's' : ''}.`)
    } else {
      setWarnMsg(null)
    }

    return result
  }

  async function guardar(marcarRevisado: boolean) {
    if (!detalle || !fincaId) return

    if (marcarRevisado) {
      const ok = window.confirm(
        '¿Confirmar aprobación?\n\nEsto cierra el muestreo como revisado. Esta acción no se puede deshacer.'
      )
      if (!ok) return
    }

    setSaving(true)
    setOkMsg(null)
    try {
      const body: {
        correcciones?: ReturnType<typeof buildCorrecciones>
        marcar_revisado?: boolean
      } = {}

      const corrs = buildCorrecciones()
      if (corrs.length > 0) body.correcciones = corrs
      if (marcarRevisado) body.marcar_revisado = true

      const res = await fetch(`${API}/api/finca/${fincaId}/sigatoka/revision/${detalle.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data = await res.json()

      if (marcarRevisado) {
        setDetalle(null)
        setModoEdicion(false)
        setCorrecciones({})
        setValores({})
        await cargarLista()
      } else {
        // Re-fetch del detalle para que los checksums se recalculen y se vean
        setModoEdicion(false)
        setCorrecciones({})
        setValores({})
        await abrirDetalle(detalle.id)
        setOkMsg(`Correcciones guardadas. Quedan ${data.ilegibles?.total ?? 0} celdas sin definir.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  const s = detalle?.sigatoka ?? null
  const nCorrecciones = Object.keys(correcciones).filter(k => correcciones[k].trim() !== '').length

  return (
    <>
      <Topbar
        title="Revisión Sigatoka"
        badge={`${items.length} muestreo${items.length !== 1 ? 's' : ''} por revisar`}
        avatarInitials={user ? getInitials(user.nombre) : 'WA'}
      />

      <main style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {!fincaId && (
          <div style={{ ...card, padding: 20, fontSize: 13, color: '#7A1810' }}>
            Tu usuario no tiene una finca asignada.
          </div>
        )}

        {error && (
          <div style={{
            background: '#FFEEEA', border: '2px solid #C43020',
            boxShadow: '4px 4px 0 0 #C43020', padding: '12px 16px',
            fontSize: 13, color: '#C43020',
          }}>
            ⚠ {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: detalle ? '320px 1fr' : '1fr', gap: 16, alignItems: 'start' }}>

          {/* ── Lista ── */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(13,15,12,0.1)', background: 'rgba(13,15,12,0.03)' }}>
              <span style={labelStyle}>Cola de revisión</span>
            </div>

            {loadingList && (
              <div style={{ padding: 20, fontSize: 13, color: 'rgba(13,15,12,0.5)' }}>Cargando…</div>
            )}
            {!loadingList && items.length === 0 && fincaId && (
              <div style={{ padding: 24, fontSize: 13, color: 'rgba(13,15,12,0.45)', textAlign: 'center' }}>
                No hay muestreos pendientes de revisión. ✅
              </div>
            )}

            {items.map(it => {
              const badge = RUTA_BADGE[it.ilegibles.ruta] ?? RUTA_BADGE['preguntar']!
              const activo = detalle?.id === it.id
              return (
                <div
                  key={it.id}
                  onClick={() => abrirDetalle(it.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px',
                    borderBottom: '1px solid rgba(13,15,12,0.06)',
                    cursor: 'pointer',
                    background: activo ? 'rgba(201,240,59,0.1)' : 'transparent',
                    borderLeft: activo ? '3px solid #C9F03B' : '3px solid transparent',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0D0F0C' }}>
                      {it.nombre_finca ?? 'Finca'} · semana {it.semana ?? '—'}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(13,15,12,0.45)', marginTop: 2 }}>
                      {new Date(it.created_at).toLocaleDateString()}
                      {' · '}{it.ilegibles.total} celda{it.ilegibles.total !== 1 ? 's' : ''} ilegible{it.ilegibles.total !== 1 ? 's' : ''}
                      {it.tiene_imagen ? ' · 📷' : ''}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 9, fontWeight: 800, padding: '3px 7px',
                    background: badge.bg, color: badge.color,
                    border: `1.5px solid ${badge.color}`,
                    flexShrink: 0,
                  }}>
                    {badge.label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* ── Detalle ── */}
          {detalle && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Cabecera del detalle */}
              <div style={{ ...card, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#0D0F0C' }}>
                    {s?.nombreFinca ?? 'Muestreo'} · semana {s?.semana ?? '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(13,15,12,0.5)', marginTop: 2 }}>
                    {new Date(detalle.created_at).toLocaleDateString()}
                    {s?.supervisor ? ` · ${s.supervisor}` : ''}
                    {' · '}Confianza: {detalle.confidence_score != null ? `${Math.round(detalle.confidence_score * 100)}%` : '—'}
                    {' · '}{detalle.ilegibles.total} celdas ilegibles
                  </div>
                </div>
                <button
                  onClick={() => setDetalle(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'rgba(13,15,12,0.4)', marginLeft: 16 }}
                  aria-label="Cerrar"
                >
                  ✕
                </button>
              </div>

              {loadingDetalle && (
                <div style={{ ...card, padding: 20, fontSize: 13, color: 'rgba(13,15,12,0.5)' }}>
                  Cargando ficha…
                </div>
              )}

              {!loadingDetalle && s && (
                <>
                  {/* Imagen + panel de acciones en paralelo */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>

                    {/* Imagen original */}
                    <div style={{ ...card, overflow: 'hidden' }}>
                      <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(13,15,12,0.1)', background: 'rgba(13,15,12,0.03)' }}>
                        <span style={labelStyle}>Foto original</span>
                      </div>
                      {detalle.imagen_url
                        ? (
                          <a href={detalle.imagen_url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={detalle.imagen_url}
                              alt="Ficha de muestreo"
                              style={{ width: '100%', display: 'block' }}
                            />
                          </a>
                        )
                        : (
                          <div style={{ padding: 24, fontSize: 12, color: 'rgba(13,15,12,0.4)', textAlign: 'center' }}>
                            Sin imagen original
                          </div>
                        )
                      }
                    </div>

                    {/* Panel derecho: encabezado + acciones */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ ...card, padding: '14px 16px' }}>
                        <SeccionEncabezado s={s} conf={detalle.confidence_score} />
                      </div>

                      {/* Panel de celdas ilegibles (solo lectura rápida; se oculta en modo edición) */}
                      {!modoEdicion && detalle.ilegibles.ubicaciones.length > 0 && (
                        <div style={{ ...card, padding: '14px 16px' }}>
                          <div style={{ ...labelStyle, marginBottom: 8 }}>
                            Celdas ilegibles — completá lo que veas en la foto
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto', marginBottom: 10 }}>
                            {detalle.ilegibles.ubicaciones.map(u => {
                              const key = `${u.punto}.${u.campo}`
                              return (
                                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <div style={{ flex: 1, fontSize: 12, color: '#0D0F0C' }}>
                                    <strong>{u.punto}</strong>
                                    {u.sector ? ` (${u.sector})` : ''}
                                    {' · '}{LABEL_CAMPO[u.campo] ?? u.campo}
                                  </div>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    value={valores[key] ?? ''}
                                    onChange={e => handleInput(key, e.target.value)}
                                    placeholder="—"
                                    style={{
                                      width: 72, padding: '5px 8px',
                                      border: '2px solid #0D0F0C',
                                      fontSize: 13, fontFamily: 'monospace',
                                    }}
                                  />
                                </div>
                              )
                            })}
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => void guardar(false)}
                              disabled={saving}
                              style={{
                                flex: 1, padding: '9px',
                                border: '2px solid #0D0F0C',
                                background: '#F5F1E8',
                                fontWeight: 700, fontSize: 13,
                                cursor: saving ? 'wait' : 'pointer',
                              }}
                            >
                              {saving ? 'Guardando…' : 'Guardar'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Modo edición: barra de estado y acciones */}
                      {modoEdicion && (
                        <div style={{
                          ...card,
                          padding: '14px 16px',
                          background: 'rgba(37,99,235,0.05)',
                          border: '2px solid #2563EB',
                          boxShadow: '4px 4px 0 0 #2563EB',
                        }}>
                          <div style={{ ...labelStyle, color: '#2563EB', marginBottom: 6 }}>
                            Modo edición activo
                          </div>
                          <div style={{ fontSize: 12, color: '#2563EB', marginBottom: 12 }}>
                            {nCorrecciones > 0
                              ? `${nCorrecciones} celda${nCorrecciones !== 1 ? 's' : ''} modificada${nCorrecciones !== 1 ? 's' : ''} (borde azul)`
                              : 'Hacé clic en cualquier celda de la ficha para editarla.'
                            }
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => void guardar(false)}
                              disabled={saving || nCorrecciones === 0}
                              style={{
                                flex: 1, padding: '9px',
                                border: '2px solid #2563EB',
                                background: '#2563EB',
                                color: '#fff',
                                fontWeight: 700, fontSize: 13,
                                cursor: (saving || nCorrecciones === 0) ? 'not-allowed' : 'pointer',
                                opacity: nCorrecciones === 0 ? 0.5 : 1,
                              }}
                            >
                              {saving ? 'Guardando…' : `Guardar ${nCorrecciones > 0 ? `(${nCorrecciones})` : ''}`}
                            </button>
                            <button
                              onClick={cancelarEdicion}
                              disabled={saving}
                              style={{
                                padding: '9px 14px',
                                border: '2px solid #0D0F0C',
                                background: '#F5F1E8',
                                fontWeight: 600, fontSize: 13,
                                cursor: 'pointer',
                              }}
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Botón para activar modo edición */}
                      {!modoEdicion && (
                        <button
                          onClick={activarEdicion}
                          style={{
                            padding: '10px 16px',
                            border: '2px solid #2563EB',
                            background: '#F5F1E8',
                            color: '#2563EB',
                            fontWeight: 700, fontSize: 13,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          ✎ Corregir valores leídos por el modelo
                        </button>
                      )}

                      {okMsg && (
                        <div style={{ fontSize: 12, color: '#1F8040', padding: '8px 12px', background: '#EDFBF3', border: '1px solid #1F8040' }}>
                          {okMsg}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Tablas de datos completas ── */}
                  <div style={{ ...card, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 20 }}>

                    {/* Matriz de puntos */}
                    <SeccionMatriz
                      puntos={s.puntosMuestreo ?? []}
                      ilegibleKeys={ilegibleKeys}
                      valores={valores}
                      onInput={handleInput}
                      modoEdicion={modoEdicion}
                      correcciones={correcciones}
                      onCorreccion={handleCorreccion}
                    />

                    {/* Tabla 11 semanas */}
                    {(s.plantas11sem?.length ?? 0) > 0 && (
                      <SeccionTablaSemanas
                        titulo="Plantas de 11 semanas"
                        filas={s.plantas11sem ?? []}
                        totales={s.totales11sem}
                        promedios={s.promedios11sem}
                        verificacion={s.verificacion11sem}
                        prefijo="11sem"
                        ilegibleKeys={ilegibleKeys}
                        valores={valores}
                        onInput={handleInput}
                        modoEdicion={modoEdicion}
                        correcciones={correcciones}
                        onCorreccion={handleCorreccion}
                      />
                    )}

                    {/* Tabla 00 semanas */}
                    {(s.plantas00sem?.length ?? 0) > 0 && (
                      <SeccionTablaSemanas
                        titulo="Plantas de 00 semanas"
                        filas={s.plantas00sem ?? []}
                        totales={s.totales00sem}
                        promedios={s.promedios00sem}
                        verificacion={s.verificacion00sem}
                        prefijo="00sem"
                        ilegibleKeys={ilegibleKeys}
                        valores={valores}
                        onInput={handleInput}
                        modoEdicion={modoEdicion}
                        correcciones={correcciones}
                        onCorreccion={handleCorreccion}
                      />
                    )}

                    {/* DATOS A–M */}
                    <SeccionDatos columnas={s.resumenColumnas ?? []} />

                    {/* Plagas foliares */}
                    <SeccionPlagas pf={s.plagasFoliares} />

                    {/* Seguimiento */}
                    <SeccionSeguimiento s={s} />
                  </div>

                  {/* ── Botón de aprobación humana (P7) ── */}
                  <div style={{ ...card, padding: '16px 18px', background: '#F0FBF4', border: '2px solid #1B3D24', boxShadow: '4px 4px 0 0 #1B3D24' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: '#1B3D24' }}>
                          ¿La ficha está correcta?
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(27,61,36,0.65)', marginTop: 2 }}>
                          Aprobá el muestreo cuando los datos coincidan con la foto. Esta acción cierra la revisión.
                        </div>
                      </div>
                      <button
                        onClick={() => void guardar(true)}
                        disabled={saving || modoEdicion}
                        title={modoEdicion ? 'Guardá o cancelá las correcciones antes de aprobar' : undefined}
                        style={{
                          padding: '12px 24px',
                          border: '2px solid #1B3D24',
                          background: saving || modoEdicion ? 'rgba(201,240,59,0.4)' : '#C9F03B',
                          color: '#0D0F0C',
                          fontWeight: 800, fontSize: 14,
                          cursor: (saving || modoEdicion) ? 'not-allowed' : 'pointer',
                          flexShrink: 0,
                          opacity: modoEdicion ? 0.5 : 1,
                        }}
                      >
                        {saving ? 'Procesando…' : '✓ Todo correcto — aprobar muestreo'}
                      </button>
                    </div>
                  </div>

                </>
              )}

              {/* Sin sigatoka parseable */}
              {!loadingDetalle && !s && (
                <div style={{ ...card, padding: '16px 18px', fontSize: 13, color: 'rgba(13,15,12,0.45)' }}>
                  No hay datos de la ficha disponibles para este evento.
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
