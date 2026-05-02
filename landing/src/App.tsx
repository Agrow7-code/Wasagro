import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { motion, useInView } from 'motion/react'
import {
  ArrowRight, ChevronDown, Mic, CheckCircle, AlertTriangle,
  BarChart3, Leaf, Droplets, Cloud, DollarSign, Grid3x3,
  Zap, Menu, X, Phone, Video, MoreVertical,
} from 'lucide-react'
import { DashboardLayout } from './dashboard/layout/DashboardLayout'
import { AdminFinca } from './dashboard/views/AdminFinca'
import { GerenteAgricola } from './dashboard/views/GerenteAgricola'
import { Exportadora } from './dashboard/views/Exportadora'
import { AgricultorIndividual } from './dashboard/views/AgricultorIndividual'
import LoginPage from './auth/LoginPage'
import { useAuth } from './auth/useAuth'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

const WA_LINK = 'https://wa.me/50672134878?text=Hola%2C%20quiero%20empezar%20con%20Wasagro'

// ─────────────────────────────────────────────────────────────
// LOGO — isotipo v3: W condensada + señal GPS (dot centrado)
// ─────────────────────────────────────────────────────────────
function LogoMark({ size = 28, onDark = false }: { size?: number; onDark?: boolean }) {
  const w = Math.round(size * 0.6)
  const h = Math.round(size * 1.18)
  return (
    <svg viewBox="0 -22 60 96" width={w} height={h} fill="none" aria-hidden="true">
      <path
        d="M8,8 L18,72 L30,36 L42,72 L52,8"
        stroke={onDark ? '#F5F1E8' : '#1B3D24'}
        strokeWidth="10.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="30" cy="-6" r="12" fill="#C9F03B" />
    </svg>
  )
}

function Logo({ size = 28, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5" aria-label="Wasagro">
      <LogoMark size={size} onDark={onDark} />
      <span
        className="font-bold tracking-[-0.03em] leading-none"
        style={{
          fontSize: size * 0.75,
          color: onDark ? '#F5F1E8' : '#0D0F0C',
          fontFamily: 'Space Grotesk, sans-serif',
        }}
      >
        Wasagro<span style={{ color: '#C9F03B' }}>.</span>
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ANIMATION HELPERS
// ─────────────────────────────────────────────────────────────
function FadeUp({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// NAV
// ─────────────────────────────────────────────────────────────
function Nav() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const links = [
    { href: '#como-funciona', label: 'Cómo funciona' },
    { href: '#exportadoras', label: 'Exportadoras' },
  ]

  return (
    <header
      className={`sticky top-0 z-50 transition-shadow duration-150 ${
        scrolled ? 'shadow-[0_2px_0_0_#0D0F0C]' : 'border-b-2 border-negro'
      }`}
      style={{
        background: 'rgba(245,241,232,0.95)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
      }}
    >
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <a href="#" aria-label="Wasagro inicio">
          <Logo size={26} />
        </a>

        <nav className="hidden md:flex items-center gap-1" aria-label="Navegación principal">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="px-3.5 py-2 text-[13px] font-semibold text-n400 hover:text-negro transition-colors duration-100 rounded-md hover:bg-n200"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href={WA_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold bg-negro text-pergamino border-2 border-negro rounded-md shadow-hard-sm hover:translate-x-[-1px] hover:translate-y-[-1px] transition-transform duration-100"
          >
            Solicitar acceso
            <ArrowRight size={13} strokeWidth={2.5} />
          </a>
          <button
            className="md:hidden p-2 border-2 border-negro rounded-md"
            onClick={() => setOpen(!open)}
            aria-label="Menú"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t-2 border-negro bg-pergamino px-6 py-4 flex flex-col gap-2">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="py-2.5 text-[15px] font-semibold text-n700 border-b border-n200"
            >
              {l.label}
            </a>
          ))}
          <a
            href={WA_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center justify-center gap-2 px-4 py-3 font-bold bg-negro text-pergamino border-2 border-negro rounded-md"
          >
            Solicitar acceso <ArrowRight size={14} />
          </a>
        </div>
      )}
    </header>
  )
}

// ─────────────────────────────────────────────────────────────
// WHATSAPP PHONE MOCK — modern redesign
// ─────────────────────────────────────────────────────────────
type WaMessage = {
  from: 'user' | 'bot'
  text?: string
  voice?: boolean
  duration?: string
  lines?: string[]
  time: string
  alert?: boolean
}

