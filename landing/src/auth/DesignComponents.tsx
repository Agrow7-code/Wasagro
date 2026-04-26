import React from 'react'
import { motion } from 'motion/react'

export const DesignConfig = {
  colors: {
    pergamino: '#F5F1E8',
    marfil: '#FDFAF4',
    tierra: '#0D0F0C',
    signal: '#C9F03B',
    campo: '#1B3D24',
    tierraAccent: '#D45828',
    tierraSuave: 'rgba(13,15,12,0.45)',
    tierraFaint: 'rgba(13,15,12,0.2)',
  }
}

export const DotGrid = () => (
  <div className="absolute inset-0 pointer-events-none z-0" 
    style={{
      backgroundImage: 'radial-gradient(circle, rgba(13,15,12,0.12) 1px, transparent 1px)',
      backgroundSize: '22px 22px',
    }} 
  />
)

export const WA_LINK = 'https://wa.me/593999999999?text=Hola%2C%20no%20tengo%20acceso%20a%20Wasagro%20y%20me%20gustar%C3%ADA%20adquirir%20el%20servicio'

export const LogoMark = ({ size = 32 }: { size?: number }) => {
  const w = Math.round(size * 0.6)
  const h = Math.round(size * 1.18)
  return (
    <div className="flex items-center gap-[12px] justify-center mb-6">
      <svg viewBox="0 -22 60 96" width={w} height={h} fill="none" aria-hidden="true">
        <path
          d="M8,8 L18,72 L30,36 L42,72 L52,8"
          stroke="#1B3D24"
          strokeWidth="10.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="30" cy="-6" r="12" fill="#C9F03B" />
      </svg>
      <span className="font-bold text-xl tracking-tight" style={{ color: DesignConfig.colors.tierra }}>
        Wasagro<span style={{ color: DesignConfig.colors.signal }}>.</span>
      </span>
    </div>
  )
}

export const Divider = () => (
  <div className="h-[1px] mb-6" style={{ background: '#EAE6DC' }} />
)

export const Panel = ({ children }: { children: React.ReactNode }) => (
  <div className="relative z-10 w-full max-w-[440px] p-10 md:p-[44px]"
    style={{
      background: DesignConfig.colors.marfil,
      border: `2px solid ${DesignConfig.colors.tierra}`,
      borderRadius: 16,
      boxShadow: `8px 8px 0 0 ${DesignConfig.colors.tierra}`,
    }}>
    {children}
  </div>
)

export const PrimaryBtn = ({ children, disabled, loading, onClick, style = {} }: any) => {
  return (
    <motion.button
      whileHover={{ x: -1, y: -1, boxShadow: `6px 6px 0 0 ${DesignConfig.colors.tierra}` }}
      whileTap={{ x: 0, y: 0, boxShadow: 'none' }}
      disabled={disabled || loading}
      onClick={onClick}
      className="w-full py-3.5 px-6 font-bold text-base flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: DesignConfig.colors.signal,
        border: `2px solid ${DesignConfig.colors.tierra}`,
        borderRadius: 8,
        color: DesignConfig.colors.tierra,
        boxShadow: `4px 4px 0 0 ${DesignConfig.colors.tierra}`,
        ...style,
      }}
    >
      {loading ? 'Procesando...' : children}
    </motion.button>
  )
}
