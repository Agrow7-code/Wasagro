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
  mapearSectoresALotesFilas,
  construirFallbackSigatoka,
  buildDescripcionRaw,
  buildWhatsappSummary,
  extractSigatokaMuestreo,
  normalizarCelda,
  normalizarFilaSemana,
  contarCeldasIlegibles,
  buildPreguntaAclaracion,
  aplicarAclaraciones,
  aplicarCorrecciones,
  verificarChecksumTabla,
  filasConDato,
  elegirMejorTabla,
  reconciliarCrossField,
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
  type FilaSemana,
  type TotalesSemana,
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
    puntosMuestreo: [], plantas: [], resumenColumnas: columnas, plantas11sem: [], plantas00sem: [],
    plagasFoliares: { ceramida: { h: 2, p: 1, m: 0 }, sibine: { h: 0, p: 0, m: 0 } },
    ...top,
  }
}

function fila11(overrides: Partial<FilaSemana> = {}): FilaSemana {
  return {
    fila: 1, sector: null, lote_id: null,
    ht:      { valor: 12, estado: 'leida' },
    hVle:    { valor: 5,  estado: 'leida' },
    q5menos: { valor: 8,  estado: 'leida' },
    q5mas:   { valor: 12, estado: 'leida' },
    lc:      { valor: 11, estado: 'leida' },
    ...overrides,
  }
}

