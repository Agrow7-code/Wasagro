import { describe, expect, it } from 'vitest'
import { seccionDeCorreccion, analizarCorrecciones, type CorreccionEval } from '../../src/pipeline/sigatokaEval.js'

function c(o: Partial<CorreccionEval> = {}): CorreccionEval {
  return { punto: 'P1', campo: 'planta1_estadio', estado_extraido: 'leida', valor_extraido: 1, valor_corregido: 1, ...o }
}

describe('seccionDeCorreccion', () => {
  it('mapea por prefijo del punto', () => {
    expect(seccionDeCorreccion('11sem-14')).toBe('sem11')
    expect(seccionDeCorreccion('00sem-3')).toBe('sem00')
    expect(seccionDeCorreccion('P1')).toBe('matriz')
    expect(seccionDeCorreccion('P19')).toBe('matriz')
    expect(seccionDeCorreccion('raro')).toBe('otro')
  })
})

describe('analizarCorrecciones', () => {
  it('un valor que NO cambió no es error (confirmación)', () => {
    const r = analizarCorrecciones([c({ valor_extraido: 5, valor_corregido: 5 })])
    expect(r.total).toBe(1)
    expect(r.errores).toBe(0)
  })

  it('error confiado = el modelo leyó (leida) pero el valor cambió — lo peligroso', () => {
    const r = analizarCorrecciones([c({ estado_extraido: 'leida', valor_extraido: 3, valor_corregido: 7 })])
    expect(r.errores).toBe(1)
    expect(r.erroresConfiados).toBe(1)
    expect(r.ilegiblesCompletados).toBe(0)
  })

  it('ilegible completado = el modelo avisó (no es error silencioso)', () => {
    const r = analizarCorrecciones([c({ estado_extraido: 'ilegible', valor_extraido: null, valor_corregido: 4 })])
    expect(r.errores).toBe(1)
    expect(r.erroresConfiados).toBe(0)
    expect(r.ilegiblesCompletados).toBe(1)
  })

  it('agrupa errores por sección', () => {
    const r = analizarCorrecciones([
      c({ punto: 'P3', estado_extraido: 'leida', valor_extraido: 1, valor_corregido: 2 }),
      c({ punto: 'P5', estado_extraido: 'leida', valor_extraido: 0, valor_corregido: 3 }),
      c({ punto: '11sem-4', campo: 'ht', estado_extraido: 'leida', valor_extraido: 10, valor_corregido: 12 }),
      c({ punto: '00sem-2', campo: 'lc', estado_extraido: 'ilegible', valor_extraido: null, valor_corregido: 6 }),
    ])
    expect(r.errores).toBe(4)
    expect(r.porSeccion.matriz.errores).toBe(2)
    expect(r.porSeccion.matriz.confiados).toBe(2)
    expect(r.porSeccion.sem11.errores).toBe(1)
    expect(r.porSeccion.sem00.errores).toBe(1)
    expect(r.porSeccion.sem00.confiados).toBe(0)
  })

  it('lista vacía → todo cero, sin romper', () => {
    const r = analizarCorrecciones([])
    expect(r.total).toBe(0)
    expect(r.errores).toBe(0)
    expect(r.porSeccion.matriz.errores).toBe(0)
  })
})
