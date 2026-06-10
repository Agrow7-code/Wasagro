import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: {
    trace: vi.fn().mockReturnValue({ event: vi.fn(), generation: vi.fn().mockReturnValue({ end: vi.fn() }) }),
    getPrompt: vi.fn().mockRejectedValue(new Error('no langfuse')),
  },
}))

import {
  calcularColumna,
  detectarCamposDudosos,
  detectarFormularioSigatoka,
  mapearSectoresALotes,
  construirFallbackSigatoka,
  buildDescripcionRaw,
  buildWhatsappSummary,
  extractSigatokaMuestreo,
  normalizarCelda,
  contarCeldasIlegibles,
  buildPreguntaAclaracion,
  aplicarAclaraciones,
  type ResumenColumnaSinCalculo,
  type SigatokaVisionFn,
} from '../../src/pipeline/handlers/SigatokaHandler.js'
import {
  SigatokaMuestreoSchema,
  type SigatokaMuestreo,
  type ResumenColumna,
  type PuntoMuestreoSigatoka,
  type CeldaMuestra,
  type EstadoCelda,
} from '../../src/types/dominio/SigatokaMuestreo.js'
import { PromptManager } from '../../src/pipeline/promptManager.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function colRaw(o: Partial<ResumenColumnaSinCalculo> = {}): ResumenColumnaSinCalculo {
  return {
    A: 19, B: 127, C: 0, D: 0, E: 0, F: 19, G: 171,
    H_formulario: null, I_formulario: null, J_formulario: null,
    K_formulario: null, L_formulario: null, M_formulario: null,
    ...o,
  }
}

function fullCol(o: Partial<ResumenColumna> = {}): ResumenColumna {
  return { ...calcularColumna(colRaw()), ...o }
}

function muestreo(columnas: ResumenColumna[], camposDudosos: string[] = [], top: Partial<SigatokaMuestreo> = {}): SigatokaMuestreo {
  return {
    confidenceScore: 0.9,
    requiereValidacion: camposDudosos.length > 0,
    camposDudosos,
    zona: 'Manabi', codigoFinca: '360', nombreFinca: 'A-Michell',
    semana: 23, periodo: 6, fecha: '2026-06-05', supervisor: 'Marios',
    puntosMuestreo: [], plantas: [], resumenColumnas: columnas, plantas11sem: [],
    plagasFoliares: { ceramida: { h: 2, p: 1, m: 0 }, sibine: { h: 0, p: 0, m: 0 } },
    ...top,
  }
}

function celda(valor: number | null = null, estado: EstadoCelda = valor != null ? 'leida' : 'vacia'): CeldaMuestra {
  return { valor, estado }
}

function punto(o: Partial<PuntoMuestreoSigatoka> = {}): PuntoMuestreoSigatoka {
  return {
    punto: 'P1', sector: null, lote_id: null,
    planta1_estadio: celda(), planta1_piscas: celda(),
    planta2_estadio: celda(), planta2_piscas: celda(),
    planta3_estadio: celda(), planta3_piscas: celda(),
    hVle: celda(), hVlq: celda(), func: celda(), marcaEspecial: null, ...o,
  }
}

// ─── calcularColumna (null-safe) ─────────────────────────────────────────────

describe('calcularColumna', () => {
  it('H = (C/A)·100 con A=19, C=0 → 0', () => {
    expect(calcularColumna(colRaw()).H_calculado).toBe(0)
  })

  it('K = B/A con B=127, A=19 → 6.7', () => {
    expect(calcularColumna(colRaw({ B: 127, A: 19 })).K_calculado).toBe(6.7)
  })

  it('A=0 → calculados null (NO lanza)', () => {
    const r = calcularColumna(colRaw({ A: 0 }))
    expect(r.H_calculado).toBeNull()
    expect(r.K_calculado).toBeNull()
  })

  it('A=null → calculados null', () => {
    expect(calcularColumna(colRaw({ A: null })).J_calculado).toBeNull()
  })

  it('I = (D/A)·100 con A=20, D=1 → 5', () => {
    expect(calcularColumna(colRaw({ A: 20, D: 1 })).I_calculado).toBe(5)
  })
})

// ─── detectarCamposDudosos (multi-columna) ───────────────────────────────────

