import { describe, it, expect } from 'vitest'
import { calcularPrecio, getBasePrice, getSegmentLabel, inferPlanSegment, isPaidPlan, PRICE_PER_FINCA, PRICE_PER_USER } from '../../src/auth/pricingUtils.js'

describe('pricingUtils — constants', () => {
  it('PRICE_PER_FINCA = 8', () => expect(PRICE_PER_FINCA).toBe(8))
  it('PRICE_PER_USER = 4', () => expect(PRICE_PER_USER).toBe(4))
})

describe('getBasePrice — border cases', () => {
  it('1 finca, 1 usuario → $10 (Agricultor)', () => {
    expect(getBasePrice(1, 1)).toBe(10)
  })

  it('1 finca, 3 usuarios → $10 (ultimo del rango Agricultor)', () => {
    expect(getBasePrice(1, 3)).toBe(10)
  })

  it('1 finca, 4 usuarios → $15 (primer paso a Productor)', () => {
    expect(getBasePrice(1, 4)).toBe(15)
  })

  it('1 finca, 10 usuarios → $15', () => {
    expect(getBasePrice(1, 10)).toBe(15)
  })

  it('2 fincas, 1 usuario → $15 (Productor por fincas)', () => {
    expect(getBasePrice(2, 1)).toBe(15)
  })

  it('5 fincas, 10 usuarios → $15 (ultimo del rango Productor)', () => {
    expect(getBasePrice(5, 10)).toBe(15)
  })

  it('6 fincas, 1 usuario → $25 (primer paso a Pyme)', () => {
    expect(getBasePrice(6, 1)).toBe(25)
  })

  it('20 fincas, 50 usuarios → $25 (ultimo del rango Pyme)', () => {
    expect(getBasePrice(20, 50)).toBe(25)
  })

  it('21 fincas, 1 usuario → $50 (primer paso a Corporativo)', () => {
    expect(getBasePrice(21, 1)).toBe(50)
  })

  it('100 fincas, 200 usuarios → $50 (Corporativo)', () => {
    expect(getBasePrice(100, 200)).toBe(50)
  })
})

describe('calcularPrecio — formula', () => {
  it('Agricultor (1F, 1U): 10 + 8×1 + 4×1 = 22', () => {
    expect(calcularPrecio(1, 1)).toBe(22)
  })

  it('Agricultor + 2 empleados (1F, 3U): 10 + 8 + 12 = 30', () => {
    expect(calcularPrecio(1, 3)).toBe(30)
  })

  it('Agricultor → Productor border (1F, 4U): 15 + 8 + 16 = 39', () => {
    expect(calcularPrecio(1, 4)).toBe(39)
  })

  it('Productor (3F, 5U): 15 + 24 + 20 = 59', () => {
    expect(calcularPrecio(3, 5)).toBe(59)
  })

  it('Productor (3F, 8U): 15 + 24 + 32 = 71', () => {
    expect(calcularPrecio(3, 8)).toBe(71)
  })

  it('Productor → Pyme border (6F, 12U): 25 + 48 + 48 = 121', () => {
    expect(calcularPrecio(6, 12)).toBe(121)
  })

  it('Pyme (10F, 12U): 25 + 80 + 48 = 153', () => {
    expect(calcularPrecio(10, 12)).toBe(153)
  })

  it('Pyme → Corporativo border (21F, 50U): 50 + 168 + 200 = 418', () => {
    expect(calcularPrecio(21, 50)).toBe(418)
  })

  it('Corporativo (50F, 50U): 50 + 400 + 200 = 650', () => {
    expect(calcularPrecio(50, 50)).toBe(650)
  })
})

describe('getSegmentLabel', () => {
  it('1F, 1U → Agricultor', () => expect(getSegmentLabel(1, 1)).toBe('Agricultor'))
  it('1F, 3U → Agricultor', () => expect(getSegmentLabel(1, 3)).toBe('Agricultor'))
  it('1F, 4U → Productor', () => expect(getSegmentLabel(1, 4)).toBe('Productor'))
  it('2F, 1U → Productor', () => expect(getSegmentLabel(2, 1)).toBe('Productor'))
  it('5F, 10U → Productor', () => expect(getSegmentLabel(5, 10)).toBe('Productor'))
  it('6F, 1U → Pyme / Agroexportadora', () => expect(getSegmentLabel(6, 1)).toBe('Pyme / Agroexportadora'))
  it('20F, 50U → Pyme / Agroexportadora', () => expect(getSegmentLabel(20, 50)).toBe('Pyme / Agroexportadora'))
  it('21F, 1U → Corporativo', () => expect(getSegmentLabel(21, 1)).toBe('Corporativo'))
})

describe('inferPlanSegment', () => {
  it('1F, 1U → agricultor', () => expect(inferPlanSegment(1, 1)).toBe('agricultor'))
  it('1F, 3U → agricultor', () => expect(inferPlanSegment(1, 3)).toBe('agricultor'))
  it('1F, 4U → productor', () => expect(inferPlanSegment(1, 4)).toBe('productor'))
  it('3F, 5U → productor', () => expect(inferPlanSegment(3, 5)).toBe('productor'))
  it('5F, 10U → productor', () => expect(inferPlanSegment(5, 10)).toBe('productor'))
  it('6F, 1U → pyme', () => expect(inferPlanSegment(6, 1)).toBe('pyme'))
  it('20F, 50U → pyme', () => expect(inferPlanSegment(20, 50)).toBe('pyme'))
  it('21F, 1U → corporativo', () => expect(inferPlanSegment(21, 1)).toBe('corporativo'))
})

describe('isPaidPlan', () => {
  it('agricultor → true', () => expect(isPaidPlan('agricultor')).toBe(true))
  it('productor → true', () => expect(isPaidPlan('productor')).toBe(true))
  it('pyme → true', () => expect(isPaidPlan('pyme')).toBe(true))
  it('corporativo → true', () => expect(isPaidPlan('corporativo')).toBe(true))
  it('starter (legado) → true', () => expect(isPaidPlan('starter')).toBe(true))
  it('enterprise (legado) → true', () => expect(isPaidPlan('enterprise')).toBe(true))
  it('trial → false', () => expect(isPaidPlan('trial')).toBe(false))
  it('free → false', () => expect(isPaidPlan('free')).toBe(false))
  it('unknown → false', () => expect(isPaidPlan('unknown')).toBe(false))
})
