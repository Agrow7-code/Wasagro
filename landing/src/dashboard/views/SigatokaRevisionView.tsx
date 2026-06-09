import { useState, useEffect, useCallback } from 'react'
import { Topbar } from '../layout/Topbar'
import { useAuth } from '../../auth/useAuth'

// Primera vista del dashboard con datos REALES (el resto es mock). Consume la
// API de revisión D28: lista los muestreos de Sigatoka en requires_review,
// muestra la foto original (URL firmada) y deja completar las celdas ilegibles.

const API = (import.meta.env.VITE_API_URL ?? '') as string

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('wasagro_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const LABEL_CELDA: Record<string, string> = {
  planta1_estadio: 'Planta 1 · estadio', planta1_piscas: 'Planta 1 · piscas',
  planta2_estadio: 'Planta 2 · estadio', planta2_piscas: 'Planta 2 · piscas',
  planta3_estadio: 'Planta 3 · estadio', planta3_piscas: 'Planta 3 · piscas',
  hVle: 'H+VLE', hVlq: 'H+VLQ', func: 'Func',
}

interface Ubicacion { punto: string; sector: string | null; campo: string }
interface ItemLista {
  id: string
  created_at: string
  confidence_score: number | null
  semana: number | null
  nombre_finca: string | null
  tiene_imagen: boolean
  ilegibles: { total: number; ruta: 'completo' | 'preguntar' | 'manual' }
}
interface Detalle {
  id: string
  status: string
  created_at: string
  confidence_score: number | null
  sigatoka: { semana: number | null; nombreFinca: string | null; supervisor: string | null } | null
  imagen_url: string | null
  ilegibles: { total: number; ubicaciones: Ubicacion[]; ruta: string }
}

function getInitials(n: string) {
  return n.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('')
}

const RUTA_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  completo:  { label: 'Completo',  color: '#1F8040', bg: '#EDFBF3' },
  preguntar: { label: 'A revisar', color: '#8A6000', bg: '#FDF6DD' },
  manual:    { label: 'Manual',    color: '#7A1810', bg: '#FFEEEA' },
}

