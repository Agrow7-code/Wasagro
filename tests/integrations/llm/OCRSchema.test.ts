import { describe, expect, it } from 'vitest'
import { ResultadoOCRSchema, RegistroOCRSchema } from '../../../src/types/dominio/OCR.js'

describe('RegistroOCRSchema', () => {
  it('acepta registro completo con números', () => {
    const registro = {
      fila: 1,
      lote_raw: 'Lote 3',
      lote_id: null,
      actividad: 'Aplicación fungicida',
      producto: 'Entrust',
      cantidad: 20.5,
      unidad: 'litros',
      trabajadores: 5,
      monto: 45.0,
      fecha_raw: '15/04/2026',
      notas: null,
      ilegible: false,
    }
    const result = RegistroOCRSchema.safeParse(registro)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cantidad).toBe(20.5)
      expect(result.data.trabajadores).toBe(5)
      expect(result.data.monto).toBe(45.0)
    }
  })

  it('transforma string numérico en cantidad', () => {
    const registro = {
      fila: 1,
      lote_raw: null,
      lote_id: null,
      actividad: null,
      producto: null,
      cantidad: '20',
      unidad: null,
      trabajadores: null,
      monto: null,
      fecha_raw: null,
      notas: null,
      ilegible: false,
    }
    const result = RegistroOCRSchema.safeParse(registro)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cantidad).toBe(20)
    }
  })

  it('transforma monto con símbolos de moneda', () => {
    const registro = {
      fila: 1,
      lote_raw: null,
      lote_id: null,
      actividad: null,
      producto: null,
      cantidad: null,
      unidad: null,
      trabajadores: null,
      monto: '$20.50',
      fecha_raw: null,
      notas: null,
      ilegible: false,
    }
    const result = RegistroOCRSchema.safeParse(registro)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.monto).toBe(20.5)
    }
  })

  it('convierte string no-numérico en null para cantidad', () => {
    const registro = {
      fila: 1,
      lote_raw: null,
      lote_id: null,
      actividad: null,
      producto: null,
      cantidad: 'veinte litros',
      unidad: null,
      trabajadores: null,
      monto: null,
      fecha_raw: null,
      notas: null,
      ilegible: false,
    }
    const result = RegistroOCRSchema.safeParse(registro)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cantidad).toBeNull()
    }
  })

  it('acepta null para campos numéricos opcionales', () => {
    const registro = {
      fila: 1,
      lote_raw: null,
      lote_id: null,
      actividad: null,
      producto: null,
      cantidad: null,
      unidad: null,
      trabajadores: null,
      monto: null,
      fecha_raw: null,
      notas: null,
      ilegible: false,
    }
    const result = RegistroOCRSchema.safeParse(registro)
    expect(result.success).toBe(true)
  })

  it('defaults ilegible a false', () => {
    const registro = {
      fila: 1,
      lote_raw: null,
      lote_id: null,
      actividad: null,
      producto: null,
      cantidad: null,
      unidad: null,
      trabajadores: null,
      monto: null,
      fecha_raw: null,
      notas: null,
    }
    const result = RegistroOCRSchema.safeParse(registro)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.ilegible).toBe(false)
    }
  })
})

describe('ResultadoOCRSchema', () => {
  it('acepta resultado completo válido', () => {
    const resultado = {
      tipo_documento: 'planilla_aplicacion',
      fecha_documento: '2026-04-15',
      registros: [
        {
          fila: 1,
          lote_raw: 'Lote 3',
          lote_id: null,
          actividad: 'Aplicación',
          producto: 'Entrust',
          cantidad: 20,
          unidad: 'litros',
          trabajadores: 5,
          monto: 45.0,
          fecha_raw: '15/04',
          notas: null,
          ilegible: false,
        },
      ],
      texto_completo_visible: 'Planilla de aplicación...',
      confianza_lectura: 0.85,
      advertencia: null,
    }
    const result = ResultadoOCRSchema.safeParse(resultado)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tipo_documento).toBe('planilla_aplicacion')
      expect(result.data.registros).toHaveLength(1)
      expect(result.data.registros[0].cantidad).toBe(20)
    }
  })

  it('acepta confianza_lectura = 0 para imagen borrosa', () => {
    const resultado = {
      tipo_documento: 'otro',
      fecha_documento: null,
      registros: [],
      texto_completo_visible: '',
      confianza_lectura: 0,
      advertencia: 'imagen borrosa',
    }
    const result = ResultadoOCRSchema.safeParse(resultado)
    expect(result.success).toBe(true)
  })

  it('rechaza tipo_documento inválido', () => {
    const resultado = {
      tipo_documento: 'factura_electronica',
      fecha_documento: null,
      registros: [],
      texto_completo_visible: '',
      confianza_lectura: 0.5,
      advertencia: null,
    }
    const result = ResultadoOCRSchema.safeParse(resultado)
    expect(result.success).toBe(false)
  })

  it('rechaza confianza_lectura > 1', () => {
    const resultado = {
      tipo_documento: 'otro',
      fecha_documento: null,
      registros: [],
      texto_completo_visible: '',
      confianza_lectura: 1.5,
      advertencia: null,
    }
    const result = ResultadoOCRSchema.safeParse(resultado)
    expect(result.success).toBe(false)
  })

  it('rechaza registros con tipos incorrectos en campos numéricos', () => {
    const resultado = {
      tipo_documento: 'registro_gastos',
      fecha_documento: null,
      registros: [{
        fila: 1,
        lote_raw: null,
        lote_id: null,
        actividad: null,
        producto: null,
        cantidad: { valor: 20 },
        unidad: null,
        trabajadores: null,
        monto: null,
        fecha_raw: null,
        notas: null,
        ilegible: false,
      }],
      texto_completo_visible: '',
      confianza_lectura: 0.7,
      advertencia: null,
    }
    const result = ResultadoOCRSchema.safeParse(resultado)
    expect(result.success).toBe(false)
  })

  it('acepta múltiples registros con mix de valores convertibles', () => {
    const resultado = {
      tipo_documento: 'cuaderno_campo',
      fecha_documento: null,
      registros: [
        {
          fila: 1,
          lote_raw: 'Lote A',
          lote_id: null,
          actividad: 'Cosecha',
          producto: null,
          cantidad: 100,
          unidad: 'kg',
          trabajadores: '3',
          monto: null,
          fecha_raw: '10/04',
          notas: 'Buana calidad',
          ilegible: false,
        },
        {
          fila: 2,
          lote_raw: 'Lote B',
          lote_id: null,
          actividad: 'Aplicación',
          producto: 'Manzate',
          cantidad: '2.5',
          unidad: 'litros',
          trabajadores: 2,
          monto: '$15.00',
          fecha_raw: '11/04',
          notas: null,
          ilegible: false,
        },
      ],
      texto_completo_visible: 'Cuaderno de campo...',
      confianza_lectura: 0.75,
      advertencia: null,
    }
    const result = ResultadoOCRSchema.safeParse(resultado)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.registros[0].trabajadores).toBe(3)
      expect(result.data.registros[1].cantidad).toBe(2.5)
      expect(result.data.registros[1].monto).toBe(15.0)
    }
  })
})
