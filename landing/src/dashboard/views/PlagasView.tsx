import { useState } from 'react'
import { Topbar } from '../layout/Topbar'
import { useAuth } from '../../auth/useAuth'

// ── Datos de la finca ────────────────────────────────────────────────────────

const FINCA = {
  nombre: 'Finca El Porvenir',
  agricultor: 'Federico Aguirre',
  cultivo: 'Banano (Cavendish)',
  ubicacion: 'Quinindé, Esmeraldas',
  hectareas: 22.4,
  fecha: '11 May 2026',
}

// Polígonos irregulares con bordes compartidos exactos entre lotes adyacentes.
// Puntos de junction clave (compartidos):
//   J_A = (178,20)   — L1/L5 top
//   J_B = (148,148)  — L1/L5/L4/L6 junction
//   J_C = (318,18)   — L5/L7 top
//   J_D = (285,148)  — L5/L7/L6/L9 junction
//   J_E = (458,15)   — L7/L8 top
//   J_F = (432,148)  — L7/L8/L9 junction
//   J_G = (148,280)  — L4/L6/L2/L3 junction
//   J_H = (292,278)  — L6/L9/L3 junction
//   J_I = (20,268)   — L4/L2 left edge
//   J_J = (148,378)  — L2/L3 bottom

interface Lote {
  id: string
  nombre: string
  ha: number
  severidad: number
  plaga: string | null
  focos: number
  ultimaRevision: string
  trabajador: string
  pts: string       // polygon points SVG
  cx: number        // centroid x para labels
  cy: number        // centroid y para labels
}

const LOTES: Lote[] = [
  {
    id: 'L1', nombre: 'Norte', ha: 2.1, severidad: 5, plaga: null,
    focos: 0, ultimaRevision: '10 May', trabajador: 'Marco Intriago',
    pts: '20,22 178,20 168,75 148,148 95,155 48,150 20,135',
    cx: 95, cy: 88,
  },
  {
    id: 'L5', nombre: 'Río', ha: 3.2, severidad: 8, plaga: null,
    focos: 1, ultimaRevision: '09 May', trabajador: 'José Delgado',
    pts: '178,20 318,18 310,95 285,148 148,148 168,75',
    cx: 232, cy: 88,
  },
  {
    id: 'L7', nombre: 'Entrada', ha: 2.8, severidad: 45, plaga: 'Sigatoka negra',
    focos: 4, ultimaRevision: '11 May', trabajador: 'Rosa Cando',
    pts: '318,18 458,15 448,88 432,148 285,148 310,95',
    cx: 370, cy: 88,
  },
  {
    id: 'L8', nombre: 'Palmar', ha: 1.9, severidad: 3, plaga: null,
    focos: 0, ultimaRevision: '08 May', trabajador: 'Marco Intriago',
    pts: '458,15 562,20 562,148 432,148 448,88',
    cx: 504, cy: 85,
  },
  {
    id: 'L4', nombre: 'Central', ha: 4.1, severidad: 78, plaga: 'Sigatoka + Trips',
    focos: 8, ultimaRevision: '11 May', trabajador: 'Federico Aguirre',
    pts: '20,135 48,150 95,155 148,148 148,200 145,268 148,280 78,290 30,284 20,268',
    cx: 84, cy: 212,
  },
  {
    id: 'L6', nombre: 'Colina', ha: 2.5, severidad: 18, plaga: 'Nematodos',
    focos: 2, ultimaRevision: '10 May', trabajador: 'José Delgado',
    pts: '148,148 285,148 290,202 292,278 148,280 145,268 148,200',
    cx: 218, cy: 212,
  },
  {
    id: 'L9', nombre: 'Nuevo', ha: 1.0, severidad: 25, plaga: 'Sigatoka negra',
    focos: 2, ultimaRevision: '09 May', trabajador: 'Federico Aguirre',
    pts: '285,148 432,148 562,148 562,282 445,288 292,278 290,202',
    cx: 418, cy: 215,
  },
  {
    id: 'L2', nombre: 'Sur-1', ha: 3.0, severidad: 62, plaga: 'Sigatoka negra',
    focos: 6, ultimaRevision: '11 May', trabajador: 'Rosa Cando',
    pts: '20,268 30,284 78,290 148,280 148,378 102,388 45,382 20,370',
    cx: 82, cy: 328,
  },
  {
    id: 'L3', nombre: 'Sur-2', ha: 1.8, severidad: 31, plaga: 'Trips del banano',
    focos: 3, ultimaRevision: '10 May', trabajador: 'Marco Intriago',
    pts: '148,280 292,278 296,382 268,392 152,385 148,378',
    cx: 218, cy: 335,
  },
]

