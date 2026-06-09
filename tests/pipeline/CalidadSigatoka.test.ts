import { describe, it, expect } from 'vitest'
import {
  evaluarCalidadSigatoka,
  decidirRecaptura,
  MAX_RECAPTURA_SIGATOKA,
  CalidadSigatokaSchema,
  CALIDAD_FALLBACK_PASA,
  type CalidadSigatoka,
} from '../../src/types/dominio/CalidadSigatoka.js'

function calidad(overrides: Partial<CalidadSigatoka> = {}): CalidadSigatoka {
  return {
    secciones_visibles:  ['titulo', 'matriz_puntos', 'ef_pas_act', 'plagas_foliares', 'bloque_formulas'],
    secciones_faltantes: [],
    legibilidad_matriz:  'legible',
    motivo:    null,
    confianza: 0.9,
    ...overrides,
  }
}

describe('decidirRecaptura — cap de re-captura (P2)', () => {
  it('foto aceptable → procesar (sin importar intentos)', () => {
    expect(decidirRecaptura(true, 0)).toBe('procesar')
    expect(decidirRecaptura(true, 5)).toBe('procesar')
  })

  it('no aceptable y por debajo del cap → pedir otra foto', () => {
    expect(decidirRecaptura(false, 0)).toBe('pedir')
    expect(decidirRecaptura(false, 1)).toBe('pedir')
  })

  it('no aceptable y en el cap → procesar igual (no insistir, P2)', () => {
    expect(decidirRecaptura(false, MAX_RECAPTURA_SIGATOKA)).toBe('procesar')
    expect(decidirRecaptura(false, MAX_RECAPTURA_SIGATOKA + 1)).toBe('procesar')
  })

  it('respeta un cap custom', () => {
    expect(decidirRecaptura(false, 0, 1)).toBe('pedir')
    expect(decidirRecaptura(false, 1, 1)).toBe('procesar')
  })
})

describe('evaluarCalidadSigatoka — acepta', () => {
  it('foto completa y legible → aceptable', () => {
    expect(evaluarCalidadSigatoka(calidad())).toEqual({ aceptable: true, problema: null, mensaje: null })
  })

  it("legibilidad 'parcial' PASA (no es falso positivo)", () => {
    expect(evaluarCalidadSigatoka(calidad({ legibilidad_matriz: 'parcial' })).aceptable).toBe(true)
  })

  it('sección periférica faltante (bloque_formulas) PASA — solo la matriz es obligatoria', () => {
    const v = evaluarCalidadSigatoka(calidad({ secciones_faltantes: ['bloque_formulas'] }))
    expect(v.aceptable).toBe(true)
  })

  it('el fallback (gate falló) deja pasar', () => {
    expect(evaluarCalidadSigatoka(CALIDAD_FALLBACK_PASA).aceptable).toBe(true)
  })
})

describe('evaluarCalidadSigatoka — rechaza (señal clara + confianza suficiente)', () => {
  it('falta la matriz → cortada', () => {
    const v = evaluarCalidadSigatoka(calidad({ secciones_faltantes: ['matriz_puntos'] }))
    expect(v.aceptable).toBe(false)
    expect(v.problema).toBe('cortada')
    expect(v.mensaje).toMatch(/tabla completa/i)
  })

  it('matriz ilegible → borrosa', () => {
    const v = evaluarCalidadSigatoka(calidad({ legibilidad_matriz: 'ilegible' }))
    expect(v.aceptable).toBe(false)
    expect(v.problema).toBe('borrosa')
    expect(v.mensaje).toMatch(/borrosa/i)
  })
})

describe('evaluarCalidadSigatoka — guard de confianza (bias a pasar)', () => {
  it('matriz faltante pero confianza baja → PASA (no rechaza con poca certeza)', () => {
    const v = evaluarCalidadSigatoka(calidad({ secciones_faltantes: ['matriz_puntos'], confianza: 0.3 }))
    expect(v.aceptable).toBe(true)
  })

  it('ilegible pero confianza baja → PASA', () => {
    const v = evaluarCalidadSigatoka(calidad({ legibilidad_matriz: 'ilegible', confianza: 0.4 }))
    expect(v.aceptable).toBe(true)
  })

  it('umbral configurable: con umbral 0.2 sí rechaza una matriz faltante de confianza 0.3', () => {
    const v = evaluarCalidadSigatoka(calidad({ secciones_faltantes: ['matriz_puntos'], confianza: 0.3 }), 0.2)
    expect(v.aceptable).toBe(false)
  })
})

describe('CalidadSigatokaSchema', () => {
  it('valida una respuesta bien formada', () => {
    expect(() => CalidadSigatokaSchema.parse(calidad())).not.toThrow()
  })

  it('rechaza una sección desconocida', () => {
    expect(() => CalidadSigatokaSchema.parse(calidad({ secciones_visibles: ['inventada' as never] }))).toThrow()
  })

  it('rechaza confianza fuera de 0-1', () => {
    expect(() => CalidadSigatokaSchema.parse(calidad({ confianza: 1.4 }))).toThrow()
  })
})
