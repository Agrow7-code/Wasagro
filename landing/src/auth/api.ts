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
export function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  })
}
