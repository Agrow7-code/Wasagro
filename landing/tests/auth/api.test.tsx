// 4R fix (PR-S3 review) — central 401 handler in authFetch (landing/src/auth/api.ts).
// Any authenticated call that comes back 401 means the session is no longer
// valid — authFetch purges the stored auth and hard-redirects to /login,
// guarded against redirect loops.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from '../../src/auth/api'

function mockLocation(pathname: string) {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname, assign },
    writable: true,
    configurable: true,
  })
  return assign
}

describe('authFetch — central 401 handler', () => {
  const originalLocation = window.location

  beforeEach(() => {
    localStorage.setItem('wasagro_token', 'fake-token')
    localStorage.setItem('wasagro_user', JSON.stringify({ id: 'u1', rol: 'admin_org' }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
  })

  it('on 401, clears the stored auth (same keys as useAuth.logout) and redirects to /login', async () => {
    const assign = mockLocation('/admin')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))

    const res = await authFetch('/api/admin/orgs')

    expect(res.status).toBe(401) // return contract preserved for existing res.ok callers
    expect(localStorage.getItem('wasagro_token')).toBeNull()
    expect(localStorage.getItem('wasagro_user')).toBeNull()
    expect(assign).toHaveBeenCalledWith('/login')
  })

  it('on 401 while already on /login, does NOT redirect (loop guard)', async () => {
    const assign = mockLocation('/login')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))

    await authFetch('/api/admin/orgs')

    expect(assign).not.toHaveBeenCalled()
  })

  it('non-401 responses do not clear storage or redirect', async () => {
    const assign = mockLocation('/admin')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))

    await authFetch('/api/admin/orgs')

    expect(localStorage.getItem('wasagro_token')).toBe('fake-token')
    expect(assign).not.toHaveBeenCalled()
  })
})
