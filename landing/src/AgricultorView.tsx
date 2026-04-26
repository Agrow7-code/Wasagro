import {
  LayoutGrid,
  Map,
  ClipboardList,
  Calendar,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Droplets,
  Package,
  Navigation,
  CloudRain,
  ChevronRight,
  Phone,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type LoteEstado = 'ok' | 'revisar'

interface Lote {
  id: string
  nombre: string
  cultivo: string
  hectareas: number
  semana: number
  registros: number
  estado: LoteEstado
  barras: number[]
}

type FuenteRegistro = 'voz' | 'texto' | 'imagen'
type IconoRegistro = 'insumo' | 'cosecha' | 'labor' | 'clima'

interface Registro {
  id: string
  dia: number
  mes: string
  icono: IconoRegistro
  titulo: string
  detalle: string
  lote: string
  hora: string
  fuente: FuenteRegistro
  esPlaga?: boolean
}

interface GrupoRegistros {
  label: string
  items: Registro[]
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const LOTES: Lote[] = [
  {
    id: 'A', nombre: 'Lote A', cultivo: 'Banano', hectareas: 2.5, semana: 18,
    registros: 6, estado: 'ok',
    barras: [50, 65, 40, 70, 55, 60, 90],
  },
  {
    id: 'B', nombre: 'Lote B', cultivo: 'Cacao', hectareas: 1.8, semana: 27,
    registros: 5, estado: 'ok',
    barras: [40, 55, 60, 50, 45, 65, 75],
  },
  {
    id: 'C', nombre: 'Lote C', cultivo: 'Banano', hectareas: 3.1, semana: 14,
    registros: 3, estado: 'revisar',
    barras: [70, 50, 30, 20, 15, 10, 35],
  },
]

const HISTORIAL: GrupoRegistros[] = [
  {
    label: 'Hoy — Sábado 25 de abril',
    items: [
      { id: 'r1', dia: 25, mes: 'Abr', icono: 'insumo', titulo: 'Apliqué fungicida', detalle: 'Mancozeb · 2.5 L/ha', lote: 'Lote A', hora: '14:31', fuente: 'voz' },
      { id: 'r2', dia: 25, mes: 'Abr', icono: 'cosecha', titulo: 'Cosecha', detalle: '420 kg · Variedad Williams', lote: 'Lote A', hora: '11:00', fuente: 'texto' },
    ],
  },
  {
    label: 'Ayer — Viernes 24 de abril',
    items: [
      { id: 'r3', dia: 24, mes: 'Abr', icono: 'labor', titulo: 'Deshoje', detalle: 'Labor cultural · 2.5 ha', lote: 'Lote B', hora: '09:45', fuente: 'voz' },
      { id: 'r4', dia: 24, mes: 'Abr', icono: 'insumo', titulo: 'Abono foliar', detalle: 'Urea foliar · 1.2 L/ha', lote: 'Lote B', hora: '16:00', fuente: 'imagen' },
    ],
  },
  {
    label: 'Jueves 23 de abril',
    items: [
      { id: 'r5', dia: 23, mes: 'Abr', icono: 'cosecha', titulo: 'Cosecha', detalle: '280 kg · Variedad Williams', lote: 'Lote C', hora: '10:30', fuente: 'texto' },
      { id: 'r6', dia: 23, mes: 'Abr', icono: 'clima', titulo: 'Registro de lluvia', detalle: '22mm · Temperatura 23°C', lote: 'General', hora: '07:00', fuente: 'texto' },
    ],
  },
]

// ─── Sub-components ───────────────────────────────────────────────────────────

function RegistroIcono({ tipo, esPlaga }: { tipo: IconoRegistro; esPlaga?: boolean }) {
  const base = 'w-10 h-10 border-2 flex items-center justify-center shrink-0'
  const borderColor = esPlaga ? 'border-wa-tierra-accent' : 'border-wa-tierra'
  const iconColor = esPlaga ? 'text-wa-tierra-accent' : tipo === 'clima' ? 'text-wa-tierra-suave' : 'text-wa-campo'

  const icon = {
    insumo:  <Droplets className={`w-[18px] h-[18px] ${iconColor}`} />,
    cosecha: <Package   className={`w-[18px] h-[18px] ${iconColor}`} />,
    labor:   <Navigation className={`w-[18px] h-[18px] ${iconColor}`} />,
    clima:   <CloudRain  className={`w-[18px] h-[18px] ${iconColor}`} />,
  }[tipo]

  return <div className={`${base} ${borderColor}`}>{icon}</div>
}

function FuenteBadge({ fuente }: { fuente: FuenteRegistro }) {
  const map: Record<FuenteRegistro, { label: string; className: string }> = {
    voz:    { label: '🎤 VOZ',    className: 'bg-[rgba(27,61,36,0.1)] text-wa-campo border-wa-campo' },
    texto:  { label: '✍️ TEXTO',  className: 'bg-[rgba(13,15,12,0.07)] text-wa-tierra-suave border-[rgba(13,15,12,0.25)]' },
    imagen: { label: '📷 IMAGEN', className: 'bg-[rgba(43,78,160,0.1)] text-[#2B4EA0] border-[#2B4EA0]' },
  }
  const { label, className } = map[fuente]
  return (
    <span className={`font-mono text-[9px] font-bold px-1.5 py-[2px] tracking-[0.05em] border-[1.5px] ${className}`}>
      {label}
    </span>
  )
}

function MiniBars({ barras }: { barras: number[] }) {
  return (
    <div className="flex items-end gap-[3px] h-7">
      {barras.map((h, i) => (
        <div
          key={i}
          className={`flex-1 min-h-[3px] ${i === barras.length - 1 ? 'bg-wa-signal' : 'bg-wa-campo'}`}
          style={{ height: `${h}%`, opacity: i === barras.length - 1 ? 1 : 0.65 }}
        />
      ))}
    </div>
  )
}

function LoteCard({ lote }: { lote: Lote }) {
  const isRevisar = lote.estado === 'revisar'
  return (
    <div
      className={`bg-wa-pergamino p-6 border-2 cursor-pointer transition-transform hover:translate-x-[-1px] hover:translate-y-[-1px] ${
        isRevisar
          ? 'border-wa-tierra-accent shadow-[4px_4px_0_0_#D45828]'
          : 'border-wa-tierra shadow-[4px_4px_0_0_#0D0F0C]'
      }`}
    >
      <div className="flex items-start justify-between mb-1.5">
        <span className="text-[18px] font-bold">{lote.nombre}</span>
        {isRevisar ? (
          <span className="font-mono text-[11px] font-bold px-[9px] py-[3px] tracking-[0.05em] text-wa-tierra-accent bg-[rgba(212,88,40,0.1)] border-[1.5px] border-wa-tierra-accent">
            REVISAR
          </span>
        ) : (
          <span className="font-mono text-[11px] font-bold px-[9px] py-[3px] tracking-[0.05em] text-wa-exito bg-[rgba(62,187,106,0.1)] border-[1.5px] border-wa-exito">
            OK ✓
          </span>
        )}
      </div>
      <div className="font-mono text-[13px] text-wa-tierra-suave mb-5">
        {lote.cultivo} · {lote.hectareas} ha · Sem. {lote.semana}
      </div>
      <div
        className="font-mono text-[42px] font-bold leading-none mb-0.5"
        style={{ color: isRevisar ? '#D45828' : undefined }}
      >
        {lote.registros}
      </div>
      <div className="text-[11px] font-bold tracking-[0.08em] uppercase text-wa-tierra-suave mb-3.5">
        registros esta semana
      </div>
      <MiniBars barras={lote.barras} />
      {isRevisar && (
        <div className="mt-2.5 text-[12px] font-semibold text-wa-tierra-accent flex items-center gap-1">
          <AlertTriangle className="w-[13px] h-[13px]" />
          Pocos registros esta semana
        </div>
      )}
    </div>
  )
}

function HistorialItem({ item }: { item: Registro }) {
  const isGeneral = item.lote === 'General'
  return (
    <div className="flex items-center gap-[18px] px-[22px] py-4 border-b border-[rgba(13,15,12,0.1)] cursor-pointer transition-colors hover:bg-[rgba(13,15,12,0.03)] last:border-b-0">
      <div className="text-center w-[52px] shrink-0">
        <div className="font-mono text-[22px] font-bold leading-none">{item.dia}</div>
        <div className="text-[10px] font-bold tracking-[0.06em] uppercase text-wa-tierra-suave">{item.mes}</div>
      </div>
      <RegistroIcono tipo={item.icono} esPlaga={item.esPlaga} />
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-bold mb-[3px]">{item.titulo}</div>
        <div className="text-[13px] text-wa-tierra-suave font-mono">{item.detalle}</div>
      </div>
      <div className="flex flex-col items-end gap-[5px] shrink-0">
        <span
          className={`font-mono text-[12px] font-bold px-2.5 py-[3px] border-[1.5px] ${
            isGeneral ? 'border-[rgba(13,15,12,0.2)] text-wa-tierra-suave' : 'border-wa-tierra'
          }`}
        >
          {item.lote}
        </span>
        <span className="font-mono text-[11px] text-wa-tierra-suave">{item.hora}</span>
        <FuenteBadge fuente={item.fuente} />
      </div>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function AgricultorView() {
  return (
    <div className="flex min-h-screen min-w-[1280px] overflow-x-auto bg-wa-pergamino font-sans text-wa-tierra">

      {/* ── SIDEBAR ── */}
      <aside className="w-[200px] min-h-screen bg-wa-campo flex flex-col shrink-0 fixed top-0 left-0 z-50">
        <div className="px-[18px] py-6 pb-5 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-wa-signal flex items-center justify-center font-bold text-[16px] text-wa-campo">
              W
            </div>
            <span className="font-bold text-[18px] text-wa-pergamino tracking-[-0.3px]">
              Wasagro<span className="text-wa-signal">.</span>
            </span>
          </div>
        </div>

        <nav className="flex-1 py-5 flex flex-col gap-[2px]">
          {[
            { label: 'Mi finca',  icon: <LayoutGrid className="w-5 h-5" />,       active: true  },
            { label: 'Mis lotes', icon: <Map className="w-5 h-5" />,               active: false },
            { label: 'Historial', icon: <ClipboardList className="w-5 h-5" />,     active: false },
          ].map(({ label, icon, active }) => (
            <a
              key={label}
              href="#"
              className={`flex items-center gap-3 px-[18px] py-3 text-[15px] font-medium border-l-[3px] transition-colors no-underline ${
                active
                  ? 'bg-[rgba(201,240,59,0.15)] text-wa-signal border-l-wa-signal'
                  : 'text-[rgba(245,241,232,0.65)] border-l-transparent hover:bg-white/[0.06] hover:text-wa-pergamino'
              }`}
            >
              {icon}
              {label}
            </a>
          ))}
        </nav>

        <div className="px-[18px] py-4 border-t border-white/10">
          <div className="w-10 h-10 bg-wa-signal text-wa-campo font-bold text-[15px] flex items-center justify-center mb-2">
            LM
          </div>
          <div className="text-[14px] font-bold text-wa-pergamino">Luis Mora</div>
          <div className="text-[12px] text-[rgba(245,241,232,0.55)] mt-0.5">Agricultor</div>
          <div className="text-[12px] text-wa-signal mt-0.5 opacity-85">Finca La Colina</div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="ml-[200px] flex-1 flex flex-col">

        {/* ── TOPBAR ── */}
        <header className="h-[68px] bg-wa-pergamino border-b-2 border-wa-tierra flex items-center justify-between px-8 sticky top-0 z-40">
          <div>
            <div className="text-[13px] text-[rgba(13,15,12,0.45)] mb-[1px]">Buenos días,</div>
            <div className="text-[19px] font-bold tracking-[-0.3px]">Luis — ¿qué pasó hoy en La Colina?</div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="font-mono text-[12px] font-bold px-3.5 py-[7px] border-2 border-wa-tierra text-[rgba(13,15,12,0.45)] flex items-center gap-1.5">
              <Calendar className="w-3 h-3" />
              Semana 17 · Abr 2026
            </div>
          </div>
        </header>

        {/* ── CONTENT ── */}
        <main className="p-8 flex flex-col gap-8 pb-[100px]">

          {/* KPI ROW */}
          <section className="grid grid-cols-2 gap-5">

            {/* Registros esta semana */}
            <div className="bg-wa-pergamino border-2 border-wa-campo shadow-[4px_4px_0_0_#1B3D24] p-8 pl-9">
              <div className="text-[12px] font-bold tracking-[0.1em] uppercase text-[rgba(13,15,12,0.45)] mb-4">
                Tus registros esta semana
              </div>
              <div className="font-mono text-[80px] font-bold leading-none tracking-[-4px] mb-2.5 text-wa-campo">
                14
              </div>
              <div className="text-[16px] text-[rgba(13,15,12,0.45)] mb-1.5">eventos registrados</div>
              <div className="flex items-center gap-1.5 text-[13px] font-mono text-wa-campo">
                <TrendingUp className="w-[13px] h-[13px]" />
                +3 vs semana pasada
              </div>
              {/* Mini sparkline */}
              <div className="flex items-end gap-1 h-10 mt-3">
                {[50, 65, 45, 70, 55, 60].map((h, i) => (
                  <div key={i} className="flex-1 bg-wa-campo min-h-[3px]" style={{ height: `${h}%`, opacity: 0.3 }} />
                ))}
                <div className="flex-1 bg-wa-signal min-h-[3px]" style={{ height: '100%' }} />
              </div>
            </div>

            {/* Alertas */}
            <div className="bg-wa-pergamino border-2 border-wa-tierra shadow-[4px_4px_0_0_#0D0F0C] p-8 pl-9">
              <div className="text-[12px] font-bold tracking-[0.1em] uppercase text-[rgba(13,15,12,0.45)] mb-4">
                Alertas activas
              </div>
              <div className="font-mono text-[80px] font-bold leading-none tracking-[-4px] mb-2.5">
                0
              </div>
              <div className="text-[16px] text-[rgba(13,15,12,0.45)] mb-1.5">sin problemas detectados</div>
              <div className="flex items-center gap-1.5 text-[13px] font-bold text-wa-exito mt-2">
                <CheckCircle className="w-[18px] h-[18px]" />
                Todo en orden esta semana
              </div>
              <div className="flex items-center gap-1.5 text-[13px] font-mono text-[rgba(13,15,12,0.45)] mt-3.5">
                Última revisión: hoy 08:00
              </div>
            </div>

          </section>

          {/* LOTES */}
          <section>
            <div className="text-[14px] font-bold tracking-[0.07em] uppercase text-[rgba(13,15,12,0.45)] mb-4">
              Mis lotes
            </div>
            <div className="grid grid-cols-3 gap-4">
              {LOTES.map(lote => <LoteCard key={lote.id} lote={lote} />)}
            </div>
          </section>

          {/* HISTORIAL */}
          <section>
            <div className="text-[14px] font-bold tracking-[0.07em] uppercase text-[rgba(13,15,12,0.45)] mb-4">
              Mis registros recientes
            </div>
            <div className="bg-wa-pergamino border-2 border-wa-tierra shadow-[4px_4px_0_0_#0D0F0C] overflow-hidden">
              {HISTORIAL.map(grupo => (
                <div key={grupo.label}>
                  <div className="font-mono text-[11px] font-bold tracking-[0.1em] uppercase text-[rgba(13,15,12,0.45)] px-[22px] py-[10px] border-b-2 border-wa-tierra">
                    {grupo.label}
                  </div>
                  {grupo.items.map(item => <HistorialItem key={item.id} item={item} />)}
                </div>
              ))}
              <div className="px-[22px] py-3.5 border-t border-[rgba(13,15,12,0.1)] flex items-center justify-between">
                <span className="text-[13px] text-[rgba(13,15,12,0.45)] font-mono">
                  14 registros esta semana
                </span>
                <button className="text-[13px] font-bold text-wa-campo bg-transparent border-none cursor-pointer flex items-center gap-1 font-sans">
                  Ver semanas anteriores
                  <ChevronRight className="w-[13px] h-[13px]" />
                </button>
              </div>
            </div>
          </section>

        </main>
      </div>

      {/* ── CTA FIJO ── */}
      <div className="fixed bottom-0 left-[200px] right-0 px-8 py-4 bg-wa-pergamino border-t-2 border-wa-tierra flex items-center justify-between z-40">
        <div className="text-[13px] text-[rgba(13,15,12,0.45)] flex items-center gap-2">
          <Phone className="w-4 h-4 opacity-40" />
          ¿Hiciste algo en el campo hoy? Registralo con un mensaje de voz.
        </div>
        <a
          href="https://wa.me/1234567890"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 px-7 py-3.5 bg-wa-signal border-2 border-wa-tierra shadow-[4px_4px_0_0_#0D0F0C] text-[15px] font-bold tracking-[0.03em] text-wa-tierra no-underline transition-all hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0_0_#0D0F0C] active:translate-x-0 active:translate-y-0 active:shadow-[4px_4px_0_0_#0D0F0C]"
        >
          <WhatsAppIcon />
          Registrar en WhatsApp →
        </a>
      </div>

    </div>
  )
}

function WhatsAppIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 3C9.373 3 4 8.373 4 15c0 2.385.668 4.61 1.827 6.5L4 29l7.71-1.813A11.94 11.94 0 0 0 16 27c6.627 0 12-5.373 12-12S22.627 3 16 3z" fill="#1B3D24"/>
      <path d="M21.5 18.5c-.3-.15-1.77-.87-2.04-.97s-.47-.15-.67.15-.77.97-.94 1.17-.35.22-.65.07a8.17 8.17 0 0 1-4.04-3.53c-.3-.52.3-.48.87-1.6.1-.2.05-.37-.02-.52s-.67-1.61-.91-2.2c-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37s-1.04 1.02-1.04 2.48 1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.09 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35z" fill="#C9F03B"/>
    </svg>
  )
}
