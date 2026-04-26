import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown, Search, AlertCircle } from 'lucide-react'
import { countries, Country } from './countries'
import { LogoMark, Divider, PrimaryBtn, DesignConfig, WA_LINK } from './DesignComponents'

interface StepTelefonoProps {
  selectedCountry: Country
  setSelectedCountry: (c: Country) => void
  onContinue: (phone: string) => Promise<void>
}

export function StepTelefono({ selectedCountry, setSelectedCountry, onContinue }: StepTelefonoProps) {
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSelector, setShowSelector] = useState(false)
  const [search, setSearch] = useState('')
  const [focused, setFocused] = useState(false)

  const filteredCountries = countries.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.code.includes(search)
  )

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!phone || loading) return

    setError(null)
    setLoading(true)

    try {
      const fullPhone = `${selectedCountry.code}${phone.replace(/\D/g, '')}`
      await onContinue(fullPhone)
    } catch (err: any) {
      setError(err.message || 'Número no registrado en Wasagro. Contacta a tu administrador.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <LogoMark />
      <Divider />
      
      <div className="font-bold text-[22px] mb-2 tracking-tight leading-[1.25]" style={{ color: DesignConfig.colors.tierra }}>
        Ingresa tu número de WhatsApp
      </div>
      <div className="text-sm mb-6 leading-[1.55]" style={{ color: DesignConfig.colors.tierraSuave }}>
        Te enviaremos un código de verificación por WhatsApp.
      </div>

      <div className="relative mb-6">
        <div className="flex">
          {/* Country Selector Button */}
          <button
            type="button"
            onClick={() => setShowSelector(!showSelector)}
            className="w-[116px] h-[52px] flex-shrink-0 flex items-center justify-center gap-1.5 font-bold text-sm transition-all"
            style={{
              background: DesignConfig.colors.marfil,
              border: `2px solid ${error ? DesignConfig.colors.tierraAccent : focused ? DesignConfig.colors.signal : DesignConfig.colors.tierra}`,
              borderRight: 'none',
              borderRadius: '8px 0 0 8px',
              color: DesignConfig.colors.tierra,
              boxShadow: focused && !error ? `4px 4px 0 0 rgba(201,240,59,0.25)` : 'none'
            }}
          >
            <span className="text-lg">{selectedCountry.flag}</span>
            <span>+{selectedCountry.code}</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-40" />
          </button>

          {/* Input */}
          <input
            type="tel"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setError(null); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="999 999 999"
            className="flex-1 h-[52px] px-4 font-mono text-base tracking-[0.05em] outline-none transition-all"
            style={{
              background: error ? '#FFF8F6' : DesignConfig.colors.marfil,
              border: `2px solid ${error ? DesignConfig.colors.tierraAccent : focused ? DesignConfig.colors.signal : DesignConfig.colors.tierra}`,
              borderLeft: 'none',
              borderRadius: '0 8px 8px 0',
              color: error ? DesignConfig.colors.tierraAccent : DesignConfig.colors.tierra,
              boxShadow: focused && !error ? `4px 4px 0 0 rgba(201,240,59,0.25)` : 'none'
            }}
            disabled={loading}
          />
        </div>

        {/* Error Message */}
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-1.5 mt-2 text-[13px] font-medium"
            style={{ color: DesignConfig.colors.tierraAccent }}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </motion.div>
        )}

        {/* Dropdown Selector */}
        <AnimatePresence>
          {showSelector && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowSelector(false)} />
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute top-full left-0 w-full mt-2 z-30 bg-white rounded-lg shadow-2xl border-2 border-black overflow-hidden max-h-[280px] flex flex-col"
              >
                <div className="p-2 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
                  <Search className="w-4 h-4 opacity-30" />
                  <input 
                    autoFocus
                    type="text"
                    placeholder="Buscar..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-transparent border-none focus:ring-0 text-sm font-medium"
                  />
                </div>
                <div className="overflow-y-auto">
                  {filteredCountries.map((c) => (
                    <button
                      key={c.code + c.name}
                      type="button"
                      onClick={() => {
                        setSelectedCountry(c)
                        setShowSelector(false)
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{c.flag}</span>
                        <span className="text-sm font-bold">{c.name}</span>
                      </div>
                      <span className="text-xs font-mono opacity-40">+{c.code}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      <PrimaryBtn 
        loading={loading} 
        disabled={!phone}
        onClick={handleSubmit}
        style={{ marginTop: 20, opacity: !phone ? 0.5 : 1 }}
      >
        Continuar →
      </PrimaryBtn>

      <div className="text-center text-[13px] mt-6" style={{ color: DesignConfig.colors.tierraSuave }}>
        ¿No tienes acceso? Escríbenos a{' '}
        <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="font-bold underline" style={{ color: DesignConfig.colors.campo }}>
          WhatsApp
        </a>
      </div>
    </>
  )
}