const WA_MESSAGES: WaMessage[] = [
  { from: 'user', voice: true, duration: '0:18', time: '08:43' },
  {
    from: 'bot',
    lines: ['✓ Aplicación registrada', 'Lote 3 · Fungicida · 2.5 L/ha', 'Hoy 08:43 · J. Caicedo'],
    time: '08:43',
  },
  { from: 'user', text: 'Cosecha lote 7, cuatro cajas', time: '09:15' },
  {
    from: 'bot',
    lines: ['✓ Cosecha registrada', 'Cosecha · 420 kg · Lote 7', 'Procesado en 2 seg ✓'],
    time: '09:15',
  },
  { from: 'user', text: 'Hay sigatoka en lote 12', time: '10:30' },
  {
    from: 'bot',
    lines: ['⚠ Alerta — Lote 12', 'Sigatoka · Severidad 3/5', 'Últ. tratamiento: 18 días · Revisar'],
    time: '10:30',
    alert: true,
  },
]

const WAVEFORM = [2, 4, 7, 3, 6, 9, 5, 3, 7, 5, 3, 6, 8, 4, 6, 3, 5]

function VoiceBubble({ duration }: { duration: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5 min-w-[155px]">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: '#128C7E' }}
      >
        <Mic size={14} color="#fff" strokeWidth={2} />
      </div>
      <div className="flex gap-[2px] items-center flex-1" style={{ height: 20 }}>
        {WAVEFORM.map((h, i) => (
          <div
            key={i}
            className="w-[2.5px] rounded-full"
            style={{ height: Math.max(3, h * 1.8), background: i < 9 ? '#128C7E' : 'rgba(18,140,126,0.35)' }}
          />
        ))}
      </div>
      <span className="font-mono text-[10px] ml-1 flex-shrink-0" style={{ color: '#667781' }}>{duration}</span>
    </div>
  )
}

