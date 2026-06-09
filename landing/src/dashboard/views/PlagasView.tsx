import { useState, useEffect, useRef } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Topbar } from '../layout/Topbar'
import { useAuth } from '../../auth/useAuth'

// ── Datos de la finca ─────────────────────────────────────────────────────────
// Finca El Porvenir, Federico Aguirre, Pimocha, Babahoyo, Ecuador
// Coordenadas reales (~-1.7708°S, 79.5760°W), 9 lotes, 22.4 ha total

const FINCA = {
  nombre: 'Finca El Porvenir',
  agricultor: 'Federico Aguirre',
  cultivo: 'Banano (Cavendish)',
  ubicacion: 'Pimocha, Babahoyo',
  hectareas: 22.4,
  fecha: '12 May 2026',
}

// Coordenadas reales [lat, lng], Pimocha, Babahoyo (~-1.771°S, 79.576°W)
// Los 9 lotes comparten vértices exactos en los bordes adyacentes.
type LatLng = [number, number]

interface Lote {
  id: string
  nombre: string
  ha: number
  severidad: number
  plaga: string | null
  focos: number
  ultimaRevision: string
  trabajador: string
  coords: LatLng[]
}

const LOTES: Lote[] = [
  {
    id: 'L1', nombre: 'Norte', ha: 2.1, severidad: 5, plaga: null,
    focos: 0, ultimaRevision: '10 May', trabajador: 'Marco Intriago',
    coords: [
      [-1.769319, -79.577838], [-1.769299, -79.576748],
      [-1.769739, -79.576818], [-1.770319, -79.576958],
      [-1.770379, -79.577328], [-1.770339, -79.577648],
      [-1.770219, -79.577838],
    ],
  },
  {
    id: 'L5', nombre: 'Río', ha: 3.2, severidad: 8, plaga: null,
    focos: 1, ultimaRevision: '09 May', trabajador: 'José Delgado',
    coords: [
      [-1.769299, -79.576748], [-1.769279, -79.575788],
      [-1.769899, -79.575838], [-1.770319, -79.576008],
      [-1.770319, -79.576958], [-1.769739, -79.576818],
    ],
  },
  {
    id: 'L7', nombre: 'Entrada', ha: 2.8, severidad: 45, plaga: 'Sigatoka negra',
    focos: 4, ultimaRevision: '11 May', trabajador: 'Rosa Cando',
    coords: [
      [-1.769279, -79.575788], [-1.769259, -79.574818],
      [-1.769839, -79.574888], [-1.770319, -79.574998],
      [-1.770319, -79.576008], [-1.769899, -79.575838],
    ],
  },
  {
    id: 'L8', nombre: 'Palmar', ha: 1.9, severidad: 3, plaga: null,
    focos: 0, ultimaRevision: '08 May', trabajador: 'Marco Intriago',
    coords: [
      [-1.769259, -79.574818], [-1.769299, -79.574098],
      [-1.770319, -79.574098], [-1.770319, -79.574998],
      [-1.769839, -79.574888],
    ],
  },
  {
    id: 'L4', nombre: 'Central', ha: 4.1, severidad: 78, plaga: 'Sigatoka + Trips',
    focos: 8, ultimaRevision: '11 May', trabajador: 'Federico Aguirre',
    coords: [
      [-1.770219, -79.577838], [-1.770339, -79.577648],
      [-1.770379, -79.577328], [-1.770319, -79.576958],
      [-1.770739, -79.576958], [-1.771279, -79.576978],
      [-1.771379, -79.576958], [-1.771459, -79.577438],
      [-1.771409, -79.577768], [-1.771279, -79.577838],
    ],
  },
  {
    id: 'L6', nombre: 'Colina', ha: 2.5, severidad: 18, plaga: 'Nematodos',
    focos: 2, ultimaRevision: '10 May', trabajador: 'José Delgado',
    coords: [
      [-1.770319, -79.576958], [-1.770319, -79.576008],
      [-1.770759, -79.575978], [-1.771359, -79.575968],
      [-1.771379, -79.576958], [-1.771279, -79.576978],
      [-1.770739, -79.576958],
    ],
  },
  {
    id: 'L9', nombre: 'Nuevo', ha: 1.0, severidad: 25, plaga: 'Sigatoka negra',
    focos: 2, ultimaRevision: '09 May', trabajador: 'Federico Aguirre',
    coords: [
      [-1.770319, -79.576008], [-1.770319, -79.574998],
      [-1.770319, -79.574098], [-1.771399, -79.574098],
      [-1.771439, -79.574908], [-1.771359, -79.575968],
      [-1.770759, -79.575978],
    ],
  },
  {
    id: 'L2', nombre: 'Sur-1', ha: 3.0, severidad: 62, plaga: 'Sigatoka negra',
    focos: 6, ultimaRevision: '11 May', trabajador: 'Rosa Cando',
    coords: [
      [-1.771279, -79.577838], [-1.771409, -79.577768],
      [-1.771459, -79.577438], [-1.771379, -79.576958],
      [-1.772159, -79.576958], [-1.772239, -79.577278],
      [-1.772189, -79.577668], [-1.772099, -79.577838],
    ],
  },
  {
    id: 'L3', nombre: 'Sur-2', ha: 1.8, severidad: 31, plaga: 'Trips del banano',
    focos: 3, ultimaRevision: '10 May', trabajador: 'Marco Intriago',
    coords: [
      [-1.771379, -79.576958], [-1.771359, -79.575968],
      [-1.772189, -79.575938], [-1.772279, -79.576128],
      [-1.772219, -79.576928], [-1.772159, -79.576958],
    ],
  },
]

