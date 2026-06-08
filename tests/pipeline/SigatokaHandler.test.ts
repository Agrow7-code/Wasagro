import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: {
    trace: vi.fn().mockReturnValue({ event: vi.fn(), generation: vi.fn().mockReturnValue({ end: vi.fn() }) }),
    getPrompt: vi.fn().mockRejectedValue(new Error('no langfuse')),
  },
}))

import {
  calcularResumen,
  detectarCamposDudosos,
  detectarFormularioSigatoka,
  buildDescripcionRaw,
  buildWhatsappSummary,
  extractSigatokaMuestreo,
  type ResumenSigatokaSinCalculo,
  type SigatokaVisionFn,
} from '../../src/pipeline/handlers/SigatokaHandler.js'
import { SigatokaMuestreoSchema, type SigatokaMuestreo, type ResumenSigatoka } from '../../src/types/dominio/SigatokaMuestreo.js'
import { PromptManager } from '../../src/pipeline/promptManager.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function fixtureResumenRaw(overrides: Partial<ResumenSigatokaSinCalculo> = {}): ResumenSigatokaSinCalculo {
  return {
    A: 19, B: 127, C: 0, D: 0, E: 0, F: 19, G: 171,
    H_formulario: null, I_formulario: null, J_formulario: null,
    K_formulario: null, L_formulario: null, M_formulario: null,
    ...overrides,
  }
}

function fixtureResumen(overrides: Partial<ResumenSigatoka> = {}): ResumenSigatoka {
  return {
    A: 19, B: 127, C: 0, D: 0, E: 0, F: 19, G: 171,
    H_formulario: null, I_formulario: null, J_formulario: null,
    K_formulario: null, L_formulario: null, M_formulario: null,
    H_calculado: 0, I_calculado: 0, J_calculado: 0,
    K_calculado: 6.7, L_calculado: 1, M_calculado: 9,
    ...overrides,
  }
}

function fixtureMuestreo(resumen: ResumenSigatoka, camposDudosos: string[] = []): SigatokaMuestreo {
  return {
    confidenceScore:    0.9,
    requiereValidacion: camposDudosos.length > 0,
    camposDudosos,
    zona:        'Litoral',
    codigoFinca: 'F001',
    nombreFinca: 'Bananera Test',
    semana:      23,
    periodo:     6,
    fecha:       '2026-06-05',
    supervisor:  'Juan Pérez',
    puntosMuestreo: [],
    plantas:        [],
    resumen,
    plantas11sem:   [],
    plagasFoliares: {
      ceramida: { h: 2, p: 1, m: 0 },
      sibine:   { h: 0, p: 0, m: 0 },
    },
  }
}

// ─── calcularResumen ─────────────────────────────────────────────────────────

describe('calcularResumen', () => {
  it('H = (C/A)·100 con A=19, C=0 → H_calculado=0', () => {
    const r = calcularResumen(fixtureResumenRaw())
    expect(r.H_calculado).toBe(0)
  })

  it('K = B/A con B=127, A=19 → K_calculado=6.7', () => {
    const r = calcularResumen(fixtureResumenRaw({ B: 127, A: 19 }))
    expect(r.K_calculado).toBe(6.7)
  })

  it('lanza error cuando A=0', () => {
    expect(() => calcularResumen(fixtureResumenRaw({ A: 0 }))).toThrow(/no puede ser 0/)
  })

  it('I = (D/A)·100 con A=20, D=1 → I_calculado=5', () => {
    const r = calcularResumen(fixtureResumenRaw({ A: 20, D: 1 }))
    expect(r.I_calculado).toBe(5)
  })

  it('M = G/A con G=171, A=19 → M_calculado=9', () => {
    const r = calcularResumen(fixtureResumenRaw({ G: 171, A: 19 }))
    expect(r.M_calculado).toBe(9)
  })
})

// ─── detectarCamposDudosos ───────────────────────────────────────────────────

