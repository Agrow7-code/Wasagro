import { useState, useEffect, useCallback } from 'react'
import { Topbar } from '../layout/Topbar'
import { useAuth } from '../../auth/useAuth'

// Vista de revisión de muestreos Sigatoka (D30) — rediseño "ficha".
// Objetivo de campo: validar de un vistazo contra la foto, con MÍNIMOS clics.
// - Foto original STICKY a la izquierda: siempre visible mientras se valida.
// - Datos a la derecha, en el orden de la ficha física (encabezado · matriz ·
//   11/00 sem · DATOS A–M · plagas · seguimiento).
// - Resumen de ATENCIÓN arriba: lleva directo a lo que hay que mirar.
// - TODA celda es editable directo (sin "modo edición"): tocás, escribís, listo.
//   Ilegible → ámbar. Corregida por vos → azul. Auto-corregida por el oráculo
//   (origen='cross_field') → azul + "auto". Todo se envía como `correcciones`.

const API = (import.meta.env.VITE_API_URL ?? '') as string

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('wasagro_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ─── Tipos locales ────────────────────────────────────────────────────────────

interface CeldaMuestra { valor: number | null; estado: 'leida' | 'vacia' | 'ilegible'; origen?: 'modelo' | 'cross_field' }

/** Normaliza el valor crudo de una celda. Eventos viejos: número plano o null.
 *  Eventos nuevos: { valor, estado }. Nunca arroja. */
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
  ht: unknown; hVle: unknown; q5menos: unknown; q5mas: unknown; lc: unknown
}
interface TotalesSemana { ht?: number | null; hVle?: number | null; q5menos?: number | null; q5mas?: number | null; lc?: number | null }
interface ColumnaChecksum { columna: string; sumaFilas: number; totalFicha: number | null; cuadra: boolean | null }
interface VerificacionTabla { columnas: ColumnaChecksum[]; cuadraTodo: boolean | null }

interface PuntoMuestreo {
  punto: string; sector?: string | null; lote_id?: string | null
  planta1_estadio: unknown; planta1_piscas: unknown
  planta2_estadio: unknown; planta2_piscas: unknown
  planta3_estadio: unknown; planta3_piscas: unknown
  hVle: unknown; hVlq: unknown; func: unknown; marcaEspecial?: string | null
}

interface ResumenColumna {
  A?: number | null; B?: number | null; C?: number | null
  D?: number | null; E?: number | null; F?: number | null; G?: number | null
  H_formulario?: number | null; I_formulario?: number | null; J_formulario?: number | null
  K_formulario?: number | null; L_formulario?: number | null; M_formulario?: number | null
  H_calculado?: number | null; I_calculado?: number | null; J_calculado?: number | null
  K_calculado?: number | null; L_calculado?: number | null; M_calculado?: number | null
}

interface PlagaFoliar { h?: number | null; p?: number | null; m?: number | null; g?: number | null }
interface PlagasFoliares { ceramida?: PlagaFoliar; sibine?: PlagaFoliar }

interface SigatokaMuestreo {
  zona?: string | null; codigoFinca?: string | null; nombreFinca?: string | null
  semana?: number | null; periodo?: number | null; fecha?: string | null; supervisor?: string | null
  puntosMuestreo?: PuntoMuestreo[]
  plantas11sem?: FilaSemana[]; plantas00sem?: FilaSemana[]
  totales11sem?: TotalesSemana | null; promedios11sem?: TotalesSemana | null
  totales00sem?: TotalesSemana | null; promedios00sem?: TotalesSemana | null
  verificacion11sem?: VerificacionTabla | null; verificacion00sem?: VerificacionTabla | null
  resumenColumnas?: ResumenColumna[]
  plagasFoliares?: PlagasFoliares | null
  pEfFinca?: number | null; pEfFincaT?: number | null; pEfFincaFrec?: number | null; erradicadasBsv?: number | null
}

interface Ubicacion { punto: string; sector: string | null; campo: string }
interface ItemLista {
  id: string; created_at: string; confidence_score: number | null
  semana: number | null; nombre_finca: string | null; tiene_imagen: boolean
  ilegibles: { total: number; ruta: 'completo' | 'preguntar' | 'manual' }
}
interface Detalle {
  id: string; status: string; created_at: string; confidence_score: number | null
  sigatoka: SigatokaMuestreo | null; imagen_url: string | null
  ilegibles: { total: number; ubicaciones: Ubicacion[]; ruta: string }
}