describe('detectarCamposDudosos', () => {
  it('vacío cuando calculado ≈ formulario', () => {
    expect(detectarCamposDudosos([fullCol({ K_calculado: 6.7, K_formulario: 6.8 })])).toEqual([])
  })

  it('flaggea la columna correcta con su índice', () => {
    const d = detectarCamposDudosos([fullCol(), fullCol({ J_calculado: 5, J_formulario: 12 })])
    expect(d).toHaveLength(1)
    expect(d[0]).toContain('resumen[col2].J')
  })

  it('null-safe: calc null no rompe ni flaggea', () => {
    expect(detectarCamposDudosos([fullCol({ J_calculado: null, J_formulario: 12 })])).toEqual([])
  })
})

// ─── detectarFormularioSigatoka ──────────────────────────────────────────────

describe('detectarFormularioSigatoka', () => {
  it('true con 3+ marcadores', () => {
    expect(detectarFormularioSigatoka('SIGATOKA H+VLE FUNC semana 23')).toBe(true)
  })
  it('false con menos de 3', () => {
    expect(detectarFormularioSigatoka('reporte de cosecha banano')).toBe(false)
  })
  it('false con string vacío', () => {
    expect(detectarFormularioSigatoka('')).toBe(false)
  })
})

// ─── mapearSectoresALotes ────────────────────────────────────────────────────

describe('mapearSectoresALotes', () => {
  const lotes = [
    { lote_id: 'F360-L01', nombre: 'Corrijal' },
    { lote_id: 'F360-L02', nombre: 'Arrastradero' },
  ]

  it('asigna lote_id cuando el sector coincide (case/acentos-insensible)', () => {
    const r = mapearSectoresALotes([punto({ sector: 'CORRIJAL' }), punto({ sector: 'arrastradero' })], lotes)
    expect(r[0]!.lote_id).toBe('F360-L01')
    expect(r[1]!.lote_id).toBe('F360-L02')
  })

  it('lote_id null cuando el sector no coincide con ningún lote', () => {
    expect(mapearSectoresALotes([punto({ sector: 'desconocido' })], lotes)[0]!.lote_id).toBeNull()
  })

  it('deja el punto igual cuando no tiene sector', () => {
    expect(mapearSectoresALotes([punto({ sector: null })], lotes)[0]!.lote_id).toBeNull()
  })
})

// ─── normalizarCelda (estado por celda — I5) ─────────────────────────────────

describe('normalizarCelda', () => {
  it('número crudo → leída', () => {
    expect(normalizarCelda(5)).toEqual({ valor: 5, estado: 'leida' })
  })
  it('null → vacía', () => {
    expect(normalizarCelda(null)).toEqual({ valor: null, estado: 'vacia' })
  })
  it('objeto con estado ilegible y valor null → ilegible', () => {
    expect(normalizarCelda({ valor: null, estado: 'ilegible' })).toEqual({ valor: null, estado: 'ilegible' })
  })
  it('valor presente fuerza leída aunque el modelo diga ilegible (no contradicción)', () => {
    expect(normalizarCelda({ valor: 7, estado: 'ilegible' })).toEqual({ valor: 7, estado: 'leida' })
  })
  it('estado desconocido con valor null → vacía (conservador, no inventa ilegible)', () => {
    expect(normalizarCelda({ valor: null, estado: 'raro' })).toEqual({ valor: null, estado: 'vacia' })
  })
  it('basura → vacía', () => {
    expect(normalizarCelda('x')).toEqual({ valor: null, estado: 'vacia' })
  })

  it('número en string ("2", "6,6") → leída (modelos de visión devuelven texto)', () => {
    expect(normalizarCelda('2')).toEqual({ valor: 2, estado: 'leida' })
    expect(normalizarCelda({ valor: '6,6' })).toEqual({ valor: 6.6, estado: 'leida' })
  })
})

// ─── contarCeldasIlegibles (señal para "preguntar al tomador") ────────────────

