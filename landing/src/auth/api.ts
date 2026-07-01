// Helper de autenticación para llamadas a la API del dashboard.
// Centraliza el envío del token Bearer (hoy en localStorage) para que TODAS las
// vistas autentiquen igual. La identidad del usuario se deriva server-side del
// token verificado — nunca se pasa el teléfono/finca_id como "identidad" en la URL.

export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('wasagro_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// fetch con el header Authorization ya inyectado. Mantiene cualquier header extra
// que pase el caller (ej. Content-Type para POST/PATCH con body JSON).
//
// Central 401 handler (4R review, PR-S3): any authenticated call that comes
// back 401 means the token is missing/expired/invalid — the session is no
// longer valid app-wide. On 401 we purge the stored auth and hard-redirect
// to /login as a side effect, but still RETURN the Response so existing
// callers that check `res.ok` keep working unchanged.
export function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  }).then((res) => {
    if (res.status === 401) handleUnauthorized()
    return res
  })
}

// Purges the SAME localStorage keys `logout()` clears in useAuth.ts
// (wasagro_user / wasagro_token) and hard-redirects to /login.
//
// Hard redirect (window.location.assign), not React Router `navigate`:
// authFetch runs outside the React tree, so no navigate() is available here.
//
// Loop guard: no-ops if already on /login. LoginPage's own request-otp/
// verify-otp calls use plain `fetch` (NOT authFetch) — confirmed by reading
// LoginPage.tsx, since those endpoints are unauthenticated — so sign-in
// itself never goes through this handler. The guard below is still kept as
// a defensive backstop against any future authFetch usage on /login.
function handleUnauthorized(): void {
  localStorage.removeItem('wasagro_user')
  localStorage.removeItem('wasagro_token')
  if (window.location.pathname.startsWith('/login')) return
  window.location.assign('/login')
}