const TENDENCIA = [
  { dia: 'Lun', avg: 22, max: 42 },
  { dia: 'Mar', avg: 28, max: 51 },
  { dia: 'Mié', avg: 35, max: 58 },
  { dia: 'Jue', avg: 41, max: 65 },
  { dia: 'Vie', avg: 48, max: 71 },
  { dia: 'Sáb', avg: 52, max: 74 },
  { dia: 'Hoy', avg: 55, max: 78 },
]

interface Tratamiento {
  fecha: string
  lote: string
  producto: string
  dosis: string
  estado: 'Aplicado' | 'Pendiente' | 'En evaluación' | 'Eficaz' | 'Parcial'
}

const TRATAMIENTOS: Tratamiento[] = [
  { fecha: '05 May', lote: 'L4 Central',  producto: 'Mancozeb 80% + Aceite mineral', dosis: '2.5 + 1.5 L/ha', estado: 'Pendiente'     },
  { fecha: '02 May', lote: 'L2 Sur-1',    producto: 'Propiconazol 250 EC',           dosis: '1.5 L/ha',        estado: 'Aplicado'      },
  { fecha: '01 May', lote: 'L7 Entrada',  producto: 'Mancozeb 80%',                  dosis: '2.0 L/ha',        estado: 'En evaluación' },
  { fecha: '28 Abr', lote: 'L6 Colina',   producto: 'Nemacur 10G',                   dosis: '3.0 kg/ha',       estado: 'Eficaz'        },
  { fecha: '25 Abr', lote: 'L3 Sur-2',    producto: 'Aceite mineral',                dosis: '2.0 L/ha',        estado: 'Parcial'       },
]

// ── Utilidades ───────────────────────────────────────────────────────────────

function sev(s: number) {
  if (s <= 15) return { fill: '#3EBB6A', stroke: '#229A4A', text: '#0D4020', label: 'OK',      bg: '#EDFBF3' }
  if (s <= 30) return { fill: '#96C93D', stroke: '#6A9020', text: '#2A3800', label: 'BAJA',    bg: '#F4FAE0' }
  if (s <= 50) return { fill: '#D4A017', stroke: '#9A7000', text: '#3A2800', label: 'MEDIA',   bg: '#FDF6DD' }
  if (s <= 70) return { fill: '#E06820', stroke: '#A04410', text: '#fff',    label: 'ALTA',    bg: '#FFF0E6' }
  return              { fill: '#C43020', stroke: '#882010', text: '#fff',    label: 'CRÍTICA', bg: '#FFEEEA' }
}

function estadoStyle(estado: Tratamiento['estado']) {
  const m: Record<string, { c: string; bg: string; b: string }> = {
    'Pendiente':     { c: '#C43020', bg: '#FFEEEA', b: '#C43020' },
    'Aplicado':      { c: '#D4A017', bg: '#FDF6DD', b: '#D4A017' },
    'En evaluación': { c: '#2A50D4', bg: '#EEF2FF', b: '#2A50D4' },
    'Eficaz':        { c: '#3EBB6A', bg: '#EDFBF3', b: '#3EBB6A' },
    'Parcial':       { c: '#D4A017', bg: '#FDF6DD', b: '#D4A017' },
  }
  return m[estado]
}

function getInitials(n: string) {
  return n.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('')
}

const lotesConPlaga = LOTES.filter(l => l.plaga !== null)
const avgSev        = Math.round(lotesConPlaga.reduce((s, l) => s + l.severidad, 0) / (lotesConPlaga.length || 1))
const lotesCrit     = LOTES.filter(l => l.severidad > 70).length
const haRiesgo      = parseFloat(LOTES.filter(l => l.severidad > 30).reduce((s, l) => s + l.ha, 0).toFixed(1))

