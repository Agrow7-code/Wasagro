import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useGeolocacion } from './useGeolocacion'
import { useAuth, User } from './useAuth'
import { StepTelefono } from './StepTelefono'
import { StepOTP } from './StepOTP'
import { DotGrid, Panel, DesignConfig } from './DesignComponents'

// URL del backend (Usamos /api como prefijo consistente para proxy en dev y Vercel en prod)
const API_URL = '/api'

export default function LoginPage() {
  const [step, setStep] = useState<'telefono' | 'otp'>('telefono')
  const [phone, setPhone] = useState('')
  const { selectedCountry, setSelectedCountry } = useGeolocacion()
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleRequestOTP = async (fullPhone: string) => {
    try {
      console.log(`[Login] Solicitando OTP para ${fullPhone}...`)
      
      const res = await fetch(`${API_URL}/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone }),
      })

      const data = await res.json().catch(() => ({ error: 'Error de formato en respuesta del servidor' }))

      if (!res.ok) {
        // Mensajes amigables basados en el status o el error del backend
        if (res.status === 404) {
          throw new Error('Número no registrado en Wasagro. Contacta a tu administrador.')
        }
        throw new Error(data.error || `Error ${res.status}: No se pudo solicitar el código`)
      }

      console.log('[Login] OTP solicitado con éxito')
      setPhone(fullPhone)
      setStep('otp')
    } catch (err: any) {
      console.error('[Login] Error en handleRequestOTP:', err)
      
      // Manejar errores de red (cuando fetch falla antes de recibir respuesta)
      if (err instanceof TypeError || err.message?.includes('fetch')) {
        throw new Error('No se pudo conectar con el servidor. Verifica tu internet.')
      }
      throw err
    }
  }

  const handleVerifyOTP = async (code: string) => {
    try {
      console.log('[Login] Verificando código...')
      
      const res = await fetch(`${API_URL}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      })

      const data = await res.json().catch(() => ({ error: 'Error de formato en respuesta del servidor' }))

      if (!res.ok) {
        throw new Error(data.error || 'Código incorrecto o expirado')
      }

      const user = data.user as User
      login(user)
      console.log('[Login] Verificación exitosa, redirigiendo...', user.rol)

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
    } catch (err: any) {
      console.error('[Login] Error en handleVerifyOTP:', err)
      throw err
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
