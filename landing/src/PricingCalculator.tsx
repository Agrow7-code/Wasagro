import { useState } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, CheckCircle, Minus, Plus } from 'lucide-react'

const PRICE_PER_FINCA = 8
const PRICE_PER_USER = 4

function getBasePrice(fincas: number, usuarios: number): number {
  if (fincas === 1 && usuarios <= 3) return 10
  if (fincas === 1 && usuarios >= 4) return 15
  if (fincas >= 2 && fincas <= 5) return 15
  if (fincas >= 6 && fincas <= 20) return 25
  return 50
}

function calcularPrecio(fincas: number, usuarios: number): number {
  return getBasePrice(fincas, usuarios) + PRICE_PER_FINCA * fincas + PRICE_PER_USER * usuarios
}

function getSegmentLabel(fincas: number, usuarios: number): string {
  if (fincas === 1 && usuarios <= 3) return 'Agricultor'
  if (fincas === 1 && usuarios >= 4) return 'Productor'
  if (fincas >= 2 && fincas <= 5) return 'Productor'
  if (fincas >= 6 && fincas <= 20) return 'Pyme / Agroexportadora'
  return 'Corporativo'
}

function isCorporativo(fincas: number): boolean {
  return fincas >= 21
}

const WA_CTA = 'https://wa.me/50672134878?text=Hola%2C%20quiero%20empezar%20con%20Wasagro'

const BASE_FEATURES = [
  'Eventos ilimitados',
  'Alertas de plaga y clima',
  'Dashboard en tiempo real',
  'Reportes semanales',
  'Captura via WhatsApp',
  'Clasificación inteligente',
]

function getFeatures(fincas: number, usuarios: number): string[] {
  const features = [...BASE_FEATURES]
  if (fincas >= 2 || (fincas === 1 && usuarios >= 4)) {
    features.push('Soporte prioritario')
  }
  if (fincas >= 6) {
    if (!features.includes('Soporte prioritario')) features.push('Soporte prioritario')
    features.push('API para integraciones')
  }
  if (fincas >= 21) {
    features.push('Trazabilidad avanzada')
    features.push('Gestión multi-org')
    features.push('Precio custom')
  }
  return features
}

