import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { authFetch } from '../auth/api'
import { attentionLabel } from './conversationLabels'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

interface ConversacionRow {
  id: string
  phone: string
  nombre: string | null
  empresa: string | null
  status: string
  handoff_status: string
  handoff_reason: string | null
  ultima_interaccion: string | null
  needs_attention: boolean
}

interface ThreadItem {
  id: string
  created_at: string
  origen: 'mensajes_entrada' | 'sdr_interacciones'
  direction: 'inbound' | 'outbound'
  isFounder?: boolean
  contenido?: string
  contenido_raw?: string
  media_url?: string
  media_tipo?: 'audio' | 'image'
}

// Both source tables land in the same thread. `sdr_interacciones` uses
// `contenido`; `mensajes_entrada` uses `contenido_raw` (see
// getConversacionThread in src/pipeline/supabaseQueries.ts).
function threadText(item: ThreadItem): string {
  return item.contenido ?? item.contenido_raw ?? ''
}

// BUG A fix (fix/founder-crm-thread-direction): the backend now tags every
// thread row with an explicit `direction`. Render inbound (prospect) and
// outbound (Wasagro) messages distinctly so the founder can tell at a glance
// who said what.
function senderLabel(item: ThreadItem): string {
  if (item.direction === 'inbound') return 'Prospecto'
  return item.isFounder ? 'Wasagro (fundador)' : 'Wasagro'
}

async function readBackendError(res: Response, fallback: string): Promise<string> {
  const text = await res.text()
  try {
    const parsed = JSON.parse(text) as { error?: string }
    return parsed.error || fallback
  } catch {
    return fallback
  }
}

