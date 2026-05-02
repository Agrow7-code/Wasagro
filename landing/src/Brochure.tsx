import { motion } from 'motion/react'
import { ArrowRight, FileText, CheckCircle, BarChart3, Cloud, Droplets, Grid3x3, Leaf, Zap, AlertTriangle } from 'lucide-react'

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
// LOGO
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

const WA_LINK = 'https://wa.me/50672134878?text=Hola%2C%20quiero%20empezar%20con%20Wasagro'

export default function Brochure() {
  return (
    <div className="min-h-screen dot-grid" style={{ background: '#F5F1E8', fontFamily: 'Space Grotesk, sans-serif' }}>
      {/* HEADER */}
      <header className="border-b-2 border-negro py-6">
        <div className="max-w-4xl mx-auto px-6 flex justify-between items-center">
          <Logo size={26} />
          <a
            href={WA_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold bg-negro text-pergamino border-2 border-negro rounded-md shadow-hard-sm hover:translate-x-[-1px] hover:translate-y-[-1px] transition-transform duration-100"
          >
            Solicitar acceso
            <ArrowRight size={13} strokeWidth={2.5} />
          </a>
        </div>
      </header>

      {/* HERO BROCHURE */}
      <main className="max-w-4xl mx-auto px-6 py-16">
        <FadeUp>
          <div className="flex items-center gap-2 mb-6">
            <FileText size={20} color="#1B3D24" />
            <span className="font-mono text-[12px] font-bold tracking-[.14em] uppercase text-n400">
              Brochure Digital
            </span>
          </div>
          <h1 className="font-bold leading-[1.0] tracking-[-0.03em] text-negro mb-8" style={{ fontSize: 'clamp(40px, 6vw, 64px)' }}>
            Digitaliza tu finca
            <br />
            usando solo WhatsApp.
          </h1>
          <p className="text-[18px] text-n700 leading-[1.65] mb-12 max-w-2xl">
            Tus trabajadores ya usan WhatsApp. No los obligues a aprender una nueva app. Wasagro es una inteligencia artificial que <strong>convierte audios y fotos de WhatsApp en datos estructurados</strong>, tableros y trazabilidad automática.
          </p>
        </FadeUp>

        {/* 3 PASOS SIMPLES */}
        <FadeUp delay={0.1}>
          <div className="border-2 border-negro bg-pergamino rounded-2xl p-8 mb-16 shadow-hard">
            <h2 className="font-bold text-[24px] mb-8 text-negro">¿Cómo funciona?</h2>
            <div className="grid sm:grid-cols-3 gap-8">
              <div className="flex flex-col gap-3">
                <div className="w-12 h-12 rounded-full bg-senal flex items-center justify-center border-2 border-negro">
                  <span className="font-bold">1</span>
                </div>
                <h3 className="font-bold text-[18px]">El trabajador habla</h3>
                <p className="text-[14px] text-n700">Manda un audio o texto: "Apliqué 2 litros de herbicida en el lote 3".</p>
              </div>
              <div className="flex flex-col gap-3">
                <div className="w-12 h-12 rounded-full bg-senal flex items-center justify-center border-2 border-negro">
                  <span className="font-bold">2</span>
                </div>
                <h3 className="font-bold text-[18px]">La IA extrae datos</h3>
                <p className="text-[14px] text-n700">Identifica producto, lote, trabajador y fecha en segundos.</p>
              </div>
              <div className="flex flex-col gap-3">
                <div className="w-12 h-12 rounded-full bg-senal flex items-center justify-center border-2 border-negro">
                  <span className="font-bold">3</span>
                </div>
                <h3 className="font-bold text-[18px]">Dashboard y Trazabilidad</h3>
                <p className="text-[14px] text-n700">Tú recibes todo en un panel web para tomar decisiones y exportar reportes.</p>
              </div>
            </div>
          </div>
        </FadeUp>

        {/* CASOS DE USO */}
        <FadeUp delay={0.2}>
          <h2 className="font-bold text-[32px] mb-8 text-negro tracking-[-0.02em]">¿Qué puedes registrar?</h2>
          <div className="grid sm:grid-cols-2 gap-4 mb-16">
            {[
              { icon: Droplets, title: 'Insumos', desc: 'Control de dosis por hectárea.' },
              { icon: AlertTriangle, title: 'Plagas', desc: 'Alertas en tiempo real al administrador.' },
              { icon: Leaf, title: 'Cosechas', desc: 'Delta de kg o toneladas por semana.' },
              { icon: Grid3x3, title: 'Gastos', desc: 'Jornales, maquinaria, combustible.' }
            ].map((f, i) => (
              <div key={i} className="flex gap-4 p-5 border-2 border-negro rounded-xl bg-white">
                <div className="bg-campo/10 p-3 rounded-lg border border-campo/20 h-fit">
                  <f.icon size={20} color="#1B3D24" />
                </div>
                <div>
                  <h4 className="font-bold text-[16px] text-negro">{f.title}</h4>
                  <p className="text-[14px] text-n700 mt-1">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </FadeUp>

        {/* CTA */}
        <FadeUp delay={0.3}>
          <div className="bg-[#1B3D24] text-pergamino border-2 border-negro rounded-2xl p-10 text-center relative overflow-hidden" style={{ boxShadow: '6px 6px 0 0 #0D0F0C' }}>
            <div className="absolute inset-0 dot-grid-light opacity-20 pointer-events-none" />
            <div className="relative z-10">
              <h2 className="font-bold text-[32px] mb-4">¿Listo para dejar el papel y Excel?</h2>
              <p className="text-[16px] text-pergamino/80 mb-8 max-w-lg mx-auto">
                No arriesgues la información de tus fincas. Digitaliza la trazabilidad hoy mismo de la forma más fácil posible.
              </p>
              <a
                href={WA_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-8 py-4 font-bold text-[16px] bg-[#C9F03B] text-negro border-2 border-negro rounded-xl transition-transform hover:scale-105"
              >
                Empezar en WhatsApp
                <ArrowRight size={18} strokeWidth={2.5} />
              </a>
            </div>
          </div>
        </FadeUp>
      </main>

      {/* FOOTER */}
      <footer className="border-t-2 border-negro py-8 text-center bg-white">
        <p className="font-mono text-[12px] text-n400">© 2025 Wasagro. Todos los derechos reservados.</p>
      </footer>
    </div>
  )
}