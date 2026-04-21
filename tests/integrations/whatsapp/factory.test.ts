import { describe, expect, it, afterEach } from 'vitest'
import { crearAdapterWhatsApp } from '../../../src/integrations/whatsapp/index.js'
import { MetaAdapter } from '../../../src/integrations/whatsapp/MetaAdapter.js'
import { EvolutionAdapter } from '../../../src/integrations/whatsapp/EvolutionAdapter.js'

afterEach(() => {
  delete process.env['WHATSAPP_PROVIDER']
  delete process.env['WHATSAPP_APP_SECRET']
  delete process.env['WHATSAPP_VERIFY_TOKEN']
})

describe('crearAdapterWhatsApp', () => {
  it('retorna MetaAdapter con WHATSAPP_PROVIDER=meta', () => {
    process.env['WHATSAPP_PROVIDER'] = 'meta'
    process.env['WHATSAPP_APP_SECRET'] = 'secret'
    process.env['WHATSAPP_VERIFY_TOKEN'] = 'token'
    expect(crearAdapterWhatsApp()).toBeInstanceOf(MetaAdapter)
  })

  it('retorna EvolutionAdapter con WHATSAPP_PROVIDER=evolution', () => {
    process.env['WHATSAPP_PROVIDER'] = 'evolution'
    expect(crearAdapterWhatsApp()).toBeInstanceOf(EvolutionAdapter)
  })

  it('lanza error descriptivo con provider inválido', () => {
    process.env['WHATSAPP_PROVIDER'] = 'telegram'
    expect(() => crearAdapterWhatsApp()).toThrow('WHATSAPP_PROVIDER="telegram" no es válido')
  })

  it('lanza error descriptivo sin WHATSAPP_PROVIDER', () => {
    expect(() => crearAdapterWhatsApp()).toThrow('no es válido')
  })

  it('lanza error si WHATSAPP_PROVIDER=meta pero falta WHATSAPP_APP_SECRET', () => {
    process.env['WHATSAPP_PROVIDER'] = 'meta'
    process.env['WHATSAPP_VERIFY_TOKEN'] = 'token'
    expect(() => crearAdapterWhatsApp()).toThrow('WHATSAPP_APP_SECRET')
  })
})