const FARM_CENTER: LatLng = [-1.770769, -79.575968]

const TENDENCIA = [
  { dia: 'Lun', avg: 22, max: 42 }, { dia: 'Mar', avg: 28, max: 51 },
  { dia: 'Mié', avg: 35, max: 58 }, { dia: 'Jue', avg: 41, max: 65 },
  { dia: 'Vie', avg: 48, max: 71 }, { dia: 'Sáb', avg: 52, max: 74 },
  { dia: 'Hoy', avg: 55, max: 78 },
]

interface Tratamiento {
  fecha: string; lote: string; producto: string; dosis: string
  estado: 'Aplicado' | 'Pendiente' | 'En evaluación' | 'Eficaz' | 'Parcial'
}

const TRATAMIENTOS: Tratamiento[] = [
  { fecha: '05 May', lote: 'L4 Central',  producto: 'Mancozeb 80% + Aceite mineral', dosis: '2.5 + 1.5 L/ha', estado: 'Pendiente'     },
  { fecha: '02 May', lote: 'L2 Sur-1',    producto: 'Propiconazol 250 EC',           dosis: '1.5 L/ha',        estado: 'Aplicado'      },
  { fecha: '01 May', lote: 'L7 Entrada',  producto: 'Mancozeb 80%',                  dosis: '2.0 L/ha',        estado: 'En evaluación' },
  { fecha: '28 Abr', lote: 'L6 Colina',   producto: 'Nemacur 10G',                   dosis: '3.0 kg/ha',       estado: 'Eficaz'        },
  { fecha: '25 Abr', lote: 'L3 Sur-2',    producto: 'Aceite mineral',                dosis: '2.0 L/ha',        estado: 'Parcial'       },
]

// ── Utilidades ────────────────────────────────────────────────────────────────