// ── Mapa SVG ─────────────────────────────────────────────────────────────────

function FarmMap({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const [hov, setHov] = useState<string | null>(null)

  return (
    <svg
      viewBox="0 0 582 420"
      style={{ width: '100%', height: 'auto', display: 'block', cursor: 'pointer' }}
    >
      <defs>
        {/* Patrón de finca sin cultivar (fuera de lotes) */}
        <pattern id="outside" patternUnits="userSpaceOnUse" width="8" height="8">
          <rect width="8" height="8" fill="#D6E8C4" />
          <path d="M 0 8 L 8 0" stroke="#C2D8B0" strokeWidth="0.5" />
        </pattern>
        {/* Filtro sombra para polígonos seleccionados */}
        <filter id="glow">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#C9F03B" floodOpacity="0.8" />
        </filter>
      </defs>

      {/* Fondo general fuera de la finca */}
      <rect width="582" height="420" fill="#E8F0DC" />

      {/* Contorno de la finca (forma irregular del predio total) */}
      <polygon
        points="20,22 562,20 562,282 445,290 296,385 268,395 152,388 45,384 20,370"
        fill="url(#outside)"
        stroke="#8AA870"
        strokeWidth="2"
      />

      {/* ── LOTES ── */}
      {LOTES.map(lote => {
        const c       = sev(lote.severidad)
        const isSel   = selected === lote.id
        const isHov   = hov === lote.id
        const dimmed  = selected !== null && !isSel
        const opacity = dimmed ? 0.38 : 1

        return (
          <g
            key={lote.id}
            onClick={() => onSelect(lote.id)}
            onMouseEnter={() => setHov(lote.id)}
            onMouseLeave={() => setHov(null)}
            style={{ cursor: 'pointer' }}
          >
            {/* Relleno del lote */}
            <polygon
              points={lote.pts}
              fill={c.fill}
              fillOpacity={isHov ? 0.96 : 0.78}
              stroke={isSel ? '#C9F03B' : c.stroke}
              strokeWidth={isSel ? 3 : isHov ? 2 : 1.5}
              opacity={opacity}
              filter={isSel ? 'url(#glow)' : undefined}
            />

            {/* Label: ID lote */}
            <text
              x={lote.cx} y={lote.cy - 8}
              textAnchor="middle"
              fontSize={lote.ha < 2 ? 10 : 12}
              fontWeight={800}
              fill={c.text}
              opacity={opacity}
              style={{ userSelect: 'none', pointerEvents: 'none' }}
            >
              {lote.id}
            </text>

            {/* Badge de severidad */}
            <rect
              x={lote.cx - 18} y={lote.cy + 2}
              width={36} height={16}
              rx={2}
              fill="rgba(0,0,0,0.28)"
              opacity={opacity}
            />
            <text
              x={lote.cx} y={lote.cy + 14}
              textAnchor="middle"
              fontSize={9} fontWeight={800}
              fill="#fff"
              opacity={opacity}
              style={{ userSelect: 'none', pointerEvents: 'none' }}
            >
              {lote.severidad}%
            </text>

            {/* Ícono crítico */}
            {lote.severidad > 70 && (
              <text
                x={lote.cx - 22} y={lote.cy - 5}
                fontSize={11}
                opacity={opacity}
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >⚠</text>
            )}
          </g>
        )
      })}

      {/* ── DECORACIONES ── */}

      {/* Río (lateral derecho fuera de finca) */}
      <path
        d="M 572,20 C 578,80 576,160 574,220 C 572,280 574,340 570,400"
        fill="none"
        stroke="#7EC8E3"
        strokeWidth={7}
        strokeLinecap="round"
        opacity={0.75}
      />
      <text x={579} y={120} fontSize={8} fill="#5BA4C0" fontWeight={700}
        transform="rotate(90,579,120)" style={{ userSelect: 'none' }}>
        Río Verde
      </text>

      {/* Camino de acceso (abajo) */}
      <path
        d="M 20,400 L 290,392 L 292,420 L 20,420 Z"
        fill="#D4C4A0"
        opacity={0.55}
      />
      <text x={155} y={413} textAnchor="middle" fontSize={8} fill="#7A6840" fontWeight={600}
        style={{ userSelect: 'none' }}>
        Camino de acceso
      </text>

      {/* Brújula */}
      <g transform="translate(548, 295)">
        <circle cx={0} cy={0} r={16} fill="rgba(255,255,255,0.88)" stroke="#5A6050" strokeWidth={1.2} />
        <text x={0} y={-4} textAnchor="middle" fontSize={7} fontWeight={900} fill="#C43020"
          style={{ userSelect: 'none' }}>N</text>
        <polygon points="0,-13 3.5,0 0,5 -3.5,0" fill="#C43020" />
        <polygon points="0,13 3.5,0 0,-5 -3.5,0" fill="#9C9080" />
      </g>

      {/* Leyenda */}
      {[
        { label: 'OK ≤15%',    fill: '#3EBB6A' },
        { label: 'Baja ≤30%',  fill: '#96C93D' },
        { label: 'Media ≤50%', fill: '#D4A017' },
        { label: 'Alta ≤70%',  fill: '#E06820' },
        { label: 'Crítica',    fill: '#C43020' },
      ].map((item, i) => (
        <g key={item.label} transform={`translate(${20 + i * 88}, 404)`}>
          <rect x={0} y={0} width={11} height={11} fill={item.fill} rx={1.5} />
          <text x={15} y={9} fontSize={8} fill="#3A3A30" style={{ userSelect: 'none' }}>{item.label}</text>
        </g>
      ))}
    </svg>
  )
}

// ── Detalle de lote ──────────────────────────────────────────────────────────

function LoteDetail({ lote }: { lote: Lote }) {
  const c = sev(lote.severidad)
  return (
    <div style={{ background: c.bg, border: `2px solid ${c.stroke}`, boxShadow: `3px 3px 0 0 ${c.stroke}`, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#0D0F0C' }}>{lote.id} — {lote.nombre}</div>
          <div style={{ fontSize: 11, color: 'rgba(13,15,12,0.5)', marginTop: 2 }}>{lote.ha} ha · Rev. {lote.ultimaRevision}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 30, fontWeight: 900, color: c.fill, lineHeight: 1 }}>{lote.severidad}%</div>
          <div style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', marginTop: 3, display: 'inline-block', background: c.fill, color: c.text }}>{c.label}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div style={{ background: 'rgba(255,255,255,0.55)', padding: '8px 10px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'rgba(13,15,12,0.4)', marginBottom: 3 }}>Plaga</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0D0F0C' }}>{lote.plaga ?? '— Sin plaga'}</div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.55)', padding: '8px 10px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'rgba(13,15,12,0.4)', marginBottom: 3 }}>Focos</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: lote.focos > 4 ? '#C43020' : '#0D0F0C' }}>{lote.focos} activo{lote.focos !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.55)', padding: '8px 10px', marginBottom: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'rgba(13,15,12,0.4)', marginBottom: 3 }}>Técnico</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#0D0F0C' }}>{lote.trabajador}</div>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'rgba(13,15,12,0.4)' }}>Severidad</span>
          <span style={{ fontSize: 9, fontWeight: 800, color: c.fill }}>{lote.severidad}%</span>
        </div>
        <div style={{ height: 7, background: 'rgba(0,0,0,0.12)', borderRadius: 4 }}>
          <div style={{ height: 7, width: `${lote.severidad}%`, background: c.fill, borderRadius: 4 }} />
        </div>
      </div>
    </div>
  )
}

