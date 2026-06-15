import { describe, expect, it } from 'vitest'
import { aplicarFiltroConfianza } from '../../../src/integrations/llm/confidenceFilter.js'
import type { EventoCampoExtraido } from '../../../src/types/dominio/EventoCampo.js'

function evento(overrides: Partial<EventoCampoExtraido> = {}): EventoCampoExtraido {
  return {
    tipo_evento: 'insumo',
    lote_id: 'F001-L01',
    lote_detectado_raw: null,
    fecha_evento: '2026-06-01',
    confidence_score: 0.9,
    requiere_validacion: false,
    alerta_urgente: false,
    campos_extraidos: {},
    confidence_por_campo: {},
    campos_faltantes: [],
    requiere_clarificacion: false,
    ...overrides,
  }
}

describe('aplicarFiltroConfianza', () => {
  const opts = { umbralCampoNull: 0.3, umbralEventoRevision: 0.5 }

  it('anula un campo cuya confianza está por debajo del umbral', () => {
    const e = evento({
      campos_extraidos: { producto: 'urea', dosis: '5kg' },
      confidence_por_campo: { producto: 0.95, dosis: 0.2 },
    })
    const { evento: out, camposAnulados } = aplicarFiltroConfianza(e, opts)
    expect(camposAnulados).toEqual(['dosis'])
    expect(out.campos_extraidos['dosis']).toBeNull()
    expect(out.campos_extraidos['producto']).toBe('urea')
    expect(out.campos_faltantes).toContain('dosis')
    expect(out.requiere_validacion).toBe(true)
  })

  it('NO anula campos con confianza igual o superior al umbral', () => {
    const e = evento({
      campos_extraidos: { producto: 'urea', dosis: '5kg' },
      confidence_por_campo: { producto: 0.3, dosis: 0.85 },
    })
    const { camposAnulados, evento: out } = aplicarFiltroConfianza(e, opts)
    expect(camposAnulados).toEqual([])
    expect(out.campos_extraidos['producto']).toBe('urea')
    expect(out.requiere_validacion).toBe(false)
  })

  it('NO anula un campo sin confianza explícita (no destruye dato por metadato ausente)', () => {
    const e = evento({
      campos_extraidos: { producto: 'urea' },
      confidence_por_campo: {},
    })
    const { camposAnulados, evento: out } = aplicarFiltroConfianza(e, opts)
    expect(camposAnulados).toEqual([])
    expect(out.campos_extraidos['producto']).toBe('urea')
  })

  it('marca requiere_validacion cuando el score global está por debajo del umbral, sin anular campos', () => {
    const e = evento({
      confidence_score: 0.4,
      campos_extraidos: { producto: 'urea' },
      confidence_por_campo: { producto: 0.9 },
    })
    const { camposAnulados, evento: out } = aplicarFiltroConfianza(e, opts)
    expect(camposAnulados).toEqual([])
    expect(out.requiere_validacion).toBe(true)
  })

  it('no descarta el evento ni cambia el tipo', () => {
    const e = evento({
      tipo_evento: 'plaga',
      campos_extraidos: { individuos_encontrados: 20 },
      confidence_por_campo: { individuos_encontrados: 0.1 },
    })
    const { evento: out } = aplicarFiltroConfianza(e, opts)
    expect(out.tipo_evento).toBe('plaga')
    // Campo anulado → la regla determinista de plaga (worker) verá !null y pedirá clarificación.
    expect(out.campos_extraidos['individuos_encontrados']).toBeNull()
  })

  it('es puro: no muta el evento de entrada', () => {
    const e = evento({
      campos_extraidos: { dosis: '5kg' },
      confidence_por_campo: { dosis: 0.1 },
    })
    aplicarFiltroConfianza(e, opts)
    expect(e.campos_extraidos['dosis']).toBe('5kg')
    expect(e.requiere_validacion).toBe(false)
  })

  it('preserva campos_faltantes previos y deduplica', () => {
    const e = evento({
      campos_extraidos: { dosis: '5kg' },
      confidence_por_campo: { dosis: 0.1 },
      campos_faltantes: ['lote_id', 'dosis'],
    })
    const { evento: out } = aplicarFiltroConfianza(e, opts)
    expect(out.campos_faltantes.filter(c => c === 'dosis')).toHaveLength(1)
    expect(out.campos_faltantes).toContain('lote_id')
  })
})