function sev(s: number) {
  if (s <= 15) return { fill: '#3EBB6A', stroke: '#1F8040', text: '#0D3A1A', label: 'OK',      bg: '#EDFBF3' }
  if (s <= 30) return { fill: '#96C93D', stroke: '#5A8010', text: '#233800', label: 'BAJA',    bg: '#F2FAD8' }
  if (s <= 50) return { fill: '#D4A017', stroke: '#8A6000', text: '#3A2800', label: 'MEDIA',   bg: '#FDF6DD' }
  if (s <= 70) return { fill: '#E06820', stroke: '#903800', text: '#fff',    label: 'ALTA',    bg: '#FFF0E6' }
  return              { fill: '#C43020', stroke: '#7A1810', text: '#fff',    label: 'CRÍTICA', bg: '#FFEEEA' }
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

// ── Mapa Leaflet (instanciado via useEffect) ──────────────────────────────────

function MapaFinca({
  selected,
  onSelect,
}: {
  selected: string | null
  onSelect: (id: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<LeafletMap | null>(null)
  // Guardamos referencias a los polígonos para poder actualizarlos sin recrear el mapa
  const polysRef     = useRef<Map<string, any>>(new Map())

  // Inicializar mapa una sola vez
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    import('leaflet').then((L) => {
      const map = L.map(containerRef.current!, {
        center: FARM_CENTER,
        zoom: 16,
        zoomControl: true,
        attributionControl: true,
      })

      // Imagen satelital Esri (libre, sin API key)
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles &copy; Esri',
          maxZoom: 20,
        }
      ).addTo(map)

      // Etiquetas de calles sobre la satelital (opcional, da contexto)
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 20, opacity: 0.6 }
      ).addTo(map)

      // Crear polígonos
      LOTES.forEach(lote => {
        const c = sev(lote.severidad)

        const poly = L.polygon(lote.coords as [number, number][], {
          color:       c.stroke,
          weight:      2,
          fillColor:   c.fill,
          fillOpacity: 0.55,
        }).addTo(map)

        // Tooltip permanente con nombre del lote + severidad
        const tooltipHtml = `
          <div style="font-family:system-ui;line-height:1.3;">
            <div style="font-weight:800;font-size:12px;color:#0D0F0C;">${lote.id} · ${lote.nombre}</div>
            <div style="font-size:11px;color:${c.fill};font-weight:700;margin-top:2px;">
              ${lote.severidad}% ${c.label}
            </div>
            ${lote.plaga ? `<div style="font-size:10px;color:#555;margin-top:1px;">${lote.plaga}</div>` : ''}
          </div>
        `
        poly.bindTooltip(tooltipHtml, {
          permanent: lote.severidad > 50,  // siempre visible si es crítico/alto
          direction: 'center',
          className: 'wasagro-lote-tooltip',
          opacity: 0.95,
        })

        poly.on('click', () => onSelect(lote.id))

        poly.on('mouseover', () => {
          poly.setStyle({ weight: 3, fillOpacity: 0.75 })
        })
        poly.on('mouseout', () => {
          const isSel = selected === lote.id
          poly.setStyle({
            weight:      isSel ? 3.5 : 2,
            color:       isSel ? '#C9F03B' : c.stroke,
            fillOpacity: isSel ? 0.72 : 0.55,
          })
        })

        polysRef.current.set(lote.id, { poly, c })
      })

      mapRef.current = map
    })

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      polysRef.current.clear()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Actualizar estilo cuando cambia la selección
  useEffect(() => {
    polysRef.current.forEach(({ poly, c }, id) => {
      const isSel = id === selected
      poly.setStyle({
        color:       isSel ? '#C9F03B' : c.stroke,
        weight:      isSel ? 3.5 : 2,
        fillOpacity: isSel ? 0.72 : 0.55,
      })
      if (isSel) poly.bringToFront()
    })
  }, [selected])

  return (
    <>
      {/* CSS del tooltip personalizado */}
      <style>{`
        .wasagro-lote-tooltip {
          background: rgba(255,255,255,0.96) !important;
          border: 1.5px solid rgba(13,15,12,0.18) !important;
          border-radius: 0 !important;
          box-shadow: 2px 2px 0 rgba(13,15,12,0.12) !important;
          padding: 5px 9px !important;
        }
        .wasagro-lote-tooltip::before {
          display: none !important;
        }
      `}</style>
      <div ref={containerRef} style={{ width: '100%', height: 440 }} />
    </>
  )
}

// ── Detalle de lote ───────────────────────────────────────────────────────────