// ── Gráfico tendencia ────────────────────────────────────────────────────────

function TendenciaChart() {
  const W = 560, H = 130
  const PL = 30, PR = 12, PT = 14, PB = 26
  const IW = W - PL - PR, IH = H - PT - PB

  const xOf = (i: number) => PL + (i / (TENDENCIA.length - 1)) * IW
  const yOf = (v: number) => PT + IH - (v / 100) * IH

  const avgPath  = TENDENCIA.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(d.avg)}`).join(' ')
  const maxPath  = TENDENCIA.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(d.max)}`).join(' ')
  const areaPath = [
    ...TENDENCIA.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(d.avg)}`),
    `L ${xOf(TENDENCIA.length - 1)} ${PT + IH}`,
    `L ${xOf(0)} ${PT + IH}`, 'Z',
  ].join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#C43020" stopOpacity={0.22} />
          <stop offset="100%" stopColor="#C43020" stopOpacity={0.02} />
        </linearGradient>
      </defs>

      {[0, 25, 50, 75, 100].map(t => (
        <g key={t}>
          <line x1={PL} y1={yOf(t)} x2={W - PR} y2={yOf(t)} stroke="rgba(13,15,12,0.07)" strokeWidth={1} />
          <text x={PL - 4} y={yOf(t) + 3} fontSize={7} fill="rgba(13,15,12,0.35)" textAnchor="end">{t}%</text>
        </g>
      ))}

      <path d={areaPath} fill="url(#ag)" />
      <path d={maxPath}  fill="none" stroke="#E06820" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.55} />
      <path d={avgPath}  fill="none" stroke="#C43020" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

      {TENDENCIA.map((d, i) => (
        <g key={i}>
          <circle cx={xOf(i)} cy={yOf(d.avg)} r={3.5} fill="#C43020" stroke="#fff" strokeWidth={1.5} />
          {i === TENDENCIA.length - 1 && (
            <text x={xOf(i) + 6} y={yOf(d.avg) + 3.5} fontSize={8} fontWeight={800} fill="#C43020">{d.avg}%</text>
          )}
        </g>
      ))}

      {TENDENCIA.map((d, i) => (
        <text key={i} x={xOf(i)} y={H - 5} fontSize={8} fill="rgba(13,15,12,0.5)" textAnchor="middle"
          fontWeight={i === TENDENCIA.length - 1 ? 800 : 400}>{d.dia}</text>
      ))}
    </svg>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

export function PlagasView() {
  const { user }                 = useAuth()
  const [selected, setSelected]  = useState<string | null>('L4')
  const selectedLote = LOTES.find(l => l.id === selected) ?? null
  const sorted = [...LOTES].sort((a, b) => b.severidad - a.severidad)

  return (
    <>
      <Topbar
        title="Plagas"
        badge={`${lotesConPlaga.length} lotes afectados · ${haRiesgo} ha en riesgo`}
        avatarInitials={user ? getInitials(user.nombre) : 'WA'}
      />

      <main style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Header finca */}
        <div style={{ background: '#1B3D24', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#C9F03B', letterSpacing: '-0.3px' }}>{FINCA.nombre}</div>
            <div style={{ fontSize: 12, color: 'rgba(245,241,232,0.65)', marginTop: 2 }}>
              {FINCA.agricultor} · {FINCA.cultivo} · {FINCA.ubicacion} · {FINCA.hectareas} ha
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'rgba(245,241,232,0.4)' }}>Monitoreo</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#F5F1E8', marginTop: 2 }}>{FINCA.fecha}</div>
          </div>
        </div>

        {/* Alerta crítica */}
        <div style={{ background: '#FFEEEA', border: '2px solid #C43020', boxShadow: '4px 4px 0 0 #C43020', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>⚠</span>
          <span style={{ fontSize: 13, color: '#C43020', fontWeight: 600 }}>
            <strong>ALERTA CRÍTICA — </strong>
            L4 Central: severidad 78% — brote combinado Sigatoka negra + Trips.
            Aplicación de Mancozeb pendiente. Riesgo de pérdida estimado 35% si no se actúa en 48h.
          </span>
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'Focos activos',      value: String(lotesConPlaga.length), sub: 'lotes con plaga',    color: '#C43020', bg: '#FFEEEA' },
            { label: 'Severidad promedio', value: `${avgSev}%`,                 sub: 'en lotes infectados', color: '#E06820', bg: '#FFF0E6' },
            { label: 'Lotes críticos',     value: String(lotesCrit),            sub: 'severidad > 70%',    color: '#C43020', bg: '#FFEEEA' },
            { label: 'Ha en riesgo',       value: `${haRiesgo} ha`,             sub: 'severidad > 30%',    color: '#D4A017', bg: '#FDF6DD' },
          ].map(k => (
            <div key={k.label} style={{ background: k.bg, border: `2px solid ${k.color}`, boxShadow: `3px 3px 0 0 ${k.color}`, padding: '14px 16px' }}>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.07em', color: 'rgba(13,15,12,0.4)', marginBottom: 5 }}>{k.label}</div>
              <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1, color: k.color }}>{k.value}</div>
              <div style={{ fontSize: 10, color: 'rgba(13,15,12,0.45)', marginTop: 3 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* Mapa + panel lateral */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
          {/* Mapa */}
          <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', padding: 16 }}>
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'rgba(13,15,12,0.4)' }}>
                Mapa de lotes · Clic para ver detalle
              </span>
            </div>
            <FarmMap selected={selected} onSelect={setSelected} />
          </div>

          {/* Panel derecho */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {selectedLote
              ? <LoteDetail lote={selectedLote} />
              : (
                <div style={{ background: '#F5F1E8', border: '2px solid rgba(13,15,12,0.12)', padding: 20, textAlign: 'center', color: 'rgba(13,15,12,0.4)', fontSize: 12 }}>
                  Tocá un lote en el mapa para ver el detalle
                </div>
              )
            }

            {/* Lista de prioridad */}
            <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '3px 3px 0 0 #0D0F0C', overflow: 'hidden', flex: 1 }}>
              <div style={{ padding: '9px 13px', borderBottom: '1px solid rgba(13,15,12,0.1)', background: 'rgba(13,15,12,0.03)' }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'rgba(13,15,12,0.4)' }}>
                  Prioridad de atención
                </span>
              </div>
              {sorted.map((lote, i) => {
                const c = sev(lote.severidad)
                const isAct = selected === lote.id
                return (
                  <div
                    key={lote.id}
                    onClick={() => setSelected(lote.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 13px',
                      borderBottom: '1px solid rgba(13,15,12,0.06)',
                      cursor: 'pointer',
                      background: isAct ? 'rgba(201,240,59,0.1)' : 'transparent',
                      borderLeft: isAct ? '3px solid #C9F03B' : '3px solid transparent',
                    }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 800, color: 'rgba(13,15,12,0.28)', width: 14, flexShrink: 0 }}>#{i + 1}</span>
                    <div style={{ width: 8, height: 8, background: c.fill, borderRadius: '50%', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#0D0F0C' }}>{lote.id} {lote.nombre}</div>
                      <div style={{ fontSize: 9, color: 'rgba(13,15,12,0.45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {lote.plaga ?? 'Sin plaga activa'}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 800, color: c.fill, fontFamily: 'monospace', flexShrink: 0 }}>{lote.severidad}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Tendencia semanal */}
        <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', padding: '16px 20px' }}>
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'rgba(13,15,12,0.4)' }}>
              Tendencia semanal · severidad promedio · Finca El Porvenir
            </span>
          </div>
          <TendenciaChart />
          <div style={{ marginTop: 8, display: 'flex', gap: 20, flexWrap: 'wrap' as const }}>
            <span style={{ fontSize: 11, color: 'rgba(13,15,12,0.5)' }}>
              <span style={{ fontWeight: 800, color: '#C43020' }}>+33pp</span> en 7 días
            </span>
            <span style={{ fontSize: 11, color: 'rgba(13,15,12,0.5)' }}>
              Pico: <span style={{ fontWeight: 700, color: '#E06820' }}>78%</span> (L4, hoy)
            </span>
            <span style={{ fontSize: 11, color: 'rgba(13,15,12,0.5)' }}>
              Inicio de semana: <span style={{ fontWeight: 700 }}>22%</span>
            </span>
          </div>
        </div>

        {/* Tabla completa */}
        <section>
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'rgba(13,15,12,0.4)' }}>
              Estado por lote · todos los lotes
            </span>
          </div>
          <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #0D0F0C', background: 'rgba(13,15,12,0.04)' }}>
                  {['Lote', 'Ha', 'Severidad', 'Plaga detectada', 'Focos', 'Técnico', 'Última rev.', 'Estado'].map(h => (
                    <th key={h} style={{ padding: '10px 13px', textAlign: 'left', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', opacity: 0.4 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(lote => {
                  const c = sev(lote.severidad)
                  const isAct = selected === lote.id
                  return (
                    <tr
                      key={lote.id}
                      onClick={() => setSelected(lote.id)}
                      style={{
                        borderBottom: '1px solid rgba(13,15,12,0.07)',
                        cursor: 'pointer',
                        background: isAct ? 'rgba(201,240,59,0.07)' : 'transparent',
                        borderLeft: isAct ? '3px solid #C9F03B' : '3px solid transparent',
                      }}
                    >
                      <td style={{ padding: '11px 13px', fontSize: 12, fontWeight: 800, color: '#0D0F0C' }}>{lote.id} {lote.nombre}</td>
                      <td style={{ padding: '11px 13px', fontSize: 12, color: 'rgba(13,15,12,0.55)' }}>{lote.ha}</td>
                      <td style={{ padding: '11px 13px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <div style={{ width: 52, height: 5, background: 'rgba(0,0,0,0.1)', borderRadius: 3 }}>
                            <div style={{ width: `${lote.severidad}%`, height: 5, background: c.fill, borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 800, fontFamily: 'monospace', color: c.fill }}>{lote.severidad}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '11px 13px', fontSize: 11, color: 'rgba(13,15,12,0.65)' }}>{lote.plaga ?? '—'}</td>
                      <td style={{ padding: '11px 13px', fontSize: 12, fontWeight: 700, color: lote.focos > 4 ? '#C43020' : '#0D0F0C' }}>{lote.focos}</td>
                      <td style={{ padding: '11px 13px', fontSize: 11, color: 'rgba(13,15,12,0.65)' }}>{lote.trabajador}</td>
                      <td style={{ padding: '11px 13px', fontSize: 11, fontFamily: 'monospace', color: 'rgba(13,15,12,0.5)' }}>{lote.ultimaRevision}</td>
                      <td style={{ padding: '11px 13px' }}>
                        <span style={{ fontSize: 9, fontWeight: 800, padding: '3px 7px', background: c.bg, color: c.fill, border: `1.5px solid ${c.fill}` }}>
                          {c.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Tratamientos */}
        <section>
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'rgba(13,15,12,0.4)' }}>
              Historial de tratamientos · últimas 2 semanas
            </span>
          </div>
          <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #0D0F0C', background: 'rgba(13,15,12,0.04)' }}>
                  {['Fecha', 'Lote', 'Producto', 'Dosis', 'Estado'].map(h => (
                    <th key={h} style={{ padding: '10px 13px', textAlign: 'left', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', opacity: 0.4 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TRATAMIENTOS.map((t, i) => {
                  const s = estadoStyle(t.estado)
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(13,15,12,0.07)' }}>
                      <td style={{ padding: '11px 13px', fontSize: 11, fontFamily: 'monospace', color: 'rgba(13,15,12,0.5)' }}>{t.fecha}</td>
                      <td style={{ padding: '11px 13px', fontSize: 12, fontWeight: 700, color: '#0D0F0C' }}>{t.lote}</td>
                      <td style={{ padding: '11px 13px', fontSize: 12, color: 'rgba(13,15,12,0.75)' }}>{t.producto}</td>
                      <td style={{ padding: '11px 13px', fontSize: 11, fontFamily: 'monospace', color: 'rgba(13,15,12,0.55)' }}>{t.dosis}</td>
                      <td style={{ padding: '11px 13px' }}>
                        <span style={{ fontSize: 9, fontWeight: 800, padding: '3px 7px', background: s.bg, color: s.c, border: `1.5px solid ${s.b}` }}>
                          {t.estado.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Footer IA */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 15px', background: 'rgba(201,240,59,0.08)', border: '1px solid rgba(201,240,59,0.3)' }}>
          <div style={{ width: 6, height: 6, background: '#C9F03B', borderRadius: '50%', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'rgba(13,15,12,0.6)' }}>
            <strong style={{ color: '#0D0F0C' }}>Wasagro AI — </strong>
            L4 Central: aplicar Mancozeb 80% (2.5 L/ha) + Aceite mineral (1.5 L/ha) de inmediato.
            No aplicar con lluvias en las próximas 6h. Stock disponible: 12L Mancozeb.
          </span>
        </div>

      </main>
    </>
  )
}
