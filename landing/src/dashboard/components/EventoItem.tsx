import type { ReactNode } from 'react'
import type { Evento } from '../mock/data'
import { FuenteBadge } from './FuenteBadge'
import { ConfianzaLLM } from './ConfianzaLLM'

const tipoIcon: Record<Evento['tipo'], ReactNode> = {
  insumo: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v1H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3V5a3 3 0 0 0-3-3z" />
    </svg>
  ),
  plaga: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  cosecha: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 8C8 10 5.9 16.17 3.82 22" /><path d="M9.5 9.5C6.5 16 6 19 6 22" /><path d="M14.5 14.5C18 20 18 22 18 22" /><path d="M3 3c2 0 4 1 5 3" />
    </svg>
  ),
  labor: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 22v-4a2 2 0 1 0-4 0v4" /><path d="m18 10 4 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8l4-2" /><path d="M18 5v17" /><path d="m6 5 6-3 6 3" /><path d="M6 5v17" /><path d="M2 12h20" />
    </svg>
  ),
  clima: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z" />
    </svg>
  ),
  gasto: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
}

const estadoBadge: Record<Evento['estado'], ReactNode> = {
  confirmado: (
    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, padding: '3px 7px', background: '#1B3D24', color: '#C9F03B', border: '1.5px solid #1B3D24', letterSpacing: '0.04em' }}>
      CONFIRMADO
    </span>
  ),
  validacion: (
    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, padding: '3px 7px', background: 'rgba(245,196,67,0.2)', color: '#9C6B00', border: '1.5px solid #F5C443', letterSpacing: '0.04em' }}>
      REVISAR
    </span>
  ),
  alerta: (
    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, padding: '3px 7px', background: 'rgba(212,88,40,0.12)', color: '#D45828', border: '1.5px solid #D45828', letterSpacing: '0.04em' }}>
      ALERTA
    </span>
  ),
}

export function EventoItem({ evento }: { evento: Evento }) {
  const isPlaga = evento.tipo === 'plaga'
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        padding: '14px 20px',
        borderBottom: '1px solid rgba(13,15,12,0.1)',
        cursor: 'pointer',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(13,15,12,0.03)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div
        style={{
          width: 36,
          height: 36,
          border: `2px solid ${isPlaga ? '#D45828' : '#0D0F0C'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: 1,
          color: isPlaga ? '#D45828' : '#0D0F0C',
        }}
      >
        {tipoIcon[evento.tipo]}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{evento.titulo}</div>
        <div style={{ fontSize: 12, color: 'rgba(13,15,12,0.45)', fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>
          {evento.sub}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(13,15,12,0.45)' }}>{evento.trabajador}</span>
          <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(13,15,12,0.45)' }}>{evento.hora}</span>
        </div>
        {evento.nota && (
          <div style={{ fontSize: 11, fontStyle: 'italic', color: 'rgba(13,15,12,0.45)', marginTop: 4, borderLeft: '2px solid #D45828', paddingLeft: 8 }}>
            {evento.nota}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
        <FuenteBadge fuente={evento.fuente} />
        {estadoBadge[evento.estado]}
        <ConfianzaLLM value={evento.confianza} />
      </div>
    </div>
  )
}