describe('contarCeldasIlegibles', () => {
  it('0 ilegibles → ruta completo', () => {
    const r = contarCeldasIlegibles([punto(), punto({ planta1_estadio: celda(2) })])
    expect(r.total).toBe(0)
    expect(r.ruta).toBe('completo')
  })

  it('1-5 ilegibles → ruta preguntar, con ubicación localizable', () => {
    const p = punto({ punto: 'P3', sector: 'Corrijal', planta2_estadio: celda(null, 'ilegible') })
    const r = contarCeldasIlegibles([p])
    expect(r.total).toBe(1)
    expect(r.ruta).toBe('preguntar')
    expect(r.ubicaciones[0]).toMatchObject({ punto: 'P3', sector: 'Corrijal', campo: 'planta2_estadio' })
  })

  it('>5 ilegibles → ruta manual', () => {
    const p = punto({
      planta1_estadio: celda(null, 'ilegible'), planta1_piscas: celda(null, 'ilegible'),
      planta2_estadio: celda(null, 'ilegible'), planta2_piscas: celda(null, 'ilegible'),
      planta3_estadio: celda(null, 'ilegible'), planta3_piscas: celda(null, 'ilegible'),
    })
    const r = contarCeldasIlegibles([p])
    expect(r.total).toBe(6)
    expect(r.ruta).toBe('manual')
  })

  it('una celda vacía NO cuenta como ilegible (no torturar por celdas en blanco)', () => {
    expect(contarCeldasIlegibles([punto({ planta1_estadio: celda(null, 'vacia') })]).total).toBe(0)
  })
})

// ─── buildPreguntaAclaracion (follow-up "preguntar al tomador") ───────────────

describe('buildPreguntaAclaracion', () => {
  it('lista las celdas ilegibles con etiqueta legible y pluraliza', () => {
    const q = buildPreguntaAclaracion([
      { punto: 'P3', sector: 'Corrijal', campo: 'planta2_estadio' },
      { punto: 'P5', sector: null, campo: 'hVle' },
    ])
    expect(q).toContain('P3')
    expect(q).toContain('planta 2 estadio')
    expect(q).toContain('P5')
    expect(q).toContain('H+VLE')
    expect(q).toMatch(/2 valores/)
  })

  it('singular con una sola celda', () => {
    const q = buildPreguntaAclaracion([{ punto: 'P1', sector: null, campo: 'func' }])
    expect(q).toMatch(/1 valor\b/)
  })
})

// ─── aplicarAclaraciones (merge de respuestas del tomador) ────────────────────

describe('aplicarAclaraciones', () => {
  const base = () => muestreo([fullCol()], [], {
    confidenceScore: 0.9,
    puntosMuestreo: [
      punto({ punto: 'P3', planta2_estadio: celda(null, 'ilegible') }),
      punto({ punto: 'P5', hVle: celda(null, 'ilegible') }),
    ],
  })

  it('completa la celda ilegible con el valor del tomador → leída', () => {
    const r = aplicarAclaraciones(base(), [{ punto: 'P3', campo: 'planta2_estadio', valor: 4 }])
    expect(r.puntosMuestreo[0]!.planta2_estadio).toEqual({ valor: 4, estado: 'leida' })
  })

  it('deja en ilegible la celda no respondida y mantiene requiereValidacion', () => {
    const r = aplicarAclaraciones(base(), [{ punto: 'P3', campo: 'planta2_estadio', valor: 4 }])
    expect(r.puntosMuestreo[1]!.hVle.estado).toBe('ilegible')
    expect(r.requiereValidacion).toBe(true)
  })

  it('resueltas TODAS y sin otras dudas → requiereValidacion false', () => {
    const r = aplicarAclaraciones(base(), [
      { punto: 'P3', campo: 'planta2_estadio', valor: 4 },
      { punto: 'P5', campo: 'hVle', valor: 7 },
    ])
    expect(r.requiereValidacion).toBe(false)
  })

  it('ignora valor null y no pisa una celda ya leída (solo toca ilegibles)', () => {
    const m = muestreo([fullCol()], [], { puntosMuestreo: [punto({ punto: 'P1', planta1_estadio: celda(2) })] })
    const r = aplicarAclaraciones(m, [
      { punto: 'P1', campo: 'planta1_estadio', valor: 9 }, // ya leída → no pisar
      { punto: 'P3', campo: 'planta2_estadio', valor: null }, // null → ignorar
    ])
    expect(r.puntosMuestreo[0]!.planta1_estadio.valor).toBe(2)
  })
})

// ─── buildWhatsappSummary (alerta sobre la PEOR columna — I8) ─────────────────

