import { describe, it, expect } from 'vitest'
import {
  detectRoleFromText,
  segmentoToBrochureSlug,
} from '../../../src/agents/sdr/roleDetector.js'

describe('detectRoleFromText — agricultor patterns', () => {
  it('detects "tengo mi propia finca" as agricultor (the real client case)', () => {
    const hit = detectRoleFromText('Hola, tengo mi propia finca y quiero empezar con Wasagro.')
    expect(hit?.segmento).toBe('agricultor')
  })

  it('detects "soy agricultor" as agricultor', () => {
    expect(detectRoleFromText('soy agricultor desde hace 20 años')?.segmento).toBe('agricultor')
  })

  it('detects "soy productor de cacao" as agricultor', () => {
    expect(detectRoleFromText('Soy productor de cacao en la sierra')?.segmento).toBe('agricultor')
  })

  it('detects "mi finca" alone as agricultor', () => {
    expect(detectRoleFromText('mi finca está en Ecuador')?.segmento).toBe('agricultor')
  })

  it('detects "es nuestra finca" as agricultor', () => {
    expect(detectRoleFromText('Sí, es nuestra finca familiar')?.segmento).toBe('agricultor')
  })

  it('detects "quiero empezar con Wasagro" as agricultor (signup intent)', () => {
    expect(detectRoleFromText('quiero empezar con Wasagro hoy mismo')?.segmento).toBe('agricultor')
  })

  it('detects "tenemos una finca" as agricultor', () => {
    expect(detectRoleFromText('Tenemos una finca chica de aguacates')?.segmento).toBe('agricultor')
  })
})

describe('detectRoleFromText — exportadora patterns', () => {
  it('detects "soy gerente de una exportadora"', () => {
    expect(detectRoleFromText('Soy gerente de una exportadora de banano')?.segmento).toBe('exportadora')
  })

  it('detects "trabajamos en la exportadora"', () => {
    expect(detectRoleFromText('Trabajamos en la exportadora desde 2010')?.segmento).toBe('exportadora')
  })

  it('detects "exportamos a Europa"', () => {
    expect(detectRoleFromText('Exportamos a Europa cacao premium')?.segmento).toBe('exportadora')
  })

  it('detects "vendemos a Asia"', () => {
    expect(detectRoleFromText('vendemos a Asia y EE.UU.')?.segmento).toBe('exportadora')
  })

  it('detects EUDR mention as exportadora signal', () => {
    expect(detectRoleFromText('Necesito cumplir con la EUDR este año')?.segmento).toBe('exportadora')
  })
})

describe('detectRoleFromText — cooperativa', () => {
  it('detects "somos una cooperativa"', () => {
    expect(detectRoleFromText('Somos una cooperativa de cacao')?.segmento).toBe('cooperativa')
  })

  it('detects "cooperativa de productores"', () => {
    expect(detectRoleFromText('Estoy en la cooperativa de productores del norte')?.segmento).toBe('cooperativa')
  })

  it('detects "asociación de productores"', () => {
    expect(detectRoleFromText('Estamos en una asociación de productores')?.segmento).toBe('cooperativa')
  })
})

describe('detectRoleFromText — no signal', () => {
  it('returns null for size-only messages (the bug: size should NOT be a role signal)', () => {
    expect(detectRoleFromText('2 fincas y en total 30 hectáreas')).toBeNull()
  })

  it('returns null for cultivo-only messages', () => {
    expect(detectRoleFromText('cacao y banano')).toBeNull()
  })

  it('returns null for country-only', () => {
    expect(detectRoleFromText('Colombia')).toBeNull()
  })

  it('returns null for short greetings', () => {
    expect(detectRoleFromText('Hola')).toBeNull()
    expect(detectRoleFromText('Sí')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(detectRoleFromText('')).toBeNull()
  })
})

describe('detectRoleFromText — priority (agricultor wins over size cues)', () => {
  it('respects role declaration even with large hectareas mentioned in same message', () => {
    // This is the real-world regression case: client says "tengo mi propia finca"
    // AND mentions 30 hectáreas in the same/next turn. The role wins.
    const hit = detectRoleFromText('Tengo mi propia finca de 30 hectáreas de hortalizas')
    expect(hit?.segmento).toBe('agricultor')
  })
})

describe('segmentoToBrochureSlug', () => {
  it('maps exportadora -> exportadora', () => {
    expect(segmentoToBrochureSlug('exportadora')).toBe('exportadora')
  })

  it('maps agricultor -> agricultor', () => {
    expect(segmentoToBrochureSlug('agricultor')).toBe('agricultor')
  })

  it('maps cooperativa -> agricultor (no cooperativa brochure yet)', () => {
    expect(segmentoToBrochureSlug('cooperativa')).toBe('agricultor')
  })

  it('maps ong -> exportadora (institutional pitch closer)', () => {
    expect(segmentoToBrochureSlug('ong')).toBe('exportadora')
  })

  it('maps desconocido -> agricultor (safer default)', () => {
    expect(segmentoToBrochureSlug('desconocido')).toBe('agricultor')
  })
})
