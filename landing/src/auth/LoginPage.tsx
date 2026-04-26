import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useGeolocacion } from './useGeolocacion'
import { useAuth, User } from './useAuth'
import { StepTelefono } from './StepTelefono'
import { StepOTP } from './StepOTP'
import { DotGrid, Panel, DesignConfig } from './DesignComponents'

// URL del backend (vacío para usar rutas relativas en Vercel)
const API_URL = (import.meta as any).env?.VITE_API_URL || ''

export default function LoginPage() {
  const [step, setStep] = useState<'telefono' | 'otp'>('telefono')
  const [phone, setPhone] = useState('')
  const { selectedCountry, setSelectedCountry } = useGeolocacion()
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleRequestOTP = async (fullPhone: string) => {
    const res = await fetch(`${API_URL}/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: fullPhone }),
    })

    let data: any
    try {
      data = await res.json()
    } catch {
      throw new Error('Error de conexión. Intenta de nuevo.')
    }
    if (!res.ok) throw new Error(data.error || 'Error al solicitar código')

    setPhone(fullPhone)
    setStep('otp')
  }

  const handleVerifyOTP = async (code: string) => {
    const res = await fetch(`${API_URL}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    })

    let data: any
    try {
      data = await res.json()
    } catch {
      throw new Error('Error de conexión. Intenta de nuevo.')
    }
    if (!res.ok) throw new Error(data.error || 'Error al verificar código')

    const user = data.user as User
    login(user)

    // Redirección por rol
    switch (user.rol) {
      case 'administrador':
      case 'propietario':
      case 'admin_org':
        navigate('/dashboard')
        break
      case 'gerente':
      case 'director':
        navigate('/dashboard/gerente')
        break
      case 'analista':
        navigate('/dashboard/exportadora')
        break
      case 'agricultor':
      case 'tecnico':
      case 'jefe_finca':
        navigate('/dashboard/agricultor')
        break
      default:
        navigate('/dashboard')
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden" 
      style={{ background: DesignConfig.colors.pergamino, fontFamily: 'Space Grotesk, sans-serif' }}>
      
      <DotGrid />

      <Panel>
        <AnimatePresence mode="wait">
          {step === 'telefono' ? (
            <motion.div
              key="step-tel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <StepTelefono
                selectedCountry={selectedCountry}
                setSelectedCountry={setSelectedCountry}
                onContinue={handleRequestOTP}
              />
            </motion.div>
          ) : (
            <motion.div
              key="step-otp"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
        <StepOTP
          phone={phone}
          countryCode={selectedCountry.code}
          onVerify={handleVerifyOTP}
          onResend={() => handleRequestOTP(phone)}
          onBack={() => setStep('telefono')}
        />
            </motion.div>
          )}
        </AnimatePresence>
      </Panel>

      {/* Footer Texts from Design */}
      <div className="absolute bottom-5 left-6 font-mono text-[11px] leading-[1.6] tracking-[0.04em] pointer-events-none opacity-20 hidden md:block">
        ACCESO SEGURO · WASAGRO v1.0<br />
        CAMPO → DATO → DECISIÓN
      </div>
      
      <div className="absolute bottom-5 right-6 font-mono text-[11px] leading-[1.6] tracking-[0.04em] text-right pointer-events-none opacity-20 hidden md:block">
        LATAM · 2026<br />
        WhatsApp Business API
      </div>

      <div className="absolute bottom-5 text-center font-mono text-[11px] tracking-[0.04em] opacity-30">
        Wasagro · Acceso seguro vía WhatsApp
      </div>
    </div>
  )
}