describe('buildWhatsappSummary — alerta multi-columna', () => {
  it('alerta cuando ALGUNA columna tiene J > 10 (no perder el peor caso)', () => {
    const m = muestreo([fullCol({ J_calculado: 0 }), fullCol({ J_calculado: 29 }), fullCol({ J_calculado: 95 })])
    const msg = buildWhatsappSummary(m, [])
    expect(msg).toMatch(/EE3-6/)
    expect(msg).toMatch(/95%/)
  })

  it('alerta I cuando alguna columna supera 5', () => {
    const msg = buildWhatsappSummary(muestreo([fullCol(), fullCol({ I_calculado: 7 })]), [])
    expect(msg).toMatch(/EE2 avanzado/)
  })

  it('alerta M cuando alguna columna baja de 9', () => {
    const msg = buildWhatsappSummary(muestreo([fullCol({ M_calculado: 7 }), fullCol()]), [])
    expect(msg).toMatch(/hojas funcionales bajo/)
  })

  it('sin alertas con valores normales', () => {
    const msg = buildWhatsappSummary(muestreo([fullCol({ H_calculado: 5, I_calculado: 2, J_calculado: 3, M_calculado: 11 })]), [])
    expect(msg).not.toMatch(/⚠️/)
  })

  it('muestra EE2 leve (1-3) por las 3 columnas — no esconde el peor caso', () => {
    const msg = buildWhatsappSummary(muestreo([
      fullCol({ H_calculado: 0 }), fullCol({ H_calculado: 10.5 }), fullCol({ H_calculado: 47.4 }),
    ]), [])
    expect(msg).toMatch(/1-3/)
    expect(msg).toContain('47.4%')
    expect(msg).toContain('10.5%')
  })

  it('distingue EE2 leve (1-3) de EE2 avanzado (4+)', () => {
    const msg = buildWhatsappSummary(muestreo([fullCol({ H_calculado: 47, I_calculado: 0 })]), [])
    expect(msg).toMatch(/EE2 avanzado/)
    expect(msg).toMatch(/1-3/)
  })

  it('alerta cuando EE2 leve (1-3) supera el umbral', () => {
    const msg = buildWhatsappSummary(muestreo([fullCol({ H_calculado: 47 })]), [])
    expect(msg).toMatch(/⚠️.*EE2 \(1-3\)/)
  })

  it('muestra cuántas plantas de 11 semanas se evaluaron', () => {
    const onceSem = [
      { ht: 8, hVle: 0, q5menos: 3, q5mas: 8, lc: 7 },
      { ht: 7, hVle: 0, q5menos: 2, q5mas: 7, lc: 6 },
    ]
    const msg = buildWhatsappSummary(muestreo([fullCol()], [], { plantas11sem: onceSem }), [])
    expect(msg).toMatch(/11 sem/)
    expect(msg).toMatch(/\b2\b/)
  })

  it('estado general CRÍTICO cuando EE3-6 supera 10', () => {
    const msg = buildWhatsappSummary(muestreo([fullCol({ J_calculado: 15 })]), [])
    expect(msg).toMatch(/CRÍTICO/)
  })

  it('estado general ATENCIÓN cuando EE2 (1-3) alto pero sin severos', () => {
    const msg = buildWhatsappSummary(muestreo([fullCol({ H_calculado: 47, I_calculado: 0, J_calculado: 0, M_calculado: 11 })]), [])
    expect(msg).toMatch(/ATENCIÓN/)
    expect(msg).not.toMatch(/CRÍTICO/)
  })

  it('estado general BAJO CONTROL con valores sanos', () => {
    const msg = buildWhatsappSummary(muestreo([fullCol({ H_calculado: 5, I_calculado: 1, J_calculado: 2, M_calculado: 12 })]), [])
    expect(msg).toMatch(/BAJO CONTROL/)
  })

  it('muestra supervisor y fecha; NO muestra erradicadas/índice EF (zona poco confiable)', () => {
    const m = muestreo([fullCol()], [], { supervisor: 'Marios', fecha: '2026-06-05', erradicadasBsv: 264, pEfFinca: 0.8 })
    const msg = buildWhatsappSummary(m, [])
    expect(msg).toContain('Marios')
    expect(msg).toContain('2026-06-05')
    expect(msg).not.toContain('264')
    expect(msg).not.toMatch(/Índice EF/)
  })

  it('omite plagas foliares cuando vienen en 0/null (no muestra ceros no confiables)', () => {
    const m = muestreo([fullCol()], [], { plagasFoliares: { ceramida: { h: 0, p: 0, m: 0 }, sibine: { h: null, p: null, m: null } } })
    expect(buildWhatsappSummary(m, [])).not.toMatch(/Plagas foliares/)
  })

  it('muestra plagas foliares cuando hay algún valor real', () => {
    const m = muestreo([fullCol()], [], { plagasFoliares: { ceramida: { h: 13, p: 7, m: 12 }, sibine: { h: 0, p: 0, m: 0 } } })
    const msg = buildWhatsappSummary(m, [])
    expect(msg).toMatch(/Plagas foliares/)
    expect(msg).toContain('13')
  })

  it('avisa que el asesor revisa cuando hay camposAclarar — sin prometer un follow-up del bot', () => {
    const msg = buildWhatsappSummary(muestreo([fullCol()]), ['resumen[col1].K (…)'])
    // Honesto: derivamos al asesor (el recálculo es la fuente confiable), no
    // prometemos escribirle nosotros (no existe esa máquina de seguimiento).
    expect(msg).toMatch(/asesor/)
    expect(msg).not.toMatch(/te escribo/)
    expect(msg).not.toMatch(/en un momento/)
  })

  it('pluraliza el aviso de revisión y no usa el emoji ❓', () => {
    const unMsg = buildWhatsappSummary(muestreo([fullCol()]), ['a'])
    const dosMsg = buildWhatsappSummary(muestreo([fullCol()]), ['a', 'b'])
    expect(unMsg).toMatch(/1 valor\b/)
    expect(dosMsg).toMatch(/2 valores\b/)
    expect(unMsg).not.toContain('❓')
  })
})

