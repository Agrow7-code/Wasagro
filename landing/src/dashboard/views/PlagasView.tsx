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

interface Lote {
  id: string
  nombre: string
  ha: number
  severidad: number
  plaga: string | null
  focos: number
  ultimaRevision: string
  trabajador: string
  svgX: number
  svgY: number
  svgW: number
  svgH: number
}

const LOTES: Lote[] = [
  { id:'L1', nombre:'L1 Norte',   ha:2.1, severidad:5,  plaga:null,                     focos:0, ultimaRevision:'10 May', trabajador:'Marco Intriago',   svgX:8,   svgY:38,  svgW:118, svgH:100 },
  { id:'L5', nombre:'L5 Río',     ha:3.2, severidad:8,  plaga:null,                     focos:1, ultimaRevision:'09 May', trabajador:'José Delgado',     svgX:134, svgY:38,  svgW:118, svgH:100 },
  { id:'L7', nombre:'L7 Entrada', ha:2.8, severidad:45, plaga:'Sigatoka negra',         focos:4, ultimaRevision:'11 May', trabajador:'Rosa Cando',       svgX:260, svgY:38,  svgW:148, svgH:100 },
  { id:'L8', nombre:'L8 Palmar',  ha:1.9, severidad:3,  plaga:null,                     focos:0, ultimaRevision:'08 May', trabajador:'Marco Intriago',   svgX:416, svgY:38,  svgW:118, svgH:100 },
  { id:'L4', nombre:'L4 Central', ha:4.1, severidad:78, plaga:'Sigatoka + Trips',       focos:8, ultimaRevision:'11 May', trabajador:'Federico Aguirre', svgX:8,   svgY:160, svgW:200, svgH:122 },
  { id:'L6', nombre:'L6 Colina',  ha:2.5, severidad:18, plaga:'Nematodos',              focos:2, ultimaRevision:'10 May', trabajador:'José Delgado',     svgX:216, svgY:160, svgW:122, svgH:122 },
  { id:'L2', nombre:'L2 Sur-1',   ha:3.0, severidad:62, plaga:'Sigatoka negra',         focos:6, ultimaRevision:'11 May', trabajador:'Rosa Cando',       svgX:8,   svgY:304, svgW:136, svgH:96  },
  { id:'L3', nombre:'L3 Sur-2',   ha:1.8, severidad:31, plaga:'Trips del banano',       focos:3, ultimaRevision:'10 May', trabajador:'Marco Intriago',   svgX:152, svgY:304, svgW:136, svgH:96  },
  { id:'L9', nombre:'L9 Nuevo',   ha:1.0, severidad:25, plaga:'Sigatoka negra',         focos:2, ultimaRevision:'09 May', trabajador:'Federico Aguirre', svgX:296, svgY:304, svgW:116, svgH:96  },
]

const TENDENCIA = [
  { dia:'Lun', avg:22, max:42 },
  { dia:'Mar', avg:28, max:51 },
  { dia:'Mié', avg:35, max:58 },
  { dia:'Jue', avg:41, max:65 },
  { dia:'Vie', avg:48, max:71 },
  { dia:'Sáb', avg:52, max:74 },
  { dia:'Hoy', avg:55, max:78 },
]

interface Tratamiento {
  fecha: string
  lote: string
  producto: string
  dosis: string
  estado: 'Aplicado' | 'Pendiente' | 'En evaluación' | 'Eficaz' | 'Parcial'
}

const TRATAMIENTOS: Tratamiento[] = [
  { fecha:'05 May', lote:'L4 Central',  producto:'Mancozeb 80% + Aceite mineral', dosis:'2.5 + 1.5 L/ha', estado:'Pendiente'     },
  { fecha:'02 May', lote:'L2 Sur-1',    producto:'Propiconazol 250 EC',           dosis:'1.5 L/ha',        estado:'Aplicado'      },
  { fecha:'01 May', lote:'L7 Entrada',  producto:'Mancozeb 80%',                  dosis:'2.0 L/ha',        estado:'En evaluación' },
  { fecha:'28 Abr', lote:'L6 Colina',   producto:'Nemacur 10G',                   dosis:'3.0 kg/ha',       estado:'Eficaz'        },
  { fecha:'25 Abr', lote:'L3 Sur-2',    producto:'Aceite mineral',                dosis:'2.0 L/ha',        estado:'Parcial'       },
]