describe('detectarCamposDudosos', () => {
  it('array vacío cuando calculado ≈ formulario (diff ≤ 0.5)', () => {
    const r = fixtureResumen({ K_calculado: 6.7, K_formulario: 6.8 })
    expect(detectarCamposDudosos(r)).toEqual([])
  })

  it('array vacío cuando todos los _formulario son null', () => {
    const r = fixtureResumen()
    expect(detectarCamposDudosos(r)).toEqual([])
  })

  it('incluye campo K cuando K_formulario difiere en más de 0.5', () => {
    const r = fixtureResumen({ K_calculado: 6.7, K_formulario: 9.0 })
    const dudosos = detectarCamposDudosos(r)
    expect(dudosos).toHaveLength(1)
    expect(dudosos[0]).toContain('resumen.K')
    expect(dudosos[0]).toContain('6.7')
    expect(dudosos[0]).toContain('9')
  })

  it('puede devolver múltiples campos dudosos simultáneamente', () => {
    const r = fixtureResumen({
      H_calculado: 10, H_formulario: 20,
      J_calculado: 5,  J_formulario: 12,
      M_calculado: 9,  M_formulario: 3,
    })
    const dudosos = detectarCamposDudosos(r)
    expect(dudosos).toHaveLength(3)
    expect(dudosos.join(' ')).toMatch(/resumen\.H/)
    expect(dudosos.join(' ')).toMatch(/resumen\.J/)
    expect(dudosos.join(' ')).toMatch(/resumen\.M/)
  })
})

// ─── detectarFormularioSigatoka ──────────────────────────────────────────────

describe('detectarFormularioSigatoka', () => {
  it('true cuando 3+ marcadores presentes', () => {
    expect(detectarFormularioSigatoka('SIGATOKA muestreo H+VLE FUNC semana 23')).toBe(true)
  })

  it('false cuando menos de 3 marcadores', () => {
    expect(detectarFormularioSigatoka('reporte de cosecha banano semana 23')).toBe(false)
  })

  it('false con string vacío', () => {
    expect(detectarFormularioSigatoka('')).toBe(false)
  })

  it('match es case-insensitive', () => {
    expect(detectarFormularioSigatoka('sigatoka h+vle ef pas ee2')).toBe(true)
  })
})

// ─── buildDescripcionRaw ─────────────────────────────────────────────────────

describe('buildDescripcionRaw', () => {
  it('incluye el nombre de la finca y la semana', () => {
    const d = fixtureMuestreo(fixtureResumen())
    const desc = buildDescripcionRaw(d)
    expect(desc).toContain('Bananera Test')
    expect(desc).toContain('semana 23')
  })

  it('incluye los campos de alerta (I, J, M)', () => {
    const d = fixtureMuestreo(fixtureResumen({ I_calculado: 7, J_calculado: 12, M_calculado: 8 }))
    const desc = buildDescripcionRaw(d)
    expect(desc).toContain('(I): 7')
    expect(desc).toContain('(J): 12')
    expect(desc).toContain('(M): 8')
  })

  it('menciona campos dudosos cuando existen', () => {
    const d = fixtureMuestreo(fixtureResumen(), ['resumen.K (calculado: 6.7, formulario: 9)'])
    const desc = buildDescripcionRaw(d)
    expect(desc).toMatch(/Campos con discrepancia/)
    expect(desc).toContain('resumen.K')
  })

  it('omite la sección de discrepancia si camposDudosos está vacío', () => {
    const d = fixtureMuestreo(fixtureResumen())
    const desc = buildDescripcionRaw(d)
    expect(desc).not.toMatch(/Campos con discrepancia/)
  })
})

// ─── buildWhatsappSummary ────────────────────────────────────────────────────