// ─── buildDescripcionRaw ─────────────────────────────────────────────────────

describe('buildDescripcionRaw', () => {
  it('incluye finca, semana, el peor J y el peor EE2 (1-3)', () => {
    const d = buildDescripcionRaw(muestreo([fullCol({ J_calculado: 3, H_calculado: 12 }), fullCol({ J_calculado: 40, H_calculado: 47 })]))
    expect(d).toContain('A-Michell')
    expect(d).toContain('semana 23')
    expect(d).toContain('(J): 40%')
    expect(d).toContain('47')
  })

  it('tolera columnas vacías sin romper', () => {
    expect(() => buildDescripcionRaw(muestreo([]))).not.toThrow()
  })
})

// ─── construirFallbackSigatoka (nunca lanza, siempre Zod-válido) ──────────────

describe('construirFallbackSigatoka', () => {
  it('desde JSON basura → objeto válido, requiereValidacion, confidence 0', () => {
    const fb = construirFallbackSigatoka({ zona: 123, resumenColumnas: 'no-array' }, 'semana: required')
    expect(() => SigatokaMuestreoSchema.parse(fb)).not.toThrow()
    expect(fb.requiereValidacion).toBe(true)
    expect(fb.confidenceScore).toBe(0)
    expect(fb.zona).toBeNull()
    expect(fb.camposDudosos[0]).toContain('semana: required')
  })

  it('desde null → mínimo válido', () => {
    expect(() => SigatokaMuestreoSchema.parse(construirFallbackSigatoka(null, null))).not.toThrow()
  })

  it('rescata lo que sí es del tipo correcto (celdas crudas → leída)', () => {
    const fb = construirFallbackSigatoka({
      nombreFinca: 'A-Michell', semana: 23,
      resumenColumnas: [{ A: 19, B: 127, C: 9 }],
      puntosMuestreo: [{ punto: 'P1', sector: 'Corrijal', planta1_estadio: 2, planta1_piscas: 3 }],
    }, null)
    expect(fb.nombreFinca).toBe('A-Michell')
    expect(fb.resumenColumnas[0]!.H_calculado).toBe(47.4) // (9/19)*100
    expect(fb.puntosMuestreo[0]!.sector).toBe('Corrijal')
    expect(fb.puntosMuestreo[0]!.planta1_piscas).toEqual({ valor: 3, estado: 'leida' })
    expect(fb.puntosMuestreo[0]!.planta2_estadio).toEqual({ valor: null, estado: 'vacia' })
  })
})

// ─── SigatokaMuestreoSchema ──────────────────────────────────────────────────