// ── Utilidades ───────────────────────────────────────────────────────────────

function severidadColor(s: number) {
  if (s <= 15) return { fill:'#3EBB6A', stroke:'#2A8B4A', text:'#0D0F0C', label:'OK',      bg:'#F0FFF4', bar:'#3EBB6A' }
  if (s <= 30) return { fill:'#C9F03B', stroke:'#9ABF2A', text:'#0D0F0C', label:'BAJA',    bg:'#F8FFE0', bar:'#C9F03B' }
  if (s <= 50) return { fill:'#C9A800', stroke:'#9A7A00', text:'#0D0F0C', label:'MEDIA',   bg:'#FFFBF0', bar:'#C9A800' }
  if (s <= 70) return { fill:'#E07028', stroke:'#A05018', text:'#fff',    label:'ALTA',    bg:'#FFF0E8', bar:'#E07028' }
  return              { fill:'#D45828', stroke:'#9A2808', text:'#fff',    label:'CRÍTICA', bg:'#FFF4F0', bar:'#D45828' }
}

function estadoStyle(estado: Tratamiento['estado']) {
  switch (estado) {
    case 'Pendiente':     return { color:'#D45828', bg:'#FFF4F0', border:'#D45828' }
    case 'Aplicado':      return { color:'#C9A800', bg:'#FFFBF0', border:'#C9A800' }
    case 'En evaluación': return { color:'#2A50D4', bg:'#F0F4FF', border:'#2A50D4' }
    case 'Eficaz':        return { color:'#3EBB6A', bg:'#F0FFF4', border:'#3EBB6A' }
    case 'Parcial':       return { color:'#C9A800', bg:'#FFFBF0', border:'#C9A800' }
  }
}

function getInitials(n: string) {
  return n.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('')
}

// ── KPIs ─────────────────────────────────────────────────────────────────────

const lotesConPlaga = LOTES.filter(l => l.plaga !== null)
const avgSeveridad  = Math.round(lotesConPlaga.reduce((s, l) => s + l.severidad, 0) / (lotesConPlaga.length || 1))
const lotesCriticos = LOTES.filter(l => l.severidad > 70).length
const haEnRiesgo    = parseFloat(LOTES.filter(l => l.severidad > 30).reduce((s, l) => s + l.ha, 0).toFixed(1))

// ── Mapa SVG ─────────────────────────────────────────────────────────────────