function LoteDetail({ lote }: { lote: Lote }) {
  const c = sev(lote.severidad)
  return (
    <div style={{ background: c.bg, border: `2px solid ${c.stroke}`, boxShadow: `3px 3px 0 0 ${c.stroke}`, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#0D0F0C' }}>{lote.id} · {lote.nombre}</div>
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
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0D0F0C' }}>{lote.plaga ?? 'Sin plaga'}</div>
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

// ── Gráfico tendencia ─────────────────────────────────────────────────────────

function TendenciaChart() {
  const W = 560, H = 130
  const PL = 30, PR = 12, PT = 14, PB = 26
  const IW = W - PL - PR, IH = H - PT - PB
  const xOf = (i: number) => PL + (i / (TENDENCIA.length - 1)) * IW
  const yOf = (v: number) => PT + IH - (v / 100) * IH
  const avgPath  = TENDENCIA.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(d.avg)}`).join(' ')
  const maxPath  = TENDENCIA.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(d.max)}`).join(' ')
  const areaPath = [...TENDENCIA.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(d.avg)}`), `L ${xOf(TENDENCIA.length - 1)} ${PT + IH}`, `L ${xOf(0)} ${PT + IH}`, 'Z'].join(' ')

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
  const { user }                = useAuth()
  const [selected, setSelected] = useState<string | null>('L4')
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
              {FINCA.agricultor} · {FINCA.cultivo} · {FINCA.ubicacion}, Ecuador · {FINCA.hectareas} ha
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
            <strong>ALERTA CRÍTICA: </strong>
            L4 Central: severidad 78%, brote combinado Sigatoka negra + Trips.
            Aplicación de Mancozeb pendiente. Riesgo estimado 35% del lote si no se actúa en 48h.
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 310px', gap: 16 }}>

          {/* Mapa real Leaflet */}
          <div style={{ background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(13,15,12,0.1)' }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'rgba(13,15,12,0.4)' }}>
                Vista satelital · Clic en lote para detalle
              </span>
            </div>
            <MapaFinca selected={selected} onSelect={setSelected} />
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
            <span style={{ fontSize: 11, color: 'rgba(13,15,12,0.5)' }}><span style={{ fontWeight: 800, color: '#C43020' }}>+33pp</span> en 7 días</span>
            <span style={{ fontSize: 11, color: 'rgba(13,15,12,0.5)' }}>Pico: <span style={{ fontWeight: 700, color: '#E06820' }}>78%</span> (L4, hoy)</span>
            <span style={{ fontSize: 11, color: 'rgba(13,15,12,0.5)' }}>Inicio de semana: <span style={{ fontWeight: 700 }}>22%</span></span>
          </div>
        </div>

        {/* Tabla completa de lotes */}
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
                      <td style={{ padding: '11px 13px', fontSize: 11, color: 'rgba(13,15,12,0.65)' }}>{lote.plaga ?? 'N/A'}</td>
                      <td style={{ padding: '11px 13px', fontSize: 12, fontWeight: 700, color: lote.focos > 4 ? '#C43020' : '#0D0F0C' }}>{lote.focos}</td>
                      <td style={{ padding: '11px 13px', fontSize: 11, color: 'rgba(13,15,12,0.65)' }}>{lote.trabajador}</td>
                      <td style={{ padding: '11px 13px', fontSize: 11, fontFamily: 'monospace', color: 'rgba(13,15,12,0.5)' }}>{lote.ultimaRevision}</td>
                      <td style={{ padding: '11px 13px' }}>
                        <span style={{ fontSize: 9, fontWeight: 800, padding: '3px 7px', background: c.bg, color: c.fill, border: `1.5px solid ${c.fill}` }}>{c.label}</span>
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
            <strong style={{ color: '#0D0F0C' }}>Wasagro AI: </strong>
            L4 Central: aplicar Mancozeb 80% (2.5 L/ha) + Aceite mineral (1.5 L/ha) de inmediato.
            No aplicar con lluvias en las próximas 6h. Stock disponible: 12L Mancozeb.
          </span>
        </div>

      </main>
    </>
  )
}