// ─── Estilos base ─────────────────────────────────────────────────────────────

const card = { background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C' } as const
const labelStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(13,15,12,0.4)',
}
const thStyle: React.CSSProperties = {
  padding: '5px 6px', textAlign: 'center', fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.04em', color: 'rgba(13,15,12,0.45)', whiteSpace: 'nowrap',
  borderBottom: '2px solid rgba(13,15,12,0.15)', background: 'rgba(13,15,12,0.03)',
}
const tdBase: React.CSSProperties = {
  padding: '4px 6px', fontSize: 12, fontFamily: 'monospace', textAlign: 'center',
  borderBottom: '1px solid rgba(13,15,12,0.06)', whiteSpace: 'nowrap',
}
const tdRowLabel: React.CSSProperties = { ...tdBase, fontWeight: 800, color: '#0D0F0C', textAlign: 'left' }

const RUTA_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  completo: { label: 'Completo', color: '#1F8040', bg: '#EDFBF3' },
  preguntar: { label: 'A revisar', color: '#8A6000', bg: '#FDF6DD' },
  manual: { label: 'Manual', color: '#7A1810', bg: '#FFEEEA' },
}
const LABEL_CAMPO: Record<string, string> = {
  planta1_estadio: 'P1 estadio', planta1_piscas: 'P1 piscas',
  planta2_estadio: 'P2 estadio', planta2_piscas: 'P2 piscas',
  planta3_estadio: 'P3 estadio', planta3_piscas: 'P3 piscas',
  hVle: 'H+VLE', hVlq: 'H+VLQ', func: 'Func', ht: 'H.T', q5menos: 'Q<5%', q5mas: 'Q>5%', lc: 'L.C.',
}

function getInitials(n: string) {
  return n.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('')
}

// ─── Celda SIEMPRE editable (sin modo edición → menos clics) ──────────────────

function CeldaEditable({
  celda, editKey, correcciones, onCorreccion, ilegible,
}: {
  celda: CeldaMuestra
  editKey: string
  correcciones: Record<string, string>
  onCorreccion: (k: string, v: string) => void
  ilegible: boolean
}) {
  const dirty = editKey in correcciones
  const display = dirty ? correcciones[editKey]! : (celda.valor != null ? String(celda.valor) : '')
  const cross = celda.origen === 'cross_field'

  // Borde por estado: dirty (vos) y cross (oráculo) en azul, ilegible en ámbar,
  // normal casi sin borde para que la tabla se lea como tabla, no como formulario.
  let borderColor = 'rgba(13,15,12,0.10)'
  let bg = 'transparent'
  let color = '#0D0F0C'
  let weight = 400
  if (ilegible && !dirty) { borderColor = '#D97706'; bg = 'rgba(251,191,36,0.20)' }
  if (cross && !dirty) { borderColor = '#2563EB'; bg = 'rgba(37,99,235,0.10)' }
  if (dirty) { borderColor = '#2563EB'; color = '#2563EB'; weight = 700 }

  return (
    <td style={{ padding: 2, position: 'relative' }}>
      <input
        type="number"
        inputMode="decimal"
        value={display}
        onChange={e => onCorreccion(editKey, e.target.value)}
        placeholder={ilegible ? '?' : ''}
        title={cross ? 'Auto-corregido por el oráculo: cuadra con el total (T=) de la ficha' : undefined}
        style={{
          width: 44, padding: '4px 4px', textAlign: 'center',
          border: `1.5px solid ${borderColor}`, background: bg,
          fontSize: 12, fontFamily: 'monospace', color, fontWeight: weight,
        }}
      />
      {cross && !dirty && (
        <span style={{ position: 'absolute', top: -4, right: 0, fontSize: 7, fontWeight: 800, color: '#2563EB', background: '#F5F1E8', padding: '0 2px', lineHeight: 1.2 }}>
          auto
        </span>
      )}
    </td>
  )
}

// ─── Encabezado ───────────────────────────────────────────────────────────────