function FarmMap({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const [hovered, setHovered] = useState<string | null>(null)
  const VW = 542
  const VH = 420

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      style={{ width:'100%', height:'auto', display:'block', cursor:'pointer' }}
    >
      {/* Fondo */}
      <rect x={0} y={0} width={VW} height={VH} fill="#E8F5E9" rx={4} />

      {/* Río */}
      <path d="M 134 0 C 134 80 128 120 134 160 C 140 200 136 280 134 420"
        fill="none" stroke="#7EC8E3" strokeWidth={8} strokeLinecap="round" opacity={0.5} />
      <text x={112} y={70} fontSize={9} fill="#5BA4C0" fontWeight={700} transform="rotate(-90,112,70)">Río Verde</text>

      {/* Camino */}
      <path d="M 0 304 L 542 304" fill="none" stroke="#C9B48E" strokeWidth={5} strokeDasharray="8 4" opacity={0.6} />
      <text x={450} y={298} fontSize={9} fill="#9A8060" fontWeight={600}>Camino principal</text>

      {/* Lotes */}
      {LOTES.map(lote => {
        const c = severidadColor(lote.severidad)
        const isSelected = selected === lote.id
        const isHovered  = hovered === lote.id
        const opacity = selected && !isSelected ? 0.45 : 1

        return (
          <g key={lote.id}
            onClick={() => onSelect(lote.id)}
            onMouseEnter={() => setHovered(lote.id)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor:'pointer' }}
          >
            <rect
              x={lote.svgX} y={lote.svgY}
              width={lote.svgW} height={lote.svgH}
              fill={c.fill}
              fillOpacity={isHovered ? 0.95 : 0.82}
              stroke={isSelected ? '#0D0F0C' : c.stroke}
              strokeWidth={isSelected ? 3 : isHovered ? 2 : 1.5}
              opacity={opacity}
              rx={2}
            />
            {/* Badge severidad */}
            <rect
              x={lote.svgX + lote.svgW - 34} y={lote.svgY + 6}
              width={28} height={16}
              fill="rgba(0,0,0,0.25)" rx={2} opacity={opacity}
            />
            <text
              x={lote.svgX + lote.svgW - 20} y={lote.svgY + 18}
              fontSize={9} fontWeight={800} fill="#fff" textAnchor="middle" opacity={opacity}
            >{lote.severidad}%</text>

            {/* Label */}
            <text
              x={lote.svgX + lote.svgW / 2} y={lote.svgY + lote.svgH / 2 - 6}
              fontSize={11} fontWeight={700} fill={c.text}
              textAnchor="middle" opacity={opacity}
            >{lote.id}</text>
            <text
              x={lote.svgX + lote.svgW / 2} y={lote.svgY + lote.svgH / 2 + 8}
              fontSize={9} fill={c.text} textAnchor="middle" opacity={opacity * 0.8}
            >{lote.ha} ha</text>

            {/* Alerta crítica */}
            {lote.severidad > 70 && (
              <text x={lote.svgX + 10} y={lote.svgY + 20} fontSize={14} opacity={opacity}>⚠</text>
            )}

            {/* Selección ring */}
            {isSelected && (
              <rect
                x={lote.svgX - 3} y={lote.svgY - 3}
                width={lote.svgW + 6} height={lote.svgH + 6}
                fill="none" stroke="#C9F03B" strokeWidth={2.5} rx={4}
              />
            )}
          </g>
        )
      })}

      {/* Brújula */}
      <g transform="translate(510, 30)">
        <circle cx={0} cy={0} r={14} fill="rgba(255,255,255,0.8)" stroke="#0D0F0C" strokeWidth={1} />
        <text x={0} y={-4} fontSize={7} fontWeight={800} fill="#D45828" textAnchor="middle">N</text>
        <path d="M 0 -11 L 3 0 L 0 4 L -3 0 Z" fill="#D45828" />
        <path d="M 0 11 L 3 0 L 0 -4 L -3 0 Z" fill="#9C9080" />
      </g>

      {/* Leyenda */}
      <g transform={`translate(8, ${VH - 28})`}>
        {[
          { label:'OK (≤15%)',    color:'#3EBB6A' },
          { label:'Baja (≤30%)', color:'#C9F03B'  },
          { label:'Media (≤50%)',color:'#C9A800'   },
          { label:'Alta (≤70%)', color:'#E07028'   },
          { label:'Crítica',     color:'#D45828'   },
        ].map((item, i) => (
          <g key={item.label} transform={`translate(${i * 96}, 0)`}>
            <rect x={0} y={0} width={10} height={10} fill={item.color} rx={1} />
            <text x={14} y={9} fontSize={8} fill="#0D0F0C" fontWeight={500}>{item.label}</text>
          </g>
        ))}
      </g>
    </svg>
  )
}

// ── Detalle de lote ──────────────────────────────────────────────────────────

