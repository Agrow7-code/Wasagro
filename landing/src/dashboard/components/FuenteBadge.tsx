import type { CSSProperties } from 'react'

type Fuente = 'voz' | 'texto' | 'imagen'

const config: Record<Fuente, { label: string; style: CSSProperties }> = {
  voz: {
    label: 'VOZ',
    style: { background: 'rgba(27,61,36,0.1)', color: '#1B3D24', borderColor: '#1B3D24' },
  },
  texto: {
    label: 'TEXTO',
    style: { background: 'rgba(13,15,12,0.07)', color: 'rgba(13,15,12,0.55)', borderColor: 'rgba(13,15,12,0.25)' },
  },
  imagen: {
    label: 'IMAGEN',
    style: { background: 'rgba(43,78,160,0.1)', color: '#2B4EA0', borderColor: '#2B4EA0' },
  },
}

export function FuenteBadge({ fuente }: { fuente: Fuente }) {
  const { label, style } = config[fuente]
  return (
    <span
      style={{
        ...style,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 9,
        fontWeight: 700,
        padding: '2px 6px',
        letterSpacing: '0.05em',
        border: '1.5px solid',
        display: 'inline-block',
      }}
    >
      {label}
    </span>
  )
}
