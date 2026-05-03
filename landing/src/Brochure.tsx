import { motion, AnimatePresence, useMotionValue, useTransform } from 'motion/react'
import { useSearchParams } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import {
  ArrowRight, FileText, CheckCircle, BarChart3, Cloud,
  Droplets, Grid3x3, Leaf, Zap, AlertTriangle,
  ShieldCheck, Banknote, Building2, Users, User, DollarSign, Mic,
  MessageSquare, Cpu, Database
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────
// WHATSAPP DEMO — segment-aware conversation
// ─────────────────────────────────────────────────────────────

type ChatMessage =
  | { from: 'user'; type: 'audio'; label: string; waveform?: true }
  | { from: 'user'; type: 'text'; text: string }
  | { from: 'bot'; type: 'thinking' }
  | { from: 'bot'; type: 'text'; text: string }
  | { from: 'bot'; type: 'card'; title: string; rows: Array<{ label: string; value: string; highlight?: boolean }> }

const WA_DEMOS: Record<string, ChatMessage[]> = {
  exportadora: [
    { from: 'user', type: 'audio', label: '0:08', waveform: true },
    { from: 'bot', type: 'thinking' },
    { from: 'bot', type: 'text', text: '✅ Reporte recibido. Procesando trazabilidad...' },
    { from: 'bot', type: 'card', title: 'Evento registrado — Lote 7B', rows: [
      { label: 'Labor', value: 'Aplicación Urea 46%' },
      { label: 'Cantidad', value: '3 sacos · 150 kg' },
      { label: 'Coordenadas', value: '0.1234° N, 79.5678° O', highlight: true },
      { label: 'Polígono EUDR', value: '✓ Verificado', highlight: true },
      { label: 'Timestamp', value: 'Hoy 07:42 AM' },
    ]},
  ],
  ong: [
    { from: 'user', type: 'audio', label: '0:11', waveform: true },
    { from: 'bot', type: 'thinking' },
    { from: 'bot', type: 'text', text: '✅ Práctica registrada. Calculando adopción...' },
    { from: 'bot', type: 'card', title: 'Adopción técnica — Juan Pérez', rows: [
      { label: 'Técnica', value: 'Aplicación bioinsumo Trichoderma' },
      { label: 'Dosis', value: '2 kg · conforme protocolo', highlight: true },
      { label: 'Cultivo', value: 'Cacao CCN-51' },
      { label: 'Semana #', value: '3 de 12 del proyecto' },
      { label: 'Evidencia', value: 'Audio + foto ✓', highlight: true },
    ]},
  ],
  banco: [
    { from: 'user', type: 'audio', label: '0:06', waveform: true },
    { from: 'bot', type: 'thinking' },
    { from: 'bot', type: 'text', text: '✅ Actividad verificada. Actualizando expediente crediticio...' },
    { from: 'bot', type: 'card', title: 'Verificación de inversión — Crédito #4821', rows: [
      { label: 'Insumo aplicado', value: 'Fertilizante Urea 46%' },
      { label: 'Valor verificado', value: '$312.00 USD', highlight: true },
      { label: 'Coincide con plan', value: '✓ Sí — semana 6/12', highlight: true },
      { label: 'Riesgo actualizado', value: 'BAJO 🟢' },
      { label: 'Próx. verificación', value: '14 días' },
    ]},
  ],
  fintech: [
    { from: 'user', type: 'text', text: 'POST /api/v1/events?finca_id=F004' },
    { from: 'bot', type: 'thinking' },
    { from: 'bot', type: 'card', title: 'API Response 200 OK', rows: [
      { label: 'event_type', value: 'aplicacion_insumo' },
      { label: 'producto', value: 'Urea 46%' },
      { label: 'cantidad_kg', value: '150', highlight: true },
      { label: 'geo_verified', value: 'true', highlight: true },
      { label: 'confidence_score', value: '0.94' },
      { label: 'eudr_compliant', value: 'true' },
    ]},
  ],
  asociacion: [
    { from: 'user', type: 'audio', label: '0:09', waveform: true },
    { from: 'bot', type: 'thinking' },
    { from: 'bot', type: 'text', text: '✅ Cosecha registrada. Actualizando oferta agregada...' },
    { from: 'bot', type: 'card', title: 'Producción — Semana 18', rows: [
      { label: 'Socio', value: 'Carlos Mendoza · Finca El Prado' },
      { label: 'Cosecha', value: '18 quintales cacao húmedo' },
      { label: 'Calidad', value: 'Fermentación 5 días ✓', highlight: true },
      { label: 'Acumulado zona', value: '347 qq · 23 socios', highlight: true },
      { label: 'Demanda insumos', value: 'Proyección actualizada ✓' },
    ]},
  ],
  productor_grande: [
    { from: 'user', type: 'audio', label: '0:07', waveform: true },
    { from: 'bot', type: 'thinking' },
    { from: 'bot', type: 'text', text: '✅ Labor registrada. Actualizando costos por lote...' },
    { from: 'bot', type: 'card', title: 'Costo real — Lote Sector Norte', rows: [
      { label: 'Labor', value: '4 jornales · deshierba' },
      { label: 'Costo', value: '$48.00 USD hoy', highlight: true },
      { label: 'Acumulado mes', value: '$312.00 USD este lote' },
      { label: 'Insumos aplicados', value: 'Glifosato 2L', highlight: true },
      { label: 'Avance cuadrilla', value: '6/10 has completadas' },
    ]},
  ],
  productor_mediano: [
    { from: 'user', type: 'audio', label: '0:10', waveform: true },
    { from: 'bot', type: 'thinking' },
    { from: 'bot', type: 'text', text: '✅ Anotado. Acá está tu registro de hoy 👇' },
    { from: 'bot', type: 'card', title: 'Tu resumen de hoy', rows: [
      { label: 'Aplicación', value: 'Cipermetrina 0.5L · Lote 2' },
      { label: 'Trabajadores', value: '2 personas · mañana' },
      { label: 'Alerta ⚠️', value: 'Dosis alta — revisar ficha', highlight: true },
      { label: 'Stock bodega', value: '1.5L Cipermetrina restantes' },
      { label: 'Próximo vencimiento', value: 'Aplicación preventiva en 12 días' },
    ]},
  ],
  productor_pequeno_self: [
    { from: 'user', type: 'audio', label: '0:05', waveform: true },
    { from: 'bot', type: 'thinking' },
    { from: 'bot', type: 'text', text: '✅ ¡Listo! Guardé tu reporte. Así quedó 👇' },
    { from: 'bot', type: 'card', title: 'Tu anotación de hoy', rows: [
      { label: 'Qué hiciste', value: 'Cosecha — 4 canastos cacao' },
      { label: 'Cuánto', value: '~80 kg estimados' },
      { label: 'Precio mercado', value: '$1.20/kg hoy', highlight: true },
      { label: 'Tu ganancia est.', value: '$96.00 esta cosecha', highlight: true },
      { label: 'Total este mes', value: '$274.00 acumulados' },
    ]},
  ],
  productor_pequeno_staff: [
    { from: 'user', type: 'audio', label: '0:08', waveform: true },
    { from: 'bot', type: 'thinking' },
    { from: 'bot', type: 'text', text: '✅ El reporte llegó a tu patrón. ¡Buen trabajo!' },
    { from: 'bot', type: 'card', title: 'Reporte enviado al dueño', rows: [
      { label: 'Labor', value: 'Podas — Sector B completo' },
      { label: 'Trabajadores', value: '3 personas · 8 hrs' },
      { label: 'Foto enviada', value: '✓ Evidencia guardada', highlight: true },
      { label: 'Alerta detectada', value: '⚠️ Moniliasis en 2 plantas', highlight: true },
      { label: 'Estado', value: 'Dueño notificado al instante' },
    ]},
  ],
}

// ─────────────────────────────────────────────────────────────
// SEGMENT DEFINITIONS
// ─────────────────────────────────────────────────────────────

type SegmentContent = {
  label: string
  title: string
  subtitle: string
  problem: { headline: string; body: string }
  solution: { headline: string; body: string }
  features: Array<{ icon: any; title: string; desc: string }>
  proof: Array<{ value: string; label: string }>
  ctaLabel: string
  ctaHref: string
}

const WA_BASE = 'https://wa.me/50672134878?text='

const SEGMENTS: Record<string, SegmentContent> = {
  exportadora: {
    label: 'Exportadora',
    title: 'Sin trazabilidad, un rechazo en puerto cuesta más que todo tu software del año.',
    subtitle: 'Wasagro digitaliza tus fincas proveedoras desde WhatsApp. Cero hardware, cero capacitación técnica.',
    problem: {
      headline: 'El papel no cumple con EUDR.',
      body: 'Tus agricultores llevan registros en cuadernos que se mojan, se pierden o llegan con semanas de retraso. Cuando necesitás presentar evidencia de dónde vino el cacao, no tenés nada que mostrar.',
    },
    solution: {
      headline: 'Cada audio es un registro de trazabilidad.',
      body: 'El trabajador habla al WhatsApp de siempre. Wasagro transcribe, estructura y georreferencia el evento en menos de 30 segundos. Tu dashboard muestra el polígono en tiempo real.',
    },
    features: [
      { icon: ShieldCheck, title: 'Cumplimiento EUDR automático', desc: 'Polígonos georreferenciados y cadena de custodia documentada por cada lote sin formularios extras.' },
      { icon: BarChart3, title: 'Dashboard de todas tus fincas', desc: 'Vista consolidada de insumos, cosechas y alertas de plaga. Una pantalla, cientos de fincas.' },
      { icon: FileText, title: 'Expedientes listos para auditoría', desc: 'Exportá el historial completo de cualquier finca en un click. PDF o CSV, el formato que pida el certificador.' },
    ],
    proof: [
      { value: '<30s', label: 'De audio a dato estructurado' },
      { value: '85%+', label: 'Precisión de extracción' },
      { value: '0', label: 'Hardware necesario' },
    ],
    ctaLabel: 'Agendar demo con el equipo',
    ctaHref: WA_BASE + 'Hola%2C+soy+exportadora+y+quiero+una+demo+de+Wasagro',
  },

  ong: {
    label: 'ONG / Proyecto',
    title: 'Tus técnicos cubren 3x más familias cuando el campo se reporta solo.',
    subtitle: 'Evidencia directa de adopción para donantes, sin depender de visitas presenciales costosas.',
    problem: {
      headline: 'No sabés si las técnicas que enseñaste se están aplicando.',
      body: 'Las visitas de campo son caras y escasas. Entre visita y visita, no tenés forma de saber si los agricultores están siguiendo el protocolo del proyecto.',
    },
    solution: {
      headline: 'El campo reporta en tiempo real vía WhatsApp.',
      body: 'Los beneficiarios mandan audio o foto cuando hacen la práctica. Wasagro estructura el evento, calcula la tasa de adopción y actualiza el dashboard del proyecto automáticamente.',
    },
    features: [
      { icon: Users, title: 'Monitoreo de adopción técnica', desc: 'Sabe qué porcentaje de beneficiarios está aplicando bioinsumos, buenas prácticas o técnicas sostenibles esta semana.' },
      { icon: Cloud, title: 'Alertas de resiliencia climática', desc: 'Detecta eventos adversos reportados por los agricultores antes de que impacten la cosecha del proyecto.' },
      { icon: BarChart3, title: 'Reportes para donantes listos', desc: 'Genera evidencia cuantitativa de impacto con los datos del campo. Nada que inventar, todo trazable.' },
    ],
    proof: [
      { value: '3x', label: 'Alcance por técnico de campo' },
      { value: '100%', label: 'Evidencia trazable' },
      { value: '0 papel', label: 'En toda la operación' },
    ],
    ctaLabel: 'Ver cómo funciona para proyectos',
    ctaHref: WA_BASE + 'Hola%2C+tengo+una+ONG+y+quiero+ver+c%C3%B3mo+funciona+Wasagro',
  },

  banco: {
    label: 'Banco / Cooperativa',
    title: 'El crédito agro que no podés monitorear es el que más probabilidad tiene de no pagarse.',
    subtitle: 'Wasagro te da visibilidad continua de la inversión sin multiplicar las visitas de campo.',
    problem: {
      headline: 'Una vez entregado el crédito, perdés la visibilidad.',
      body: 'Las visitas físicas son costosas y cubren una fracción de la cartera. El resto es una caja negra hasta que el cliente deja de pagar.',
    },
    solution: {
      headline: 'Ojos en la finca sin mandar un técnico.',
      body: 'El agricultor reporta su actividad por WhatsApp. Wasagro verifica que el insumo financiado se aplicó, detecta plagas antes de que afecten la cosecha, y actualiza el score de riesgo automáticamente.',
    },
    features: [
      { icon: Banknote, title: 'Verificación de destino del crédito', desc: 'Comprobá que el dinero se usó en los insumos acordados. Cada aplicación genera evidencia con timestamp y coordenadas.' },
      { icon: AlertTriangle, title: 'Alertas de siniestro anticipadas', desc: 'Enterate de plagas o daños climáticos antes que el cliente deje de pagar. Actúa antes, no después.' },
      { icon: ShieldCheck, title: 'Historial crediticio productivo', desc: 'Construí un score basado en productividad real, no solo en promesas. Datos para renovar o rechazar con evidencia.' },
    ],
    proof: [
      { value: '↓ mora', label: 'Con monitoreo activo' },
      { value: '10x', label: 'Fincas por técnico de campo' },
      { value: 'Real-time', label: 'Score de riesgo dinámico' },
    ],
    ctaLabel: 'Hablar con el equipo comercial',
    ctaHref: WA_BASE + 'Hola%2C+soy+de+un+banco+y+quiero+info+sobre+Wasagro',
  },

  fintech: {
    label: 'Fintech Agro',
    title: 'Sin datos de campo estructurados, tu modelo de riesgo agro está adivinando.',
    subtitle: 'La API que conecta eventos reales del campo con tu motor de crédito en tiempo real.',
    problem: {
      headline: 'Los datos agropecuarios no existen o son mentira.',
      body: 'Los formularios que llenan los clientes son autodeclarados, subjetivos e imposibles de verificar. Tu modelo de scoring funciona sobre supuestos, no sobre datos.',
    },
    solution: {
      headline: 'Datos verificados directamente del campo.',
      body: 'Wasagro captura eventos reales — aplicaciones, cosechas, labores — con georreferencia, timestamp y confianza de extracción. Via API, los integrás a tu motor de riesgo en minutos.',
    },
    features: [
      { icon: Zap, title: 'API de eventos productivos', desc: 'Integra labor, cosecha y aplicación de insumos con confidence_score y geolocalización a tu plataforma.' },
      { icon: ShieldCheck, title: 'Prueba de vida del cultivo', desc: 'Fotos georreferenciadas que confirman que el cultivo existe y está activo. Sin visitas físicas.' },
      { icon: BarChart3, title: 'Historial productivo por finca', desc: 'Series temporales de datos para modelos predictivos. Cuánto produce, cuánto gasta, qué riesgo tiene.' },
    ],
    proof: [
      { value: 'REST API', label: 'Integración en días' },
      { value: '0.94', label: 'Confidence score promedio' },
      { value: 'EUDR', label: 'Datos certificables' },
    ],
    ctaLabel: 'Ver documentación de la API',
    ctaHref: WA_BASE + 'Hola%2C+soy+fintech+y+quiero+info+de+la+API+de+Wasagro',
  },

  asociacion: {
    label: 'Asociación / Cooperativa',
    title: 'No podés negociar bien si no sabés cuánto van a cosechar tus socios.',
    subtitle: 'Wasagro unifica la producción de todos tus miembros en tiempo real, sin planillas ni visitas.',
    problem: {
      headline: 'Siempre llegás tarde con los datos de tus socios.',
      body: 'Cuando vas a negociar precio o comprar insumos al por mayor, los datos de producción de tus asociados tienen semanas de retraso o son estimaciones a ojo.',
    },
    solution: {
      headline: 'Proyección de cosecha en tiempo real desde el campo.',
      body: 'Tus socios reportan por WhatsApp lo que hacen cada día. Wasagro agrega la producción, detecta brotes de plaga en la zona y proyecta la oferta semanal de toda la asociación.',
    },
    features: [
      { icon: Leaf, title: 'Oferta agregada en tiempo real', desc: 'Sabé cuántas toneladas van a cosechar tus socios la próxima semana antes de negociar con el comprador.' },
      { icon: Users, title: 'Proyección de demanda de insumos', desc: 'Planificá compras centralizadas con datos reales de consumo. Mejor precio por volumen, menos desperdicio.' },
      { icon: AlertTriangle, title: 'Alertas comunitarias de plaga', desc: 'Si un socio detecta Monilia, avisás a toda la zona en minutos. Evitás el contagio antes de que se expanda.' },
    ],
    proof: [
      { value: 'Real-time', label: 'Oferta agregada de la zona' },
      { value: '+30%', label: 'Poder de negociación' },
      { value: '0 planillas', label: 'En toda la operación' },
    ],
    ctaLabel: 'Hablar con el equipo',
    ctaHref: WA_BASE + 'Hola%2C+tengo+una+asociaci%C3%B3n+y+quiero+info+de+Wasagro',
  },

  productor_grande: {
    label: 'Productor Grande',
    title: 'Cientos de hectáreas. ¿Cuánto gastaste hoy en el lote norte? ¿No sabés?',
    subtitle: 'Control de costos por lote en tiempo real, sin planillas de papel ni reportes que llegan tarde.',
    problem: {
      headline: 'Los datos tardan días en llegar de la cuadrilla a la oficina.',
      body: 'Tu gente anota en papel. El papel llega a la tarde. Lo digitás vos o tu asistente. Para cuando tenés el número real, ya pasaron dos días y la decisión hay que tomarla igual.',
    },
    solution: {
      headline: 'El lote reporta al terminar la labor, no dos días después.',
      body: 'Tu cuadrilla manda un audio de 10 segundos cuando termina. Wasagro convierte eso en costo, insumo y avance por lote. Vos lo ves en tu celular en tiempo real.',
    },
    features: [
      { icon: DollarSign, title: 'Costos reales por lote y por día', desc: 'Sabe exactamente cuánto gastás en jornales, insumos y horas máquina en cada hectárea hoy, no la semana que viene.' },
      { icon: Zap, title: 'Gestión de cuadrillas sin radio', desc: 'Monitorea el avance de labores, detecta quién reportó y quién no. Sin ir al campo.' },
      { icon: BarChart3, title: 'Tableros para gerencia y bancos', desc: 'Exporta estados de la operación para presentaciones, créditos o socio. Datos listos, no estimaciones.' },
    ],
    proof: [
      { value: '<30s', label: 'De labor a dato registrado' },
      { value: 'Por lote', label: 'Costos desglosados' },
      { value: '0 papel', label: 'En toda la operación' },
    ],
    ctaLabel: 'Solicitar demo operativa',
    ctaHref: WA_BASE + 'Hola%2C+tengo+una+finca+grande+y+quiero+una+demo+de+Wasagro',
  },

  productor_mediano: {
    label: 'Productor Mediano',
    title: 'Tenés una finca que funciona. Wasagro la hace funcionar mejor, sin contratar a nadie más.',
    subtitle: 'Asistente técnico por WhatsApp que anota, alerta y resume tu semana. Vos solo hablás.',
    problem: {
      headline: 'Querés organizarte mejor, pero no tenés tiempo para aprender software.',
      body: 'Ya probaste planillas, apps y grupitos de WhatsApp. Siempre terminan abandonados porque son un trabajo extra encima de todos los demás.',
    },
    solution: {
      headline: 'Solo hablás. Wasagro hace el resto.',
      body: 'Mandás un audio cuando terminás una labor, como si le hablaras a un empleado de confianza. Wasagro anota, detecta alertas, y te manda un resumen cada semana.',
    },
    features: [
      { icon: Mic, title: 'Solo voz, sin formularios', desc: 'Hablás como siempre. Wasagro entiende jerga agrícola local, nombres coloquiales de productos y todo.' },
      { icon: AlertTriangle, title: 'Alertas de dosis y fechas', desc: 'Si aplicás más de lo recomendado o hay algo fuera de lo normal, te avisamos antes de que sea un problema.' },
      { icon: CheckCircle, title: 'Resumen semanal automático', desc: 'Cada lunes recibís un resumen de tu semana: qué hiciste, cuánto gastaste, qué viene. Sin hacer nada.' },
    ],
    proof: [
      { value: '5 min/día', label: 'Lo que tardás en reportar' },
      { value: 'Cero', label: 'Capacitación necesaria' },
      { value: 'Domingo', label: 'Resumen automático en WhatsApp' },
    ],
    ctaLabel: 'Probarlo gratis por WhatsApp',
    ctaHref: WA_BASE + 'Hola%2C+quiero+probar+Wasagro+para+mi+finca',
  },

  productor_pequeno_self: {
    label: 'Pequeño Productor',
    title: '¿Cuánto ganaste este mes de verdad? Si no lo tenés anotado, no lo sabés.',
    subtitle: 'Tu cuaderno de campo, ahora en WhatsApp. Solo hablás, Wasagro anota.',
    problem: {
      headline: 'Llevar registros en papel es aburrido. Y siempre se pierden.',
      body: 'Sabés que deberías anotar lo que cosechás y lo que gastás. Pero después de un día en el campo, nadie quiere llenar cuadernos.',
    },
    solution: {
      headline: 'Un audio de 5 segundos y listo.',
      body: 'Decís "cosechié 3 canastos hoy" y Wasagro anota, guarda y suma. Al final del mes ves cuánto ganaste de verdad.',
    },
    features: [
      { icon: Mic, title: 'Solo hablás, nada más', desc: 'No necesitás saber de tecnología. Si podés mandar un mensaje de voz, podés usar Wasagro.' },
      { icon: DollarSign, title: 'Ves cuánto ganás de verdad', desc: 'Wasagro suma tus cosechas, resta tus gastos y te dice cuánto te quedó en el bolsillo este mes.' },
      { icon: Leaf, title: 'Consejos cuando los necesitás', desc: 'Si mandás foto de una planta enferma, Wasagro te dice qué tiene y qué hacer. Gratis.' },
    ],
    proof: [
      { value: '5 seg', label: 'Para registrar una labor' },
      { value: 'Gratis', label: 'Para empezar hoy' },
      { value: 'Sin papel', label: 'Sin lápiz, sin cuadernos' },
    ],
    ctaLabel: 'Empezar gratis ahora',
    ctaHref: WA_BASE + 'Hola%2C+quiero+empezar+con+Wasagro+gratis',
  },

  productor_pequeno_staff: {
    label: 'Pequeño Productor con Personal',
    title: 'Tus trabajadores saben qué pasó hoy. Vos no. Así se pierden datos, insumos y plata.',
    subtitle: 'Ellos reportan por WhatsApp cuando terminan. Vos ves todo desde donde estés.',
    problem: {
      headline: 'Cuando llegás a la finca, ya es tarde para corregir.',
      body: 'No podés estar en la finca todo el tiempo. Y cuando no estás, los datos se pierden: nadie anota cuánto se usó, si la plaga avanzó, si la labor se terminó.',
    },
    solution: {
      headline: 'Tus trabajadores reportan, vos controlás.',
      body: 'Ellos mandan un audio al terminar cada labor. Vos recibís el resumen en tu celular. Si algo está raro — una plaga, una dosis alta — te llega una alerta al instante.',
    },
    features: [
      { icon: ShieldCheck, title: 'Evidencia de cada labor', desc: 'Foto y audio que confirman que la tarea se hizo. Nunca más "se supone que lo hicieron".' },
      { icon: AlertTriangle, title: 'Alertas de plaga al instante', desc: 'Si tu trabajador ve algo raro y te manda foto, Wasagro te notifica en segundos con qué es y qué hacer.' },
      { icon: CheckCircle, title: 'Historial completo por lote', desc: 'Sabe qué se le hizo a cada planta, cuándo y cuánto costó. Todo guardado, sin pedírselo a nadie.' },
    ],
    proof: [
      { value: 'Instantáneo', label: 'Alerta de plaga al celular' },
      { value: 'Por lote', label: 'Historial de labores' },
      { value: '0 papel', label: 'En tu finca' },
    ],
    ctaLabel: 'Empezar gratis ahora',
    ctaHref: WA_BASE + 'Hola%2C+quiero+empezar+con+Wasagro+para+mi+finca+con+personal',
  },
}

const DEFAULT_SEGMENT_KEY = 'exportadora'

// ─────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────

function useScrollProgress() {
  const scrollYProgress = useMotionValue(0)

  useEffect(() => {
    const updateProgress = () => {
      const scrollTop = window.scrollY
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      scrollYProgress.set(docHeight > 0 ? scrollTop / docHeight : 0)
    }
    window.addEventListener('scroll', updateProgress, { passive: true })
    updateProgress()
    return () => window.removeEventListener('scroll', updateProgress)
  }, [scrollYProgress])

  return scrollYProgress
}

// ─────────────────────────────────────────────────────────────
// SHARED COMPONENTS
// ─────────────────────────────────────────────────────────────

function FadeUp({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
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

// ─────────────────────────────────────────────────────────────
// WHATSAPP CHAT SIMULATOR
// ─────────────────────────────────────────────────────────────

function Waveform() {
  const bars = [3, 5, 8, 6, 10, 7, 4, 9, 6, 5, 8, 4, 7, 10, 5, 6, 8, 4, 7, 9]
  return (
    <div className="flex items-center gap-[2px] h-5">
      {bars.map((h, i) => (
        <div key={i} className="w-[2px] rounded-full bg-white/60" style={{ height: `${h * 1.6}px` }} />
      ))}
    </div>
  )
}

function ThinkingDots() {
  return (
    <div className="flex gap-1 items-center px-1 py-1">
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          className="w-2 h-2 rounded-full bg-n400"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{ duration: 0.9, delay: i * 0.2, repeat: Infinity }}
        />
      ))}
    </div>
  )
}

