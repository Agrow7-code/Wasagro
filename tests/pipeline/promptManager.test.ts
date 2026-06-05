// PromptManager — Langfuse fetch con disk fallback + TTL cache.
//
// Estos tests no necesitan Langfuse real. Mockean el cliente para verificar:
//   1. Fetch exitoso desde Langfuse cachea el resultado y devuelve el texto.
//   2. Cache hit dentro de TTL no re-fetcha.
//   3. Langfuse fail -> fallback a disco.
//   4. Langfuse no configurado (sin secret keys) -> fallback inmediato a disco.
//   5. Disco fallback tambien cachea (con promptObj=null para que adapters sepan).
//   6. getPromptClient devuelve el objeto de Langfuse cuando vino de Langfuse;
//      null cuando vino de disco.
//   7. clearCache fuerza re-fetch.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync as realReadFileSync } from 'node:fs'

const mockLangfuseGetPrompt = vi.fn()

vi.mock('../../src/integrations/langfuse.js', () => ({
  langfuse: {
    getPrompt: mockLangfuseGetPrompt,
  },
}))

const mockReadFileSync = vi.fn()
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, readFileSync: (...args: Parameters<typeof realReadFileSync>) => mockReadFileSync(...args) }
})

beforeEach(() => {
  vi.clearAllMocks()
  // Re-import PromptManager para resetear el cache module-level
  vi.resetModules()
})

async function loadPromptManager(envConfigured: boolean) {
  if (envConfigured) {
    process.env['LANGFUSE_PUBLIC_KEY'] = 'pk-test'
    process.env['LANGFUSE_SECRET_KEY'] = 'sk-test'
  } else {
    delete process.env['LANGFUSE_PUBLIC_KEY']
    delete process.env['LANGFUSE_SECRET_KEY']
  }
  const mod = await import('../../src/pipeline/promptManager.js')
  mod.PromptManager.clearCache()
  return mod.PromptManager
}

describe('PromptManager.getPrompt', () => {
  it('fetch exitoso de Langfuse devuelve el texto + cachea el PromptClient', async () => {
    mockLangfuseGetPrompt.mockResolvedValue({ prompt: 'PROMPT TEXT FROM LANGFUSE' })
    const PromptManager = await loadPromptManager(true)

    const text = await PromptManager.getPrompt('sp-test.md', 'prompts/sp-test.md')

    expect(text).toBe('PROMPT TEXT FROM LANGFUSE')
    expect(mockLangfuseGetPrompt).toHaveBeenCalledTimes(1)
    expect(mockLangfuseGetPrompt).toHaveBeenCalledWith('sp-test.md', undefined, expect.objectContaining({ cacheTtlSeconds: expect.any(Number) }))
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('cache hit dentro de TTL no re-fetcha Langfuse', async () => {
    mockLangfuseGetPrompt.mockResolvedValue({ prompt: 'CACHED' })
    const PromptManager = await loadPromptManager(true)

    await PromptManager.getPrompt('sp-test.md', 'prompts/sp-test.md')
    await PromptManager.getPrompt('sp-test.md', 'prompts/sp-test.md')
    await PromptManager.getPrompt('sp-test.md', 'prompts/sp-test.md')

    expect(mockLangfuseGetPrompt).toHaveBeenCalledTimes(1)
  })

  it('Langfuse fetch falla → fallback a disco', async () => {
    mockLangfuseGetPrompt.mockRejectedValue(new Error('Langfuse 500'))
    mockReadFileSync.mockReturnValue('DISK CONTENT')
    const PromptManager = await loadPromptManager(true)

    const text = await PromptManager.getPrompt('sp-test.md', 'prompts/sp-test.md')

    expect(text).toBe('DISK CONTENT')
    // path.join normaliza al separador del OS — usar sep-agnostic match.
    expect(mockReadFileSync).toHaveBeenCalledWith(expect.stringMatching(/prompts.sp-test\.md$/), 'utf-8')
  })

  it('Langfuse sin configurar (sin env keys) → fallback directo a disco, no toca SDK', async () => {
    mockReadFileSync.mockReturnValue('DISK ONLY')
    const PromptManager = await loadPromptManager(false)

    const text = await PromptManager.getPrompt('sp-test.md', 'prompts/sp-test.md')

    expect(text).toBe('DISK ONLY')
    expect(mockLangfuseGetPrompt).not.toHaveBeenCalled()
    expect(mockReadFileSync).toHaveBeenCalled()
  })

  it('Langfuse devuelve prompt vacío → fallback a disco', async () => {
    // Defensive: si por error el prompt en Langfuse esta vacio (paste accidental),
    // no servimos un system prompt vacio.
    mockLangfuseGetPrompt.mockResolvedValue({ prompt: '' })
    mockReadFileSync.mockReturnValue('DISK NONEMPTY')
    const PromptManager = await loadPromptManager(true)

    const text = await PromptManager.getPrompt('sp-test.md', 'prompts/sp-test.md')

    expect(text).toBe('DISK NONEMPTY')
  })

  it('disco fail → throw con mensaje claro', async () => {
    mockLangfuseGetPrompt.mockRejectedValue(new Error('no langfuse'))
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT') })
    const PromptManager = await loadPromptManager(true)

    await expect(PromptManager.getPrompt('missing.md', 'prompts/missing.md'))
      .rejects.toThrow(/no se pudo cargar el prompt local/i)
  })
})

describe('PromptManager.getPromptClient', () => {
  it('devuelve el PromptClient cuando el prompt vino de Langfuse', async () => {
    const promptObj = { prompt: 'TEXT', version: 3, id: 'pid' }
    mockLangfuseGetPrompt.mockResolvedValue(promptObj)
    const PromptManager = await loadPromptManager(true)

    await PromptManager.getPrompt('sp-x.md', 'prompts/sp-x.md')
    expect(PromptManager.getPromptClient('sp-x.md')).toBe(promptObj)
  })

  it('devuelve null cuando el prompt vino de disco', async () => {
    mockReadFileSync.mockReturnValue('disk')
    const PromptManager = await loadPromptManager(false)

    await PromptManager.getPrompt('sp-y.md', 'prompts/sp-y.md')
    expect(PromptManager.getPromptClient('sp-y.md')).toBeNull()
  })

  it('devuelve null para nombres no cacheados', async () => {
    const PromptManager = await loadPromptManager(true)
    expect(PromptManager.getPromptClient('never-fetched.md')).toBeNull()
  })
})

describe('PromptManager.clearCache', () => {
  it('fuerza re-fetch en el proximo getPrompt', async () => {
    mockLangfuseGetPrompt.mockResolvedValue({ prompt: 'V1' })
    const PromptManager = await loadPromptManager(true)

    await PromptManager.getPrompt('sp.md', 'prompts/sp.md')
    expect(mockLangfuseGetPrompt).toHaveBeenCalledTimes(1)

    PromptManager.clearCache()
    mockLangfuseGetPrompt.mockResolvedValue({ prompt: 'V2' })
    const text2 = await PromptManager.getPrompt('sp.md', 'prompts/sp.md')

    expect(text2).toBe('V2')
    expect(mockLangfuseGetPrompt).toHaveBeenCalledTimes(2)
  })
})