function SeccionEncabezado({ s, conf }: { s: SigatokaMuestreo; conf: number | null }) {
  const campos = [
    { label: 'Zona', value: s.zona ?? '—' },
    { label: 'Finca', value: s.nombreFinca ?? '—' },
    { label: 'Código', value: s.codigoFinca ?? '—' },
    { label: 'Semana', value: s.semana != null ? String(s.semana) : '—' },
    { label: 'Período', value: s.periodo != null ? String(s.periodo) : '—' },
    { label: 'Fecha', value: s.fecha ?? '—' },
    { label: 'Supervisor', value: s.supervisor ?? '—' },
    { label: 'Confianza', value: conf != null ? `${Math.round(conf * 100)}%` : '—' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px 10px' }}>
      {campos.map(c => (
        <div key={c.label} style={{ background: 'rgba(255,255,255,0.55)', padding: '6px 10px' }}>
          <div style={labelStyle}>{c.label}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0D0F0C', marginTop: 2 }}>{c.value}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Matriz de puntos (siempre editable) ──────────────────────────────────────

function SeccionMatriz({ puntos, ilegibleKeys, correcciones, onCorreccion }: {
  puntos: PuntoMuestreo[]
  ilegibleKeys: Set<string>
  correcciones: Record<string, string>
  onCorreccion: (k: string, v: string) => void
}) {
  if (!puntos.length) return null
  const cols: Array<{ label: string; campo: keyof PuntoMuestreo }> = [
    { label: 'P1e', campo: 'planta1_estadio' }, { label: 'P1p', campo: 'planta1_piscas' },
    { label: 'P2e', campo: 'planta2_estadio' }, { label: 'P2p', campo: 'planta2_piscas' },
    { label: 'P3e', campo: 'planta3_estadio' }, { label: 'P3p', campo: 'planta3_piscas' },
    { label: 'H+VLE', campo: 'hVle' }, { label: 'H+VLQ', campo: 'hVlq' }, { label: 'Func', campo: 'func' },
  ]
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: 'left' }}>Punto</th>
          <th style={{ ...thStyle, textAlign: 'left' }}>Sector</th>
          {cols.map(c => <th key={String(c.campo)} style={thStyle}>{c.label}</th>)}
          <th style={thStyle}>Nota</th>
        </tr>
      </thead>
      <tbody>
        {puntos.map(p => (
          <tr key={p.punto}>
            <td style={tdRowLabel}>{p.punto}</td>
            <td style={{ ...tdBase, textAlign: 'left', color: 'rgba(13,15,12,0.55)' }}>{p.sector ?? '—'}</td>
            {cols.map(c => {
              const celda = asCelda((p as unknown as Record<string, unknown>)[c.campo])
              const k = `${p.punto}.${String(c.campo)}`
              return <CeldaEditable key={String(c.campo)} celda={celda} editKey={k} correcciones={correcciones} onCorreccion={onCorreccion} ilegible={ilegibleKeys.has(k)} />
            })}
            <td style={{ ...tdBase, color: 'rgba(13,15,12,0.45)', fontSize: 10 }}>{p.marcaEspecial ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Tabla de semanas (11/00) — editable + checksum ───────────────────────────

function SeccionTablaSemanas({ filas, totales, promedios, verificacion, prefijo, ilegibleKeys, correcciones, onCorreccion }: {
  filas: FilaSemana[]
  totales?: TotalesSemana | null
  promedios?: TotalesSemana | null
  verificacion?: VerificacionTabla | null
  prefijo: string
  ilegibleKeys: Set<string>
  correcciones: Record<string, string>
  onCorreccion: (k: string, v: string) => void
}) {
  if (!filas.length && !totales && !promedios) return null

  const checksumMap: Record<string, ColumnaChecksum | undefined> = {}
  if (verificacion?.columnas) for (const c of verificacion.columnas) checksumMap[c.columna] = c

  const colsDef: Array<{ label: string; campo: 'ht' | 'hVle' | 'q5menos' | 'q5mas' | 'lc' }> = [
    { label: 'H.T', campo: 'ht' }, { label: 'H+VLE', campo: 'hVle' }, { label: 'Q<5%', campo: 'q5menos' },
    { label: 'Q>5%', campo: 'q5mas' }, { label: 'L.C.', campo: 'lc' },
  ]
  const checksumTh = (campo: string): React.CSSProperties => {
    const cs = checksumMap[campo]
    if (!cs || cs.cuadra === null) return thStyle
    return cs.cuadra === false ? { ...thStyle, color: '#C43020' } : { ...thStyle, color: '#1F8040' }
  }
  const checksumIcon = (campo: string): string => {
    const cs = checksumMap[campo]
    if (!cs || cs.cuadra === null) return ''
    return cs.cuadra === false ? ' ✗' : ' ✓'
  }
  const sumaCalc = (campo: 'ht' | 'hVle' | 'q5menos' | 'q5mas' | 'lc'): number | null => {
    let sum = 0, conValor = false
    for (const f of filas) { const c = asCelda(f[campo]); if (c.valor === null) continue; sum += c.valor; conValor = true }
    return conValor ? sum : null
  }

  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: 'left' }}>#</th>
          <th style={{ ...thStyle, textAlign: 'left' }}>Sector</th>
          {colsDef.map(c => (
            <th key={c.campo} style={checksumTh(c.campo)} title={checksumMap[c.campo]?.cuadra === false ? `No cuadra — suma: ${checksumMap[c.campo]?.sumaFilas}, ficha: ${checksumMap[c.campo]?.totalFicha}` : undefined}>
              {c.label}{checksumIcon(c.campo)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filas.map((f, idx) => (
          <tr key={idx}>
            <td style={{ ...tdBase, fontWeight: 700, textAlign: 'left', color: '#0D0F0C' }}>{f.fila ?? idx + 1}</td>
            <td style={{ ...tdBase, textAlign: 'left', color: 'rgba(13,15,12,0.55)' }}>{f.sector ?? '—'}</td>
            {colsDef.map(c => {
              const celda = asCelda(f[c.campo])
              const k = `${prefijo}-${f.fila ?? idx + 1}.${c.campo}`
              return <CeldaEditable key={c.campo} celda={celda} editKey={k} correcciones={correcciones} onCorreccion={onCorreccion} ilegible={ilegibleKeys.has(k)} />
            })}
          </tr>
        ))}

        {/* Suma calculada por Wasagro vs T= de la ficha */}
        <tr style={{ borderTop: '2px solid rgba(13,15,12,0.12)', background: 'rgba(13,15,12,0.03)' }}>
          <td colSpan={2} style={{ ...tdBase, textAlign: 'left', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: 'rgba(13,15,12,0.45)' }}>Suma calc.</td>
          {colsDef.map(c => {
            const suma = sumaCalc(c.campo)
            const cs = checksumMap[c.campo]
            const noC = cs && cs.cuadra === false
            return (
              <td key={c.campo} style={{ ...tdBase, fontWeight: 700, color: noC ? '#C43020' : '#0D0F0C', background: noC ? 'rgba(196,48,32,0.08)' : undefined }}>
                {fmtNum(suma)}{noC && suma !== null && <span style={{ fontSize: 9 }}> ≠{cs!.totalFicha}</span>}
              </td>
            )
          })}
        </tr>
        {totales && (
          <tr style={{ background: 'rgba(13,15,12,0.02)', borderTop: '1px dashed rgba(13,15,12,0.1)' }}>
            <td colSpan={2} style={{ ...tdBase, textAlign: 'left', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: 'rgba(13,15,12,0.4)' }}>T= ficha</td>
            {colsDef.map(c => <td key={c.campo} style={{ ...tdBase, color: 'rgba(13,15,12,0.65)' }}>{fmtNum(totales[c.campo])}</td>)}
          </tr>
        )}
        {promedios && (
          <tr style={{ background: 'rgba(13,15,12,0.02)' }}>
            <td colSpan={2} style={{ ...tdBase, textAlign: 'left', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: 'rgba(13,15,12,0.4)' }}>Pr= ficha</td>
            {colsDef.map(c => <td key={c.campo} style={{ ...tdBase, color: 'rgba(13,15,12,0.65)' }}>{fmtNum(promedios[c.campo])}</td>)}
          </tr>
        )}
      </tbody>
    </table>
  )
}

// ─── DATOS A–M (referencia, solo lectura) ─────────────────────────────────────

function SeccionDatos({ columnas }: { columnas: ResumenColumna[] }) {
  if (!columnas.length) return null
  const camposAG = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const
  const camposHM = ['H', 'I', 'J', 'K', 'L', 'M'] as const

  const alertaHM = (campo: typeof camposHM[number], val: number | null | undefined): React.CSSProperties => {
    if (val == null) return {}
    if (campo === 'J' && val > 10) return { color: '#C43020', fontWeight: 800 }
    if (campo === 'I' && val > 5) return { color: '#E06820', fontWeight: 800 }
    if (campo === 'M' && val < 9) return { color: '#C43020', fontWeight: 800 }
    return {}
  }
  const difiere = (form?: number | null, calc?: number | null) => form != null && calc != null && Math.abs(form - calc) >= 0.05

  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: 'left' }}>Campo</th>
          {columnas.map((_, i) => <th key={i} style={thStyle}>Pl. {i + 1}</th>)}
        </tr>
      </thead>
      <tbody>
        {camposAG.map(campo => (
          <tr key={campo}>
            <td style={tdRowLabel}>{campo}</td>
            {columnas.map((col, i) => <td key={i} style={tdBase}>{fmtNum(col[campo])}</td>)}
          </tr>
        ))}
        <tr style={{ borderTop: '1px dashed rgba(13,15,12,0.12)' }}>
          <td colSpan={columnas.length + 1} style={{ ...tdBase, textAlign: 'left', fontSize: 8, color: 'rgba(13,15,12,0.35)' }}>
            H–M: ficha / calculado — se resalta si difieren
          </td>
        </tr>
        {camposHM.map(campo => {
          const fKey = `${campo}_formulario` as keyof ResumenColumna
          const cKey = `${campo}_calculado` as keyof ResumenColumna
          return (
            <tr key={campo}>
              <td style={tdRowLabel}>{campo}</td>
              {columnas.map((col, i) => {
                const form = col[fKey] as number | null | undefined
                const calc = col[cKey] as number | null | undefined
                const hay = form != null || calc != null
                return (
                  <td key={i} style={{ ...tdBase, ...alertaHM(campo, calc ?? form) }}>
                    {!hay ? '—' : difiere(form, calc)
                      ? <span><span style={{ color: 'rgba(13,15,12,0.55)', textDecoration: 'line-through', marginRight: 3 }}>{fmtNum(form)}</span><span style={{ fontWeight: 800 }}>{fmtNum(calc)}</span></span>
                      : <span>{fmtNum(calc ?? form)}</span>}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ─── Plagas + seguimiento ─────────────────────────────────────────────────────

function SeccionPlagas({ pf }: { pf?: PlagasFoliares | null }) {
  if (!pf) return null
  const cer = pf.ceramida, sib = pf.sibine
  if ([cer?.h, cer?.p, cer?.m, cer?.g, sib?.h, sib?.p, sib?.m, sib?.g].every(v => v == null)) return null
  const FilaPlaga = ({ nombre, d }: { nombre: string; d?: PlagaFoliar | null }) => (
    <tr>
      <td style={tdRowLabel}>{nombre}</td>
      <td style={tdBase}>{fmtNum(d?.h)}</td><td style={tdBase}>{fmtNum(d?.p)}</td>
      <td style={tdBase}>{fmtNum(d?.m)}</td><td style={tdBase}>{fmtNum(d?.g ?? null)}</td>
    </tr>
  )
  return (
    <table style={{ borderCollapse: 'collapse' }}>
      <thead><tr><th style={{ ...thStyle, textAlign: 'left' }}>Plaga</th><th style={thStyle}>H</th><th style={thStyle}>P</th><th style={thStyle}>M</th><th style={thStyle}>G</th></tr></thead>
      <tbody><FilaPlaga nombre="Ceramida" d={cer} /><FilaPlaga nombre="Sibine" d={sib} /></tbody>
    </table>
  )
}

function SeccionSeguimiento({ s }: { s: SigatokaMuestreo }) {
  const campos = [
    { label: 'P-EF-FINCA', value: s.pEfFinca }, { label: 'P-EF-FINCA T=', value: s.pEfFincaT },
    { label: 'P-EF-FINCA Frec', value: s.pEfFincaFrec }, { label: 'Erradicadas BSV', value: s.erradicadasBsv },
  ]
  if (!campos.some(c => c.value != null)) return null
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {campos.map(c => (
        <div key={c.label} style={{ background: 'rgba(255,255,255,0.55)', padding: '6px 10px', minWidth: 120 }}>
          <div style={labelStyle}>{c.label}</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#0D0F0C', marginTop: 2 }}>{fmtNum(c.value ?? null)}</div>
        </div>
      ))}
    </div>
  )
}

// Bloque con título + contenido (una "sección" de la ficha).
function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ ...card, padding: '12px 14px' }}>
      <div style={{ ...labelStyle, marginBottom: 8 }}>{titulo}</div>
      <div style={{ overflowX: 'auto' }}>{children}</div>
    </div>
  )
}

// ─── Vista principal ──────────────────────────────────────────────────────────

export function SigatokaRevisionView() {
  const { user } = useAuth()
  const fincaId = user?.finca_id ?? null

  const [items, setItems] = useState<ItemLista[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingDetalle, setLoadingDetalle] = useState(false)
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [correcciones, setCorrecciones] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [warnMsg, setWarnMsg] = useState<string | null>(null)

  const ilegibleKeys: Set<string> = new Set(detalle?.ilegibles.ubicaciones.map(u => `${u.punto}.${u.campo}`) ?? [])

  function handleCorreccion(k: string, v: string) {
    setCorrecciones(prev => {
      const next = { ...prev }
      if (v === '') delete next[k]
      else next[k] = v
      return next
    })
  }

  const cargarLista = useCallback(async () => {
    if (!fincaId) { setLoadingList(false); return }
    setLoadingList(true); setError(null)
    try {
      const res = await fetch(`${API}/api/finca/${fincaId}/sigatoka/revision`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data = await res.json()
      setItems(data.eventos ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la cola de revisión')
    } finally { setLoadingList(false) }
  }, [fincaId])

  useEffect(() => { void cargarLista() }, [cargarLista])

  async function abrirDetalle(id: string) {
    if (!fincaId) return
    setDetalle(null); setOkMsg(null); setWarnMsg(null); setCorrecciones({}); setLoadingDetalle(true)
    try {
      const res = await fetch(`${API}/api/finca/${fincaId}/sigatoka/revision/${id}`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setDetalle(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el muestreo')
    } finally { setLoadingDetalle(false) }
  }

  /** Convierte `correcciones` (key → string) al array que espera el PATCH.
   *  Keys: "P3.planta1_estadio" · "11sem-14.ht" · "00sem-3.lc".
   *  Acepta coma decimal; descarta no-numéricos (avisa por warnMsg). */
  function buildCorrecciones(): Array<{ punto: string; campo: string; valor: number | null }> {
    let descartados = 0
    const result: Array<{ punto: string; campo: string; valor: number | null }> = []
    for (const [key, raw] of Object.entries(correcciones)) {
      const v = raw.trim()
      if (v === '') continue
      const dotIdx = key.indexOf('.')
      const punto = key.slice(0, dotIdx)
      const campo = key.slice(dotIdx + 1)
      const num = Number(v.replace(',', '.'))
      if (!Number.isFinite(num)) { descartados++; continue }
      result.push({ punto, campo, valor: num })
    }
    setWarnMsg(descartados > 0 ? `${descartados} valor${descartados !== 1 ? 'es' : ''} no numérico${descartados !== 1 ? 's' : ''} ignorado${descartados !== 1 ? 's' : ''}.` : null)
    return result
  }

  async function guardar(marcarRevisado: boolean) {
    if (!detalle || !fincaId) return
    if (marcarRevisado && !window.confirm('¿Aprobar el muestreo?\n\nSe cierra como revisado. No se puede deshacer.')) return
    setSaving(true); setOkMsg(null)
    try {
      const body: { correcciones?: ReturnType<typeof buildCorrecciones>; marcar_revisado?: boolean } = {}
      const corrs = buildCorrecciones()
      if (corrs.length > 0) body.correcciones = corrs
      if (marcarRevisado) body.marcar_revisado = true

      const res = await fetch(`${API}/api/finca/${fincaId}/sigatoka/revision/${detalle.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data = await res.json()
      if (marcarRevisado) {
        setDetalle(null); setCorrecciones({}); await cargarLista()
      } else {
        setCorrecciones({}); await abrirDetalle(detalle.id)
        setOkMsg(`Correcciones guardadas. Quedan ${data.ilegibles?.total ?? 0} celdas sin definir.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally { setSaving(false) }
  }

  const s = detalle?.sigatoka ?? null
  const nCorrecciones = Object.values(correcciones).filter(v => v.trim() !== '').length

  // Resumen de atención: lo que el validador tiene que mirar.
  const nIlegibles = detalle?.ilegibles.total ?? 0
  const checksumFails = s
    ? [...(s.verificacion11sem?.columnas ?? []), ...(s.verificacion00sem?.columnas ?? [])].filter(c => c.cuadra === false).length
    : 0
  const todoOk = nIlegibles === 0 && checksumFails === 0

  return (
    <>
      <Topbar
        title="Revisión Sigatoka"
        badge={`${items.length} por revisar`}
        avatarInitials={user ? getInitials(user.nombre) : 'WA'}
      />

      <main style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!fincaId && <div style={{ ...card, padding: 20, fontSize: 13, color: '#7A1810' }}>Tu usuario no tiene una finca asignada.</div>}
        {error && <div style={{ background: '#FFEEEA', border: '2px solid #C43020', boxShadow: '4px 4px 0 0 #C43020', padding: '12px 16px', fontSize: 13, color: '#C43020' }}>⚠ {error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: detalle ? '260px 1fr' : '1fr', gap: 16, alignItems: 'start' }}>

          {/* ── Cola de revisión ── */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(13,15,12,0.1)', background: 'rgba(13,15,12,0.03)' }}>
              <span style={labelStyle}>Cola de revisión</span>
            </div>
            {loadingList && <div style={{ padding: 20, fontSize: 13, color: 'rgba(13,15,12,0.5)' }}>Cargando…</div>}
            {!loadingList && items.length === 0 && fincaId && (
              <div style={{ padding: 24, fontSize: 13, color: 'rgba(13,15,12,0.45)', textAlign: 'center' }}>No hay muestreos pendientes. ✅</div>
            )}
            {items.map(it => {
              const badge = RUTA_BADGE[it.ilegibles.ruta] ?? RUTA_BADGE['preguntar']!
              const activo = detalle?.id === it.id
              return (
                <div key={it.id} onClick={() => abrirDetalle(it.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                  borderBottom: '1px solid rgba(13,15,12,0.06)', cursor: 'pointer',
                  background: activo ? 'rgba(201,240,59,0.1)' : 'transparent',
                  borderLeft: activo ? '3px solid #C9F03B' : '3px solid transparent',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0D0F0C' }}>{it.nombre_finca ?? 'Finca'} · sem {it.semana ?? '—'}</div>
                    <div style={{ fontSize: 11, color: 'rgba(13,15,12,0.45)', marginTop: 2 }}>
                      {new Date(it.created_at).toLocaleDateString()} · {it.ilegibles.total} ileg.{it.tiene_imagen ? ' · 📷' : ''}
                    </div>
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 800, padding: '3px 7px', background: badge.bg, color: badge.color, border: `1.5px solid ${badge.color}`, flexShrink: 0 }}>{badge.label}</span>
                </div>
              )
            })}
          </div>

          {/* ── Detalle (ficha) ── */}
          {detalle && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Cabecera + resumen de atención */}
              <div style={{ ...card, padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#0D0F0C' }}>{s?.nombreFinca ?? 'Muestreo'} · semana {s?.semana ?? '—'}</div>
                    <div style={{ fontSize: 11, color: 'rgba(13,15,12,0.5)', marginTop: 2 }}>
                      {new Date(detalle.created_at).toLocaleDateString()}{s?.supervisor ? ` · ${s.supervisor}` : ''} · confianza {detalle.confidence_score != null ? `${Math.round(detalle.confidence_score * 100)}%` : '—'}
                    </div>
                  </div>
                  <button onClick={() => setDetalle(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'rgba(13,15,12,0.4)' }} aria-label="Cerrar">✕</button>
                </div>
                {s && (
                  <div style={{
                    marginTop: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    background: todoOk ? '#EDFBF3' : '#FDF6DD', border: `1.5px solid ${todoOk ? '#1F8040' : '#8A6000'}`,
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: todoOk ? '#1F8040' : '#8A6000' }}>
                      {todoOk ? '✓ Todo legible y los totales cuadran' : '⚠ Revisá lo marcado contra la foto'}
                    </span>
                    {nIlegibles > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: '#8A6000' }}>· {nIlegibles} celda{nIlegibles !== 1 ? 's' : ''} ilegible{nIlegibles !== 1 ? 's' : ''} (ámbar)</span>}
                    {checksumFails > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: '#C43020' }}>· {checksumFails} columna{checksumFails !== 1 ? 's' : ''} que no cuadra{checksumFails !== 1 ? 'n' : ''}</span>}
                  </div>
                )}
              </div>

              {loadingDetalle && <div style={{ ...card, padding: 20, fontSize: 13, color: 'rgba(13,15,12,0.5)' }}>Cargando ficha…</div>}

              {!loadingDetalle && s && (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 40%) 1fr', gap: 16, alignItems: 'start' }}>

                  {/* Foto STICKY — siempre visible para comparar */}
                  <div style={{ position: 'sticky', top: 16, ...card, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 120px)' }}>
                    <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(13,15,12,0.1)', background: 'rgba(13,15,12,0.03)', flexShrink: 0 }}>
                      <span style={labelStyle}>Foto de la ficha — compará contra esto</span>
                    </div>
                    {detalle.imagen_url
                      ? <div style={{ overflow: 'auto' }}><a href={detalle.imagen_url} target="_blank" rel="noopener noreferrer"><img src={detalle.imagen_url} alt="Ficha" style={{ width: '100%', display: 'block' }} /></a></div>
                      : <div style={{ padding: 24, fontSize: 12, color: 'rgba(13,15,12,0.4)', textAlign: 'center' }}>Sin imagen original</div>}
                  </div>

                  {/* Hoja de datos (orden de la ficha) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ ...card, padding: '12px 14px' }}><SeccionEncabezado s={s} conf={detalle.confidence_score} /></div>

                    {(s.puntosMuestreo?.length ?? 0) > 0 && (
                      <Bloque titulo="Estado evolutivo · matriz de puntos">
                        <SeccionMatriz puntos={s.puntosMuestreo ?? []} ilegibleKeys={ilegibleKeys} correcciones={correcciones} onCorreccion={handleCorreccion} />
                      </Bloque>
                    )}
                    {(s.plantas11sem?.length ?? 0) > 0 && (
                      <Bloque titulo="Plantas de 11 semanas">
                        <SeccionTablaSemanas filas={s.plantas11sem ?? []} totales={s.totales11sem} promedios={s.promedios11sem} verificacion={s.verificacion11sem} prefijo="11sem" ilegibleKeys={ilegibleKeys} correcciones={correcciones} onCorreccion={handleCorreccion} />
                      </Bloque>
                    )}
                    {(s.plantas00sem?.length ?? 0) > 0 && (
                      <Bloque titulo="Plantas de 00 semanas">
                        <SeccionTablaSemanas filas={s.plantas00sem ?? []} totales={s.totales00sem} promedios={s.promedios00sem} verificacion={s.verificacion00sem} prefijo="00sem" ilegibleKeys={ilegibleKeys} correcciones={correcciones} onCorreccion={handleCorreccion} />
                      </Bloque>
                    )}
                    {(s.resumenColumnas?.length ?? 0) > 0 && (
                      <Bloque titulo="Datos (A–M) · por planta"><SeccionDatos columnas={s.resumenColumnas ?? []} /></Bloque>
                    )}
                    {s.plagasFoliares && <Bloque titulo="Plagas foliares"><SeccionPlagas pf={s.plagasFoliares} /></Bloque>}
                    <SeccionSeguimiento s={s} />

                    {/* Acciones: guardar correcciones (si hay) + aprobar */}
                    {warnMsg && <div style={{ fontSize: 12, color: '#8A6000', padding: '8px 12px', background: '#FDF6DD', border: '1px solid #8A6000' }}>{warnMsg}</div>}
                    {okMsg && <div style={{ fontSize: 12, color: '#1F8040', padding: '8px 12px', background: '#EDFBF3', border: '1px solid #1F8040' }}>{okMsg}</div>}

                    <div style={{ ...card, padding: '14px 16px', background: '#F0FBF4', border: '2px solid #1B3D24', boxShadow: '4px 4px 0 0 #1B3D24', position: 'sticky', bottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 12, color: 'rgba(27,61,36,0.7)' }}>
                        {nCorrecciones > 0
                          ? <><strong style={{ color: '#2563EB' }}>{nCorrecciones} celda{nCorrecciones !== 1 ? 's' : ''} corregida{nCorrecciones !== 1 ? 's' : ''}</strong> — guardá antes de aprobar.</>
                          : 'Corregí las celdas marcadas si hace falta, después aprobá.'}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {nCorrecciones > 0 && (
                          <button onClick={() => void guardar(false)} disabled={saving} style={{ padding: '11px 18px', border: '2px solid #2563EB', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: 13, cursor: saving ? 'wait' : 'pointer' }}>
                            {saving ? 'Guardando…' : `Guardar (${nCorrecciones})`}
                          </button>
                        )}
                        <button onClick={() => void guardar(true)} disabled={saving || nCorrecciones > 0} title={nCorrecciones > 0 ? 'Guardá las correcciones antes de aprobar' : undefined}
                          style={{ padding: '11px 22px', border: '2px solid #1B3D24', background: saving || nCorrecciones > 0 ? 'rgba(201,240,59,0.4)' : '#C9F03B', color: '#0D0F0C', fontWeight: 800, fontSize: 14, cursor: saving || nCorrecciones > 0 ? 'not-allowed' : 'pointer', opacity: nCorrecciones > 0 ? 0.55 : 1 }}>
                          {saving ? 'Procesando…' : '✓ Aprobar muestreo'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!loadingDetalle && !s && <div style={{ ...card, padding: '16px 18px', fontSize: 13, color: 'rgba(13,15,12,0.45)' }}>No hay datos de la ficha disponibles para este evento.</div>}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