function PhoneMock({ autoPlay = false }: { autoPlay?: boolean }) {
  const [visible, setVisible] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true })

  useEffect(() => {
    if (!isInView && !autoPlay) return
    if (visible >= WA_MESSAGES.length) return
    let i = visible
    const run = () => {
      if (i >= WA_MESSAGES.length) return
      i++
      setVisible(i)
      setTimeout(run, i % 2 === 0 ? 700 : 1100)
    }
    const t = setTimeout(run, 600)
    return () => clearTimeout(t)
  }, [isInView, autoPlay]) // eslint-disable-line react-hooks/exhaustive-deps

  // 1080×2340 → ratio 9:19.5 → at 275px wide ≈ 595px tall
  return (
    <div ref={ref} className="select-none mx-auto" style={{ maxWidth: 275, width: '100%', position: 'relative' }}>

      {/* Side buttons — flush with frame, zero shadow of their own */}
      <div style={{ position: 'absolute', left: -2, top: 112, width: 2, height: 26, background: '#0a0a0a', borderRadius: '1px 0 0 1px' }} />
      <div style={{ position: 'absolute', left: -2, top: 150, width: 2, height: 44, background: '#0a0a0a', borderRadius: '1px 0 0 1px' }} />
      <div style={{ position: 'absolute', left: -2, top: 204, width: 2, height: 44, background: '#0a0a0a', borderRadius: '1px 0 0 1px' }} />
      <div style={{ position: 'absolute', right: -2, top: 164, width: 2, height: 60, background: '#0a0a0a', borderRadius: '0 1px 1px 0' }} />

      {/* Phone frame — padding uniforme en los 4 lados: frame_radius - padding = screen_radius */}
      <div
        style={{
          background: '#111',
          borderRadius: 50,
          padding: '10px',
          boxShadow: '8px 8px 0 0 #0D0F0C',
        }}
      >
        {/* Screen — position relative para que el DI sea overlay interno */}
        <div style={{ borderRadius: 40, overflow: 'hidden', position: 'relative' }}>

          {/* Dynamic Island — flota DENTRO de la pantalla, igual que un iPhone real */}
          <div style={{
            position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
            width: 106, height: 28, background: '#000', borderRadius: 999, zIndex: 10,
          }} />

          {/* Status bar — altura suficiente para convivir con el DI */}
          <div style={{ background: '#075E54', height: 44, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 16px 6px' }}>
            <span style={{ color: '#fff', fontSize: 10, fontWeight: 700, fontFamily: 'monospace' }}>9:41</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {[3, 4, 5, 7].map((h, i) => (
                <div key={i} style={{ width: 2.5, height: h, background: i < 3 ? '#fff' : 'rgba(255,255,255,0.28)', borderRadius: 1 }} />
              ))}
              <div style={{ marginLeft: 4, width: 18, height: 9, border: '1.5px solid rgba(255,255,255,0.5)', borderRadius: 3, display: 'flex', alignItems: 'center', padding: '1.5px 2px', position: 'relative' }}>
                <div style={{ width: '72%', height: '100%', background: '#fff', borderRadius: 1.5 }} />
                <div style={{ position: 'absolute', right: -3.5, top: '50%', transform: 'translateY(-50%)', width: 2, height: 5, background: 'rgba(255,255,255,0.4)', borderRadius: 1 }} />
              </div>
            </div>
          </div>

          {/* WA Chat header */}
          <div style={{ background: '#075E54', padding: '8px 14px 10px', display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 22, lineHeight: 1, fontWeight: 300 }}>‹</span>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#0D0F0C', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg viewBox="0 -22 60 96" width="14" height="28" fill="none" aria-hidden="true">
                <path d="M8,8 L18,72 L30,36 L42,72 L52,8" stroke="#F5F1E8" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="30" cy="-6" r="12" fill="#C9F03B" />
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1.2, fontFamily: 'Space Grotesk, sans-serif' }}>
                Wasagro<span style={{ color: '#C9F03B' }}>.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#25D366' }} />
                <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 9.5, fontFamily: 'monospace' }}>en línea</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 13, alignItems: 'center' }}>
              <Video size={15} color="rgba(255,255,255,0.6)" strokeWidth={1.5} />
              <Phone size={14} color="rgba(255,255,255,0.6)" strokeWidth={1.5} />
              <MoreVertical size={14} color="rgba(255,255,255,0.6)" strokeWidth={1.5} />
            </div>
          </div>

          {/* Chat */}
          <div style={{ background: '#E5DDD5', padding: '10px 10px 6px', minHeight: 420, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 2 }}>
              <span style={{ background: 'rgba(255,255,255,0.72)', color: '#667781', fontSize: 10, padding: '2px 8px', borderRadius: 8, fontFamily: 'monospace' }}>
                HOY
              </span>
            </div>

            {WA_MESSAGES.slice(0, visible).map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                style={{ display: 'flex', justifyContent: msg.from === 'user' ? 'flex-end' : 'flex-start' }}
              >
                <div
                  style={{
                    maxWidth: '83%',
                    borderRadius: msg.from === 'user' ? '12px 3px 12px 12px' : '3px 12px 12px 12px',
                    padding: msg.voice ? '6px 10px 4px' : '6px 10px',
                    fontSize: 11.5,
                    lineHeight: 1.45,
                    background: msg.from === 'user' ? '#DCF8C6' : '#fff',
                    color: '#111',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                    borderLeft: msg.alert ? '2.5px solid #D45828' : undefined,
                  }}
                >
                  {msg.voice && <VoiceBubble duration={msg.duration ?? '0:00'} />}
                  {msg.text && <p style={{ margin: 0 }}>{msg.text}</p>}
                  {msg.lines && msg.lines.map((l, li) => (
                    <p
                      key={li}
                      style={{
                        margin: 0,
                        fontWeight: li === 0 ? 700 : 400,
                        fontSize: li === msg.lines!.length - 1 ? 9.5 : 11.5,
                        opacity: li === msg.lines!.length - 1 ? 0.45 : 1,
                        marginTop: li === msg.lines!.length - 1 ? 2 : 0,
                        color: msg.alert && li === 0 ? '#D45828' : undefined,
                      }}
                    >
                      {l}
                    </p>
                  ))}
                  <p style={{ margin: '2px 0 0', fontSize: 8.5, opacity: 0.38, textAlign: 'right', color: '#667781' }}>
                    {msg.time} ✓✓
                  </p>
                </div>
              </motion.div>
            ))}

            {visible > 0 && visible < WA_MESSAGES.length && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex' }}>
                <div style={{ background: '#fff', borderRadius: '3px 12px 12px 12px', padding: '8px 12px', display: 'flex', gap: 4, alignItems: 'center', boxShadow: '0 1px 2px rgba(0,0,0,.08)' }}>
                  {[0, 1, 2].map((d) => (
                    <motion.div
                      key={d}
                      style={{ width: 6, height: 6, borderRadius: '50%', background: '#9C9080' }}
                      animate={{ y: [0, -3, 0] }}
                      transition={{ duration: 0.7, repeat: Infinity, delay: d * 0.15 }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </div>

          {/* Input bar */}
          <div style={{ background: '#F0F2F0', padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{ flex: 1, background: '#fff', borderRadius: 999, padding: '5px 14px', fontSize: 10.5, color: '#bbb', fontFamily: 'Space Grotesk, sans-serif' }}>
              Escribe un mensaje…
            </div>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#128C7E', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Mic size={14} color="#fff" strokeWidth={2} />
            </div>
          </div>
        </div>

        {/* Home indicator — dentro del frame, centrado */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
          <div style={{ width: 42, height: 5, background: 'rgba(255,255,255,0.18)', borderRadius: 999 }} />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// HERO
// ─────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section
      className="relative overflow-hidden dot-grid"
      style={{ background: '#F5F1E8', minHeight: 'calc(100vh - 56px)' }}
      aria-label="Propuesta de valor principal"
    >
      <div className="max-w-6xl mx-auto px-6 py-20 lg:py-28 grid lg:grid-cols-[1fr_420px] gap-12 lg:gap-16 items-center">
        <div>
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center gap-2.5 mb-7"
          >
            <span className="w-7 h-[2px] bg-senal inline-block" />
            <span className="font-mono text-[11px] font-bold tracking-[.14em] uppercase text-n400">
              Agtech · Latinoamérica
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="font-bold leading-[.97] tracking-[-0.03em] mb-6 text-negro"
            style={{ fontSize: 'clamp(44px, 6.5vw, 80px)' }}
          >
            Tu WhatsApp
            <br />
            ya era el sistema.
            <br />
            <span style={{ background: '#C9F03B', padding: '0 8px', display: 'inline' }}>
              Solo faltaba
            </span>
            <br />
            <span style={{ background: '#C9F03B', padding: '0 8px', display: 'inline' }}>
              Wasagro.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="text-[17px] text-n700 leading-[1.65] max-w-md mb-8"
          >
            Captura eventos de campo en{' '}
            <strong className="text-negro">30 segundos</strong> — voz, texto o foto.
            Sin apps nuevas. Sin capacitaciones. Los datos que la exportadora necesita,{' '}
            <strong className="text-negro">estructurados automáticamente.</strong>
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-wrap gap-3"
          >
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-5 py-3 font-bold text-[15px] bg-negro text-pergamino border-2 border-negro rounded-md shadow-hard hover:translate-x-[-2px] hover:translate-y-[-2px] transition-transform duration-100"
              style={{ boxShadow: '4px 4px 0 0 #1B3D24' }}
            >
              Empezar con WhatsApp
              <ArrowRight size={15} strokeWidth={2.5} />
            </a>
            <a
              href="#como-funciona"
              className="flex items-center gap-2 px-5 py-3 font-semibold text-[15px] border-2 border-negro rounded-md text-negro hover:bg-n200 transition-colors duration-100"
            >
              Ver cómo funciona
              <ChevronDown size={14} strokeWidth={2.5} />
            </a>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.65, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="flex justify-center"
        >
          <PhoneMock autoPlay />
        </motion.div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// STATS BAR
// ─────────────────────────────────────────────────────────────
const STATS = [
  { value: '30', unit: ' seg', label: 'por evento de campo' },
  { value: '0', unit: ' apps', label: 'nuevas que instalar' },
  { value: '90', unit: '%', label: 'de teléfonos con WhatsApp en LATAM' },
  { value: '100', unit: '%', label: 'de datos listos sin trabajo adicional' },
]

function Stats() {
  return (
    <section className="border-y-2 border-negro" style={{ background: '#F5F1E8' }} aria-label="Métricas clave">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <FadeUp
              key={s.label}
              delay={i * 0.07}
              className={`py-10 px-6 ${i < STATS.length - 1 ? 'border-b-2 lg:border-b-0 lg:border-r-2 border-negro' : ''} ${i === 1 ? 'border-r-2 lg:border-r-2' : ''}`}
            >
              <div className="font-bold leading-none tracking-[-0.03em] text-campo mb-2" style={{ fontSize: 'clamp(48px, 5vw, 68px)' }}>
                {s.value}
                <span className="text-senal">{s.unit}</span>
              </div>
              <div className="font-mono text-[12px] text-n400 uppercase tracking-[.08em]">{s.label}</div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// MANIFESTO
// ─────────────────────────────────────────────────────────────
const MANIFESTO = [
  {
    quote: '"No somos un ERP.\nNunca lo seremos."',
    sub: 'Los ERPs son para quien tiene tiempo de llenarlo. El trabajador de campo no.',
  },
  {
    quote: '"Tu WhatsApp ya era el sistema.\nSolo faltaba Wasagro."',
    sub: 'La gente ya reportaba por audio y foto. Solo necesitaba que alguien escuchara.',
    highlight: true,
  },
  {
    quote: '"El agtech te pide un formulario.\nNosotros te pedimos que hables."',
    sub: 'Apps agrícolas: <15% adopción en LATAM. WhatsApp: 90% de cobertura.',
    sourceText: 'Statista',
    sourceUrl: 'https://www.statista.com/statistics/1323702/whatsapp-penetration-latin-american-countries/',
  },
]

function Manifesto() {
  return (
    <section className="py-20 relative overflow-hidden" style={{ background: '#1B3D24' }} aria-label="Manifiesto de marca">
      <div className="absolute inset-0 dot-grid-light pointer-events-none" />
      <div className="relative max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-3 gap-5">
          {MANIFESTO.map((m, i) => (
            <FadeUp key={i} delay={i * 0.1}>
              <div
                className={`border rounded-xl p-7 h-full flex flex-col gap-4 ${
                  m.highlight ? 'border-senal/60 bg-senal/5' : 'border-white/10'
                }`}
              >
                <blockquote className="font-bold leading-[1.25] text-pergamino whitespace-pre-line" style={{ fontSize: 'clamp(17px, 2vw, 21px)' }}>
                  {m.quote}
                </blockquote>
                <p className="font-mono text-[13px] text-pergamino/50 leading-[1.65] mt-auto">{m.sub}</p>
                {m.sourceText && (
                  <a
                    href={m.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[11px] text-pergamino/25 hover:text-pergamino/50 transition-colors duration-100"
                  >
                    {m.sourceText}
                  </a>
                )}
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// HOW IT WORKS
// ─────────────────────────────────────────────────────────────
const STEPS = [
  {
    num: '01',
    icon: Mic,
    title: 'Habla (o escribe)',
    desc: 'El trabajador manda un audio, texto o foto por WhatsApp — exactamente como ya lo hace hoy. Sin instrucciones, sin apps, sin cambios.',
    example: '"Fungicida · 2.5 L/ha · Lote 3"',
  },
  {
    num: '02',
    icon: Zap,
    title: 'Wasagro escucha',
    desc: 'IA extrae producto, lote, dosis, fecha, trabajador y georeferencia en menos de 3 segundos. Confirma con un mensaje limpio.',
    example: '✓ Lote 3 · Fungicida · 2.5 L/ha · 08:43',
  },
  {
    num: '03',
    icon: BarChart3,
    title: 'Los datos trabajan',
    desc: 'El equipo de exportación recibe dashboard en tiempo real, reporte semanal PDF y trazabilidad georreferenciada. Automáticamente.',
    example: 'Reporte semanal listo · Sin trabajo manual',
  },
]

function HowItWorks() {
  return (
    <section
      id="como-funciona"
      className="py-24 border-b-2 border-negro dot-grid"
      style={{ background: '#F5F1E8' }}
      aria-label="Cómo funciona"
    >
      <div className="max-w-6xl mx-auto px-6">
        <FadeUp>
          <p className="font-mono text-[11px] font-bold tracking-[.14em] uppercase text-n400 mb-3">— 03 pasos</p>
          <h2 className="font-bold leading-[1.0] tracking-[-0.02em] text-negro mb-5" style={{ fontSize: 'clamp(32px, 4.5vw, 56px)' }}>
            Sin app. Sin form. Sin magia.
            <br />
            Solo WhatsApp.
          </h2>
          <p className="text-[17px] text-n700 leading-[1.65] max-w-xl mb-16">
            Tres pasos que el campo ya sabe dar. Lo único nuevo es que ahora los datos se estructuran solos.
          </p>
        </FadeUp>

        <div className="grid md:grid-cols-3 gap-5 relative items-stretch">
          <div className="hidden md:block absolute top-10 left-[calc(33%+10px)] right-[calc(33%+10px)] h-[2px] bg-negro/20" />

          {STEPS.map((step, i) => (
            <FadeUp key={step.num} delay={i * 0.12} className="h-full">
              <div className="border-2 border-negro rounded-xl overflow-hidden bg-pergamino shadow-hard hover:translate-x-[-2px] hover:translate-y-[-2px] transition-transform duration-150 h-full flex flex-col">
                <div className="bg-negro px-5 py-3 flex items-center gap-3 flex-shrink-0">
                  <span className="font-mono text-[11px] font-bold text-senal tracking-[.1em]">{step.num}</span>
                  <step.icon size={15} color="#C9F03B" strokeWidth={2} />
                </div>
                <div className="p-6 flex flex-col flex-1">
                  <h3 className="font-bold text-[18px] text-negro mb-3">{step.title}</h3>
                  <p className="text-[14px] text-n700 leading-[1.65] flex-1">{step.desc}</p>
                  <div className="border-l-3 border-senal pl-3 font-mono text-[12px] text-campo font-bold mt-5">
                    {step.example}
                  </div>
                </div>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// WHATSAPP DEMO (dark section)
// ─────────────────────────────────────────────────────────────
function WhatsAppSection() {
  return (
    <section className="py-24 relative overflow-hidden" style={{ background: '#0D0F0C' }} aria-label="Demo en WhatsApp">
      <div className="absolute inset-0 dot-grid-light pointer-events-none opacity-40" />
      <div className="relative max-w-6xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">
        <FadeUp>
          <p className="font-mono text-[11px] font-bold tracking-[.14em] uppercase text-senal/70 mb-4">— Demo en vivo</p>
          <h2 className="font-bold leading-[1.0] tracking-[-0.02em] text-pergamino mb-5" style={{ fontSize: 'clamp(30px, 4vw, 52px)' }}>
            Demo en vivo — escribe como
            <br />
            <span className="text-senal">si fuera tu equipo de campo.</span>
          </h2>
          <p className="text-[16px] text-pergamino/60 leading-[1.65] mb-8 max-w-md">
            Estos son ejemplos reales de mensajes que Wasagro procesa. Texto, voz o foto — el resultado es el mismo.
          </p>
          <div className="flex flex-col gap-3">
            {[
              { icon: CheckCircle, text: 'Tipo de insumo y dosis por hectárea', color: '#3EBB6A' },
              { icon: CheckCircle, text: 'Lote y hectáreas afectadas', color: '#3EBB6A' },
              { icon: CheckCircle, text: 'Fecha, hora y trabajador', color: '#3EBB6A' },
              { icon: AlertTriangle, text: 'Alertas de dosis o plagas — automáticas', color: '#C9F03B' },
            ].map(({ icon: Icon, text, color }) => (
              <div key={text} className="flex items-center gap-3">
                <Icon size={16} color={color} strokeWidth={2} />
                <span className="text-[14px] text-pergamino/80">{text}</span>
              </div>
            ))}
          </div>
        </FadeUp>
        <div className="flex justify-center">
          <PhoneMock />
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// FEATURES GRID
// ─────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: Droplets,
    title: 'Aplicaciones de insumos',
    desc: 'Herbicidas, fungicidas, fertilizantes. Extrae tipo, dosis por hectárea, método y lote automáticamente.',
    example: '"Apliqué fungicida" → Producto · Dosis · Lote',
    color: '#2A50D4',
  },
  {
    icon: AlertTriangle,
    title: 'Reportes de plaga',
    desc: 'Sigatoka, moniliasis, escoba de bruja. Registra tipo, severidad y genera alerta al jefe de finca en tiempo real.',
    example: '"Hay escoba" → Plaga · Nivel · Alerta ⚠',
    color: '#D45828',
  },
  {
    icon: Leaf,
    title: 'Eventos de cosecha',
    desc: 'Kg o toneladas por lote, calidad de fruta, rechazo. Comparativa automática vs semana anterior.',
    example: '"Cosecha · 420 kg · Lote 7" → Delta +8%',
    color: '#3EBB6A',
  },
  {
    icon: Cloud,
    title: 'Eventos climáticos',
    desc: 'Lluvias, vientos fuertes, granizo. Correlación automática con rendimiento de cosecha y aplicaciones.',
    example: '"Llovió fuerte" → Evento · Intensidad · Lote',
    color: '#2A50D4',
  },
  {
    icon: DollarSign,
    title: 'Gastos de campo',
    desc: 'Jornales, insumos, combustible. Control de costos por lote sin contabilidad manual.',
    example: '"Deshierbe · 3 jornales · Lote 2" → Gasto',
    color: '#C9F03B',
  },
  {
    icon: Grid3x3,
    title: 'Trazabilidad completa',
    desc: 'Todos los eventos quedan georreferenciados y auditables. Dashboard en tiempo real para exportación.',
    example: 'Todo lo anterior → Expediente auditado ✓',
    color: '#C9F03B',
    highlight: true,
  },
]

function Features() {
  return (
    <section className="py-24 border-b-2 border-negro" style={{ background: '#EAE6DC' }} aria-label="Qué captura Wasagro">
      <div className="max-w-6xl mx-auto px-6">
        <FadeUp>
          <p className="font-mono text-[11px] font-bold tracking-[.14em] uppercase text-n400 mb-3">— Eventos que captura</p>
          <h2 className="font-bold leading-[1.0] tracking-[-0.02em] text-negro mb-5" style={{ fontSize: 'clamp(30px, 4.5vw, 52px)' }}>
            Todo lo que pasa en el campo.
            <br />
            <span className="text-campo">Sin que nadie lo transcriba.</span>
          </h2>
          <p className="text-[17px] text-n700 leading-[1.65] max-w-xl mb-14">
            El trabajador habla como siempre. Wasagro extrae el dato estructurado y lo pone donde el equipo de exportación lo necesita.
          </p>
        </FadeUp>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f, i) => (
            <FadeUp key={f.title} delay={i * 0.07}>
              <div
                className={`border-2 border-negro rounded-xl p-6 shadow-hard hover:translate-x-[-2px] hover:translate-y-[-2px] transition-transform duration-150 h-full flex flex-col ${
                  f.highlight ? 'bg-negro' : 'bg-pergamino'
                }`}
              >
                <div
                  className="w-10 h-10 rounded-lg border-2 border-negro flex items-center justify-center mb-4 flex-shrink-0"
                  style={{ background: f.highlight ? '#C9F03B' : `${f.color}15` }}
                >
                  <f.icon size={18} color={f.highlight ? '#0D0F0C' : f.color} strokeWidth={2} />
                </div>
                <h3 className={`font-bold text-[16px] mb-2 ${f.highlight ? 'text-pergamino' : 'text-negro'}`}>{f.title}</h3>
                <p className={`text-[13px] leading-[1.6] mb-4 flex-1 ${f.highlight ? 'text-pergamino/60' : 'text-n700'}`}>{f.desc}</p>
                <div className={`mt-auto font-mono text-[11px] px-3 py-2 rounded-md ${f.highlight ? 'bg-senal/10 text-senal' : 'bg-campo/8 text-campo border border-campo/20'}`}>
                  {f.example}
                </div>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// AUDIENCES
// ─────────────────────────────────────────────────────────────
function Audiences() {
  const audiences = [
    {
      id: 'exportadoras',
      tag: 'Para exportadoras',
      title: 'Visibilidad total de tus fincas.\nSin contratar más personal.',
      items: [
        'Dashboard de todas las fincas en tiempo real',
        'Reportes semanales PDF por finca y lote',
        'Trazabilidad lista para auditorías EUDR y certificaciones de exportación',
        '0 capacitación adicional para el campo',
        'Alertas de plagas y dosis antes de que escalen',
        'API para integrar con tu ERP exportador',
      ],
      cta: 'Solicitar demo para exportadoras',
      bg: '#F5F1E8',
      border: '#0D0F0C',
    },
    {
      id: 'finca',
      tag: 'Para el jefe de finca',
      title: 'El campo reporta solo.\nTú ves los datos.',
      items: [
        'Sin apps nuevas para tus trabajadores',
        'El mismo WhatsApp que ya usan',
        'Alertas al instante cuando algo sale mal',
        'Historial completo por lote y trabajador',
        'Reporte semanal automático los domingos',
        'El agricultor solo habla — Wasagro estructura',
      ],
      cta: 'Empezar con mi finca',
      bg: '#1B3D24',
      border: '#C9F03B',
      dark: true,
    },
  ]

  return (
    <section
      id="exportadoras"
      className="py-24 border-b-2 border-negro dot-grid"
      style={{ background: '#F5F1E8' }}
      aria-label="Para quién es Wasagro"
    >
      <div className="max-w-6xl mx-auto px-6">
        <FadeUp>
          <p className="font-mono text-[11px] font-bold tracking-[.14em] uppercase text-n400 mb-3">— Dos perspectivas</p>
          <h2 className="font-bold leading-[1.0] tracking-[-0.02em] text-negro mb-14" style={{ fontSize: 'clamp(30px, 4.5vw, 52px)' }}>
            Una herramienta.
            <br />
            Dos mundos que conecta.
          </h2>
        </FadeUp>
        <div className="grid md:grid-cols-2 gap-5">
          {audiences.map((a, i) => (
            <FadeUp key={a.id} delay={i * 0.12}>
              <div
                className="border-2 rounded-2xl overflow-hidden h-full flex flex-col"
                style={{
                  background: a.bg,
                  borderColor: a.border,
                  boxShadow: `6px 6px 0 0 ${a.dark ? 'rgba(201,240,59,0.2)' : '#0D0F0C'}`,
                }}
              >
                <div className="px-6 py-5 border-b-2" style={{ background: a.dark ? 'rgba(0,0,0,0.2)' : '#0D0F0C', borderColor: a.border }}>
                  <p className="font-mono text-[10px] font-bold tracking-[.12em] uppercase mb-1" style={{ color: '#C9F03B' }}>{a.tag}</p>
                  <h3 className="font-bold leading-[1.2] whitespace-pre-line text-pergamino" style={{ fontSize: 'clamp(18px, 2.5vw, 24px)' }}>
                    {a.title}
                  </h3>
                </div>
                <div className="px-6 py-6 flex flex-col gap-3 flex-1">
                  {a.items.map((item) => (
                    <div key={item} className="flex items-start gap-3">
                      <CheckCircle size={15} color={a.dark ? '#C9F03B' : '#3EBB6A'} strokeWidth={2.5} className="flex-shrink-0 mt-0.5" />
                      <span className="text-[14px] leading-[1.5]" style={{ color: a.dark ? 'rgba(245,241,232,0.8)' : '#3A3530' }}>
                        {item}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="px-6 pb-6">
                  <a
                    href={WA_LINK}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-3 font-bold text-[14px] rounded-xl border-2 transition-all duration-100 hover:gap-3"
                    style={
                      a.dark
                        ? { background: '#C9F03B', color: '#0D0F0C', borderColor: '#C9F03B' }
                        : { background: '#0D0F0C', color: '#F5F1E8', borderColor: '#0D0F0C' }
                    }
                  >
                    {a.cta}
                    <ArrowRight size={14} strokeWidth={2.5} />
                  </a>
                </div>
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// PROOF BAR — animated ticker
// ─────────────────────────────────────────────────────────────
const TICKER_ITEMS = [
  'REGISTRA EN 30 SEGUNDOS',
  'SIN APPS QUE INSTALAR',
  'VOZ · TEXTO · IMAGEN',
  'DATOS ESTRUCTURADOS DESDE EL CAMPO',
  'TRAZABILIDAD AUTOMÁTICA',
  'OPERA EN WHATSAPP',
]

function ProofBar() {
  const track = [...TICKER_ITEMS, ...TICKER_ITEMS]
  return (
    <section
      className="py-3.5 border-b-2 border-negro overflow-hidden"
      style={{ background: '#C9F03B' }}
      aria-hidden="true"
    >
      <div
        style={{
          display: 'flex',
          width: 'max-content',
          animation: 'wa-ticker 24s linear infinite',
          willChange: 'transform',
        }}
      >
        {track.map((item, i) => (
          <span
            key={i}
            className="font-mono text-[11.5px] font-bold text-negro tracking-[.10em] whitespace-nowrap"
            style={{ padding: '0 28px' }}
          >
            {item}
            <span className="mx-3 opacity-30">·</span>
          </span>
        ))}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// FINAL CTA
// ─────────────────────────────────────────────────────────────
function FinalCTA() {
  return (
    <section className="py-28 relative overflow-hidden dot-grid" style={{ background: '#F5F1E8' }} aria-label="Llamado a acción">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <FadeUp>
          <p className="font-mono text-[11px] font-bold tracking-[.14em] uppercase text-n400 mb-5">— Empieza hoy</p>
          <h2 className="font-bold leading-[1.0] tracking-[-0.03em] text-negro mb-6" style={{ fontSize: 'clamp(36px, 5vw, 68px)' }}>
            Empieza con un
            <br />
            <span style={{ background: '#C9F03B', padding: '0 8px', display: 'inline' }}>mensaje de WhatsApp.</span>
          </h2>
          <p className="text-[18px] text-n700 leading-[1.65] max-w-lg mx-auto mb-10">
            Sin formularios, sin demo calls, sin demoras. Manda un mensaje y en 5 minutos tu primer evento de campo está registrado.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-8 py-4 font-bold text-[16px] bg-negro text-pergamino border-2 border-negro rounded-xl transition-all duration-100 hover:translate-x-[-2px] hover:translate-y-[-2px]"
              style={{ boxShadow: '4px 4px 0 0 #1B3D24' }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="#25D366" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Escribir a Wasagro
              <ArrowRight size={16} strokeWidth={2.5} />
            </a>
            <a
              href="mailto:wasagro@proton.me"
              className="flex items-center gap-2 px-6 py-4 font-mono text-[13px] border-2 border-negro rounded-xl text-negro hover:bg-n200 transition-colors duration-100"
            >
              wasagro@proton.me
            </a>
          </div>
          <p className="font-mono text-[11px] text-n400 mt-8 tracking-[.04em]">
            Cacao · Banano · Café · WhatsApp · Latinoamérica
          </p>
        </FadeUp>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// FOOTER
// ─────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="border-t-2 border-negro py-10" style={{ background: '#1B3D24' }} role="contentinfo">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          <div>
            <Logo size={28} onDark />
            <p className="font-mono text-[11px] text-pergamino/40 mt-2 tracking-[.04em]">Asistente de campo inteligente</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
            {[
              { label: 'Cómo funciona', href: '#como-funciona' },
              { label: 'Para exportadoras', href: '#exportadoras' },
              { label: 'Privacidad', href: '#' },
            ].map((l) => (
              <a key={l.label} href={l.href} className="text-[13px] text-pergamino/50 hover:text-pergamino/90 transition-colors duration-100">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="text-right">
            <a href="mailto:wasagro@proton.me" className="font-mono text-[13px] text-pergamino/60 hover:text-pergamino transition-colors duration-100">
              wasagro@proton.me
            </a>
            <p className="font-mono text-[11px] text-pergamino/30 mt-1">© 2025 Wasagro</p>
          </div>
        </div>
        <div className="border-t border-pergamino/10 mt-8 pt-6 flex flex-wrap items-center justify-between gap-4">
          <p className="font-mono text-[10px] text-pergamino/25 tracking-[.08em] uppercase">
            Gestión agrícola · Trazabilidad · WhatsApp · Cacao · Banano
          </p>
          <a
            href={WA_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-senal tracking-[.08em] uppercase hover:opacity-80 transition-opacity duration-100"
          >
            <svg viewBox="0 0 24 24" width="11" height="11" fill="#C9F03B" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            Abrir en WhatsApp
          </a>
        </div>
      </div>
    </footer>
  )
}

// ─────────────────────────────────────────────────────────────
// LANDING PAGE
// ─────────────────────────────────────────────────────────────
function LandingPage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Stats />
        <Manifesto />
        <HowItWorks />
        <WhatsAppSection />
        <Features />
        <Audiences />
        <ProofBar />
        <FinalCTA />
      </main>
      <Footer />
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/brochure" element={<Brochure />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminFinca />} />
          <Route path="gerente" element={<GerenteAgricola />} />
          <Route path="exportadora" element={<Exportadora />} />
          <Route path="agricultor" element={<AgricultorIndividual />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}