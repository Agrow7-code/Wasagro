function getConfianzaConfig(pct: number) {
  if (pct >= 95) return { label: 'VERIFICADO', bg: '#1B3D24', color: '#C9F03B', border: '#1B3D24' }
  if (pct >= 80) return { label: 'REVISAR', bg: 'rgba(245,196,67,0.2)', color: '#9C6B00', border: '#F5C443' }
  return { label: 'VALIDAR', bg: 'rgba(212,88,40,0.12)', color: '#D45828', border: '#D45828' }
}

export function ConfianzaLLM({ value }: { value: number }) {
  const { label, bg, color, border } = getConfianzaConfig(value)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          width: 60,
          height: 5,
          background: 'rgba(13,15,12,0.12)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${value}%`,
            height: '100%',
            background: color,
          }}
        />
      </div>
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          fontWeight: 700,
          padding: '2px 6px',
          background: bg,
          color,
          border: `1.5px solid ${border}`,
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap' as const,
        }}
      >
        {label}
      </span>
    </div>
  )
}
