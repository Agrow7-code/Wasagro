import { describe, expect, it } from 'vitest'
import { resumirEventos, type EventoDashboard } from '../../../src/agents/finca/dashboardResumen.js'

// "ahora" fijo para tests deterministas: jueves 2026-06-18 14:00 UTC.
const AHORA = new Date('2026-06-18T14:00:00.000Z')

function ev(o: Partial<EventoDashboard> = {}): EventoDashboard {
  return {
    tipo_evento: 'labor',
    created_at: '2026-06-18T08:00:00.000Z',
    status: 'complete',
    confidence_score: 0.95,
    lote_id: 'F001-L01',
    ...o,
  }
}

describe('resumirEventos', () => {
  it('cuenta eventos de HOY (mismo día calendario que ahora)', () => {
    const r = resumirEventos([
      ev({ created_at: '2026-06-18T06:00:00.000Z' }),
      ev({ created_at: '2026-06-18T13:30:00.000Z' }),
      ev({ created_at: '2026-06-17T23:00:00.000Z' }), // ayer
    ], AHORA)
    expect(r.eventosHoy).toBe(2)
  })

  it('cuenta eventos de los ÚLTIMOS 7 días en eventosSemana', () => {
    const r = resumirEventos([
      ev({ created_at: '2026-06-18T06:00:00.000Z' }), // hoy
      ev({ created_at: '2026-06-12T10:00:00.000Z' }), // dentro de 7d
      ev({ created_at: '2026-06-10T10:00:00.000Z' }), // fuera de 7d
    ], AHORA)
    expect(r.eventosSemana).toBe(2)
  })

  it('alertasSinResolver = eventos con status requires_review', () => {
    const r = resumirEventos([
      ev({ status: 'requires_review' }),
      ev({ status: 'requires_review' }),
      ev({ status: 'complete' }),
    ], AHORA)
    expect(r.alertasSinResolver).toBe(2)
  })

  it('porTipo agrupa los eventos de la semana por tipo_evento', () => {
    const r = resumirEventos([
      ev({ tipo_evento: 'cosecha' }),
      ev({ tipo_evento: 'cosecha' }),
      ev({ tipo_evento: 'plaga' }),
    ], AHORA)
    expect(r.porTipo).toEqual({ cosecha: 2, plaga: 1 })
  })

  it('serieDiaria tiene 7 entradas (una por día) en orden cronológico, con el conteo por día', () => {
    const r = resumirEventos([
      ev({ created_at: '2026-06-18T06:00:00.000Z' }),
      ev({ created_at: '2026-06-18T09:00:00.000Z' }),
      ev({ created_at: '2026-06-16T09:00:00.000Z' }),
    ], AHORA)
    expect(r.serieDiaria).toHaveLength(7)
    expect(r.serieDiaria[6]).toEqual({ fecha: '2026-06-18', total: 2 }) // último = hoy
    expect(r.serieDiaria[4]).toEqual({ fecha: '2026-06-16', total: 1 })
    expect(r.serieDiaria[0]!.fecha).toBe('2026-06-12') // hace 6 días
  })

  it('null-safe: lista vacía no rompe y da ceros', () => {
    const r = resumirEventos([], AHORA)
    expect(r.eventosHoy).toBe(0)
    expect(r.eventosSemana).toBe(0)
    expect(r.alertasSinResolver).toBe(0)
    expect(r.porTipo).toEqual({})
    expect(r.serieDiaria).toHaveLength(7)
    expect(r.serieDiaria.every(d => d.total === 0)).toBe(true)
  })
})
