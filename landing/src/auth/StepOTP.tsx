import React, { useState, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { AlertCircle } from 'lucide-react'
import { LogoMark, Divider, PrimaryBtn, DesignConfig } from './DesignComponents'

interface StepOTPProps {
  phone: string
  countryCode: string
  onVerify: (code: string) => Promise<void>
  onResend: () => Promise<void>
  onBack: () => void
}

export function StepOTP({ phone, countryCode, onVerify, onResend, onBack }: StepOTPProps) {
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timer, setTimer] = useState(60)
  const inputsRef = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    const interval = setInterval(() => {
      setTimer((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return
    if (value.length > 1) value = value[value.length - 1]
    
    const newCode = [...code]
    newCode[index] = value
    setCode(newCode)
    setError(null)

    if (value && index < 5) {
      inputsRef.current[index + 1]?.focus()
    }

    if (newCode.every(v => v !== '')) {
      handleVerify(newCode.join(''))
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputsRef.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (text.length === 6) {
      setCode(text.split(''))
      handleVerify(text)
      e.preventDefault()
    }
  }

  const handleVerify = async (fullCode: string) => {
    setError(null)
    setLoading(true)
    try {
      await onVerify(fullCode)
    } catch (err: any) {
      setError(err.message || 'Código incorrecto')
      setCode(['', '', '', '', '', ''])
      inputsRef.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <LogoMark />
      <Divider />

      <div className="font-bold text-[22px] mb-2 tracking-tight leading-[1.25]" style={{ color: DesignConfig.colors.tierra }}>
        Revisa tu WhatsApp
      </div>
      <div className="text-sm mb-1 leading-[1.55]" style={{ color: DesignConfig.colors.tierraSuave }}>
        Enviamos un código de 6 dígitos al
      </div>
      <div className="font-mono font-bold text-[15px] mb-1.5" style={{ color: DesignConfig.colors.tierra }}>
        +{countryCode} *** *** {phone.slice(-3)}
      </div>
      <div className="text-xs mb-6 underline cursor-pointer" style={{ color: DesignConfig.colors.tierraSuave }} onClick={onBack}>
        ¿No es tu número? Volver
      </div>

      <div className="flex gap-2 items-center justify-center mb-6">
        {code.map((v, i) => {
          const filled = v !== ''
          const active = !filled && code.slice(0, i).every(x => x !== '')
          const border = error 
            ? DesignConfig.colors.tierraAccent 
            : active ? DesignConfig.colors.signal 
            : filled ? DesignConfig.colors.campo 
            : DesignConfig.colors.tierra
          
          return (
            <React.Fragment key={i}>
              {i === 3 && (
                <div className="w-[14px] h-[2px] flex-shrink-0" style={{ background: 'rgba(13,15,12,0.25)' }} />
              )}
              <div className="relative">
                <input
                  ref={el => { inputsRef.current[i] = el }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={v}
                  onChange={e => handleChange(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                  onPaste={handlePaste}
                  disabled={loading}
                  className="w-[52px] h-[64px] text-center font-mono font-bold text-[28px] outline-none transition-all rounded-lg"
                  style={{
                    border: `2px solid ${border}`,
                    background: error ? '#FFF8F6' : DesignConfig.colors.marfil,
                    color: error ? DesignConfig.colors.tierraAccent : DesignConfig.colors.tierra,
                    boxShadow: active && !error ? `4px 4px 0 0 rgba(201,240,59,0.3)` : 'none'
                  }}
                />
                {active && !error && (
                  <div className="absolute bottom-[10px] left-1/2 -translate-x-1/2 w-[2px] h-6 animate-pulse"
                    style={{ background: DesignConfig.colors.signal }} />
                )}
              </div>
            </React.Fragment>
          )
        })}
      </div>

      {error && (
        <motion.div 
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-1.5 mb-4 text-[13px] font-medium"
          style={{ color: DesignConfig.colors.tierraAccent }}
        >
          <AlertCircle className="w-3.5 h-3.5" />
          {error}
        </motion.div>
      )}

      <PrimaryBtn loading={loading} onClick={() => handleVerify(code.join(''))} style={{ marginTop: 8 }}>
        Verificar y entrar →
      </PrimaryBtn>

      <div className="text-center text-[13px] mt-6 font-mono" style={{ color: DesignConfig.colors.tierraSuave }}>
        {timer > 0 ? (
          <>Reenviar código en <strong style={{ color: DesignConfig.colors.tierra }}>0:{timer.toString().padStart(2, '0')}</strong></>
        ) : (
          <span className="font-bold underline cursor-pointer" style={{ color: DesignConfig.colors.campo }} onClick={onResend}>
            Reenviar código →
          </span>
        )}
      </div>
    </>
  )
}