describe('buildWhatsappSummary', () => {
  it('genera alerta cuando J_calculado > 10', () => {
    const d = fixtureMuestreo(fixtureResumen({ J_calculado: 15 }))
    const msg = buildWhatsappSummary(d, [])
    expect(msg).toMatch(/EE3-6/)
    expect(msg).toMatch(/15%/)
  })

  it('genera alerta cuando I_calculado > 5', () => {
    const d = fixtureMuestreo(fixtureResumen({ I_calculado: 7 }))
    const msg = buildWhatsappSummary(d, [])
    expect(msg).toMatch(/EE2 avanzado/)
  })

  it('genera alerta cuando M_calculado < 9', () => {
    const d = fixtureMuestreo(fixtureResumen({ M_calculado: 7 }))
    const msg = buildWhatsappSummary(d, [])
    expect(msg).toMatch(/hojas funcionales bajo/)
  })

  it('no genera alertas con valores normales', () => {
    const d = fixtureMuestreo(fixtureResumen({ I_calculado: 2, J_calculado: 3, M_calculado: 11 }))
    const msg = buildWhatsappSummary(d, [])
    expect(msg).not.toMatch(/⚠️/)
  })

  it('incluye nota de aclaración cuando camposAclarar tiene items', () => {
    const d = fixtureMuestreo(fixtureResumen())
    const msg = buildWhatsappSummary(d, ['resumen.K (calculado: 6.7, formulario: 9)'])
    expect(msg).toMatch(/Encontré 1 valor con discrepancia/)
  })

  it('pluraliza correctamente con múltiples aclaraciones', () => {
    const d = fixtureMuestreo(fixtureResumen())
    const msg = buildWhatsappSummary(d, ['resumen.K', 'resumen.J'])
    expect(msg).toMatch(/2 valores con discrepancia/)
  })
})

// ─── SigatokaMuestreoSchema ──────────────────────────────────────────────────

describe('SigatokaMuestreoSchema', () => {
  it('parsea correctamente un muestreo completo', () => {
    const d = fixtureMuestreo(fixtureResumen())
    expect(() => SigatokaMuestreoSchema.parse(d)).not.toThrow()
  })

  it('acepta null en campos opcionales', () => {
    const d = fixtureMuestreo(fixtureResumen())
    d.supervisor = null
    d.puntosMuestreo = [{
      punto: 'P1',
      planta1_estadio: null, planta1_piscas: null,
      planta2_estadio: null, planta2_piscas: null,
      planta3_estadio: null, planta3_piscas: null,
      hVle: null, hVlq: null, func: null,
      marcaEspecial: null,
    }]
    expect(() => SigatokaMuestreoSchema.parse(d)).not.toThrow()
  })

  it('rechaza confidenceScore fuera de 0-1', () => {
    const d = fixtureMuestreo(fixtureResumen())
    d.confidenceScore = 1.5
    expect(() => SigatokaMuestreoSchema.parse(d)).toThrow()
  })

  it('acepta planta1_piscas=3 y planta1_estadio=2 para el valor escrito "2(3)"', () => {
    const d = fixtureMuestreo(fixtureResumen())
    d.puntosMuestreo = [{
      punto: 'P1',
      planta1_estadio: 2, planta1_piscas: 3,
      planta2_estadio: null, planta2_piscas: null,
      planta3_estadio: null, planta3_piscas: null,
      hVle: 7, hVlq: 8, func: 9,
      marcaEspecial: null,
    }]
    const parsed = SigatokaMuestreoSchema.parse(d)
    expect(parsed.puntosMuestreo[0]!.planta1_estadio).toBe(2)
    expect(parsed.puntosMuestreo[0]!.planta1_piscas).toBe(3)
  })

  it('acepta marcaEspecial="PR" en puntosMuestreo', () => {
    const d = fixtureMuestreo(fixtureResumen())
    d.puntosMuestreo = [{
      punto: 'P1',
      planta1_estadio: null, planta1_piscas: null,
      planta2_estadio: null, planta2_piscas: null,
      planta3_estadio: null, planta3_piscas: null,
      hVle: null, hVlq: null, func: null,
      marcaEspecial: 'PR',
    }]
    const parsed = SigatokaMuestreoSchema.parse(d)
    expect(parsed.puntosMuestreo[0]!.marcaEspecial).toBe('PR')
  })

  it('rechaza semana > 52', () => {
    const d = fixtureMuestreo(fixtureResumen())
    d.semana = 53
    expect(() => SigatokaMuestreoSchema.parse(d)).toThrow()
  })
})

