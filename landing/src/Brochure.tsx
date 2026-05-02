import { motion } from 'motion/react'
import { useSearchParams } from 'react-router-dom'
import { 
  ArrowRight, FileText, CheckCircle, BarChart3, Cloud, 
  Droplets, Grid3x3, Leaf, Zap, AlertTriangle, 
  ShieldCheck, Banknote, Building2, Users, User
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────
// SEGMENT DEFINITIONS
// ─────────────────────────────────────────────────────────────

type SegmentContent = {
  title: string
  subtitle: string
  heroImageDesc: string
  problem: string
  solution: string
  features: Array<{ icon: any, title: string, desc: string }>
  benefits: string[]
}

const SEGMENTS: Record<string, SegmentContent> = {
  // --- B2B SEGMENTS ---
  exportadora: {
    title: 'Trazabilidad total de tus exportaciones.',
    subtitle: 'Cumple con EUDR y certificaciones internacionales sin formularios complejos.',
    heroImageDesc: 'Dashboards de cumplimiento en tiempo real.',
    problem: 'La recolección manual de datos en cientos de fincas genera errores y riesgos de rechazo en puerto.',
    solution: 'Digitaliza tu cadena de suministro permitiendo que los agricultores reporten por audio de WhatsApp.',
    features: [
      { icon: ShieldCheck, title: 'Cumplimiento EUDR', desc: 'Georreferenciación y polígonos automáticos por cada envío.' },
      { icon: BarChart3, title: 'Dashboard de Operaciones', desc: 'Vista consolidada de todas tus fincas proveedoras.' },
      { icon: FileText, title: 'Reportes de Auditoría', desc: 'Exporta expedientes de trazabilidad en un click.' }
    ],
    benefits: ['Reduce 90% el tiempo de digitación', 'Asegura certificaciones', 'Control de residuos']
  },
  ong: {
    title: 'Mide el impacto de tus proyectos en tiempo real.',
    subtitle: 'Visibilidad directa del campo para cooperantes y donantes.',
    heroImageDesc: 'Reportes de adopción técnica y social.',
    problem: 'Saber si los agricultores están aplicando las técnicas enseñadas es difícil y costoso de monitorear.',
    solution: 'Recibe evidencias directas del campo (voz/foto) sobre la adopción de buenas prácticas.',
    features: [
      { icon: Users, title: 'Monitoreo de Adopción', desc: 'Verifica el uso de bioinsumos o técnicas sostenibles.' },
      { icon: Cloud, title: 'Resiliencia Climática', desc: 'Alertas tempranas para proteger los cultivos de los beneficiarios.' },
      { icon: BarChart3, title: 'Transparencia de Impacto', desc: 'Datos crudos del campo para tus reportes de donación.' }
    ],
    benefits: ['Reportes automáticos para donantes', 'Monitoreo remoto', 'Mayor alcance de técnicos']
  },
  banco: {
    title: 'Reduce el riesgo de tu cartera agropecuaria.',
    subtitle: 'Monitoreo satelital y presencial de la inversión en tiempo real.',
    heroImageDesc: 'Score de riesgo dinámico por finca.',
    problem: 'Los bancos pierden visibilidad una vez entregado el crédito, dependiendo de visitas físicas costosas.',
    solution: 'Wasagro te da ojos en la finca: verifica aplicaciones y avances de cosecha vía WhatsApp.',
    features: [
      { icon: Banknote, title: 'Verificación de Inversión', desc: 'Comprueba que el crédito se use en los insumos acordados.' },
      { icon: AlertTriangle, title: 'Alertas de Siniestro', desc: 'Entérate de plagas o clima adverso antes que el cliente deje de pagar.' },
      { icon: ShieldCheck, title: 'Colateral de Datos', desc: 'Crea un historial crediticio basado en la productividad real.' }
    ],
    benefits: ['Reduce tasa de mora', 'Optimiza visitas de campo', 'Mejor selección de clientes']
  },
  fintech: {
    title: 'Datos en tiempo real para financiar el agro.',
    subtitle: 'La API que conecta el campo con tu motor de riesgo.',
    heroImageDesc: 'Conexión directa vía API Wasagro.',
    problem: 'La falta de datos estructurados impide dar créditos rápidos y justos al sector rural.',
    solution: 'Usa Wasagro como tu oráculo de datos de campo estructurados por IA.',
    features: [
      { icon: Zap, title: 'API de Productividad', desc: 'Integra datos de labor y cosecha en tu plataforma.' },
      { icon: ShieldCheck, title: 'Prueba de Vida', desc: 'Fotos georreferenciadas que validan la existencia del cultivo.' },
      { icon: BarChart3, title: 'Historial Productivo', desc: 'Datos históricos para modelos de inteligencia de riesgos.' }
    ],
    benefits: ['Aprobación en minutos', 'Escalabilidad masiva', 'Datos 100% verificables']
  },
  asociacion: {
    title: 'Fortalece tu asociación con tecnología.',
    subtitle: 'Servicios digitales de valor para tus asociados sin costo de hardware.',
    heroImageDesc: 'Comunidad conectada y productiva.',
    problem: 'Las asociaciones luchan por recolectar datos de sus miembros para ventas conjuntas o compras de insumos.',
    solution: 'Wasagro unifica la información de todos tus socios en un solo tablero central.',
    features: [
      { icon: Users, title: 'Central de Compras', desc: 'Proyecta demanda de insumos basada en reportes reales.' },
      { icon: Leaf, title: 'Oferta Agregada', desc: 'Sabe cuántas toneladas van a cosechar tus socios la próxima semana.' },
      { icon: AlertTriangle, title: 'Alertas Comunitarias', desc: 'Detecta brotes de plagas en la zona y avisa a todos.' }
    ],
    benefits: ['Mejor poder de negociación', 'Socios más leales', 'Trazabilidad de grupo']
  },

  // --- B2C SEGMENTS ---
  productor_grande: {
    title: 'Control total de tu operación a gran escala.',
    subtitle: 'Elimina las planillas de papel y los reportes tardíos.',
    heroImageDesc: 'Gestión por lotes y costos en tiempo real.',
    problem: 'Con cientos de hectáreas, los datos tardan días en llegar de la cuadrilla a la oficina.',
    solution: 'Recibe información al instante: lo que pasa en el lote llega a tu celular en 3 segundos.',
    features: [
      { icon: DollarSign, title: 'Costos por Lote', desc: 'Sabe exactamente cuánto gastas en cada hectárea hoy.' },
      { icon: Zap, title: 'Gestión de Cuadrillas', desc: 'Monitorea el avance de labores sin ir al campo.' },
      { icon: BarChart3, title: 'Tableros de Gerencia', desc: 'Toma decisiones con datos, no con presentimientos.' }
    ],
    benefits: ['Maximiza el ROI', 'Evita robos de insumos', 'Reportes listos para exportar']
  },
  productor_mediano: {
    title: 'Digitaliza tu finca sin contratar ingenieros.',
    subtitle: 'Toda la potencia de una oficina técnica en tu WhatsApp.',
    heroImageDesc: 'Asistente personal de campo 24/7.',
    problem: 'Quieres tecnificarte pero no tienes tiempo de aprender programas complicados ni de contratar gente extra.',
    solution: 'Tú hablas, Wasagro anota. Es como tener un asistente que nunca duerme.',
    features: [
      { icon: Cloud, title: 'Alertas Climáticas', desc: 'Pronósticos locales para planificar tus aplicaciones.' },
      { icon: Droplets, title: 'Registro de Labores', desc: 'Lleva el historial de todo lo que haces tú y tu gente.' },
      { icon: CheckCircle, title: 'Reporte Semanal', desc: 'Recibe un PDF cada domingo con el resumen de tu semana.' }
    ],
    benefits: ['Orden total en tu finca', 'Evita errores de dosis', 'Más tiempo para tu familia']
  },
  productor_pequeno_self: {
    title: 'Tu cuaderno de campo, ahora inteligente.',
    subtitle: 'Registra tus labores con solo mandar un audio.',
    heroImageDesc: 'Simple. Rápido. En tu idioma.',
    problem: 'Llevar registros en papel es aburrido y las hojas siempre se pierden o se mojan.',
    solution: 'Usa el mismo WhatsApp que usas para hablar con tu familia para anotar tus cosechas y gastos.',
    features: [
      { icon: Mic, title: 'Solo habla', desc: 'No necesitas escribir ni saber de computadoras.' },
      { icon: DollarSign, title: 'Control de Ventas', desc: 'Anota cuánto vendiste y a qué precio al instante.' },
      { icon: Leaf, title: 'Mejores cosechas', desc: 'Recibe consejos y alertas para cuidar tu cultivo.' }
    ],
    benefits: ['Nunca pierdes un dato', 'Sabe cuánto ganas de verdad', 'Totalmente gratis para probar']
  },
  productor_pequeno_staff: {
    title: 'Sabe qué pasa en tu finca, aunque no estés ahí.',
    subtitle: 'Tus trabajadores reportan, tú recibes el control.',
    heroImageDesc: 'Ojos en tu finca desde cualquier lugar.',
    problem: 'Tus trabajadores tienen el dato, pero no te lo dicen a tiempo o se les olvida anotarlo.',
    solution: 'Ellos solo mandan un audio cuando terminan la labor. Tú ves el reporte en tu celular.',
    features: [
      { icon: ShieldCheck, title: 'Prueba de Trabajo', desc: 'Fotos y audios que confirman que la labor se hizo.' },
      { icon: AlertTriangle, title: 'Alertas de Plaga', desc: 'Si ven algo raro, te enteras al segundo con una foto.' },
      { icon: CheckCircle, title: 'Historial de Lotes', desc: 'Sabe qué se le echó a cada planta y cuándo.' }
    ],
    benefits: ['Duerme tranquilo', 'Controla a distancia', 'Evita pérdidas por descuido']
  }
}

const DEFAULT_SEGMENT = SEGMENTS.exportadora!

// ─────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────

function FadeUp({ children, delay = 0, className = '' }: { children: React.ReactNode, delay?: number, className?: string }) {
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

function LogoMark({ size = 28, onDark = false }: { size?: number; onDark?: boolean }) {
  const w = Math.round(size * 0.6); const h = Math.round(size * 1.18)
  return (
    <svg viewBox="0 -22 60 96" width={w} height={h} fill="none" aria-hidden="true">
      <path d="M8,8 L18,72 L30,36 L42,72 L52,8" stroke={onDark ? '#F5F1E8' : '#1B3D24'} strokeWidth="10.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="30" cy="-6" r="12" fill="#C9F03B" />
    </svg>
  )
}

const WA_LINK = 'https://wa.me/50672134878?text=Hola%2C%20quiero%20empezar%20con%20Wasagro'

export default function Brochure() {
  const [searchParams] = useSearchParams()
  const segmentKey = searchParams.get('segment') || 'exportadora'
  const content = SEGMENTS[segmentKey] || DEFAULT_SEGMENT

  return (
    <div className="min-h-screen dot-grid" style={{ background: '#F5F1E8', fontFamily: 'Space Grotesk, sans-serif' }}>
      {/* HEADER */}
      <header className="border-b-2 border-negro py-6 sticky top-0 bg-[#F5F1E8]/90 backdrop-blur-md z-50">
        <div className="max-w-4xl mx-auto px-6 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <LogoMark size={26} />
            <span className="font-bold tracking-[-0.03em] text-[20px]">Wasagro<span style={{ color: '#C9F03B' }}>.</span></span>
          </div>
          <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold bg-negro text-pergamino border-2 border-negro rounded-md shadow-hard-sm">
            Solicitar demo
            <ArrowRight size={13} strokeWidth={2.5} />
          </a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        {/* HERO */}
        <FadeUp>
          <div className="flex items-center gap-2 mb-6">
            <div className="bg-negro text-senal text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-widest">
              {segmentKey.replace('_', ' ')}
            </div>
          </div>
          <h1 className="font-bold leading-[1.0] tracking-[-0.03em] text-negro mb-6" style={{ fontSize: 'clamp(36px, 6vw, 60px)' }}>
            {content.title}
          </h1>
          <p className="text-[19px] text-n700 leading-[1.6] mb-10 max-w-2xl">
            {content.subtitle}
          </p>
        </FadeUp>

        {/* MOCKUP / AHA MOMENT */}
        <FadeUp delay={0.1}>
          <div className="border-2 border-negro bg-white rounded-3xl overflow-hidden mb-16 shadow-hard-lg relative">
             <div className="bg-negro px-6 py-4 flex items-center justify-between border-b-2 border-negro">
                <div className="flex gap-1.5">
                   <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
                   <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
                   <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
                </div>
                <span className="font-mono text-[11px] text-pergamino/40 tracking-wider">PLATAFORMA WASAGRO V2.5</span>
             </div>
             <div className="p-8 sm:p-12 text-center bg-dot-grid-sm">
                <h3 className="font-bold text-[22px] mb-4 text-negro">{content.heroImageDesc}</h3>
                <div className="inline-flex flex-wrap justify-center gap-3">
                   {content.benefits.map((b, i) => (
                     <div key={i} className="bg-senal text-negro px-4 py-2 rounded-full border-2 border-negro font-bold text-[13px] shadow-hard-xs">
                        {b}
                     </div>
                   ))}
                </div>
                <div className="mt-10 border-2 border-negro rounded-xl p-6 bg-[#F5F1E8] text-left max-w-lg mx-auto">
                   <p className="font-mono text-[12px] text-n400 uppercase mb-3">Último reporte detectado</p>
                   <div className="flex gap-3 items-center">
                      <div className="w-10 h-10 rounded-full bg-negro flex items-center justify-center">
                        <Mic size={16} color="#C9F03B" />
                      </div>
                      <div className="flex-1">
                        <div className="h-2 w-full bg-n300 rounded-full overflow-hidden">
                           <div className="h-full bg-negro w-[75%]" />
                        </div>
                        <p className="text-[11px] mt-1.5 font-bold text-negro tracking-tight">"Se aplicó fertilizante urea 2 sacos lote 4 hoy a las 8am"</p>
                      </div>
                   </div>
                </div>
             </div>
          </div>
        </FadeUp>

        {/* COMPARISON */}
        <div className="grid sm:grid-cols-2 gap-8 mb-16">
          <FadeUp delay={0.2}>
            <div className="p-6 rounded-2xl border-2 border-n300 bg-n100/50">
               <h4 className="font-bold text-n500 text-[14px] uppercase tracking-widest mb-4">El Problema</h4>
               <p className="text-n700 text-[16px] leading-relaxed">{content.problem}</p>
            </div>
          </FadeUp>
          <FadeUp delay={0.3}>
            <div className="p-6 rounded-2xl border-2 border-senal bg-senal/5">
               <h4 className="font-bold text-campo text-[14px] uppercase tracking-widest mb-4">La Solución Wasagro</h4>
               <p className="text-negro font-semibold text-[16px] leading-relaxed">{content.solution}</p>
            </div>
          </FadeUp>
        </div>

        {/* FEATURES */}
        <FadeUp delay={0.4}>
          <h2 className="font-bold text-[32px] mb-8 text-negro">¿Qué obtienes con Wasagro?</h2>
          <div className="grid sm:grid-cols-3 gap-6 mb-16">
            {content.features.map((f, i) => (
              <div key={i} className="p-6 border-2 border-negro rounded-2xl bg-white shadow-hard hover:translate-y-[-4px] transition-transform">
                <div className="w-12 h-12 rounded-xl bg-negro flex items-center justify-center mb-6">
                  <f.icon size={22} color="#C9F03B" strokeWidth={2} />
                </div>
                <h4 className="font-bold text-[17px] mb-3 text-negro">{f.title}</h4>
                <p className="text-[14px] text-n700 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </FadeUp>

        {/* FINAL CTA */}
        <FadeUp delay={0.5}>
          <div className="bg-[#1B3D24] text-pergamino border-2 border-negro rounded-3xl p-10 sm:p-16 text-center relative overflow-hidden">
            <div className="absolute inset-0 dot-grid-light opacity-10 pointer-events-none" />
            <div className="relative z-10">
              <h2 className="font-bold text-[36px] mb-6 leading-tight">Digitaliza tu operación hoy mismo.</h2>
              <p className="text-[18px] text-pergamino/70 mb-10 max-w-xl mx-auto">
                No arriesgues la trazabilidad de tu finca o proyecto. Únete a las empresas que ya están tomando decisiones con datos reales.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-3 px-10 py-5 font-bold text-[17px] bg-[#C9F03B] text-negro border-2 border-negro rounded-2xl transition-all hover:scale-105 shadow-hard">
                  Solicitar acceso vía WhatsApp
                  <ArrowRight size={20} strokeWidth={2.5} />
                </a>
              </div>
              <p className="mt-8 font-mono text-[11px] text-pergamino/30 uppercase tracking-[.2em]">Cacao · Banano · Café · Ganadería</p>
            </div>
          </div>
        </FadeUp>
      </main>

      <footer className="border-t-2 border-negro py-10 text-center bg-white">
        <p className="font-mono text-[12px] text-n400 tracking-wider">© 2025 WASAGRO AGTECH · LATAM</p>
      </footer>
    </div>
  )
}
