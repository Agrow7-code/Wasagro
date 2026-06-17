import { useQuery } from '@tanstack/react-query'
import { authFetch } from '../../auth/api'

const API = (import.meta.env.VITE_API_URL ?? '') as string

// ── Contratos (espejo de src/agents/finca/router.ts) ─────────────────────────

export interface DashboardResumen {
  eventosHoy: number
  eventosSemana: number
  alertasSinResolver: number
  porTipo: Record<string, number>
  serieDiaria: { fecha: string; total: number }[]
}

export interface EventoFeed {
  id: string
  tipo: string
  created_at: string
  lote_id: string | null
  descripcion: string
  confianza: number
  status: string
}

export interface LoteReal {
  lote_id: string
  nombre_coloquial: string
  hectareas: number | null
  activo: boolean
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await authFetch(url)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Error ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function useResumen(fincaId: string | null) {
  return useQuery({
    queryKey: ['finca', fincaId, 'resumen'],
    queryFn: () =>
      fetchJson<{ resumen: DashboardResumen }>(`${API}/api/finca/${fincaId}/resumen`).then(d => d.resumen),
    enabled: !!fincaId,
  })
}

export function useEventos(fincaId: string | null, tipo?: string) {
  return useQuery({
    queryKey: ['finca', fincaId, 'eventos', tipo ?? 'all'],
    queryFn: () =>
      fetchJson<{ eventos: EventoFeed[] }>(
        `${API}/api/finca/${fincaId}/eventos${tipo ? `?tipo=${encodeURIComponent(tipo)}` : ''}`,
      ).then(d => d.eventos),
    enabled: !!fincaId,
  })
}

export function useLotes(fincaId: string | null) {
  return useQuery({
    queryKey: ['finca', fincaId, 'lotes'],
    queryFn: () =>
      fetchJson<{ lotes: LoteReal[] }>(`${API}/api/finca/${fincaId}/lotes`).then(d => d.lotes),
    enabled: !!fincaId,
  })
}
