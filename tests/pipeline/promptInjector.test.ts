import { describe, expect, it } from 'vitest'
import { injectarVariables } from '../../src/pipeline/promptInjector.js'

describe('injectarVariables', () => {
  it('reemplaza una variable simple', () => {
    const result = injectarVariables('Hola {{NOMBRE}}', { NOMBRE: 'Carlos' })
    expect(result).toBe('Hola Carlos')
  })

  it('reemplaza múltiples variables distintas', () => {
    const template = 'Finca: {{FINCA_NOMBRE}} ({{CULTIVO_PRINCIPAL}}), País: {{PAIS}}'
    const result = injectarVariables(template, { FINCA_NOMBRE: 'El Paraíso', CULTIVO_PRINCIPAL: 'cacao', PAIS: 'EC' })
    expect(result).toBe('Finca: El Paraíso (cacao), País: EC')
  })

  it('reemplaza la misma variable múltiples veces', () => {
    const result = injectarVariables('{{X}} y {{X}}', { X: 'hola' })
    expect(result).toBe('hola y hola')
  })

  it('reemplaza variable faltante con cadena vacía', () => {
    const result = injectarVariables('Lotes: {{LISTA_LOTES}}', {})
    expect(result).toBe('Lotes: ')
  })

  it('no modifica texto sin variables', () => {
    const template = 'Sin variables aquí'
    expect(injectarVariables(template, { FOO: 'bar' })).toBe(template)
  })
})
