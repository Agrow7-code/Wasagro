import { describe, expect, it, vi } from 'vitest'
import type { Context, Next } from 'hono'
import { roleGuard } from '../../src/auth/roleGuard.js'

function fakeContext(authedUser: unknown): Context {
  return {
    get: vi.fn((key: string) => (key === 'authedUser' ? authedUser : undefined)),
    json: vi.fn((body: unknown, status: number) => new Response(JSON.stringify(body), { status })),
  } as unknown as Context
}

describe('roleGuard', () => {
  it('returns 403 and does NOT call next when authedUser is missing', async () => {
    const c = fakeContext(undefined)
    const next = vi.fn() as unknown as Next

    const res = (await roleGuard(c, next)) as Response

    expect(res.status).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 and does NOT call next when authedUser.rol is not a string', async () => {
    const c = fakeContext({ rol: 42 })
    const next = vi.fn() as unknown as Next

    const res = (await roleGuard(c, next)) as Response

    expect(res.status).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 and does NOT call next for a non-director role', async () => {
    const c = fakeContext({ rol: 'gerente' })
    const next = vi.fn() as unknown as Next

    const res = (await roleGuard(c, next)) as Response

    expect(res.status).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 500 when next() throws — next IS called but the outer catch fires, never a re-throw', async () => {
    const c = fakeContext({ rol: 'director' })
    const next = vi.fn().mockRejectedValue(new Error('boom')) as unknown as Next

    const res = (await roleGuard(c, next)) as Response

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).toBe(500)
  })

  it('calls next() and returns its result for a director role', async () => {
    const c = fakeContext({ rol: 'director' })
    const next = vi.fn().mockResolvedValue(undefined) as unknown as Next

    await roleGuard(c, next)

    expect(next).toHaveBeenCalledOnce()
  })
})