function WAChatSimulator({ messages }: { messages: ChatMessage[] }) {
  const [visible, setVisible] = useState(0)

  useEffect(() => {
    setVisible(0)
    let i = 0
    const delays = messages.map((m) => m.from === 'bot' && m.type === 'thinking' ? 900 : 700)
    const schedule = () => {
      if (i >= messages.length) return
      const delay = delays[i] ?? 700
      setTimeout(() => { setVisible(v => v + 1); i++; schedule() }, delay)
    }
    const start = setTimeout(schedule, 400)
    return () => clearTimeout(start)
  }, [messages])

  return (
    <div className="rounded-2xl overflow-hidden border-2 border-negro shadow-hard-lg">
      {/* WA header */}
      <div className="bg-[#128C7E] px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-[#C9F03B] border-2 border-white/30 flex items-center justify-center">
          <LogoMark size={14} />
        </div>
        <div>
          <p className="text-white font-bold text-[13px] leading-none">Wasagro</p>
          <p className="text-white/70 text-[11px] mt-0.5">en línea</p>
        </div>
        <div className="ml-auto flex gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-[#C9F03B]" />
          <div className="w-1.5 h-1.5 rounded-full bg-[#C9F03B] opacity-60" />
          <div className="w-1.5 h-1.5 rounded-full bg-[#C9F03B] opacity-30" />
        </div>
      </div>

      {/* chat body */}
      <div className="bg-[#ECE5DD] px-4 py-5 flex flex-col gap-3 min-h-[320px]">
        <AnimatePresence mode="popLayout">
          {messages.slice(0, visible).map((msg, i) => {
            if (msg.from === 'user') {
              return (
                <motion.div key={i} className="flex justify-end"
                  initial={{ opacity: 0, x: 20, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  {msg.type === 'audio' ? (
                    <div className="bg-[#DCF8C6] border border-black/10 rounded-xl rounded-tr-sm px-4 py-2.5 max-w-[240px] flex items-center gap-3 shadow-sm">
                      <div className="w-8 h-8 rounded-full bg-[#128C7E] flex items-center justify-center flex-shrink-0">
                        <Mic size={14} color="white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <Waveform />
                        <p className="text-[10px] text-[#667781] mt-1">{msg.label}</p>
                      </div>
                      <span className="text-[10px] text-[#667781] self-end">✓✓</span>
                    </div>
                  ) : (
                    <div className="bg-[#DCF8C6] border border-black/10 rounded-xl rounded-tr-sm px-3 py-2 max-w-[260px] shadow-sm">
                      <p className="font-mono text-[11px] text-negro">{msg.text}</p>
                      <p className="text-[10px] text-[#667781] text-right mt-0.5">✓✓</p>
                    </div>
                  )}
                </motion.div>
              )
            }

            if (msg.from === 'bot' && msg.type === 'thinking') {
              return (
                <motion.div key={i} className="flex justify-start"
                  initial={{ opacity: 0, x: -20, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="bg-white border border-black/10 rounded-xl rounded-tl-sm px-3 py-2 shadow-sm">
                    <ThinkingDots />
                  </div>
                </motion.div>
              )
            }

            if (msg.from === 'bot' && msg.type === 'text') {
              return (
                <motion.div key={i} className="flex justify-start"
                  initial={{ opacity: 0, x: -20, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="bg-white border border-black/10 rounded-xl rounded-tl-sm px-3 py-2.5 max-w-[280px] shadow-sm">
                    <p className="text-[13px] text-negro leading-relaxed">{msg.text}</p>
                    <p className="text-[10px] text-[#667781] text-right mt-0.5">3:42 pm</p>
                  </div>
                </motion.div>
              )
            }

            if (msg.from === 'bot' && msg.type === 'card') {
              return (
                <motion.div key={i} className="flex justify-start"
                  initial={{ opacity: 0, x: -20, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="bg-white border border-black/10 rounded-xl rounded-tl-sm overflow-hidden shadow-sm max-w-[300px]">
                    <div className="bg-negro px-3 py-2">
                      <p className="text-[11px] font-bold text-[#C9F03B] uppercase tracking-wide">{msg.title}</p>
                    </div>
                    <div className="px-3 py-2.5 flex flex-col gap-1.5">
                      {msg.rows.map((row, j) => (
                        <div key={j} className={`flex justify-between gap-4 text-[12px] ${row.highlight ? 'font-bold text-negro' : 'text-[#3A3530]'}`}>
                          <span className="text-[#667781] shrink-0">{row.label}</span>
                          <span className={`text-right ${row.highlight ? 'text-campo' : ''}`}>{row.value}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-[#667781] text-right px-3 pb-2">3:42 pm</p>
                  </div>
                </motion.div>
              )
            }

            return null
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// HOW IT WORKS
// ─────────────────────────────────────────────────────────────

const HOW_STEPS = [
  { icon: Mic, n: '01', title: 'El agricultor habla', desc: 'Manda un audio por WhatsApp de siempre. Nada nuevo que aprender.' },
  { icon: Cpu, n: '02', title: 'La IA estructura el dato', desc: 'Wasagro transcribe, extrae entidades y valida el evento en menos de 30 segundos.' },
  { icon: Database, n: '03', title: 'Vos ves el resultado', desc: 'El dato aparece en tu dashboard, con geolocalización, timestamp y confianza de extracción.' },
]

// ─────────────────────────────────────────────────────────────
// SCROLL PROGRESS BAR
// ─────────────────────────────────────────────────────────────

function ScrollProgressBar() {
  const scrollYProgress = useScrollProgress()
  const scaleX = useTransform(scrollYProgress, [0, 1], [0, 1])

  return (
    <motion.div
      className="fixed top-0 left-0 right-0 h-[3px] z-[60] origin-left"
      style={{
        scaleX,
        transformOrigin: 'left',
        background: '#C9F03B',
      }}
    />
  )
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────

export default function Brochure() {
  const [searchParams] = useSearchParams()
  const segmentKey = searchParams.get('segment') ?? DEFAULT_SEGMENT_KEY
  const content = SEGMENTS[segmentKey] ?? SEGMENTS[DEFAULT_SEGMENT_KEY]!
  const demoMessages = WA_DEMOS[segmentKey] ?? WA_DEMOS[DEFAULT_SEGMENT_KEY]!

  return (
    <div className="min-h-screen dot-grid" style={{ background: '#F5F1E8', fontFamily: 'Space Grotesk, sans-serif' }}>
      {/* SCROLL PROGRESS BAR */}
      <ScrollProgressBar />

      {/* HEADER */}
      <header className="border-b-2 border-negro py-5 sticky top-0 bg-[#F5F1E8]/90 backdrop-blur-md z-50">
        <div className="max-w-4xl mx-auto px-6 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <LogoMark size={26} />
            <span className="font-bold tracking-[-0.03em] text-[20px]">Wasagro<span style={{ color: '#C9F03B' }}>.</span></span>
          </div>
          <a
            href={content.ctaHref}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold bg-negro text-pergamino border-2 border-negro rounded-md shadow-hard-sm hover:translate-y-[-2px] transition-transform"
          >
            {content.ctaLabel}
            <ArrowRight size={13} strokeWidth={2.5} />
          </a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-14 pb-20 md:pb-14">

        {/* HERO */}
        <FadeUp>
          <div className="inline-flex items-center gap-2 mb-7">
            <div className="bg-negro text-senal text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest">
              {content.label}
            </div>
          </div>
          <h1
            className="font-bold leading-[1.05] tracking-[-0.04em] text-negro mb-6"
            style={{ fontSize: 'clamp(32px, 5.5vw, 56px)', fontFeatureSettings: "'ss01'" }}
          >
            {content.title}
          </h1>
          <p className="text-[17px] md:text-[19px] text-n700 leading-[1.65] mb-12 max-w-2xl">
            {content.subtitle}
          </p>
        </FadeUp>

        {/* DEMO SECTION — WhatsApp simulator + proof numbers */}
        <FadeUp delay={0.08}>
          <div className="mb-20">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare size={14} className="text-n400" />
              <span className="font-mono text-[11px] text-n400 uppercase tracking-widest">Demo en vivo</span>
              <span className="flex items-center gap-1 ml-auto">
                <span className="w-2 h-2 rounded-full bg-ok animate-pulse" />
                <span className="font-mono text-[11px] text-ok">procesando</span>
              </span>
            </div>

            {/* Mobile: flex col — chat then horizontal proof numbers. Desktop: side-by-side grid */}
            <div className="flex flex-col gap-6">
              {/* Chat — full width on all sizes */}
              <WAChatSimulator messages={demoMessages} key={segmentKey} />

              {/* Proof numbers — horizontal row on mobile, hidden on md (shown in side column below) */}
              <div className="grid grid-cols-3 md:hidden gap-3">
                {content.proof.map((p, i) => (
                  <motion.div
                    key={i}
                    className="border-2 border-negro rounded-xl p-3 bg-white shadow-hard text-center"
                    initial={{ opacity: 0, y: 10 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.45, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <p className="font-bold text-[18px] leading-none tracking-tight text-campo mb-1">{p.value}</p>
                    <p className="text-[10px] text-n700 leading-snug">{p.label}</p>
                  </motion.div>
                ))}
              </div>

              {/* Desktop side-by-side layout */}
              <div className="hidden md:grid md:grid-cols-[1fr_200px] gap-6 items-start -mt-6">
                {/* Spacer to align with the chat above */}
                <div />
                <div className="flex flex-col gap-4">
                  {content.proof.map((p, i) => (
                    <motion.div
                      key={i}
                      className="border-2 border-negro rounded-2xl p-5 bg-white shadow-hard text-center"
                      initial={{ opacity: 0, y: 10 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.45, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <p className="font-bold text-[28px] leading-none tracking-tight text-campo mb-1">{p.value}</p>
                      <p className="text-[12px] text-n700 leading-snug">{p.label}</p>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </FadeUp>

        {/* HOW IT WORKS */}
        <FadeUp delay={0.1}>
          <div className="mb-20">
            <p className="font-mono text-[11px] text-n400 uppercase tracking-widest mb-4">Cómo funciona</p>
            <div className="grid sm:grid-cols-3 gap-4">
              {HOW_STEPS.map((step, i) => (
                <div key={i} className="relative p-6 border-2 border-negro rounded-2xl bg-white shadow-hard">
                  <span className="font-mono text-[11px] text-n400 absolute top-4 right-4">{step.n}</span>
                  <div className="w-11 h-11 rounded-xl bg-negro flex items-center justify-center mb-5">
                    <step.icon size={20} color="#C9F03B" strokeWidth={2} />
                  </div>
                  <h4 className="font-bold text-[16px] mb-2 text-negro">{step.title}</h4>
                  <p className="text-[13px] text-n700 leading-relaxed">{step.desc}</p>
                  {i < HOW_STEPS.length - 1 && (
                    <div className="hidden sm:block absolute top-1/2 -right-5 z-10">
                      <ArrowRight size={18} className="text-n400" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </FadeUp>

        {/* SECTION DIVIDER */}
        <div className="border-t border-negro/10 mb-20" />

        {/* PROBLEM / SOLUTION */}
        <div className="grid sm:grid-cols-2 gap-6 mb-20">
          <FadeUp delay={0.1}>
            <div className="p-7 rounded-2xl border-2 border-n400/40 bg-n200/40 h-full">
              <p className="font-mono text-[10px] text-n400 uppercase tracking-widest mb-3">El problema</p>
              <h3 className="font-bold text-[18px] text-negro mb-3 leading-snug">{content.problem.headline}</h3>
              <p className="text-[15px] text-n700 leading-relaxed">{content.problem.body}</p>
            </div>
          </FadeUp>
          <FadeUp delay={0.18}>
            <div className="p-7 rounded-2xl border-2 border-senal bg-senal/8 h-full">
              <p className="font-mono text-[10px] text-campo uppercase tracking-widest mb-3">La solución Wasagro</p>
              <h3 className="font-bold text-[18px] text-negro mb-3 leading-snug">{content.solution.headline}</h3>
              <p className="text-[15px] text-negro leading-relaxed">{content.solution.body}</p>
            </div>
          </FadeUp>
        </div>

        {/* SECTION DIVIDER */}
        <div className="border-t border-negro/10 mb-20" />

        {/* FEATURES */}
        <FadeUp delay={0.15}>
          <p className="font-mono text-[11px] text-n400 uppercase tracking-widest mb-4">Qué obtenés</p>
          <div className="grid sm:grid-cols-3 gap-5 mb-20">
            {content.features.map((f, i) => (
              <div
                key={i}
                className="group p-6 border-2 border-negro rounded-2xl bg-white shadow-hard hover:translate-y-[-4px] transition-transform duration-200"
              >
                <div className="w-11 h-11 rounded-xl bg-negro group-hover:bg-campo flex items-center justify-center mb-5 transition-colors duration-200">
                  <f.icon size={20} color="#C9F03B" strokeWidth={2} />
                </div>
                <h4 className="font-bold text-[16px] mb-2.5 text-negro leading-snug">{f.title}</h4>
                <p className="text-[13px] text-n700 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </FadeUp>

        {/* SOCIAL PROOF STRIP */}
        <FadeUp delay={0.1}>
          <div className="mb-20">
            <p className="font-mono text-[11px] text-n400 uppercase tracking-widest mb-4">Compatible con</p>
            <div className="flex flex-wrap gap-3">
              {[
                'EUDR',
                'WhatsApp Business API',
                'Deepgram STT',
                'Supabase',
              ].map((badge) => (
                <span
                  key={badge}
                  className="border border-negro/20 rounded-lg px-4 py-2.5 text-[12px] font-bold text-n700 bg-white"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </FadeUp>

        {/* FINAL CTA */}
        <FadeUp delay={0.2}>
          <div className="bg-[#1B3D24] text-pergamino border-2 border-negro rounded-3xl p-10 sm:p-14 text-center relative overflow-hidden">
            <div className="absolute inset-0 dot-grid-light opacity-10 pointer-events-none" />
            <div className="relative z-10">
              <h2 className="font-bold leading-tight mb-5" style={{ fontSize: 'clamp(28px, 4vw, 40px)' }}>
                Cada día sin datos del campo es un día{' '}
                <span className="text-senal">tomando decisiones a ciegas.</span>
              </h2>
              <p className="text-[17px] text-pergamino/70 mb-10 max-w-xl mx-auto leading-relaxed">
                Empezar toma menos de 10 minutos. No hay hardware, no hay instalaciones, no hay capacitación técnica.
              </p>
              <a
                href={content.ctaHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-3 px-10 py-5 font-bold text-[17px] bg-[#C9F03B] text-negro border-2 border-negro rounded-2xl transition-all hover:scale-105 shadow-hard"
              >
                {content.ctaLabel}
                <ArrowRight size={20} strokeWidth={2.5} />
              </a>
              <p className="mt-8 font-mono text-[11px] text-pergamino/30 uppercase tracking-[.2em]">Cacao · Banano · Café · Ecuador · Guatemala</p>
            </div>
          </div>
        </FadeUp>
      </main>

      <footer className="border-t-2 border-negro py-8 text-center bg-white">
        <div className="flex gap-6 justify-center mb-4">
          <a href="#" className="text-n400 hover:text-negro text-[12px] font-mono transition-colors">Política de privacidad</a>
          <a href="#" className="text-n400 hover:text-negro text-[12px] font-mono transition-colors">Términos de uso</a>
        </div>
        <p className="font-mono text-[12px] text-n400 tracking-wider">© 2026 WASAGRO AGTECH · LATAM</p>
      </footer>

      {/* FLOATING MOBILE CTA */}
      <motion.div
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t-2 border-negro bg-[#F5F1E8]/95 backdrop-blur-md px-4 py-3"
        initial={{ y: 80 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.5, delay: 1.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <a
          href={content.ctaHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full px-6 py-3 font-bold text-[15px] bg-negro text-pergamino border-2 border-negro rounded-xl shadow-hard-sm"
        >
          {content.ctaLabel}
          <ArrowRight size={16} strokeWidth={2.5} />
        </a>
      </motion.div>
    </div>
  )
}