export function SigatokaRevisionView() {
  const { user } = useAuth()
  const fincaId = user?.finca_id ?? null

  const [items, setItems] = useState<ItemLista[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const cargarLista = useCallback(async () => {
    if (!fincaId) { setLoadingList(false); return }
    setLoadingList(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/finca/${fincaId}/sigatoka/revision`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data = await res.json()
      setItems(data.eventos ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la cola de revisión')
    } finally {
      setLoadingList(false)
    }
  }, [fincaId])

  useEffect(() => { void cargarLista() }, [cargarLista])

  async function abrirDetalle(id: string) {
    if (!fincaId) return
    setDetalle(null)
    setValores({})
    setOkMsg(null)
    try {
      const res = await fetch(`${API}/api/finca/${fincaId}/sigatoka/revision/${id}`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setDetalle(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el muestreo')
    }
  }

  function aclaracionesDeInputs(): Array<{ punto: string; campo: string; valor: number | null }> {
    if (!detalle) return []
    return detalle.ilegibles.ubicaciones.map(u => {
      const raw = valores[`${u.punto}.${u.campo}`]?.trim()
      const num = raw ? Number(raw) : NaN
      return { punto: u.punto, campo: u.campo, valor: Number.isFinite(num) ? num : null }
    })
  }

  async function guardar(marcarRevisado: boolean) {
    if (!detalle || !fincaId) return
    setSaving(true)
    setOkMsg(null)
    try {
      const body: { aclaraciones: ReturnType<typeof aclaracionesDeInputs>; marcar_revisado?: boolean } = {
        aclaraciones: aclaracionesDeInputs(),
      }
      if (marcarRevisado) body.marcar_revisado = true
      const res = await fetch(`${API}/api/finca/${fincaId}/sigatoka/revision/${detalle.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data = await res.json()
      setOkMsg(marcarRevisado ? 'Muestreo marcado como revisado ✅' : `Guardado. Quedan ${data.ilegibles?.total ?? 0} sin definir.`)
      await cargarLista()
      if (data.status === 'complete') setDetalle(null)
      else await abrirDetalle(detalle.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  const card = { background: '#F5F1E8', border: '2px solid #0D0F0C', boxShadow: '4px 4px 0 0 #0D0F0C' } as const

  return (
    <>
      <Topbar
        title="Revisión Sigatoka"
        badge={`${items.length} muestreo${items.length !== 1 ? 's' : ''} por revisar`}
        avatarInitials={user ? getInitials(user.nombre) : 'WA'}
      />

      <main style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {!fincaId && (
          <div style={{ ...card, padding: 20, fontSize: 13, color: '#7A1810' }}>
            Tu usuario no tiene una finca asignada.
          </div>
        )}

        {error && (
          <div style={{ background: '#FFEEEA', border: '2px solid #C43020', boxShadow: '4px 4px 0 0 #C43020', padding: '12px 16px', fontSize: 13, color: '#C43020' }}>
            ⚠ {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: detalle ? '1fr 1fr' : '1fr', gap: 16, alignItems: 'start' }}>
          {/* Lista */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(13,15,12,0.1)', background: 'rgba(13,15,12,0.03)' }}>
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(13,15,12,0.4)' }}>
                Cola de revisión
              </span>
            </div>

            {loadingList && <div style={{ padding: 20, fontSize: 13, color: 'rgba(13,15,12,0.5)' }}>Cargando…</div>}
            {!loadingList && items.length === 0 && fincaId && (
              <div style={{ padding: 24, fontSize: 13, color: 'rgba(13,15,12,0.45)', textAlign: 'center' }}>
                No hay muestreos pendientes de revisión. ✅
              </div>
            )}

            {items.map(it => {
              const badge = RUTA_BADGE[it.ilegibles.ruta] ?? RUTA_BADGE['preguntar']!
              const activo = detalle?.id === it.id
              return (
                <div
                  key={it.id}
                  onClick={() => abrirDetalle(it.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                    borderBottom: '1px solid rgba(13,15,12,0.06)', cursor: 'pointer',
                    background: activo ? 'rgba(201,240,59,0.1)' : 'transparent',
                    borderLeft: activo ? '3px solid #C9F03B' : '3px solid transparent',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0D0F0C' }}>
                      {it.nombre_finca ?? 'Finca'} · semana {it.semana ?? '—'}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(13,15,12,0.45)', marginTop: 2 }}>
                      {new Date(it.created_at).toLocaleDateString()} · {it.ilegibles.total} celda{it.ilegibles.total !== 1 ? 's' : ''} ilegible{it.ilegibles.total !== 1 ? 's' : ''}
                      {it.tiene_imagen ? ' · 📷' : ''}
                    </div>
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 800, padding: '3px 7px', background: badge.bg, color: badge.color, border: `1.5px solid ${badge.color}`, flexShrink: 0 }}>
                    {badge.label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Detalle */}
          {detalle && (
            <div style={{ ...card, padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#0D0F0C' }}>
                    {detalle.sigatoka?.nombreFinca ?? 'Muestreo'} · semana {detalle.sigatoka?.semana ?? '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(13,15,12,0.5)', marginTop: 2 }}>
                    Confianza {detalle.confidence_score != null ? `${Math.round(detalle.confidence_score * 100)}%` : '—'}
                    {detalle.sigatoka?.supervisor ? ` · ${detalle.sigatoka.supervisor}` : ''}
                  </div>
                </div>
                <button onClick={() => setDetalle(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'rgba(13,15,12,0.4)' }}>✕</button>
              </div>

              {/* Imagen original */}
              {detalle.imagen_url
                ? <a href={detalle.imagen_url} target="_blank" rel="noopener noreferrer">
                    <img src={detalle.imagen_url} alt="Ficha de muestreo" style={{ width: '100%', border: '1px solid rgba(13,15,12,0.2)', marginBottom: 14, display: 'block' }} />
                  </a>
                : <div style={{ padding: 16, background: 'rgba(13,15,12,0.04)', fontSize: 12, color: 'rgba(13,15,12,0.45)', marginBottom: 14 }}>Sin imagen original</div>
              }

              {/* Celdas ilegibles a completar */}
              {detalle.ilegibles.ubicaciones.length === 0 ? (
                <div style={{ fontSize: 13, color: '#1F8040', marginBottom: 14 }}>No quedan celdas ilegibles. Podés marcarlo como revisado.</div>
              ) : (
                <>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(13,15,12,0.4)', marginBottom: 8 }}>
                    Celdas no leídas — completá lo que veas en la foto
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                    {detalle.ilegibles.ubicaciones.map(u => {
                      const key = `${u.punto}.${u.campo}`
                      return (
                        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ flex: 1, fontSize: 12, color: '#0D0F0C' }}>
                            <strong>{u.punto}</strong>{u.sector ? ` (${u.sector})` : ''} · {LABEL_CELDA[u.campo] ?? u.campo}
                          </div>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={valores[key] ?? ''}
                            onChange={e => setValores(v => ({ ...v, [key]: e.target.value }))}
                            placeholder="—"
                            style={{ width: 72, padding: '6px 8px', border: '2px solid #0D0F0C', fontSize: 13, fontFamily: 'monospace' }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {okMsg && <div style={{ fontSize: 12, color: '#1F8040', marginBottom: 10 }}>{okMsg}</div>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => guardar(false)}
                  disabled={saving || detalle.ilegibles.ubicaciones.length === 0}
                  style={{ flex: 1, padding: '10px', border: '2px solid #0D0F0C', background: '#F5F1E8', fontWeight: 700, fontSize: 13, cursor: saving ? 'wait' : 'pointer', opacity: detalle.ilegibles.ubicaciones.length === 0 ? 0.4 : 1 }}
                >
                  {saving ? 'Guardando…' : 'Guardar correcciones'}
                </button>
                <button
                  onClick={() => guardar(true)}
                  disabled={saving}
                  style={{ flex: 1, padding: '10px', border: '2px solid #1B3D24', background: '#C9F03B', color: '#0D0F0C', fontWeight: 800, fontSize: 13, cursor: saving ? 'wait' : 'pointer' }}
                >
                  Marcar revisado ✅
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
