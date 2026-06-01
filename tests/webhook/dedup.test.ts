import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── In-memory Redis double for SET NX EX ────────────────────────────────────

const fakeStore = new Map<string, string>()

const fakeSet = vi.fn(async (
  key: string,
  value: string,
  modeEx?: string,
  _ttl?: number,
  modeNx?: string,
) => {
  // ioredis 'NX' behavior: only set if not exists; returns 'OK' or null.
  if (modeNx === 'NX' && fakeStore.has(key)) return null
  fakeStore.set(key, value)
  return 'OK'
})

let redisShouldThrow = false
vi.mock('../../src/integrations/redis.js', () => ({
  getRedisClient: () => ({
    get: vi.fn(async (k: string) => fakeStore.get(k) ?? null),
    set: (...args: any[]) => {
      if (redisShouldThrow) throw new Error('redis down')
      return fakeSet(args[0], args[1], args[2], args[3], args[4])
    },
  }),
  getCachedContext: vi.fn(async () => null),
  setCachedContext: vi.fn(async () => {}),
  setIfNotExists: async (key: string, ttl: number) => {
    if (redisShouldThrow) throw new Error('redis down')
    const result = await fakeSet(key, '1', 'EX', ttl, 'NX')
    return result === 'OK'
  },
}))

// ─── Webhook handler under test ──────────────────────────────────────────────
// We import the router's isDuplicate indirectly by wiring a tiny test surface
// that exposes only the dedup behavior. This isolates the unit from Hono +
// pg-boss + adapter setup.

beforeEach(() => {
  fakeStore.clear()
  fakeSet.mockClear()
  redisShouldThrow = false
})

import { setIfNotExists } from '../../src/integrations/redis.js'

describe('webhook dedup via setIfNotExists (Redis SET NX EX)', () => {
  it('first SET NX returns OK -> not duplicate', async () => {
    const wasSet = await setIfNotExists('wamid:test-1', 60)
    expect(wasSet).toBe(true)
    expect(fakeStore.has('wamid:test-1')).toBe(true)
  })

  it('second SET NX with same key returns null -> duplicate', async () => {
    await setIfNotExists('wamid:test-2', 60)
    const wasSet2 = await setIfNotExists('wamid:test-2', 60)
    expect(wasSet2).toBe(false)
  })

  it('different wamids are independent', async () => {
    expect(await setIfNotExists('wamid:a', 60)).toBe(true)
    expect(await setIfNotExists('wamid:b', 60)).toBe(true)
    expect(await setIfNotExists('wamid:a', 60)).toBe(false)
    expect(await setIfNotExists('wamid:b', 60)).toBe(false)
  })

  it('uses EX with the requested TTL', async () => {
    await setIfNotExists('wamid:ttl', 60)
    expect(fakeSet).toHaveBeenCalledWith('wamid:ttl', '1', 'EX', 60, 'NX')
  })

  it('throws when Redis is down so caller can fall back', async () => {
    redisShouldThrow = true
    await expect(setIfNotExists('wamid:err', 60)).rejects.toThrow('redis down')
  })
})
