import { describe, expect, it } from 'vitest'
import { seccionDeCorreccion, analizarCorrecciones, compararMuestreos, type CorreccionEval } from '../../src/pipeline/sigatokaEval.js'

// Fixtures mínimos para la comparación.
const cel = (v: number | null) => ({ valor: v, estado: v == null ? 'vacia' : 'leida' } as const)
function punto(p: string, o: Record<string, { valor: number | null; estado: string }> = {}) {
  return {
    punto: p, sector: null, lote_id: null, marcaEspecial: null,
    planta1_estadio: cel(1), planta1_piscas: cel(0), planta2_estadio: cel(1), planta2_piscas: cel(0),
    planta3_estadio: cel(1), planta3_piscas: cel(0), hVle: cel(5), hVlq: cel(2), func: cel(8),
    ...o,
  }
}
function fila(n: number, o: Record<string, { valor: number | null; estado: string }> = {}) {
  return { fila: n, sector: null, lote_id: null, ht: cel(10), hVle: cel(5), q5menos: cel(8), q5mas: cel(12), lc: cel(11), ...o }
}

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

describe('compararMuestreos (re-extracción vs ground-truth)', () => {
  it('muestreos idénticos → 0 errores', () => {
    const m = { puntosMuestreo: [punto('P1')], plantas11sem: [fila(1)], plantas00sem: [fila(1)] } as any
    const r = compararMuestreos(m, m)
    expect(r.totalCeldasMal).toBe(0)
    expect(r.totalFilasFaltantes).toBe(0)
  })

  it('una celda distinta en 00sem → 1 celda mal en sem00', () => {
    const verdad = { plantas00sem: [fila(1, { ht: cel(10) })] } as any
    const nuevo = { plantas00sem: [fila(1, { ht: cel(7) })] } as any
    const r = compararMuestreos(nuevo, verdad)
    expect(r.porSeccion.sem00.celdasMal).toBe(1)
    expect(r.porSeccion.sem11.celdasMal).toBe(0)
    expect(r.totalCeldasMal).toBe(1)
  })

  it('fila que el ground-truth tiene y la re-extracción NO → fila faltante (el bug de las 2 filas)', () => {
    const verdad = { plantas00sem: [fila(1), fila(2), fila(3)] } as any
    const nuevo = { plantas00sem: [fila(1), fila(3)] } as any // falta la fila 2
    const r = compararMuestreos(nuevo, verdad)
    expect(r.porSeccion.sem00.filasFaltantes).toBe(1)
    expect(r.totalFilasFaltantes).toBe(1)
  })

  it('fila de más en la re-extracción → filasDeMas', () => {
    const verdad = { plantas11sem: [fila(1)] } as any
    const nuevo = { plantas11sem: [fila(1), fila(2)] } as any
    const r = compararMuestreos(nuevo, verdad)
    expect(r.porSeccion.sem11.filasDeMas).toBe(1)
  })

  it('cuenta errores de la matriz por punto', () => {
    const verdad = { puntosMuestreo: [punto('P1', { planta1_estadio: cel(2) })] } as any
    const nuevo = { puntosMuestreo: [punto('P1', { planta1_estadio: cel(9) })] } as any
    const r = compararMuestreos(nuevo, verdad)
    expect(r.porSeccion.matriz.celdasMal).toBe(1)
  })
})