function LoteDetail({ lote }: { lote: Lote }) {
  const c = severidadColor(lote.severidad)
  return (
    <div style={{ background:c.bg, border:`2px solid ${c.stroke}`, boxShadow:`3px 3px 0 0 ${c.stroke}`, padding:'18px 20px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
        <div>
          <div style={{ fontSize:16, fontWeight:800, color:'#0D0F0C' }}>{lote.nombre}</div>
          <div style={{ fontSize:12, color:'rgba(13,15,12,0.5)', marginTop:2 }}>{lote.ha} ha · Revisado {lote.ultimaRevision}</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:32, fontWeight:900, color:c.fill, lineHeight:1 }}>{lote.severidad}%</div>
          <div style={{ fontSize:10, fontWeight:800, padding:'2px 8px', marginTop:4, display:'inline-block', background:c.fill, color:c.text }}>{c.label}</div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
        <div style={{ background:'rgba(255,255,255,0.6)', padding:'10px 12px' }}>
          <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase' as const, letterSpacing:'0.06em', color:'rgba(13,15,12,0.45)', marginBottom:4 }}>Plaga</div>
          <div style={{ fontSize:13, fontWeight:700, color:'#0D0F0C' }}>{lote.plaga ?? '— Sin plaga activa'}</div>
        </div>
        <div style={{ background:'rgba(255,255,255,0.6)', padding:'10px 12px' }}>
          <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase' as const, letterSpacing:'0.06em', color:'rgba(13,15,12,0.45)', marginBottom:4 }}>Focos</div>
          <div style={{ fontSize:13, fontWeight:700, color:lote.focos > 4 ? '#D45828' : '#0D0F0C' }}>{lote.focos} foco{lote.focos !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <div style={{ background:'rgba(255,255,255,0.6)', padding:'10px 12px', marginBottom:12 }}>
        <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase' as const, letterSpacing:'0.06em', color:'rgba(13,15,12,0.45)', marginBottom:4 }}>Técnico</div>
        <div style={{ fontSize:13, fontWeight:600, color:'#0D0F0C' }}>{lote.trabajador}</div>
      </div>

      <div>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
          <span style={{ fontSize:10, fontWeight:700, textTransform:'uppercase' as const, letterSpacing:'0.06em', color:'rgba(13,15,12,0.45)' }}>Severidad</span>
          <span style={{ fontSize:10, fontWeight:700, color:c.fill }}>{lote.severidad}%</span>
        </div>
        <div style={{ height:8, background:'rgba(0,0,0,0.1)', borderRadius:4 }}>
          <div style={{ height:8, width:`${lote.severidad}%`, background:c.fill, borderRadius:4 }} />
        </div>
      </div>
    </div>
  )
}

// ── Gráfico de tendencia ─────────────────────────────────────────────────────

function TendenciaChart() {
  const W = 560, H = 140
  const PL = 32, PR = 16, PT = 16, PB = 30
  const IW = W - PL - PR
  const IH = H - PT - PB

  function xOf(i: number) { return PL + (i / (TENDENCIA.length - 1)) * IW }
  function yOf(v: number) { return PT + IH - (v / 100) * IH }

  const avgPath  = TENDENCIA.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(d.avg)}`).join(' ')
  const maxPath  = TENDENCIA.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(d.max)}`).join(' ')
  const areaPath = [
    ...TENDENCIA.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(d.avg)}`),
    `L ${xOf(TENDENCIA.length - 1)} ${PT + IH}`,
    `L ${xOf(0)} ${PT + IH}`, 'Z',
  ].join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'auto', display:'block' }}>
      <defs>
        <linearGradient id="avgGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#D45828" stopOpacity={0.25} />
          <stop offset="100%" stopColor="#D45828" stopOpacity={0.02} />
        </linearGradient>
      </defs>

      {[0, 25, 50, 75, 100].map(t => (
        <g key={t}>
          <line x1={PL} y1={yOf(t)} x2={W - PR} y2={yOf(t)} stroke="rgba(13,15,12,0.08)" strokeWidth={1} />
          <text x={PL - 4} y={yOf(t) + 3} fontSize={8} fill="rgba(13,15,12,0.35)" textAnchor="end">{t}%</text>
        </g>
      ))}

      <path d={areaPath} fill="url(#avgGrad)" />
      <path d={maxPath}  fill="none" stroke="#E07028" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.6} />
      <path d={avgPath}  fill="none" stroke="#D45828" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

      {TENDENCIA.map((d, i) => (
        <g key={i}>
          <circle cx={xOf(i)} cy={yOf(d.avg)} r={4} fill="#D45828" stroke="#fff" strokeWidth={1.5} />
          {i === TENDENCIA.length - 1 && (
            <text x={xOf(i) + 6} y={yOf(d.avg) + 4} fontSize={9} fontWeight={800} fill="#D45828">{d.avg}%</text>
          )}
        </g>
      ))}

      {TENDENCIA.map((d, i) => (
        <text key={i} x={xOf(i)} y={H - 6} fontSize={9} fill="rgba(13,15,12,0.5)" textAnchor="middle"
          fontWeight={i === TENDENCIA.length - 1 ? 800 : 400}
        >{d.dia}</text>
      ))}

      <g transform={`translate(${PL}, ${PT - 4})`}>
        <line x1={0} y1={0} x2={16} y2={0} stroke="#D45828" strokeWidth={2.5} />
        <text x={20} y={4} fontSize={8} fill="rgba(13,15,12,0.6)">Severidad promedio</text>
        <line x1={118} y1={0} x2={134} y2={0} stroke="#E07028" strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={138} y={4} fontSize={8} fill="rgba(13,15,12,0.6)">Pico máximo</text>
      </g>
    </svg>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

export function PlagasView() {
  const { user }   = useAuth()
  const [selected, setSelected] = useState<string | null>('L4')
  const selectedLote = LOTES.find(l => l.id === selected) ?? null
  const sorted = [...LOTES].sort((a, b) => b.severidad - a.severidad)

  return (
    <>
      <Topbar
        title="Plagas"
        badge={`${lotesConPlaga.length} lotes afectados · ${haEnRiesgo} ha en riesgo`}
        avatarInitials={user ? getInitials(user.nombre) : 'WA'}
      />

      <main style={{ padding:'24px 28px', display:'flex', flexDirection:'column', gap:20 }}>

        {/* Header finca */}
        <div style={{ background:'#1B3D24', padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:18, fontWeight:800, color:'#C9F03B', letterSpacing:'-0.3px' }}>{FINCA.nombre}</div>
            <div style={{ fontSize:13, color:'rgba(245,241,232,0.7)', marginTop:2 }}>
              {FINCA.agricultor} · {FINCA.cultivo} · {FINCA.ubicacion} · {FINCA.hectareas} ha
            </div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase' as const, letterSpacing:'0.08em', color:'rgba(245,241,232,0.45)' }}>Monitoreo</div>
            <div style={{ fontSize:13, fontWeight:700, color:'#F5F1E8', marginTop:2 }}>{FINCA.fecha}</div>
          </div>
        </div>

        {/* Alerta crítica */}
        <div style={{ background:'#FFF4F0', border:'2px solid #D45828', boxShadow:'4px 4px 0 0 #D45828', padding:'14px 18px', display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:20, flexShrink:0 }}>⚠</span>
          <span style={{ fontSize:13, color:'#D45828', fontWeight:600 }}>
            <strong>ALERTA CRÍTICA — </strong>
            L4 Central: severidad 78% con brote combinado de Sigatoka negra + Trips.
            Aplicación de Mancozeb pendiente. Riesgo estimado: 35% del lote si no se actúa en 48h.
          </span>
        </div>

        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12 }}>
          {[
            { label:'Focos activos',      value:String(lotesConPlaga.length), sub:'lotes con plaga',     color:'#D45828', bg:'#FFF4F0' },
            { label:'Severidad promedio', value:`${avgSeveridad}%`,           sub:'en lotes infectados',  color:'#E07028', bg:'#FFF0E8' },
            { label:'Lotes críticos',     value:String(lotesCriticos),        sub:'severidad > 70%',      color:'#D45828', bg:'#FFF4F0' },
            { label:'Ha en riesgo',       value:`${haEnRiesgo} ha`,           sub:'severidad > 30%',      color:'#C9A800', bg:'#FFFBF0' },
          ].map(k => (
            <div key={k.label} style={{ background:k.bg, border:`2px solid ${k.color}`, boxShadow:`3px 3px 0 0 ${k.color}`, padding:'16px 18px' }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase' as const, letterSpacing:'0.07em', color:'rgba(13,15,12,0.4)', marginBottom:6 }}>{k.label}</div>
              <div style={{ fontSize:28, fontWeight:900, lineHeight:1, color:k.color }}>{k.value}</div>
              <div style={{ fontSize:11, color:'rgba(13,15,12,0.45)', marginTop:4 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* Mapa + panel */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 340px', gap:16 }}>
          <div style={{ background:'#F5F1E8', border:'2px solid #0D0F0C', boxShadow:'4px 4px 0 0 #0D0F0C', padding:16 }}>
            <div style={{ marginBottom:12 }}>
              <span style={{ fontSize:12, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' as const, color:'rgba(13,15,12,0.45)' }}>
                Mapa de la finca · Clic en lote para detalle
              </span>
            </div>
            <FarmMap selected={selected} onSelect={setSelected} />
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {selectedLote ? (
              <LoteDetail lote={selectedLote} />
            ) : (
              <div style={{ background:'#F5F1E8', border:'2px solid rgba(13,15,12,0.15)', padding:20, textAlign:'center', color:'rgba(13,15,12,0.45)', fontSize:13 }}>
                Seleccioná un lote en el mapa
              </div>
            )}

            {/* Lista de prioridad */}
            <div style={{ background:'#F5F1E8', border:'2px solid #0D0F0C', boxShadow:'3px 3px 0 0 #0D0F0C', overflow:'hidden', flex:1 }}>
              <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(13,15,12,0.1)', background:'rgba(13,15,12,0.03)' }}>
                <span style={{ fontSize:10, fontWeight:700, textTransform:'uppercase' as const, letterSpacing:'0.08em', color:'rgba(13,15,12,0.45)' }}>
                  Prioridad de atención
                </span>
              </div>
              {sorted.slice(0, 6).map((lote, i) => {
                const c = severidadColor(lote.severidad)
                const isActive = selected === lote.id
                return (
                  <div
                    key={lote.id}
                    onClick={() => setSelected(lote.id)}
                    style={{
                      display:'flex', alignItems:'center', gap:10,
                      padding:'9px 14px',
                      borderBottom:'1px solid rgba(13,15,12,0.07)',
                      cursor:'pointer',
                      background: isActive ? 'rgba(201,240,59,0.12)' : 'transparent',
                      borderLeft: isActive ? '3px solid #C9F03B' : '3px solid transparent',
                    }}
                  >
                    <span style={{ fontSize:11, fontWeight:800, color:'rgba(13,15,12,0.3)', width:14 }}>#{i+1}</span>
                    <div style={{ width:8, height:8, background:c.fill, borderRadius:'50%', flexShrink:0 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:'#0D0F0C' }}>{lote.nombre}</div>
                      <div style={{ fontSize:10, color:'rgba(13,15,12,0.5)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                        {lote.plaga ?? 'Sin plaga'}
                      </div>
                    </div>
                    <span style={{ fontSize:12, fontWeight:800, color:c.fill, fontFamily:'monospace' }}>{lote.severidad}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Tendencia semanal */}
        <div style={{ background:'#F5F1E8', border:'2px solid #0D0F0C', boxShadow:'4px 4px 0 0 #0D0F0C', padding:'18px 20px' }}>
          <div style={{ marginBottom:14 }}>
            <span style={{ fontSize:12, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' as const, color:'rgba(13,15,12,0.45)' }}>
              Tendencia · últimos 7 días · Finca El Porvenir
            </span>
          </div>
          <TendenciaChart />
          <div style={{ marginTop:10, display:'flex', gap:24, flexWrap:'wrap' as const }}>
            <span style={{ fontSize:12, color:'rgba(13,15,12,0.5)' }}>
              <span style={{ fontWeight:800, color:'#D45828' }}>+33pp</span> en 7 días
            </span>
            <span style={{ fontSize:12, color:'rgba(13,15,12,0.5)' }}>
              Pico: <span style={{ fontWeight:700, color:'#E07028' }}>78%</span> (L4 Central, hoy)
            </span>
            <span style={{ fontSize:12, color:'rgba(13,15,12,0.5)' }}>
              Inicio de semana: <span style={{ fontWeight:700 }}>22%</span>
            </span>
          </div>
        </div>

        {/* Tabla completa */}
        <section>
          <div style={{ marginBottom:12 }}>
            <span style={{ fontSize:12, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' as const, color:'rgba(13,15,12,0.45)' }}>
              Estado por lote · todos los lotes
            </span>
          </div>
          <div style={{ background:'#F5F1E8', border:'2px solid #0D0F0C', boxShadow:'4px 4px 0 0 #0D0F0C', overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ borderBottom:'2px solid #0D0F0C', background:'rgba(13,15,12,0.04)' }}>
                  {['Lote', 'Ha', 'Severidad', 'Plaga detectada', 'Focos', 'Técnico', 'Última rev.', 'Estado'].map(h => (
                    <th key={h} style={{ padding:'11px 14px', textAlign:'left', fontSize:10, fontWeight:700, textTransform:'uppercase' as const, letterSpacing:'0.06em', opacity:0.45 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(lote => {
                  const c = severidadColor(lote.severidad)
                  const isActive = selected === lote.id
                  return (
                    <tr
                      key={lote.id}
                      onClick={() => setSelected(lote.id)}
                      style={{
                        borderBottom:'1px solid rgba(13,15,12,0.08)',
                        cursor:'pointer',
                        background: isActive ? 'rgba(201,240,59,0.08)' : 'transparent',
                        borderLeft: isActive ? '3px solid #C9F03B' : '3px solid transparent',
                      }}
                    >
                      <td style={{ padding:'12px 14px', fontSize:13, fontWeight:800, color:'#0D0F0C' }}>{lote.nombre}</td>
                      <td style={{ padding:'12px 14px', fontSize:13, color:'rgba(13,15,12,0.6)' }}>{lote.ha}</td>
                      <td style={{ padding:'12px 14px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ width:56, height:6, background:'rgba(0,0,0,0.1)', borderRadius:3 }}>
                            <div style={{ width:`${lote.severidad}%`, height:6, background:c.bar, borderRadius:3 }} />
                          </div>
                          <span style={{ fontSize:12, fontWeight:800, fontFamily:'monospace', color:c.bar }}>{lote.severidad}%</span>
                        </div>
                      </td>
                      <td style={{ padding:'12px 14px', fontSize:12, color:'rgba(13,15,12,0.7)' }}>{lote.plaga ?? '—'}</td>
                      <td style={{ padding:'12px 14px', fontSize:13, fontWeight:700, color:lote.focos > 4 ? '#D45828' : '#0D0F0C' }}>{lote.focos}</td>
                      <td style={{ padding:'12px 14px', fontSize:12, color:'rgba(13,15,12,0.7)' }}>{lote.trabajador}</td>
                      <td style={{ padding:'12px 14px', fontSize:12, fontFamily:'monospace', color:'rgba(13,15,12,0.55)' }}>{lote.ultimaRevision}</td>
                      <td style={{ padding:'12px 14px' }}>
                        <span style={{ fontSize:10, fontWeight:800, padding:'3px 8px', background:c.bg, color:c.bar, border:`1.5px solid ${c.bar}` }}>
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

        {/* Historial de tratamientos */}
        <section>
          <div style={{ marginBottom:12 }}>
            <span style={{ fontSize:12, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase' as const, color:'rgba(13,15,12,0.45)' }}>
              Historial de tratamientos · últimas 2 semanas
            </span>
          </div>
          <div style={{ background:'#F5F1E8', border:'2px solid #0D0F0C', boxShadow:'4px 4px 0 0 #0D0F0C', overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ borderBottom:'2px solid #0D0F0C', background:'rgba(13,15,12,0.04)' }}>
                  {['Fecha', 'Lote', 'Producto', 'Dosis', 'Estado'].map(h => (
                    <th key={h} style={{ padding:'11px 14px', textAlign:'left', fontSize:10, fontWeight:700, textTransform:'uppercase' as const, letterSpacing:'0.06em', opacity:0.45 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TRATAMIENTOS.map((t, i) => {
                  const s = estadoStyle(t.estado)
                  return (
                    <tr key={i} style={{ borderBottom:'1px solid rgba(13,15,12,0.08)' }}>
                      <td style={{ padding:'12px 14px', fontSize:12, fontFamily:'monospace', color:'rgba(13,15,12,0.55)' }}>{t.fecha}</td>
                      <td style={{ padding:'12px 14px', fontSize:13, fontWeight:700, color:'#0D0F0C' }}>{t.lote}</td>
                      <td style={{ padding:'12px 14px', fontSize:13, color:'rgba(13,15,12,0.8)' }}>{t.producto}</td>
                      <td style={{ padding:'12px 14px', fontSize:12, fontFamily:'monospace', color:'rgba(13,15,12,0.6)' }}>{t.dosis}</td>
                      <td style={{ padding:'12px 14px' }}>
                        <span style={{ fontSize:10, fontWeight:800, padding:'3px 8px', background:s.bg, color:s.color, border:`1.5px solid ${s.border}` }}>
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
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', background:'rgba(201,240,59,0.08)', border:'1px solid rgba(201,240,59,0.3)' }}>
          <div style={{ width:6, height:6, background:'#C9F03B', borderRadius:'50%', flexShrink:0 }} />
          <span style={{ fontSize:12, color:'rgba(13,15,12,0.6)' }}>
            <strong style={{ color:'#0D0F0C' }}>Wasagro AI — </strong>
            L4 Central requiere aplicación inmediata de Mancozeb 80% (2.5 L/ha) + Aceite mineral (1.5 L/ha).
            No aplicar si hay lluvias en las próximas 6h. Stock estimado: 12L Mancozeb disponible.
          </span>
        </div>

      </main>
    </>
  )
}