// ─── extractSigatokaMuestreo (integración con prompt + Zod) ──────────────────

describe('extractSigatokaMuestreo', () => {
  it('extrae JSON, calcula fórmulas, detecta discrepancias y devuelve camposAclarar (máx 2)', async () => {
    PromptManager.clearCache()

    const rawJson = {
      zona: 'Litoral', codigoFinca: 'F001', nombreFinca: 'Bananera Test',
      semana: 23, periodo: 6, fecha: '2026-06-05', supervisor: 'Juan',
      puntosMuestreo: [],
      plantas: [],
      resumen: {
        A: 20, B: 100, C: 4, D: 2, E: 6, F: 20, G: 180,
        H_formulario: 99,  // discrepa con (4/20)*100 = 20
        I_formulario: 99,  // discrepa con (2/20)*100 = 10
        J_formulario: 99,  // discrepa con (6/20)*100 = 30
        K_formulario: null, L_formulario: null, M_formulario: null,
      },
      plantas11sem: [],
      plagasFoliares: {
        ceramida: { h: 1, p: 1, m: 0 },
        sibine:   { h: 0, p: 0, m: 0 },
      },
      confidenceScore: 0.85,
      camposDudosos: [],
    }

    const vision: SigatokaVisionFn = vi.fn().mockResolvedValue(JSON.stringify(rawJson))

    const { data, camposAclarar } = await extractSigatokaMuestreo(
      'fake-base64', 'image/jpeg', vision, 'trace-test-1',
    )

    expect(vision).toHaveBeenCalledOnce()
    expect(data.resumen.H_calculado).toBe(20)
    expect(data.resumen.J_calculado).toBe(30)
    expect(data.camposDudosos.length).toBeGreaterThanOrEqual(3)
    expect(camposAclarar).toHaveLength(2)
    expect(data.requiereValidacion).toBe(true)
  })

  it('marca requiereValidacion=true cuando confidenceScore < 0.75 aunque no haya discrepancias', async () => {
    PromptManager.clearCache()

    const rawJson = {
      zona: 'X', codigoFinca: 'F001', nombreFinca: 'X',
      semana: 1, periodo: 1, fecha: '2026-01-01', supervisor: null,
      puntosMuestreo: [], plantas: [], plantas11sem: [],
      resumen: {
        A: 10, B: 50, C: 0, D: 0, E: 0, F: 10, G: 90,
        H_formulario: null, I_formulario: null, J_formulario: null,
        K_formulario: null, L_formulario: null, M_formulario: null,
      },
      plagasFoliares: {
        ceramida: { h: null, p: null, m: null },
        sibine:   { h: null, p: null, m: null },
      },
      confidenceScore: 0.5,
      camposDudosos: [],
    }

    const vision: SigatokaVisionFn = vi.fn().mockResolvedValue(JSON.stringify(rawJson))
    const { data } = await extractSigatokaMuestreo('b64', 'image/jpeg', vision, 'trace-2')

    expect(data.requiereValidacion).toBe(true)
  })

  it('throw cuando el LLM no devuelve JSON válido', async () => {
    PromptManager.clearCache()
    const vision: SigatokaVisionFn = vi.fn().mockResolvedValue('not json at all')
    await expect(
      extractSigatokaMuestreo('b64', 'image/jpeg', vision, 'trace-3'),
    ).rejects.toThrow(/JSON inválido/)
  })
})