describe('SigatokaMuestreoSchema', () => {
  it('parsea un muestreo completo', () => {
    expect(() => SigatokaMuestreoSchema.parse(muestreo([fullCol()]))).not.toThrow()
  })

  it('acepta identidad nullable', () => {
    expect(() => SigatokaMuestreoSchema.parse(muestreo([fullCol()], [], { zona: null, nombreFinca: null, semana: null, fecha: null }))).not.toThrow()
  })

  it('acepta planta1_estadio=2 / planta1_piscas=3 (valor "2(3)")', () => {
    const m = muestreo([fullCol()], [], { puntosMuestreo: [punto({ planta1_estadio: celda(2), planta1_piscas: celda(3) })] })
    const p = SigatokaMuestreoSchema.parse(m)
    expect(p.puntosMuestreo[0]!.planta1_piscas.valor).toBe(3)
  })

  it('rechaza un estado de celda inválido', () => {
    const m = muestreo([fullCol()], [], { puntosMuestreo: [punto({ planta1_estadio: { valor: null, estado: 'borrosa' as EstadoCelda } })] })
    expect(() => SigatokaMuestreoSchema.parse(m)).toThrow()
  })

  it('rechaza confidenceScore fuera de 0-1', () => {
    expect(() => SigatokaMuestreoSchema.parse(muestreo([fullCol()], [], { confidenceScore: 1.5 }))).toThrow()
  })

  it('rechaza semana > 53', () => {
    expect(() => SigatokaMuestreoSchema.parse(muestreo([fullCol()], [], { semana: 54 }))).toThrow()
  })

  it('coerce números en string del modelo de visión ("6,6" → 6.6)', () => {
    const m = muestreo([fullCol()], [])
    ;(m.resumenColumnas[0] as any).K_formulario = '6,6'
    ;(m as any).pEfFinca = '0.8'
    const p = SigatokaMuestreoSchema.parse(m)
    expect(p.resumenColumnas[0]!.K_formulario).toBe(6.6)
    expect(p.pEfFinca).toBe(0.8)
  })
})

// ─── extractSigatokaMuestreo (integración con prompt + Zod) ──────────────────

describe('extractSigatokaMuestreo', () => {
  it('extrae, calcula columnas, detecta discrepancias y devuelve camposAclarar (máx 2)', async () => {
    PromptManager.clearCache()
    const rawJson = {
      zona: 'Manabi', codigoFinca: '360', nombreFinca: 'A-Michell',
      semana: 23, periodo: 6, fecha: '2026-06-05', supervisor: 'Marios',
      puntosMuestreo: [], plantas: [],
      resumenColumnas: [
        { A: 20, B: 100, C: 4, D: 2, E: 6, F: 20, G: 180,
          H_formulario: 99, I_formulario: 99, J_formulario: 99,
          K_formulario: null, L_formulario: null, M_formulario: null },
      ],
      plantas11sem: [],
      plagasFoliares: { ceramida: { h: 1, p: 1, m: 0 }, sibine: { h: 0, p: 0, m: 0 } },
      confidenceScore: 0.85, camposDudosos: [],
    }
    const vision: SigatokaVisionFn = vi.fn().mockResolvedValue(JSON.stringify(rawJson))
    const { data, camposAclarar } = await extractSigatokaMuestreo('b64', 'image/jpeg', vision, 'trace-1')

    expect(data.resumenColumnas[0]!.H_calculado).toBe(20)  // (4/20)*100
    expect(data.resumenColumnas[0]!.J_calculado).toBe(30)  // (6/20)*100
    expect(data.camposDudosos.length).toBeGreaterThanOrEqual(3)
    expect(camposAclarar).toHaveLength(2)
    expect(data.requiereValidacion).toBe(true)
  })

  it('requiereValidacion=true cuando confidenceScore < 0.75', async () => {
    PromptManager.clearCache()
    const rawJson = {
      zona: 'X', codigoFinca: '1', nombreFinca: 'X', semana: 1, periodo: 1, fecha: '2026-01-01', supervisor: null,
      puntosMuestreo: [], plantas: [], plantas11sem: [],
      resumenColumnas: [{ A: 10, B: 50, C: 0, D: 0, E: 0, F: 10, G: 90,
        H_formulario: null, I_formulario: null, J_formulario: null, K_formulario: null, L_formulario: null, M_formulario: null }],
      plagasFoliares: { ceramida: { h: null, p: null, m: null }, sibine: { h: null, p: null, m: null } },
      confidenceScore: 0.5, camposDudosos: [],
    }
    const vision: SigatokaVisionFn = vi.fn().mockResolvedValue(JSON.stringify(rawJson))
    const { data } = await extractSigatokaMuestreo('b64', 'image/jpeg', vision, 'trace-2')
    expect(data.requiereValidacion).toBe(true)
  })

  it('lanza cuando el LLM no devuelve JSON válido (el graceful vive en el agente)', async () => {
    PromptManager.clearCache()
    const vision: SigatokaVisionFn = vi.fn().mockResolvedValue('not json')
    await expect(extractSigatokaMuestreo('b64', 'image/jpeg', vision, 'trace-3')).rejects.toThrow(/JSON inválido/)
  })
})