function totales11(overrides: Partial<TotalesSemana> = {}): TotalesSemana {
  return { ht: 264, hVle: 128, q5menos: 230, q5mas: 264, lc: 258, ...overrides }
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

  it('sin alertas con valores normales (3 columnas — guard lectura no activa)', () => {
    const col = fullCol({ H_calculado: 5, I_calculado: 2, J_calculado: 3, M_calculado: 11 })
    const msg = buildWhatsappSummary(muestreo([col, col, col]), [])
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

  it('cuenta plantas EVALUADAS (con dato), no las filas en blanco', () => {
    // 2 filas con dato + 2 filas vacías (renglones numerados sin muestrear).
    // Debe mostrar "2 plantas", no "4".
    const vacia = { ht: celda(null), hVle: celda(null), q5menos: celda(null), q5mas: celda(null), lc: celda(null) }
    const onceSem = [
      fila11({ fila: 1 }),
      fila11({ fila: 2 }),
      fila11({ fila: 3, ...vacia }),
      fila11({ fila: 4, ...vacia }),
    ]
    const msg = buildWhatsappSummary(muestreo([fullCol()], [], { plantas11sem: onceSem }), [])
    expect(msg).toMatch(/11 semanas\* — 2 plantas/)
    expect(msg).not.toMatch(/4 plantas/)
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

  it('estado general BAJO CONTROL con 3 columnas sanas', () => {
    // Necesita 3 columnas para que el guard de lectura parcial no tape el BAJO CONTROL.
    const col = fullCol({ H_calculado: 5, I_calculado: 1, J_calculado: 2, M_calculado: 12 })
    const msg = buildWhatsappSummary(muestreo([col, col, col]), [])
    expect(msg).toMatch(/BAJO CONTROL/)
  })

  it('muestra supervisor, fecha, erradicadas e índice EF cuando están presentes', () => {
    const m = muestreo([fullCol()], [], { supervisor: 'Marios', fecha: '2026-06-05', erradicadasBsv: 0, pEfFinca: 0.8 })
    const msg = buildWhatsappSummary(m, [])
    expect(msg).toContain('Marios')
    expect(msg).toContain('2026-06-05')
    expect(msg).toMatch(/Erradicadas BSV/)
    expect(msg).toMatch(/Índice EF/)
    expect(msg).toContain('0.8')
  })

  it('omite erradicadas/índice EF cuando la pasada no los leyó (null)', () => {
    const m = muestreo([fullCol()], [], { erradicadasBsv: null, pEfFinca: null })
    const msg = buildWhatsappSummary(m, [])
    expect(msg).not.toMatch(/Erradicadas BSV/)
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

// ─── FilaSemanaSchema — backward compat con forma vieja (números planos) ───────

describe('FilaSemanaSchema — backward compat', () => {
  it('número plano se eleva a {valor, estado:"leida"}', () => {
    const raw = { fila: 1, sector: null, lote_id: null, ht: 12, hVle: 5, q5menos: 8, q5mas: 12, lc: 11 }
    const parsed = SigatokaMuestreoSchema.parse(muestreo([fullCol()], [], { plantas11sem: [raw as any] }))
    expect(parsed.plantas11sem[0]!.ht).toEqual({ valor: 12, estado: 'leida' })
  })

  it('null se eleva a {valor:null, estado:"vacia"}', () => {
    const raw = { fila: 2, sector: null, lote_id: null, ht: null, hVle: null, q5menos: null, q5mas: null, lc: null }
    const parsed = SigatokaMuestreoSchema.parse(muestreo([fullCol()], [], { plantas11sem: [raw as any] }))
    expect(parsed.plantas11sem[0]!.ht).toEqual({ valor: null, estado: 'vacia' })
  })

  it('objeto {valor,estado} pasa sin modificación', () => {
    const parsed = SigatokaMuestreoSchema.parse(muestreo([fullCol()], [], { plantas11sem: [fila11()] }))
    expect(parsed.plantas11sem[0]!.ht).toEqual({ valor: 12, estado: 'leida' })
  })

  it('filas sin fila/sector/lote_id (forma vieja) → null en esos campos', () => {
    const raw = { ht: 10, hVle: 3, q5menos: 7, q5mas: 10, lc: 9 }
    const parsed = SigatokaMuestreoSchema.parse(muestreo([fullCol()], [], { plantas11sem: [raw as any] }))
    expect(parsed.plantas11sem[0]!.fila).toBeNull()
    expect(parsed.plantas11sem[0]!.sector).toBeNull()
    expect(parsed.plantas11sem[0]!.lote_id).toBeNull()
  })

  it('plantas00sem existe como array vacío por defecto', () => {
    const parsed = SigatokaMuestreoSchema.parse(muestreo([fullCol()]))
    expect(Array.isArray(parsed.plantas00sem)).toBe(true)
    expect(parsed.plantas00sem).toHaveLength(0)
  })
})

// ─── normalizarFilaSemana (helper de normalización) ───────────────────────────

describe('normalizarFilaSemana', () => {
  it('convierte número plano a CeldaMuestra leida', () => {
    const r = normalizarFilaSemana({ ht: 12, hVle: 5, q5menos: 8, q5mas: 12, lc: 11 })
    expect(r.ht).toEqual({ valor: 12, estado: 'leida' })
  })

  it('convierte null a CeldaMuestra vacia', () => {
    const r = normalizarFilaSemana({ ht: null, hVle: null, q5menos: null, q5mas: null, lc: null })
    expect(r.ht).toEqual({ valor: null, estado: 'vacia' })
  })

  it('objeto con estado ilegible y valor null → ilegible (mismo contrato que normalizarCelda)', () => {
    const r = normalizarFilaSemana({ ht: { valor: null, estado: 'ilegible' }, hVle: null, q5menos: null, q5mas: null, lc: null })
    expect(r.ht).toEqual({ valor: null, estado: 'ilegible' })
  })

  it('objeto con valor presente fuerza estado leida aunque venga como ilegible', () => {
    const r = normalizarFilaSemana({ ht: { valor: 7, estado: 'ilegible' }, hVle: null, q5menos: null, q5mas: null, lc: null })
    expect(r.ht).toEqual({ valor: 7, estado: 'leida' })
  })

  it('preserva fila, sector y lote_id si los tiene', () => {
    const r = normalizarFilaSemana({ fila: 5, sector: 'Torrijal', lote_id: 'F360-L01', ht: 10, hVle: 3, q5menos: 5, q5mas: 10, lc: 9 })
    expect(r.fila).toBe(5)
    expect(r.sector).toBe('Torrijal')
    expect(r.lote_id).toBe('F360-L01')
  })
})

// ─── verificarChecksumTabla ────────────────────────────────────────────────────

describe('verificarChecksumTabla', () => {
  it('columna cuadra cuando sumaFilas === totalFicha (con tolerancia ±1)', () => {
    // fila11() tiene: ht=12, hVle=5, q5menos=8, q5mas=12, lc=11
    // 2 filas → sumas: ht=24, hVle=10, q5menos=16, q5mas=24, lc=22
    const filas = [fila11({ fila: 1 }), fila11({ fila: 2 })]
    const tot: TotalesSemana = { ht: 24, hVle: 10, q5menos: 16, q5mas: 24, lc: 22 }
    const res = verificarChecksumTabla(filas, tot)
    expect(res.columnas.find(c => c.columna === 'ht')!.cuadra).toBe(true)
    expect(res.cuadraTodo).toBe(true)
  })

  it('columna no cuadra cuando suma difiere del total por más de 1', () => {
    const filas = Array.from({ length: 5 }, () => fila11({ ht: { valor: 10, estado: 'leida' } }))
    // suma real = 50, total dice 264
    const tot = totales11({ ht: 264 })
    const res = verificarChecksumTabla(filas, tot)
    expect(res.columnas.find(c => c.columna === 'ht')!.cuadra).toBe(false)
    expect(res.cuadraTodo).toBe(false)
  })

  it('cuadra=null cuando el total de la ficha es null (no hay con qué comparar)', () => {
    const filas = [fila11()]
    const res = verificarChecksumTabla(filas, { ht: null, hVle: null, q5menos: null, q5mas: null, lc: null })
    expect(res.columnas.find(c => c.columna === 'ht')!.cuadra).toBeNull()
    expect(res.cuadraTodo).toBeNull()
  })

  it('celdas ilegibles/vacías no se suman (solo valores presentes)', () => {
    // 10 filas: 5 con valor 10, 5 vacías → suma efectiva 50
    const filas = [
      ...Array.from({ length: 5 }, () => fila11({ ht: { valor: 10, estado: 'leida' } })),
      ...Array.from({ length: 5 }, () => fila11({ ht: { valor: null, estado: 'vacia' } })),
    ]
    const tot = totales11({ ht: 50 })
    const res = verificarChecksumTabla(filas, tot)
    expect(res.columnas.find(c => c.columna === 'ht')!.cuadra).toBe(true)
  })

  it('cuadraTodo=null cuando ningún total es legible', () => {
    const filas = [fila11()]
    const res = verificarChecksumTabla(filas, { ht: null, hVle: null, q5menos: null, q5mas: null, lc: null })
    expect(res.cuadraTodo).toBeNull()
  })

  it('cuadraTodo=false cuando al menos una columna no cuadra', () => {
    // ht cuadra, hVle no cuadra
    const filas = Array.from({ length: 2 }, () => fila11({ ht: { valor: 12, estado: 'leida' }, hVle: { valor: 5, estado: 'leida' } }))
    const tot = totales11({ ht: 24, hVle: 999 })
    const res = verificarChecksumTabla(filas, tot)
    expect(res.columnas.find(c => c.columna === 'ht')!.cuadra).toBe(true)
    expect(res.columnas.find(c => c.columna === 'hVle')!.cuadra).toBe(false)
    expect(res.cuadraTodo).toBe(false)
  })
})

// ─── mapearSectoresALotesFilas (sector→lote_id en FilaSemana) ─────────────────

describe('mapearSectoresALotesFilas', () => {
  const lotes = [{ lote_id: 'F360-L01', nombre: 'Torrijal' }]

  it('asigna lote_id cuando el sector coincide (case/acentos-insensible)', () => {
    const r = mapearSectoresALotesFilas([fila11({ sector: 'torrijal' })], lotes)
    expect(r[0]!.lote_id).toBe('F360-L01')
  })

  it('lote_id null cuando el sector no coincide', () => {
    const r = mapearSectoresALotesFilas([fila11({ sector: 'otro' })], lotes)
    expect(r[0]!.lote_id).toBeNull()
  })

  it('sin sector → lote_id null sin error', () => {
    const r = mapearSectoresALotesFilas([fila11({ sector: null })], lotes)
    expect(r[0]!.lote_id).toBeNull()
  })
})

// ─── contarCeldasIlegibles — extensión a filas 11/00 sem ─────────────────────

describe('contarCeldasIlegibles — filas semana', () => {
  it('detecta celda ilegible en fila 11sem y la ubica con punto legible', () => {
    const filas11 = [fila11({ fila: 14, ht: { valor: null, estado: 'ilegible' } })]
    const r = contarCeldasIlegibles([], filas11, [])
    expect(r.total).toBe(1)
    expect(r.ruta).toBe('preguntar')
    expect(r.ubicaciones[0]).toMatchObject({ punto: '11sem-14', campo: 'ht' })
  })

  it('detecta celda ilegible en fila 00sem', () => {
    const filas00 = [fila11({ fila: 3, lc: { valor: null, estado: 'ilegible' } })]
    const r = contarCeldasIlegibles([], [], filas00)
    expect(r.total).toBe(1)
    expect(r.ubicaciones[0]).toMatchObject({ punto: '00sem-3', campo: 'lc' })
  })

  it('celda vacía en fila semana NO cuenta como ilegible', () => {
    const filas11 = [fila11({ ht: { valor: null, estado: 'vacia' } })]
    expect(contarCeldasIlegibles([], filas11, []).total).toBe(0)
  })

  it('combina ilegibles de puntos + filas 11sem + filas 00sem', () => {
    const ptos = [punto({ punto: 'P1', planta1_estadio: celda(null, 'ilegible') })]
    const filas11 = [fila11({ fila: 5, ht: { valor: null, estado: 'ilegible' } })]
    const filas00 = [fila11({ fila: 2, lc: { valor: null, estado: 'ilegible' } })]
    const r = contarCeldasIlegibles(ptos, filas11, filas00)
    expect(r.total).toBe(3)
  })

  it('fila sin número de fila usa índice+1 como punto', () => {
    const filas11 = [fila11({ fila: null, ht: { valor: null, estado: 'ilegible' } })]
    const r = contarCeldasIlegibles([], filas11, [])
    expect(r.ubicaciones[0]!.punto).toBe('11sem-1')
  })
})

// ─── aplicarAclaraciones — round-trip sobre celda de 11sem ────────────────────

describe('aplicarAclaraciones — celdas de filas semana', () => {
  it('completa una celda ilegible de 11sem con el valor del tomador', () => {
    const base = muestreo([fullCol()], [], {
      plantas11sem: [fila11({ fila: 14, ht: { valor: null, estado: 'ilegible' } })],
    })
    const r = aplicarAclaraciones(base, [{ punto: '11sem-14', campo: 'ht', valor: 13 }])
    expect(r.plantas11sem[0]!.ht).toEqual({ valor: 13, estado: 'leida' })
  })

  it('completa una celda ilegible de 00sem con el valor del tomador', () => {
    const base = muestreo([fullCol()], [], {
      plantas00sem: [fila11({ fila: 3, lc: { valor: null, estado: 'ilegible' } })],
    })
    const r = aplicarAclaraciones(base, [{ punto: '00sem-3', campo: 'lc', valor: 9 }])
    expect(r.plantas00sem![0]!.lc).toEqual({ valor: 9, estado: 'leida' })
  })

  it('no toca celdas ya leídas en fila semana', () => {
    const base = muestreo([fullCol()], [], {
      plantas11sem: [fila11({ fila: 1 })], // ht ya leída con valor 12
    })
    const r = aplicarAclaraciones(base, [{ punto: '11sem-1', campo: 'ht', valor: 999 }])
    expect(r.plantas11sem[0]!.ht.valor).toBe(12) // no pisado
  })

  it('requiereValidacion queda false cuando todas las celdas ilegibles se resuelven', () => {
    const base = muestreo([fullCol()], [], {
      confidenceScore: 0.9,
      plantas11sem: [fila11({ fila: 5, ht: { valor: null, estado: 'ilegible' } })],
    })
    const r = aplicarAclaraciones(base, [{ punto: '11sem-5', campo: 'ht', valor: 10 }])
    expect(r.requiereValidacion).toBe(false)
  })
})

// ─── PlagaFoliarSchema con columna G ─────────────────────────────────────────

describe('PlagaFoliarSchema — columna G', () => {
  it('acepta ceramida con g presente', () => {
    const m = muestreo([fullCol()], [], {
      plagasFoliares: { ceramida: { h: 1, p: 0, m: 2, g: 5 }, sibine: { h: null, p: null, m: null, g: null } },
    })
    const parsed = SigatokaMuestreoSchema.parse(m)
    expect(parsed.plagasFoliares.ceramida.g).toBe(5)
  })

  it('g es null cuando la celda está en blanco (backward compat)', () => {
    const m = muestreo([fullCol()], [], {
      plagasFoliares: { ceramida: { h: 1, p: 0, m: 2 }, sibine: { h: null, p: null, m: null } },
    })
    const parsed = SigatokaMuestreoSchema.parse(m)
    expect(parsed.plagasFoliares.ceramida.g).toBeNull()
  })
})

// ─── pEfFincaT / pEfFincaFrec ────────────────────────────────────────────────

describe('pEfFincaT / pEfFincaFrec', () => {
  it('acepta pEfFincaT y pEfFincaFrec cuando están presentes', () => {
    const m = muestreo([fullCol()], [], { pEfFinca: 0.8, pEfFincaT: 210, pEfFincaFrec: 7 })
    const parsed = SigatokaMuestreoSchema.parse(m)
    expect(parsed.pEfFincaT).toBe(210)
    expect(parsed.pEfFincaFrec).toBe(7)
  })

  it('omite pEfFincaT y pEfFincaFrec cuando no están (backward compat)', () => {
    const parsed = SigatokaMuestreoSchema.parse(muestreo([fullCol()]))
    expect(parsed.pEfFincaT == null).toBe(true)
    expect(parsed.pEfFincaFrec == null).toBe(true)
  })
})

// ─── verificacion11sem / verificacion00sem en schema ─────────────────────────

describe('SigatokaMuestreoSchema — verificacion fields', () => {
  it('acepta verificacion11sem con estructura correcta', () => {
    const ver = {
      columnas: [
        { columna: 'ht', sumaFilas: 228, totalFicha: 264, cuadra: false },
      ],
      cuadraTodo: false,
    }
    const m = muestreo([fullCol()], [], { verificacion11sem: ver })
    const parsed = SigatokaMuestreoSchema.parse(m)
    expect(parsed.verificacion11sem!.cuadraTodo).toBe(false)
    expect(parsed.verificacion11sem!.columnas[0]!.columna).toBe('ht')
  })

  it('acepta verificacion11sem=null (sin totales legibles)', () => {
    const parsed = SigatokaMuestreoSchema.parse(muestreo([fullCol()], [], { verificacion11sem: null }))
    expect(parsed.verificacion11sem).toBeNull()
  })

  it('verificacion omitida → undefined (no requerida)', () => {
    const parsed = SigatokaMuestreoSchema.parse(muestreo([fullCol()]))
    expect(parsed.verificacion11sem).toBeUndefined()
  })
})

// ─── buildWhatsappSummary — extensiones (11sem, 00sem, checksum, G) ───────────

describe('buildWhatsappSummary — extensiones', () => {
  it('muestra conteo y Pr= de 11 semanas cuando hay totales en la ficha', () => {
    const m = muestreo([fullCol()], [], {
      plantas11sem: Array.from({ length: 19 }, (_, i) => fila11({ fila: i + 1 })),
      totales11sem: null,
      promedios11sem: { ht: 13.9, hVle: 6.7, q5menos: null, q5mas: 13.9, lc: 13.6 },
    })
    const msg = buildWhatsappSummary(m, [])
    expect(msg).toMatch(/11 sem/)
    expect(msg).toMatch(/\b19\b/)
    expect(msg).toContain('H.T')
    expect(msg).toMatch(/13\.9/)
  })

  it('muestra conteo de 00 semanas cuando hay filas', () => {
    const m = muestreo([fullCol()], [], {
      plantas00sem: Array.from({ length: 5 }, (_, i) => fila11({ fila: i + 1 })),
    })
    const msg = buildWhatsappSummary(m, [])
    expect(msg).toMatch(/00 sem/)
    expect(msg).toMatch(/\b5\b/)
  })

  it('omite líneas de semana cuando no hay filas ni promedios', () => {
    const m = muestreo([fullCol()], [], { plantas11sem: [], plantas00sem: [] })
    const msg = buildWhatsappSummary(m, [])
    // el count 0 no aparece
    expect(msg).not.toMatch(/11 sem.*\(0\)/)
    expect(msg).not.toMatch(/00 sem.*\(0\)/)
  })

  it('muestra ✅ cuadra con totales de ficha cuando cuadraTodo=true', () => {
    const m = muestreo([fullCol()], [], {
      verificacion11sem: { columnas: [], cuadraTodo: true },
    })
    const msg = buildWhatsappSummary(m, [])
    expect(msg).toMatch(/Cuadra con los totales/)
  })

  it('muestra ⚠️ columnas no cuadran cuando cuadraTodo=false (etiquetas humanas)', () => {
    const m = muestreo([fullCol()], [], {
      verificacion11sem: {
        columnas: [
          { columna: 'ht', sumaFilas: 228, totalFicha: 264, cuadra: false },
          { columna: 'lc', sumaFilas: 200, totalFicha: 258, cuadra: false },
        ],
        cuadraTodo: false,
      },
    })
    const msg = buildWhatsappSummary(m, [])
    expect(msg).toMatch(/no cuadra/)
    // El nuevo formato usa etiquetas humanas: H.T y LC (no "ht" y "lc" crudos)
    expect(msg).toMatch(/H\.T/)
    expect(msg).toMatch(/LC/)
    // Incluye los números accionables
    expect(msg).toMatch(/228/)
    expect(msg).toMatch(/264/)
  })

  it('no muestra veredicto de checksum cuando verificacion es null o ausente', () => {
    const m1 = muestreo([fullCol()], [], { verificacion11sem: null })
    const m2 = muestreo([fullCol()])
    expect(buildWhatsappSummary(m1, [])).not.toMatch(/Cuadra/)
    expect(buildWhatsappSummary(m2, [])).not.toMatch(/Cuadra/)
  })

  it('muestra G de plagas foliares cuando tiene valor', () => {
    const m = muestreo([fullCol()], [], {
      plagasFoliares: { ceramida: { h: 1, p: 0, m: 2, g: 5 }, sibine: { h: null, p: null, m: null, g: null } },
    })
    const msg = buildWhatsappSummary(m, [])
    expect(msg).toMatch(/g:5/)
  })

  it('omite G de ceramida cuando es null', () => {
    const m = muestreo([fullCol()], [], {
      plagasFoliares: { ceramida: { h: 1, p: 0, m: 2, g: null }, sibine: { h: null, p: null, m: null, g: null } },
    })
    const msg = buildWhatsappSummary(m, [])
    // Cuando hay h/p/m, el bloque se muestra, pero g no sale si es null
    expect(msg).not.toMatch(/g:null/)
    expect(msg).not.toMatch(/g:-/)
  })
})

// ─── Tarea 1: buildWhatsappSummary — sub-bloques de seguimiento ───────────────

describe('buildWhatsappSummary — seguimiento reestructurado (Tarea 1)', () => {
  const filas11 = Array.from({ length: 19 }, (_, i) => fila11({ fila: i + 1 }))
  const filas00 = Array.from({ length: 14 }, (_, i) => fila11({ fila: i + 1 }))
  const prom11: TotalesSemana = { ht: 7.1, hVle: 0, q5menos: null, q5mas: null, lc: 6.6 }
  const prom00: TotalesSemana = { ht: 13.8, hVle: 6.7, q5menos: null, q5mas: null, lc: 13.6 }

  it('muestra *11 semanas* en negritas con el conteo', () => {
    const m = muestreo([fullCol()], [], { plantas11sem: filas11, promedios11sem: prom11 })
    const msg = buildWhatsappSummary(m, [])
    expect(msg).toMatch(/\*11 semanas\*/)
    expect(msg).toMatch(/19/)
  })

  it('muestra *00 semanas* en negritas con el conteo', () => {
    const m = muestreo([fullCol()], [], { plantas00sem: filas00, promedios00sem: prom00 })
    const msg = buildWhatsappSummary(m, [])
    expect(msg).toMatch(/\*00 semanas\*/)
    expect(msg).toMatch(/14/)
  })

  it('promedios aparecen indentados (con 2 espacios al inicio)', () => {
    const m = muestreo([fullCol()], [], { plantas11sem: filas11, promedios11sem: prom11 })
    const msg = buildWhatsappSummary(m, [])
    // La línea de promedios debe comenzar con "  " (dos espacios)
    const lines = msg.split('\n')
    const promLine = lines.find(l => l.includes('H.T') && l.includes('LC'))
    expect(promLine).toBeDefined()
    expect(promLine!.startsWith('  ')).toBe(true)
  })

  it('finca: erradicadas e índice EF en línea separada sin bullet de tabla', () => {
    const m = muestreo([fullCol()], [], { erradicadasBsv: 0, pEfFinca: 0.8 })
    const msg = buildWhatsappSummary(m, [])
    expect(msg).toMatch(/\*Finca:\*/)
    expect(msg).toMatch(/Erradicadas BSV/)
    expect(msg).toMatch(/Índice EF/)
  })

  it('inline ✅ cuando verificacion cuadraTodo=true', () => {
    const m = muestreo([fullCol()], [], {
      plantas11sem: filas11,
      promedios11sem: prom11,
      verificacion11sem: { columnas: [], cuadraTodo: true },
    })
    const msg = buildWhatsappSummary(m, [])
    // El ✅ debe estar en la línea de "11 semanas", no en un bloque aparte
    const lines = msg.split('\n')
    const sem11Line = lines.find(l => l.includes('11 semanas'))
    expect(sem11Line).toBeDefined()
    expect(sem11Line!).toMatch(/✅/)
  })

  it('inline ⚠️ cuando verificacion cuadraTodo=false', () => {
    const m = muestreo([fullCol()], [], {
      plantas11sem: filas11,
      promedios11sem: prom11,
      verificacion11sem: { columnas: [{ columna: 'ht', sumaFilas: 135, totalFicha: 264, cuadra: false }], cuadraTodo: false },
    })
    const msg = buildWhatsappSummary(m, [])
    const lines = msg.split('\n')
    const sem11Line = lines.find(l => l.includes('11 semanas'))
    expect(sem11Line).toBeDefined()
    expect(sem11Line!).toMatch(/⚠️/)
  })

  it('sin veredicto inline cuando verificacion es null', () => {
    const m = muestreo([fullCol()], [], {
      plantas11sem: filas11,
      promedios11sem: prom11,
      verificacion11sem: null,
    })
    const msg = buildWhatsappSummary(m, [])
    const lines = msg.split('\n')
    const sem11Line = lines.find(l => l.includes('11 semanas'))
    expect(sem11Line).toBeDefined()
    // No debe tener ni ✅ ni ⚠️ en esa línea (verificacion null = silencio)
    expect(sem11Line!).not.toMatch(/[✅⚠️]/)
  })

  it('bloque de veredicto final: detalla tabla, campo con etiqueta humana y números accionables', () => {
    const m = muestreo([fullCol()], [], {
      plantas11sem: filas11,
      verificacion11sem: {
        columnas: [{ columna: 'ht', sumaFilas: 135, totalFicha: 264, cuadra: false }],
        cuadraTodo: false,
      },
    })
    const msg = buildWhatsappSummary(m, [])
    // Debe mencionar "11 semanas", la etiqueta "H.T" (no "ht"), y los números
    expect(msg).toMatch(/11 semanas/)
    expect(msg).toMatch(/H\.T/)
    expect(msg).toMatch(/135/)
    expect(msg).toMatch(/264/)
  })

  it('bloque de veredicto final: todas cuadran → una línea ✅ global', () => {
    const m = muestreo([fullCol()], [], {
      plantas11sem: filas11,
      verificacion11sem: { columnas: [{ columna: 'ht', sumaFilas: 264, totalFicha: 264, cuadra: true }], cuadraTodo: true },
      verificacion00sem: { columnas: [{ columna: 'ht', sumaFilas: 100, totalFicha: 100, cuadra: true }], cuadraTodo: true },
    })
    const msg = buildWhatsappSummary(m, [])
    // Una sola línea de confirmación global
    expect(msg).toMatch(/Cuadra con los totales/)
    // No debe mostrar dos bloques de checksum separados
    const cuadraMatches = msg.match(/Cuadra con los totales/g)
    expect(cuadraMatches).toHaveLength(1)
  })

  it('veredicto plural cuando dos tablas fallan', () => {
    const m = muestreo([fullCol()], [], {
      plantas11sem: filas11,
      plantas00sem: filas00,
      verificacion11sem: {
        columnas: [{ columna: 'ht', sumaFilas: 135, totalFicha: 264, cuadra: false }],
        cuadraTodo: false,
      },
      verificacion00sem: {
        columnas: [{ columna: 'lc', sumaFilas: 90, totalFicha: 258, cuadra: false }],
        cuadraTodo: false,
      },
    })
    const msg = buildWhatsappSummary(m, [])
    // Debe mostrar las dos tablas en el veredicto
    expect(msg).toMatch(/11 semanas/)
    expect(msg).toMatch(/00 semanas/)
    expect(msg).toMatch(/H\.T/)
    expect(msg).toMatch(/LC/)
  })
})

// ─── Tarea 2: guard de lectura parcial (cols < 3) ────────────────────────────

describe('buildWhatsappSummary — guard LECTURA INCOMPLETA (Tarea 2)', () => {
  it('muestra ⚠️ LECTURA INCOMPLETA cuando solo hay 1 columna en resumenColumnas', () => {
    const m = muestreo([fullCol({ H_calculado: 5, I_calculado: 1, J_calculado: 2, M_calculado: 12 })], [], {})
    const msg = buildWhatsappSummary(m, [])
    expect(msg).toMatch(/LECTURA INCOMPLETA/)
    expect(msg).not.toMatch(/BAJO CONTROL/)
  })

  it('muestra ⚠️ LECTURA INCOMPLETA cuando hay 2 columnas (necesita 3)', () => {
    const cols = [fullCol(), fullCol()]
    const msg = buildWhatsappSummary(muestreo(cols), [])
    expect(msg).toMatch(/LECTURA INCOMPLETA/)
  })

  it('estado normal ✅ BAJO CONTROL con 3 columnas sanas', () => {
    const cols = [
      fullCol({ H_calculado: 5, I_calculado: 1, J_calculado: 2, M_calculado: 12 }),
      fullCol({ H_calculado: 3, I_calculado: 0, J_calculado: 1, M_calculado: 13 }),
      fullCol({ H_calculado: 4, I_calculado: 2, J_calculado: 3, M_calculado: 11 }),
    ]
    const msg = buildWhatsappSummary(muestreo(cols), [])
    expect(msg).toMatch(/BAJO CONTROL/)
    expect(msg).not.toMatch(/LECTURA INCOMPLETA/)
  })

  it('estado CRÍTICO/ATENCIÓN no se bloquea por lectura incompleta — son problemas distintos', () => {
    // LECTURA INCOMPLETA reemplaza BAJO CONTROL, no los estados de alerta
    const m = muestreo([fullCol({ J_calculado: 15 })]) // 1 columna + severo
    const msg = buildWhatsappSummary(m, [])
    // Con cols < 3 Y severo, el estado calculado es CRÍTICO pero cols incompletas
    // La regla dice: si cols < 3, estado general NO puede ser BAJO CONTROL
    // → si el estado era CRÍTICO, se mantiene (lectura incompleta no lo tapa)
    // La implementación mostrará LECTURA INCOMPLETA si el estado habría sido BAJO CONTROL,
    // pero si es CRÍTICO/ATENCIÓN, prevalece el estado de alerta
    // (el test verifica que con cols<3 + BAJO CONTROL → LECTURA INCOMPLETA)
    expect(msg).not.toMatch(/BAJO CONTROL/)
  })
})

// ─── Tarea 3: checksum fallido → camposDudosos (en WasagroAIAgent ya va server-side) ──
// Verificamos la lógica en aplicarAclaraciones: filtra stale + recalcula checksum

describe('aplicarAclaraciones — checksum recalculado tras corrección (Tarea 3)', () => {
  it('requiereValidacion=false cuando se resuelven ilegibles y checksum cuadra tras corrección', () => {
    // Fila con ht ilegible; total 13 → si ht=13 cuadra perfectamente
    const base = muestreo([fullCol()], [], {
      confidenceScore: 0.9,
      plantas11sem: [fila11({ fila: 1, ht: { valor: null, estado: 'ilegible' } })],
      totales11sem: { ht: 13, hVle: 5, q5menos: 8, q5mas: 12, lc: 11 },
      verificacion11sem: {
        columnas: [{ columna: 'ht', sumaFilas: 0, totalFicha: 13, cuadra: false }],
        cuadraTodo: false,
      },
    })
    const r = aplicarAclaraciones(base, [{ punto: '11sem-1', campo: 'ht', valor: 13 }])
    // Tras la corrección, ht=13, suma=13, total=13 → cuadra
    expect(r.requiereValidacion).toBe(false)
  })

  it('requiereValidacion=true cuando tras corrección el checksum sigue fallando', () => {
    const base = muestreo([fullCol()], [], {
      confidenceScore: 0.9,
      plantas11sem: [fila11({ fila: 1, ht: { valor: null, estado: 'ilegible' } })],
      totales11sem: { ht: 999, hVle: 5, q5menos: 8, q5mas: 12, lc: 11 },
      verificacion11sem: {
        columnas: [{ columna: 'ht', sumaFilas: 0, totalFicha: 999, cuadra: false }],
        cuadraTodo: false,
      },
    })
    const r = aplicarAclaraciones(base, [{ punto: '11sem-1', campo: 'ht', valor: 13 }])
    // ht=13, suma=13, total=999 → todavía no cuadra
    expect(r.requiereValidacion).toBe(true)
  })
})

// ─── Tarea 4: aplicarCorrecciones (pisa celdas leídas, recalcula checksum) ────

describe('aplicarCorrecciones', () => {
  it('pisa una celda ya leída (a diferencia de aplicarAclaraciones)', () => {
    const base = muestreo([fullCol()], [], {
      plantas11sem: [fila11({ fila: 1, ht: { valor: 12, estado: 'leida' } })],
    })
    const r = aplicarCorrecciones(base, [{ punto: '11sem-1', campo: 'ht', valor: 99 }])
    expect(r.sigatoka.plantas11sem[0]!.ht).toEqual({ valor: 99, estado: 'leida' })
    expect(r.aplicadas).toContain('11sem-1.ht')
  })

  it('pisa celdas ilegibles también (es acción humana explícita)', () => {
    const base = muestreo([fullCol()], [], {
      plantas11sem: [fila11({ fila: 2, ht: { valor: null, estado: 'ilegible' } })],
    })
    const r = aplicarCorrecciones(base, [{ punto: '11sem-2', campo: 'ht', valor: 7 }])
    expect(r.sigatoka.plantas11sem[0]!.ht).toEqual({ valor: 7, estado: 'leida' })
  })

  it('pisa celda de punto de muestra (no solo filas semana)', () => {
    const base = muestreo([fullCol()], [], {
      puntosMuestreo: [punto({ punto: 'P3', planta1_estadio: { valor: 2, estado: 'leida' } })],
    })
    const r = aplicarCorrecciones(base, [{ punto: 'P3', campo: 'planta1_estadio', valor: 5 }])
    expect(r.sigatoka.puntosMuestreo[0]!.planta1_estadio).toEqual({ valor: 5, estado: 'leida' })
  })

  it('recalcula verificacion11sem tras corregir una celda', () => {
    const base = muestreo([fullCol()], [], {
      plantas11sem: [fila11({ fila: 1, ht: { valor: 10, estado: 'leida' } })],
      totales11sem: { ht: 13, hVle: 5, q5menos: 8, q5mas: 12, lc: 11 },
      verificacion11sem: {
        columnas: [{ columna: 'ht', sumaFilas: 10, totalFicha: 13, cuadra: false }],
        cuadraTodo: false,
      },
    })
    const r = aplicarCorrecciones(base, [{ punto: '11sem-1', campo: 'ht', valor: 13 }])
    // Tras la corrección ht=13, suma=13, total=13 → cuadra
    expect(r.sigatoka.verificacion11sem?.cuadraTodo).toBe(true)
  })

  it('requiereValidacion=false cuando tras corrección todo cuadra y no hay otros dudosos', () => {
    const base = muestreo([fullCol()], [], {
      confidenceScore: 0.9,
      plantas11sem: [fila11({ fila: 1, ht: { valor: 10, estado: 'leida' } })],
      totales11sem: { ht: 13, hVle: 5, q5menos: 8, q5mas: 12, lc: 11 },
      verificacion11sem: {
        columnas: [{ columna: 'ht', sumaFilas: 10, totalFicha: 13, cuadra: false }],
        cuadraTodo: false,
      },
    })
    const r = aplicarCorrecciones(base, [{ punto: '11sem-1', campo: 'ht', valor: 13 }])
    expect(r.sigatoka.requiereValidacion).toBe(false)
  })

  it('requiereValidacion=true cuando otros camposDudosos siguen presentes', () => {
    const base = muestreo([fullCol()], ['discrepancia en col1.K'], {
      confidenceScore: 0.9,
      plantas11sem: [fila11({ fila: 1, ht: { valor: 10, estado: 'leida' } })],
      totales11sem: { ht: 13, hVle: 5, q5menos: 8, q5mas: 12, lc: 11 },
    })
    const r = aplicarCorrecciones(base, [{ punto: '11sem-1', campo: 'ht', valor: 13 }])
    // camposDudosos siguen, aunque checksum cuadre
    expect(r.sigatoka.requiereValidacion).toBe(true)
  })

  it('ignora correcciones con valor null', () => {
    const base = muestreo([fullCol()], [], {
      plantas11sem: [fila11({ fila: 1, ht: { valor: 12, estado: 'leida' } })],
    })
    const r = aplicarCorrecciones(base, [{ punto: '11sem-1', campo: 'ht', valor: null }])
    expect(r.sigatoka.plantas11sem[0]!.ht.valor).toBe(12)
    expect(r.ignoradas).toContain('11sem-1.ht')
  })

  it('corrección sobre campo desconocido no tira excepción', () => {
    const base = muestreo([fullCol()], [], { plantas11sem: [fila11()] })
    expect(() => aplicarCorrecciones(base, [{ punto: '11sem-1', campo: 'campo_inexistente', valor: 5 }])).not.toThrow()
  })

  it('corrección a fila inexistente va a ignoradas (no aplica en silencio)', () => {
    const base = muestreo([fullCol()], [], {
      plantas11sem: [fila11({ fila: 1, ht: { valor: 12, estado: 'leida' } })],
    })
    const r = aplicarCorrecciones(base, [{ punto: '11sem-99', campo: 'ht', valor: 5 }])
    expect(r.ignoradas).toContain('11sem-99.ht')
    expect(r.aplicadas).toHaveLength(0)
  })
})

// ─── filasConDato (helper de cobertura) ──────────────────────────────────────

describe('filasConDato', () => {
  it('cuenta solo filas con al menos un campo no-null', () => {
    const filas: FilaSemana[] = [
      fila11({ ht: { valor: 10, estado: 'leida' } }),
      fila11({ ht: { valor: null, estado: 'vacia' }, hVle: { valor: null, estado: 'vacia' }, q5menos: { valor: null, estado: 'vacia' }, q5mas: { valor: null, estado: 'vacia' }, lc: { valor: null, estado: 'vacia' } }),
      fila11({ lc: { valor: 5, estado: 'leida' } }),
    ]
    expect(filasConDato(filas)).toBe(2)
  })

  it('array vacío → 0', () => {
    expect(filasConDato([])).toBe(0)
  })

  it('todas vacías → 0', () => {
    const filas: FilaSemana[] = [
      fila11({ ht: { valor: null, estado: 'vacia' }, hVle: { valor: null, estado: 'vacia' }, q5menos: { valor: null, estado: 'vacia' }, q5mas: { valor: null, estado: 'vacia' }, lc: { valor: null, estado: 'vacia' } }),
    ]
    expect(filasConDato(filas)).toBe(0)
  })

  it('celda ilegible (sin valor) no cuenta como dato', () => {
    const filas: FilaSemana[] = [
      fila11({ ht: { valor: null, estado: 'ilegible' }, hVle: { valor: null, estado: 'vacia' }, q5menos: { valor: null, estado: 'vacia' }, q5mas: { valor: null, estado: 'vacia' }, lc: { valor: null, estado: 'vacia' } }),
    ]
    expect(filasConDato(filas)).toBe(0)
  })
})

// ─── elegirMejorTabla ─────────────────────────────────────────────────────────

// Fixture: tabla con filas de un valor fijo por columna y totales que cuadran exactamente.
// valor=null en todas las celdas de columnas NO cubiertas (para que el ref total no coincida).
function tablaFija(nFilas: number, valorHt: number | null, valorLc: number | null): { filas: FilaSemana[]; totales: TotalesSemana | null; promedios: TotalesSemana | null } {
  const filas: FilaSemana[] = Array.from({ length: nFilas }, (_, i) => fila11({
    fila: i + 1,
    ht:  valorHt  != null ? { valor: valorHt,  estado: 'leida' } : { valor: null, estado: 'vacia' },
    lc:  valorLc  != null ? { valor: valorLc,  estado: 'leida' } : { valor: null, estado: 'vacia' },
    hVle:    { valor: null, estado: 'vacia' },
    q5menos: { valor: null, estado: 'vacia' },
    q5mas:   { valor: null, estado: 'vacia' },
  }))
  const totales: TotalesSemana = {
    ht:       valorHt  != null ? valorHt  * nFilas : null,
    lc:       valorLc  != null ? valorLc  * nFilas : null,
    hVle: null, q5menos: null, q5mas: null,
  }
  return { filas, totales, promedios: null }
}

describe('elegirMejorTabla', () => {
  it('si uno es null → devuelve el otro', () => {
    const b = tablaFija(10, 12, 11)
    expect(elegirMejorTabla(null, b, b.totales)).toBe(b)
    expect(elegirMejorTabla(b, null, b.totales)).toBe(b)
  })

  it('ambos null → devuelve null (sin romper)', () => {
    expect(elegirMejorTabla(null, null, null)).toBeNull()
  })

  it('cuadraTodo=true gana sobre cuadraTodo=false', () => {
    // perfecto: ht=12×10=120, lc=11×10=110 → cuadra con sus propios totales
    // imperfecto: ht=5×10=50, lc=7×10=70 → no cuadra contra perfecto.totales
    const perfecto   = tablaFija(10, 12, 11) // totales: ht=120, lc=110
    const imperfecto = tablaFija(10, 5,  7)  // suma: ht=50, lc=70 ≠ 120/110
    const ref = perfecto.totales // ficha dice 120/110
    expect(elegirMejorTabla(imperfecto, perfecto, ref)).toBe(perfecto)
    expect(elegirMejorTabla(perfecto, imperfecto, ref)).toBe(perfecto)
  })

  it('desempate por más columnas cuadran (ambos sin cuadraTodo)', () => {
    // dos: solo ht cuadra (ht=12×10=120, lc no disponible → null)
    // tres: ht y lc cuadran (ht=12×10=120, lc=11×10=110)
    const dos  = tablaFija(10, 12, null) // lc=null → no se puede verificar lc
    const tres = tablaFija(10, 12, 11)   // ht y lc cuadran
    const ref: TotalesSemana = { ht: 120, lc: 110, hVle: null, q5menos: null, q5mas: null }
    expect(elegirMejorTabla(dos, tres, ref)).toBe(tres)
  })

  it('desempate por más filas con dato cuando checksum es igual', () => {
    // Ambas no tienen totalesRef → cuadra=null en todo → empate en checksum → más filas gana
    const pocas  = tablaFija(5,  12, 11)
    const muchas = tablaFija(14, 12, 11)
    const sinTotal: TotalesSemana = { ht: null, hVle: null, q5menos: null, q5mas: null, lc: null }
    expect(elegirMejorTabla(pocas, muchas, sinTotal)).toBe(muchas)
  })

  it('ambos sin filas → devuelve el primero (no rompe)', () => {
    const a = tablaFija(0, 12, 11)
    const b = tablaFija(0, 12, 11)
    // no lanza, devuelve uno de los dos (el primero, por ser la rama `a` cuando b.filas.length=0)
    expect(() => elegirMejorTabla(a, b, null)).not.toThrow()
  })
})

describe('reconciliarCrossField', () => {
  // Fila con H.T y Q>5% explícitos (el par correlacionado H.T ≈ Q>5%).
  const fHQ = (ht: number, q5mas: number): FilaSemana =>
    fila11({ ht: celda(ht), q5mas: celda(q5mas) })

  it('adopta la corrección cuando hace cuadrar el T= (doble compuerta)', () => {
    // H.T = [6,6,6]=18 (T=21, falla por 3); Q>5% = [9,6,6]=21 (cuadra).
    // Reconciliar H.T←Q>5% en la fila 0 (6≠9) → H.T=[9,6,6]=21 → cuadra → adoptar.
    const filas = [fHQ(6, 9), fHQ(6, 6), fHQ(6, 6)]
    const totales: TotalesSemana = { ht: 21, q5mas: 21, hVle: null, q5menos: null, lc: null }
    const r = reconciliarCrossField(filas, totales)
    expect(r.corregidas).toContain('ht[0]')
    // celda corregida: marca origen 'cross_field' (auditabilidad / flywheel, P1)
    expect(r.filas[0]!.ht).toEqual({ valor: 9, estado: 'leida', origen: 'cross_field' })
    // las filas que ya coincidían no se tocan
    expect(r.filas[1]!.ht.valor).toBe(6)
    expect(r.filas[1]!.ht.origen).toBeUndefined()
  })

  it('NO adopta si el correlato tambien esta mal y la suma cuadra solo por ±1 (C1, P1)', () => {
    // Caso peligroso: ambos leen mal la fila 2 (real=5, leido=4). H.T=[7,8,4]=19 (T=21);
    // Q>5%=[8,8,4]=20. Reconciliar H.T←Q>5% → [8,8,4]=20. Con ±1, 20 "cuadraría" contra 21
    // y adoptaria un 4 incorrecto. Con compuerta EXACTA, 20≠21 → NO adopta.
    const filas = [fHQ(7, 8), fHQ(8, 8), fHQ(4, 4)]
    const totales: TotalesSemana = { ht: 21, q5mas: 21, hVle: null, q5menos: null, lc: null }
    const r = reconciliarCrossField(filas, totales)
    expect(r.corregidas).toHaveLength(0)
    expect(r.filas[2]!.ht.valor).toBe(4) // no se inventó un 5; sigue como lo leyó el modelo
  })

  it('NO adopta si la corrección no cierra exacto el total (no adivina, P1)', () => {
    // H.T = [6,6,6]=18 (T=21, falla); Q>5% = [9,9,6]=24 (T=24, cuadra).
    // Reconciliar H.T←Q>5% → [9,9,6]=24 ≠ 21 → fuera de tolerancia → NO adoptar.
    const filas = [fHQ(6, 9), fHQ(6, 9), fHQ(6, 6)]
    const totales: TotalesSemana = { ht: 21, q5mas: 24, hVle: null, q5menos: null, lc: null }
    const r = reconciliarCrossField(filas, totales)
    expect(r.corregidas).toHaveLength(0)
    expect(r.filas[0]!.ht.valor).toBe(6) // intacto
  })

  it('no hace nada si la columna ya cuadra', () => {
    const filas = [fHQ(7, 7), fHQ(7, 7), fHQ(7, 7)] // H.T=21 = T=
    const totales: TotalesSemana = { ht: 21, q5mas: 21, hVle: null, q5menos: null, lc: null }
    const r = reconciliarCrossField(filas, totales)
    expect(r.corregidas).toHaveLength(0)
  })

  it('totales null → no-op (no rompe)', () => {
    const filas = [fHQ(6, 9)]
    const r = reconciliarCrossField(filas, null)
    expect(r.corregidas).toHaveLength(0)
    expect(r.filas[0]!.ht.valor).toBe(6)
  })
})