export function PricingCalculator() {
  const [fincas, setFincas] = useState(1)
  const [usuarios, setUsuarios] = useState(1)

  const price = calcularPrecio(fincas, usuarios)
  const base = getBasePrice(fincas, usuarios)
  const segment = getSegmentLabel(fincas, usuarios)
  const corporate = isCorporativo(fincas)
  const features = getFeatures(fincas, usuarios)

  return (
    <section
      id="precios"
      className="py-24 border-b-2 border-negro dot-grid"
      style={{ background: '#EAE6DC' }}
      aria-label="Precios"
    >
      <div className="max-w-6xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="font-mono text-[11px] font-bold tracking-[.14em] uppercase text-n400 mb-3">— Precios</p>
          <h2
            className="font-bold leading-[1.0] tracking-[-0.02em] text-negro mb-5"
            style={{ fontSize: 'clamp(32px, 4.5vw, 56px)' }}
          >
            Tu plan se adapta
            <br />
            <span className="text-campo">a tu operación.</span>
          </h2>
          <p className="text-[17px] text-n700 leading-[1.65] max-w-xl mb-14">
            Precio base + $8 por finca + $4 por usuario. Sin sorpresas. Agregá o quitá fincas y usuarios cuando quieras.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Calculator */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="border-2 border-negro rounded-2xl bg-white shadow-hard overflow-hidden">
              <div className="bg-negro px-6 py-4">
                <p className="font-mono text-[10px] font-bold tracking-[.12em] uppercase text-senal">Calculá tu precio</p>
              </div>

              <div className="p-6">
                {/* Fincas selector */}
                <div className="mb-6">
                  <label className="block text-[14px] font-bold text-negro mb-3">Fincas</label>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => setFincas(Math.max(1, fincas - 1))}
                      disabled={fincas <= 1}
                      className="w-10 h-10 border-2 border-negro rounded-lg bg-negro text-white font-bold text-lg flex items-center justify-center disabled:bg-n200 disabled:border-n200 disabled:text-n400 disabled:cursor-not-allowed hover:bg-campo transition-colors"
                    >
                      <Minus size={16} strokeWidth={3} />
                    </button>
                    <span className="text-[32px] font-extrabold text-negro min-w-[48px] text-center tabular-nums">
                      {fincas}
                    </span>
                    <button
                      onClick={() => setFincas(Math.min(50, fincas + 1))}
                      disabled={fincas >= 50}
                      className="w-10 h-10 border-2 border-negro rounded-lg bg-negro text-white font-bold text-lg flex items-center justify-center disabled:bg-n200 disabled:border-n200 disabled:text-n400 disabled:cursor-not-allowed hover:bg-campo transition-colors"
                    >
                      <Plus size={16} strokeWidth={3} />
                    </button>
                    <span className="text-[13px] text-n400 ml-2">$8 cada una</span>
                  </div>
                </div>

                {/* Usuarios selector */}
                <div className="mb-8">
                  <label className="block text-[14px] font-bold text-negro mb-3">Usuarios</label>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => setUsuarios(Math.max(1, usuarios - 1))}
                      disabled={usuarios <= 1}
                      className="w-10 h-10 border-2 border-negro rounded-lg bg-negro text-white font-bold text-lg flex items-center justify-center disabled:bg-n200 disabled:border-n200 disabled:text-n400 disabled:cursor-not-allowed hover:bg-campo transition-colors"
                    >
                      <Minus size={16} strokeWidth={3} />
                    </button>
                    <span className="text-[32px] font-extrabold text-negro min-w-[48px] text-center tabular-nums">
                      {usuarios}
                    </span>
                    <button
                      onClick={() => setUsuarios(Math.min(100, usuarios + 1))}
                      disabled={usuarios >= 100}
                      className="w-10 h-10 border-2 border-negro rounded-lg bg-negro text-white font-bold text-lg flex items-center justify-center disabled:bg-n200 disabled:border-n200 disabled:text-n400 disabled:cursor-not-allowed hover:bg-campo transition-colors"
                    >
                      <Plus size={16} strokeWidth={3} />
                    </button>
                    <span className="text-[13px] text-n400 ml-2">$4 cada uno</span>
                  </div>
                </div>

                {/* Breakdown */}
                <div className="border-2 border-negro rounded-xl p-5 bg-pergamino">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-[14px] font-bold text-negro">Segmento: {segment}</span>
                  </div>

                  <div className="grid gap-2 mb-4">
                    {[
                      { label: 'Base', value: `$${base}` },
                      { label: `${fincas} finca${fincas > 1 ? 's' : ''}`, value: `$${PRICE_PER_FINCA * fincas}` },
                      { label: `${usuarios} usuario${usuarios > 1 ? 's' : ''}`, value: `$${PRICE_PER_USER * usuarios}` },
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between">
                        <span className="text-[14px] text-n400">{row.label}</span>
                        <span className="text-[14px] font-semibold text-negro">{row.value}</span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t-2 border-negro pt-3 flex justify-between items-center">
                    <span className="text-[16px] font-bold text-negro">Total mensual</span>
                    {corporate ? (
                      <div className="text-right">
                        <span className="text-[28px] font-extrabold text-negro">${price}</span>
                        <span className="text-[14px] font-medium text-n400">/mes</span>
                        <p className="text-[11px] text-n400 mt-1">Precio de referencia — contáctanos</p>
                      </div>
                    ) : (
                      <span className="text-[28px] font-extrabold text-negro">
                        ${price}<span className="text-[14px] font-medium text-n400">/mes</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* CTA */}
                <a
                  href={WA_CTA}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full mt-6 py-3.5 font-bold text-[15px] bg-negro text-pergamino border-2 border-negro rounded-xl shadow-hard-sm hover:translate-x-[-2px] hover:translate-y-[-2px] transition-transform duration-100"
                >
                  {corporate ? 'Hablar con ventas' : 'Empezar ahora'}
                  <ArrowRight size={15} strokeWidth={2.5} />
                </a>
              </div>
            </div>
          </motion.div>

          {/* Features */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-5"
          >
            {/* Segment card */}
            <div
              className={`border-2 rounded-2xl p-7 shadow-hard flex-1 ${
                corporate ? 'bg-negro border-senal' : 'bg-white border-negro'
              }`}
            >
              <div
                className={`inline-block font-mono text-[10px] font-bold tracking-[.12em] uppercase px-3 py-1 rounded-full mb-4 ${
                  corporate ? 'bg-senal text-negro' : 'bg-senal/15 text-campo'
                }`}
              >
                {segment}
              </div>

              <h3 className={`font-bold text-[18px] mb-5 ${corporate ? 'text-pergamino' : 'text-negro'}`}>
                {corporate ? 'Plan a medida para tu operación' : 'Todo lo que necesitás incluido'}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {features.map((f) => (
                  <div key={f} className="flex items-center gap-2.5">
                    <CheckCircle
                      size={15}
                      color={corporate ? '#C9F03B' : '#3EBB6A'}
                      strokeWidth={2.5}
                      className="flex-shrink-0"
                    />
                    <span className={`text-[13px] leading-snug ${corporate ? 'text-pergamino/80' : 'text-n700'}`}>
                      {f}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick comparison */}
            <div className="border-2 border-negro rounded-2xl bg-white shadow-hard p-6">
              <p className="font-mono text-[10px] font-bold tracking-[.12em] uppercase text-n400 mb-4">Rangos de precio</p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { name: 'Agricultor', hint: '1 finca, 1-3 usuarios', from: 22, to: 30 },
                  { name: 'Productor', hint: '1-5 fincas', from: 31, to: 79 },
                  { name: 'Pyme', hint: '6-20 fincas', from: 81, to: 258 },
                  { name: 'Corporativo', hint: '21+ fincas', from: 274, to: null },
                ].map((tier) => (
                  <div key={tier.name} className="border border-negro/15 rounded-lg p-3">
                    <p className="text-[13px] font-bold text-negro">{tier.name}</p>
                    <p className="text-[11px] text-n400 mb-1">{tier.hint}</p>
                    <p className="text-[15px] font-extrabold text-campo">
                      ${tier.from}{tier.to ? `–$${tier.to}` : '+'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
