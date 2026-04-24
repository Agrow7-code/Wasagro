import { useEffect, useRef, useState } from 'react'
import { motion, useInView } from 'motion/react'
import {
  ArrowRight, ChevronDown, Mic, CheckCircle, AlertTriangle,
  BarChart3, Leaf, Droplets, Cloud, DollarSign, Grid3x3,
  Shield, Zap, Globe, Menu, X
} from 'lucide-react'

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
    { href: '#eudr', label: 'EUDR' },
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

        {/* Desktop nav */}
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
            href="https://wa.me/593999999999?text=Hola%2C%20quiero%20conocer%20Wasagro"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold bg-negro text-pergamino border-2 border-negro rounded-md shadow-hard-sm hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_0_#0D0F0C] transition-all duration-100"
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

      {/* Mobile menu */}
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
            href="https://wa.me/593999999999?text=Hola%2C%20quiero%20conocer%20Wasagro"
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
// WHATSAPP PHONE MOCK
// ─────────────────────────────────────────────────────────────
type WaMessage = {
  from: 'user' | 'bot'
  text?: string
  lines?: string[]
  time: string
  alert?: boolean
}

const WA_MESSAGES: WaMessage[] = [
  { from: 'user', text: 'Apliqué oxicloruro en lote 7, 3 litros por hectárea', time: '08:43' },
  {
    from: 'bot',
    lines: ['✓ Aplicación registrada', 'Lote 7 · oxicloruro de cobre · 3 L/ha', 'Hoy 08:43 · J. Caicedo'],
    time: '08:43',
  },
  { from: 'user', text: 'Cosecha lote 9, cuatro toneladas y media', time: '09:15' },
  {
    from: 'bot',
    lines: ['✓ Cosecha registrada', 'Lote 9 · 4.5 t · +8% vs sem. ant.', 'Procesado en 2 seg ✓'],
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

  return (
    <div ref={ref} className="relative mx-auto" style={{ width: 270 }}>
      {/* Phone frame */}
      <div
        className="relative bg-negro rounded-[38px] p-[6px] border-2 border-negro"
        style={{ boxShadow: '8px 8px 0 0 #1B3D24' }}
      >
        {/* Screen */}
        <div className="rounded-[32px] overflow-hidden" style={{ background: '#ECE5DD' }}>
          {/* Status bar */}
          <div className="h-6 bg-[#1B3D24] flex items-center justify-between px-5">
            <span className="text-[9px] font-mono text-[#F5F1E8]/50">9:41</span>
            <div className="flex gap-1 items-center">
              <div className="w-3 h-1.5 rounded-sm bg-[#F5F1E8]/40" />
              <div className="w-1 h-1 rounded-full bg-[#F5F1E8]/40" />
            </div>
          </div>
          {/* WA Header */}
          <div className="bg-[#1B3D24] px-3 py-2.5 flex items-center gap-2.5 border-b border-[#C9F03B]/10">
            <div
              className="w-8 h-8 rounded-full bg-negro flex items-center justify-center border border-[#C9F03B]/30 flex-shrink-0"
            >
              <svg viewBox="0 -22 60 96" width="15" height="30" fill="none" aria-hidden="true">
                <path d="M8,8 L18,72 L30,36 L42,72 L52,8" stroke="#F5F1E8" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="30" cy="-6" r="12" fill="#C9F03B" />
              </svg>
            </div>
            <div>
              <div className="text-[12px] font-bold text-[#F5F1E8] leading-none">
                Wasagro<span className="text-[#C9F03B]">.</span>
              </div>
              <div className="text-[9px] text-[#F5F1E8]/40 font-mono mt-0.5">En línea</div>
            </div>
          </div>
          {/* Chat */}
          <div className="px-2.5 py-2 min-h-[340px] flex flex-col gap-1.5 overflow-hidden">
            {WA_MESSAGES.slice(0, visible).map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className={`flex ${msg.from === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[11px] leading-[1.45] ${
                    msg.from === 'user'
                      ? 'bg-[#DCF8C6] text-[#111] rounded-tr-[3px]'
                      : msg.alert
                      ? 'bg-white text-[#0D0F0C] rounded-tl-[3px] border-l-2 border-[#D45828]'
                      : 'bg-white text-[#0D0F0C] rounded-tl-[3px]'
                  }`}
                  style={{ boxShadow: '0 1px 2px rgba(0,0,0,.08)' }}
                >
                  {msg.text && <p>{msg.text}</p>}
                  {msg.lines && msg.lines.map((l, li) => (
                    <p
                      key={li}
                      className={li === 0 ? 'font-bold' : li === msg.lines!.length - 1 ? 'opacity-50 text-[9.5px] mt-0.5' : ''}
                      style={msg.alert && li === 0 ? { color: '#D45828' } : undefined}
                    >
                      {l}
                    </p>
                  ))}
                  <p className="text-right text-[8.5px] opacity-40 mt-0.5">{msg.time} ✓✓</p>
                </div>
              </motion.div>
            ))}
            {visible > 0 && visible < WA_MESSAGES.length && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-start"
              >
                <div className="bg-white rounded-lg rounded-tl-[3px] px-3 py-2 flex gap-1 items-center" style={{ boxShadow: '0 1px 2px rgba(0,0,0,.08)' }}>
                  {[0, 1, 2].map((d) => (
                    <motion.div
                      key={d}
                      className="w-1.5 h-1.5 rounded-full bg-[#9C9080]"
                      animate={{ y: [0, -3, 0] }}
                      transition={{ duration: 0.7, repeat: Infinity, delay: d * 0.15 }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </div>
          {/* Input bar */}
          <div className="bg-[#F0F0F0] px-2.5 py-1.5 flex items-center gap-2 border-t border-[#0D0F0C]/10">
            <div className="flex-1 bg-white rounded-full px-3 py-1 text-[10px] text-[#9C9080]">
              Escribe un mensaje…
            </div>
            <div className="w-6 h-6 rounded-full bg-[#1B3D24] flex items-center justify-center flex-shrink-0">
              <Mic size={11} color="#C9F03B" strokeWidth={2.5} />
            </div>
          </div>
        </div>
        {/* Home bar */}
        <div className="flex justify-center pt-1.5 pb-0.5">
          <div className="w-20 h-[3px] bg-[#F5F1E8]/15 rounded-full" />
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
        {/* Left */}
        <div>
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center gap-2.5 mb-7"
          >
            <span className="w-7 h-[2px] bg-senal inline-block" />
            <span className="font-mono text-[11px] font-bold tracking-[.14em] uppercase text-n400">
              Agtech · Ecuador · Guatemala
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
            <span
              className="inline"
              style={{
                background: '#C9F03B',
                padding: '0 8px',
                display: 'inline',
              }}
            >
              Solo faltaba
            </span>
            <br />
            <span
              style={{
                background: '#C9F03B',
                padding: '0 8px',
                display: 'inline',
              }}
            >
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
            className="flex flex-wrap gap-3 mb-8"
          >
            <a
              href="https://wa.me/593999999999?text=Hola%2C%20quiero%20conocer%20Wasagro"
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

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.4 }}
            className="flex flex-wrap gap-2"
          >
            {['Ecuador', 'Guatemala', 'Cacao', 'Banano', 'EUDR-ready'].map((tag) => (
              <span
                key={tag}
                className="px-3 py-1 border-2 border-negro rounded-full font-mono text-[10px] font-bold tracking-[.06em] uppercase text-negro"
              >
                {tag}
              </span>
            ))}
          </motion.div>
        </div>

        {/* Right — Phone */}
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
  { value: '94', unit: '%', label: 'adopción WhatsApp en LatAm' },
  { value: '100', unit: '%', label: 'EUDR-ready desde día uno' },
]

function Stats() {
  return (
    <section
      className="border-y-2 border-negro"
      style={{ background: '#F5F1E8' }}
      aria-label="Métricas clave"
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <FadeUp
              key={s.label}
              delay={i * 0.07}
              className={`py-10 px-6 ${i < STATS.length - 1 ? 'border-b-2 lg:border-b-0 lg:border-r-2 border-negro' : ''} ${i === 1 ? 'border-r-2 lg:border-r-2' : ''}`}
            >
              <div
                className="font-bold leading-none tracking-[-0.03em] text-campo mb-2"
                style={{ fontSize: 'clamp(48px, 5vw, 68px)' }}
              >
                {s.value}
                <span className="text-senal">{s.unit}</span>
              </div>
              <div className="font-mono text-[12px] text-n400 uppercase tracking-[.08em]">
                {s.label}
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// MANIFESTO (rebel statements — Campo Verde bg)
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
    sub: 'La diferencia es una tasa de adopción del 8% vs el 94% de WhatsApp.',
  },
]

function Manifesto() {
  return (
    <section
      className="py-20 relative overflow-hidden"
      style={{ background: '#1B3D24' }}
      aria-label="Manifiesto de marca"
    >
      <div className="absolute inset-0 dot-grid-light pointer-events-none" />
      <div className="relative max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-3 gap-5">
          {MANIFESTO.map((m, i) => (
            <FadeUp key={i} delay={i * 0.1}>
              <div
                className={`border rounded-xl p-7 h-full flex flex-col gap-4 ${
                  m.highlight
                    ? 'border-senal/60 bg-senal/5'
                    : 'border-white/10'
                }`}
              >
                <blockquote
                  className="font-bold leading-[1.25] text-pergamino whitespace-pre-line"
                  style={{ fontSize: 'clamp(17px, 2vw, 21px)' }}
                >
                  {m.quote}
                </blockquote>
                <p className="font-mono text-[13px] text-pergamino/50 leading-[1.65] mt-auto">
                  {m.sub}
                </p>
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
    example: '"Apliqué oxicloruro en lote 7, tres litros"',
  },
  {
    num: '02',
    icon: Zap,
    title: 'Wasagro escucha',
    desc: 'IA extrae producto, lote, dosis, fecha, trabajador y georeferencia en menos de 3 segundos. Confirma con un mensaje limpio.',
    example: '✓ Lote 7 · oxicloruro · 3 L/ha · 08:43',
  },
  {
    num: '03',
    icon: BarChart3,
    title: 'Los datos trabajan',
    desc: 'La exportadora recibe dashboard en tiempo real, reporte semanal PDF y trazabilidad EUDR georreferenciada. Automáticamente.',
    example: 'PDF EUDR listo · Sin trabajo manual',
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
          <p className="font-mono text-[11px] font-bold tracking-[.14em] uppercase text-n400 mb-3">
            — 03 pasos
          </p>
          <h2
            className="font-bold leading-[1.0] tracking-[-0.02em] text-negro mb-5"
            style={{ fontSize: 'clamp(32px, 4.5vw, 56px)' }}
          >
            Sin app. Sin form. Sin magia.
            <br />
            Solo WhatsApp.
          </h2>
          <p className="text-[17px] text-n700 leading-[1.65] max-w-xl mb-16">
            Tres pasos que el campo ya sabe dar. Lo único nuevo es que ahora los datos se estructuran solos.
          </p>
        </FadeUp>

        <div className="grid md:grid-cols-3 gap-5 relative">
          {/* Connector line */}
          <div className="hidden md:block absolute top-10 left-[calc(33%+10px)] right-[calc(33%+10px)] h-[2px] bg-negro/20" />

          {STEPS.map((step, i) => (
            <FadeUp key={step.num} delay={i * 0.12}>
              <div
                className="border-2 border-negro rounded-xl overflow-hidden bg-pergamino shadow-hard hover:translate-x-[-2px] hover:translate-y-[-2px] transition-transform duration-150"
              >
                {/* Header */}
                <div className="bg-negro px-5 py-3 flex items-center gap-3">
                  <span className="font-mono text-[11px] font-bold text-senal tracking-[.1em]">
                    {step.num}
                  </span>
                  <step.icon size={15} color="#C9F03B" strokeWidth={2} />
                </div>
                {/* Body */}
                <div className="p-6">
                  <h3 className="font-bold text-[18px] text-negro mb-3">{step.title}</h3>
                  <p className="text-[14px] text-n700 leading-[1.65] mb-5">{step.desc}</p>
                  <div className="border-l-3 border-senal pl-3 font-mono text-[12px] text-campo font-bold">
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
// WHATSAPP DEMO (dark section, animated chat)
// ─────────────────────────────────────────────────────────────
function WhatsAppSection() {
  return (
    <section
      className="py-24 relative overflow-hidden"
      style={{ background: '#0D0F0C' }}
      aria-label="Demo en WhatsApp"
    >
      <div className="absolute inset-0 dot-grid-light pointer-events-none opacity-40" />
      <div className="relative max-w-6xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">
        {/* Text */}
        <FadeUp>
          <p className="font-mono text-[11px] font-bold tracking-[.14em] uppercase text-senal/70 mb-4">
            — Demo en vivo
          </p>
          <h2
            className="font-bold leading-[1.0] tracking-[-0.02em] text-pergamino mb-5"
            style={{ fontSize: 'clamp(30px, 4vw, 52px)' }}
          >
            Un audio de 15 segundos.
            <br />
            <span className="text-senal">Datos estructurados en 3.</span>
          </h2>
          <p className="text-[16px] text-pergamino/60 leading-[1.65] mb-8 max-w-md">
            Wasagro escucha, interpreta y registra sin que el trabajador cambie nada. El mismo WhatsApp. El mismo audio. Ahora con datos que valen.
          </p>

          <div className="flex flex-col gap-3 mb-8">
            {[
              { icon: CheckCircle, text: 'Producto y concentración exacta', color: '#3EBB6A' },
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

          <a
            href="#eudr"
            className="inline-flex items-center gap-2 font-mono text-[12px] font-bold text-senal tracking-[.06em] uppercase hover:gap-3 transition-all duration-150"
          >
            Ver trazabilidad EUDR <ArrowRight size={12} strokeWidth={2.5} />
          </a>
        </FadeUp>

        {/* Phone */}
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
    desc: 'Herbicidas, fungicidas, fertilizantes. Extrae producto, dosis por hectárea, método y lote automáticamente.',
    example: '"Apliqué mancozeb" → Producto · Dosis · Lote',
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
    desc: 'Toneladas por lote, calidad de fruta, rechazo. Comparativa automática vs semana anterior.',
    example: '"Cosechamos 4.2 toneladas" → Cosecha · Lote · Delta',
    color: '#3EBB6A',
  },
  {
    icon: Cloud,
    title: 'Eventos climáticos',
    desc: 'Lluvias, heladas, granizo. Correlación automática con rendimiento de cosecha y aplicaciones.',
    example: '"Llovió fuerte" → Evento · Intensidad · Lote',
    color: '#2A50D4',
  },
  {
    icon: DollarSign,
    title: 'Gastos de campo',
    desc: 'Jornales, insumos, combustible. Control de costos por lote sin contabilidad manual.',
    example: '"Pagué 5 jornales" → Gasto · Lote · Categoría',
    color: '#C9F03B',
  },
  {
    icon: Grid3x3,
    title: 'Trazabilidad EUDR',
    desc: 'Todos los eventos quedan georreferenciados y auditables. PDF listo para certificadoras europeas.',
    example: 'Todo lo anterior → Expediente EUDR ✓',
    color: '#C9F03B',
    highlight: true,
  },
]

function Features() {
  return (
    <section
      className="py-24 border-b-2 border-negro"
      style={{ background: '#EAE6DC' }}
      aria-label="Qué captura Wasagro"
    >
      <div className="max-w-6xl mx-auto px-6">
        <FadeUp>
          <p className="font-mono text-[11px] font-bold tracking-[.14em] uppercase text-n400 mb-3">
            — Eventos que captura
          </p>
          <h2
            className="font-bold leading-[1.0] tracking-[-0.02em] text-negro mb-5"
            style={{ fontSize: 'clamp(30px, 4.5vw, 52px)' }}
          >
            Todo lo que pasa en el campo.
            <br />
            <span className="text-campo">Sin que nadie lo transcriba.</span>
          </h2>
          <p className="text-[17px] text-n700 leading-[1.65] max-w-xl mb-14">
            El trabajador habla como siempre. Wasagro extrae el dato estructurado y lo pone donde la exportadora lo necesita.
          </p>
        </FadeUp>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f, i) => (
            <FadeUp key={f.title} delay={i * 0.07}>
              <div
                className={`border-2 border-negro rounded-xl p-6 bg-pergamino shadow-hard hover:translate-x-[-2px] hover:translate-y-[-2px] transition-transform duration-150 h-full flex flex-col ${
                  f.highlight ? 'bg-negro' : ''
                }`}
              >
                <div
                  className="w-10 h-10 rounded-lg border-2 border-negro flex items-center justify-center mb-4 flex-shrink-0"
                  style={{
                    background: f.highlight ? '#C9F03B' : `${f.color}15`,
                  }}
                >
                  <f.icon size={18} color={f.highlight ? '#0D0F0C' : f.color} strokeWidth={2} />
                </div>
                <h3
                  className={`font-bold text-[16px] mb-2 ${f.highlight ? 'text-pergamino' : 'text-negro'}`}
                >
                  {f.title}
                </h3>
                <p
                  className={`text-[13px] leading-[1.6] mb-4 ${f.highlight ? 'text-pergamino/60' : 'text-n700'}`}
                >
                  {f.desc}
                </p>
                <div
                  className={`mt-auto font-mono text-[11px] px-3 py-2 rounded-md ${
                    f.highlight
                      ? 'bg-senal/10 text-senal'
                      : 'bg-campo/8 text-campo border border-campo/20'
                  }`}
                >
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
// EUDR SECTION
// ─────────────────────────────────────────────────────────────
function EUDRSection() {
  return (
    <section
      id="eudr"
      className="py-24 relative overflow-hidden"
      style={{ background: '#1B3D24' }}
      aria-label="Cumplimiento EUDR"
    >
      <div className="absolute inset-0 dot-grid-light pointer-events-none" />
      <div className="relative max-w-6xl mx-auto px-6">
        <div className="grid lg:grid-cols-[1fr_360px] gap-14 items-start">
          {/* Left */}
          <div>
            <FadeUp>
              <span className="inline-flex items-center gap-2 border border-tierra/40 rounded-full px-3 py-1 font-mono text-[10px] font-bold text-tierra tracking-[.1em] uppercase mb-5">
                <AlertTriangle size={11} strokeWidth={2.5} color="#D45828" />
                Urgente · EUDR 2025
              </span>
              <h2
                className="font-bold leading-[1.0] tracking-[-0.02em] text-pergamino mb-5"
                style={{ fontSize: 'clamp(30px, 4.5vw, 52px)' }}
              >
                El EUDR no es opcional.
                <br />
                <span className="text-senal">Wasagro te deja listo hoy.</span>
              </h2>
              <p className="text-[16px] text-pergamino/65 leading-[1.7] max-w-lg mb-8">
                Desde 2025, los exportadores de cacao, café y banano que no tengan trazabilidad georreferenciada por lote pierden acceso al mercado europeo. Wasagro genera los registros EUDR automáticamente desde el primer mensaje de WhatsApp — sin trabajo extra.
              </p>
            </FadeUp>

            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { icon: Shield, text: 'Georreferenciación automática de cada lote', note: 'Coordenadas GPS en cada evento' },
                { icon: CheckCircle, text: 'Registro de insumos por hectárea', note: 'Trazabilidad química completa' },
                { icon: Globe, text: 'Historial auditizable por exportación', note: 'Exportable a certificadoras EU' },
                { icon: BarChart3, text: 'PDF listo para Due Diligence EUDR', note: 'Formato aceptado en aduana' },
              ].map(({ icon: Icon, text, note }) => (
                <FadeUp key={text}>
                  <div className="border border-senal/20 rounded-xl p-4 flex gap-3 items-start">
                    <div className="w-8 h-8 rounded-lg bg-senal/10 flex items-center justify-center flex-shrink-0">
                      <Icon size={15} color="#C9F03B" strokeWidth={2} />
                    </div>
                    <div>
                      <p className="text-[13px] font-bold text-pergamino leading-tight mb-1">{text}</p>
                      <p className="font-mono text-[10px] text-pergamino/40">{note}</p>
                    </div>
                  </div>
                </FadeUp>
              ))}
            </div>
          </div>

          {/* Right — compliance card */}
          <FadeUp delay={0.2}>
            <div
              className="border-2 border-senal/40 rounded-2xl overflow-hidden"
              style={{ boxShadow: '6px 6px 0 0 rgba(201,240,59,0.15)' }}
            >
              {/* Header */}
              <div className="bg-senal px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="font-mono text-[10px] font-bold tracking-[.1em] uppercase text-negro/60 mb-0.5">
                    Expediente EUDR
                  </p>
                  <p className="font-bold text-[15px] text-negro">Finca La Palma · Sem. 16</p>
                </div>
                <CheckCircle size={22} color="#1B3D24" strokeWidth={2.5} />
              </div>
              {/* Body */}
              <div className="bg-negro/40 px-5 py-4 flex flex-col gap-3">
                {[
                  { label: 'Eventos registrados', value: '47' },
                  { label: 'Lotes documentados', value: '8 / 8' },
                  { label: 'Cobertura geográfica', value: '100%' },
                  { label: 'Insumos trazados', value: '23 productos' },
                  { label: 'Estado EUDR', value: '✓ Compliant', ok: true },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between items-center py-2 border-b border-pergamino/10 last:border-0">
                    <span className="font-mono text-[11px] text-pergamino/50">{row.label}</span>
                    <span
                      className={`font-bold text-[13px] ${row.ok ? 'text-senal' : 'text-pergamino'}`}
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
              <div className="bg-campo px-5 py-3">
                <p className="font-mono text-[10px] text-senal/60">Generado automáticamente · Wasagro v1</p>
              </div>
            </div>
          </FadeUp>
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
      title: 'Trazabilidad EUDR automática.\nSin contratar más personal.',
      items: [
        'Dashboard de todas las fincas en tiempo real',
        'Reportes semanales PDF por finca y lote',
        'Expediente EUDR listo para certificadoras',
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
          <p className="font-mono text-[11px] font-bold tracking-[.14em] uppercase text-n400 mb-3">
            — Dos perspectivas
          </p>
          <h2
            className="font-bold leading-[1.0] tracking-[-0.02em] text-negro mb-14"
            style={{ fontSize: 'clamp(30px, 4.5vw, 52px)' }}
          >
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
                <div
                  className="px-6 py-5 border-b-2"
                  style={{
                    background: a.dark ? 'rgba(0,0,0,0.2)' : '#0D0F0C',
                    borderColor: a.border,
                  }}
                >
                  <p
                    className="font-mono text-[10px] font-bold tracking-[.12em] uppercase mb-1"
                    style={{ color: a.dark ? '#C9F03B' : '#C9F03B' }}
                  >
                    {a.tag}
                  </p>
                  <h3
                    className="font-bold leading-[1.2] whitespace-pre-line"
                    style={{
                      fontSize: 'clamp(18px, 2.5vw, 24px)',
                      color: a.dark ? '#F5F1E8' : '#F5F1E8',
                    }}
                  >
                    {a.title}
                  </h3>
                </div>
                <div className="px-6 py-6 flex flex-col gap-3 flex-1">
                  {a.items.map((item) => (
                    <div key={item} className="flex items-start gap-3">
                      <CheckCircle
                        size={15}
                        color={a.dark ? '#C9F03B' : '#3EBB6A'}
                        strokeWidth={2.5}
                        className="flex-shrink-0 mt-0.5"
                      />
                      <span
                        className="text-[14px] leading-[1.5]"
                        style={{ color: a.dark ? 'rgba(245,241,232,0.8)' : '#3A3530' }}
                      >
                        {item}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="px-6 pb-6">
                  <a
                    href="https://wa.me/593999999999?text=Hola%2C%20quiero%20conocer%20Wasagro"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-3 font-bold text-[14px] rounded-xl border-2 transition-all duration-100 hover:gap-3"
                    style={
                      a.dark
                        ? {
                            background: '#C9F03B',
                            color: '#0D0F0C',
                            borderColor: '#C9F03B',
                          }
                        : {
                            background: '#0D0F0C',
                            color: '#F5F1E8',
                            borderColor: '#0D0F0C',
                          }
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
// PROOF BAR
// ─────────────────────────────────────────────────────────────
function ProofBar() {
  return (
    <section
      className="py-8 border-b-2 border-negro"
      style={{ background: '#C9F03B' }}
      aria-label="Contexto de uso"
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
          {[
            'Ecuador · Guatemala',
            'Cacao de exportación',
            'Banano orgánico',
            'EUDR-ready',
            'WhatsApp Business API oficial',
          ].map((item, i) => (
            <span key={item} className="flex items-center gap-2.5 font-mono text-[12px] font-bold text-negro tracking-[.06em] uppercase">
              {i > 0 && <span className="opacity-30">·</span>}
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// FINAL CTA
// ─────────────────────────────────────────────────────────────
function FinalCTA() {
  return (
    <section
      className="py-28 relative overflow-hidden dot-grid"
      style={{ background: '#F5F1E8' }}
      aria-label="Llamado a acción"
    >
      <div className="max-w-3xl mx-auto px-6 text-center">
        <FadeUp>
          <p className="font-mono text-[11px] font-bold tracking-[.14em] uppercase text-n400 mb-5">
            — Empieza hoy
          </p>
          <h2
            className="font-bold leading-[1.0] tracking-[-0.03em] text-negro mb-6"
            style={{ fontSize: 'clamp(36px, 5vw, 68px)' }}
          >
            Empieza con un
            <br />
            <span
              style={{ background: '#C9F03B', padding: '0 8px', display: 'inline' }}
            >
              mensaje de WhatsApp.
            </span>
          </h2>
          <p className="text-[18px] text-n700 leading-[1.65] max-w-lg mx-auto mb-10">
            Sin formularios, sin demo calls, sin contratos. Manda un mensaje y en 5 minutos tu primer evento de campo está registrado.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a
              href="https://wa.me/593999999999?text=Hola%2C%20quiero%20conocer%20Wasagro"
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
              href="mailto:hello@wasagro.co"
              className="flex items-center gap-2 px-6 py-4 font-semibold text-[15px] border-2 border-negro rounded-xl text-negro hover:bg-n200 transition-colors duration-100"
            >
              hello@wasagro.co
            </a>
          </div>

          <p className="font-mono text-[11px] text-n400 mt-8 tracking-[.04em]">
            Ecuador · Guatemala · Cacao · Banano · EUDR
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
    <footer
      className="border-t-2 border-negro py-10"
      style={{ background: '#1B3D24' }}
      role="contentinfo"
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          {/* Logo */}
          <div>
            <Logo size={28} onDark />
            <p className="font-mono text-[11px] text-pergamino/40 mt-2 tracking-[.04em]">
              Asistente de campo inteligente
            </p>
          </div>

          {/* Links */}
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
            {[
              { label: 'Cómo funciona', href: '#como-funciona' },
              { label: 'Para exportadoras', href: '#exportadoras' },
              { label: 'EUDR', href: '#eudr' },
              { label: 'Privacidad', href: '#' },
            ].map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="text-[13px] text-pergamino/50 hover:text-pergamino/90 transition-colors duration-100"
              >
                {l.label}
              </a>
            ))}
          </nav>

          {/* Right */}
          <div className="text-right">
            <a
              href="mailto:hello@wasagro.co"
              className="font-mono text-[12px] text-pergamino/50 hover:text-senal transition-colors duration-100"
            >
              hello@wasagro.co
            </a>
            <p className="font-mono text-[11px] text-pergamino/30 mt-1">
              © 2025 Wasagro · Ecuador · Guatemala
            </p>
          </div>
        </div>

        {/* Bottom rule */}
        <div className="border-t border-pergamino/10 mt-8 pt-6 flex flex-wrap items-center justify-between gap-4">
          <p className="font-mono text-[10px] text-pergamino/25 tracking-[.08em] uppercase">
            Gestión agrícola · Trazabilidad EUDR · WhatsApp · Cacao · Banano
          </p>
          <a
            href="https://wa.me/593999999999"
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
// APP
// ─────────────────────────────────────────────────────────────
export default function App() {
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
        <EUDRSection />
        <Audiences />
        <ProofBar />
        <FinalCTA />
      </main>
      <Footer />
    </>
  )
}