// T-H4.1 (founder-crm PR4, design Decision 7) — list pane + thread pane +
// pause/resume + send box. Reuses the authFetch/VITE_API_URL +
// loading/error/data pattern from ClientList.tsx (T-S3.3).
export function Inbox() {
  const [conversaciones, setConversaciones] = useState<ConversacionRow[] | null>(null)
  const [listError, setListError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [thread, setThread] = useState<ThreadItem[] | null>(null)
  const [threadError, setThreadError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [sendError, setSendError] = useState('')
  const [sending, setSending] = useState(false)
  const threadScrollRef = useRef<HTMLDivElement>(null)
  const [searchParams] = useSearchParams()

  // When a conversation opens (thread loads), jump to the LATEST message
  // (bottom) — a chat should land on the most recent message, not the oldest.
  useEffect(() => {
    if (thread && threadScrollRef.current) {
      threadScrollRef.current.scrollTop = threadScrollRef.current.scrollHeight
    }
  }, [thread])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setListError('')
      try {
        const res = await authFetch(`${API_BASE}/admin/conversaciones`)
        if (!res.ok) throw new Error(await readBackendError(res, `Error ${res.status} cargando conversaciones`))
        const data = (await res.json()) as ConversacionRow[]
        if (!cancelled) setConversaciones(data)
      } catch (err) {
        if (!cancelled) setListError(err instanceof Error ? err.message : 'Error cargando conversaciones')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function selectConversacion(id: string) {
    setSelectedId(id)
    setThread(null)
    setThreadError('')
    setSendError('')
    setMensaje('')
    try {
      const res = await authFetch(`${API_BASE}/admin/conversaciones/${id}/mensajes`)
      if (!res.ok) throw new Error(await readBackendError(res, `Error ${res.status} cargando la conversación`))
      const data = (await res.json()) as ThreadItem[]
      setThread(data)
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Error cargando la conversación')
    }
  }

  // Deep-link: arriving from the funnel (/admin/inbox?conv=<id>) auto-opens that
  // conversation once the list has loaded (guarded by !selectedId so it fires once).
  useEffect(() => {
    const convId = searchParams.get('conv')
    if (convId && conversaciones && !selectedId) {
      void selectConversacion(convId)
    }
  }, [conversaciones, searchParams, selectedId])

  // Reflects the new handoff_status locally from the route's own response —
  // no re-fetch of /conversaciones (no full reload).
  async function togglePause(conv: ConversacionRow) {
    const action = conv.handoff_status === 'human_paused' ? 'resume' : 'pause'
    const nextStatus = action === 'pause' ? 'human_paused' : 'bot'
    try {
      const res = await authFetch(`${API_BASE}/admin/conversaciones/${conv.id}/${action}`, { method: 'POST' })
      if (!res.ok) return
      setConversaciones((prev) =>
        prev
          ? prev.map((c) =>
              c.id === conv.id ? { ...c, handoff_status: nextStatus, needs_attention: nextStatus === 'human_paused' } : c,
            )
          : prev,
      )
    } catch {
      // Best-effort UI state — a network failure here leaves the prior state,
      // the founder can retry the button.
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    if (!selectedId || !mensaje.trim() || sending) return
    setSending(true)
    setSendError('')
    try {
      const res = await authFetch(`${API_BASE}/admin/conversaciones/${selectedId}/enviar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje }),
      })
      if (!res.ok) throw new Error(await readBackendError(res, `Error ${res.status} enviando el mensaje`))
      setMensaje('')
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Error enviando el mensaje')
    } finally {
      setSending(false)
    }
  }

  const selected = conversaciones?.find((c) => c.id === selectedId) ?? null

  return (
    <div style={{ display: 'flex', gap: 24, maxWidth: 1080, margin: '0 auto', height: 'calc(100vh - 160px)' }}>
      <div style={{ width: 320, flexShrink: 0, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1B3D24', marginBottom: 16 }}>Inbox</h1>

        {listError && <div style={errorBoxStyle}>{listError}</div>}
        {!listError && conversaciones === null && <div style={loadingStyle}>Cargando...</div>}
        {!listError && conversaciones !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {conversaciones.map((conv) => (
              <button
                key={conv.id}
                data-testid="conv-row"
                data-needs-attention={conv.needs_attention}
                onClick={() => selectConversacion(conv.id)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: conv.id === selectedId ? '2px solid #1B3D24' : '1px solid #EAE6DC',
                  background: conv.needs_attention ? '#FEF2F2' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1B3D24' }}>
                  {conv.nombre || conv.phone}
                  {attentionLabel(conv) && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: '#D45828', fontWeight: 700 }}>
                      ⚠ {attentionLabel(conv)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#9C9080' }}>{conv.phone}</div>
              </button>
            ))}
            {conversaciones.length === 0 && <div style={loadingStyle}>Sin conversaciones.</div>}
          </div>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {!selected && <div style={loadingStyle}>Selecciona una conversación.</div>}
        {selected && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#1B3D24' }}>{selected.nombre || selected.phone}</div>
                <div style={{ fontSize: 12, color: '#9C9080' }}>{selected.phone}</div>
              </div>
              <button onClick={() => togglePause(selected)} style={actionButtonStyle}>
                {selected.handoff_status === 'human_paused' ? 'Reanudar' : 'Pausar'}
              </button>
            </div>

            <div ref={threadScrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0, marginBottom: 16 }}>
              {threadError && <div style={errorBoxStyle}>{threadError}</div>}
              {!threadError && thread === null && <div style={loadingStyle}>Cargando...</div>}
              {!threadError && thread !== null && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {thread.map((item) => {
                    const isInbound = item.direction === 'inbound'
                    return (
                      <div
                        key={item.id}
                        data-testid="thread-item"
                        data-direction={item.direction}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          background: isInbound ? '#F5F1E8' : '#E7F0EA',
                          alignSelf: isInbound ? 'flex-start' : 'flex-end',
                          maxWidth: '80%',
                        }}
                      >
                        <div data-testid="thread-sender" style={{ fontSize: 11, fontWeight: 700, color: isInbound ? '#9C9080' : '#1B3D24' }}>
                          {senderLabel(item)}
                        </div>
                        {item.media_url && item.media_tipo === 'image' && (
                          <img src={item.media_url} alt="Imagen enviada por el prospecto" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 6, display: 'block', marginTop: 4 }} />
                        )}
                        {item.media_url && item.media_tipo === 'audio' && (
                          <audio controls src={item.media_url} style={{ marginTop: 4, maxWidth: 220 }} />
                        )}
                        {!item.media_url && <div style={{ fontSize: 13, color: '#1B3D24' }}>{threadText(item)}</div>}
                        <div style={{ fontSize: 11, color: '#9C9080' }}>{item.created_at}</div>
                      </div>
                    )
                  })}
                  {thread.length === 0 && <div style={loadingStyle}>Sin mensajes.</div>}
                </div>
              )}
            </div>

            <form onSubmit={handleSend} style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <input
                type="text"
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                placeholder="Escribe un mensaje..."
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #EAE6DC' }}
              />
              <button type="submit" disabled={sending} style={actionButtonStyle}>
                Enviar
              </button>
            </form>
            {sendError && <div style={{ ...errorBoxStyle, marginTop: 8 }}>{sendError}</div>}
          </>
        )}
      </div>
    </div>
  )
}

const errorBoxStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 8,
  background: '#FEF2F2',
  border: '1px solid #FECACA',
  color: '#D45828',
}
const loadingStyle: React.CSSProperties = { padding: 20, textAlign: 'center', color: '#9C9080' }
const actionButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: '#1B3D24',
  border: 'none',
  borderRadius: 8,
  color: '#F5F1E8',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
}
