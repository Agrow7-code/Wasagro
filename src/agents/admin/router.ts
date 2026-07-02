import { Hono } from 'hono'
import { z } from 'zod'
import { supabase } from '../../integrations/supabase.js'
import { maskPhone } from '../../utils/maskPhone.js'
import { ProvisionInputSchema, provisionarCliente } from '../provisioning/provisionarCliente.js'
import {
  setHandoffEstado,
  getConversacionesList,
  getConversacionThread,
  getSDRProspectoById,
  saveSDRInteraccion,
} from '../../pipeline/supabaseQueries.js'
import { crearSenderWhatsApp } from '../../integrations/whatsapp/index.js'

export const adminRouter = new Hono()

// PostgREST returns an embedded aggregate over a to-many relationship as an
// ARRAY (`[{ count: N }]`), not a bare object. Older code read `.count`
// directly off the relation, which yielded `undefined → 0` for every org.
// Handle both shapes defensively so a PostgREST behavior change can't silently
// zero the counts again.
function embeddedCount(
  rel: { count: number } | { count: number }[] | null | undefined,
): number {
  if (Array.isArray(rel)) return rel[0]?.count ?? 0
  return rel?.count ?? 0
}

// ─── GET /api/admin/orgs — org list with ACTUAL + CONTRACTUAL counts ─────────
//
// T-S2.0 decision (recorded here per tasks.md): a PostgREST aggregate embed
// (`fincas(count)`, `usuarios(count)`) expresses ACTUAL counts (rows in
// fincas/usuarios) in the SAME round-trip as the organizaciones row — no RPC
// needed. fincas.org_id and usuarios.org_id are both FK columns to
// organizaciones.org_id (verified in 20260101000007_add-organizaciones.sql),
// so PostgREST resolves the embed without an explicit join hint. This is ONE
// query for the whole list, regardless of org count — never N+1 (design.md:
// "GET /api/admin/orgs counts via JOIN/subquery, not N+1"). CONTRACTUAL
// counts (fincas_contratadas/usuarios_contratados, D26) are plain columns on
// organizaciones, returned alongside but never conflated with ACTUAL counts.
adminRouter.get('/orgs', async (c) => {
  const { data, error } = await supabase
    .from('organizaciones')
    .select(
      'org_id, nombre, plan, subscription_status, trial_inicio, trial_fin, ' +
        'fincas_contratadas, usuarios_contratados, precio_mensual, fincas(count), usuarios(count)',
    )
    .order('nombre')

  if (error) {
    console.error('[admin/orgs] org list query failed:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }

  type OrgRow = {
    org_id: string
    nombre: string
    plan: string
    subscription_status: string
    trial_inicio: string | null
    trial_fin: string | null
    fincas_contratadas: number
    usuarios_contratados: number
    precio_mensual: number | null
    fincas: { count: number } | { count: number }[] | null
    usuarios: { count: number } | { count: number }[] | null
  }

  const orgs = ((data ?? []) as unknown as OrgRow[]).map((row) => ({
    org_id: row.org_id,
    nombre: row.nombre,
    plan: row.plan,
    subscription_status: row.subscription_status,
    trial_inicio: row.trial_inicio,
    trial_fin: row.trial_fin,
    fincas_count: embeddedCount(row.fincas),
    usuarios_count: embeddedCount(row.usuarios),
    fincas_contratadas: row.fincas_contratadas,
    usuarios_contratados: row.usuarios_contratados,
    precio_mensual: row.precio_mensual,
  }))

  return c.json(orgs)
})

// ─── GET /api/admin/orgs/:id — org detail ─────────────────────────────────────
//
// Note (Open Items #3, deferred per design.md): billing history from
// costo_servicio_mensual is part of S5 (P&L), which design.md explicitly
// defers — this PR returns org + fincas[] + usuarios[] only.
//
// SAFE allowlist — never includes payment token / card / customer-id columns
// (dlocalgo_checkout_token, dlocalgo_payment_id, dlocal_card_id, dlocal_payment_id,
// stripe_customer_id, stripe_subscription_id, metodo_pago, or any other
// *_token/*_card_id/*_payment_id column on organizaciones).
const SAFE_ORG_FIELDS =
  'org_id, nombre, plan, subscription_status, trial_inicio, trial_fin, ' +
  'fincas_contratadas, usuarios_contratados, precio_mensual'

adminRouter.get('/orgs/:id', async (c) => {
  const orgId = c.req.param('id')

  const { data: org, error: orgError } = await supabase
    .from('organizaciones')
    .select(SAFE_ORG_FIELDS)
    .eq('org_id', orgId)
    .maybeSingle()

  if (orgError) {
    console.error('[admin/orgs/:id] org lookup failed:', orgError)
    return c.json({ error: 'Internal server error' }, 500)
  }
  if (!org) return c.json({ error: 'Org not found' }, 404)

  const { data: fincas, error: fincasError } = await supabase
    .from('fincas')
    .select('finca_id, nombre, cultivo_principal, config')
    .eq('org_id', orgId)
  if (fincasError) {
    console.error('[admin/orgs/:id] fincas query failed:', fincasError)
    return c.json({ error: 'Internal server error' }, 500)
  }

  type UsuarioRow = { id: string; nombre: string | null; rol: string; phone: string }
  const { data: usuarios, error: usuariosError } = await supabase
    .from('usuarios')
    .select('id, nombre, rol, phone')
    .eq('org_id', orgId)
  if (usuariosError) {
    console.error('[admin/orgs/:id] usuarios query failed:', usuariosError)
    return c.json({ error: 'Internal server error' }, 500)
  }

  return c.json({
    ...(org as unknown as Record<string, unknown>),
    fincas: fincas ?? [],
    usuarios: ((usuarios ?? []) as UsuarioRow[]).map((u) => ({ ...u, phone: maskPhone(u.phone) })),
  })
})

// ─── GET /api/admin/sdr — SDR funnel snapshot ─────────────────────────────────
//
// T-S2.4b decision (recorded here per tasks.md): the FSM state column is
// `status` (DB), not `estado` — the wire response key stays `estado` to match
// the admin-api spec, with this comment as the alias note for future readers.
// Display name uses COALESCE(nombre, empresa) since both are nullable and
// either may be the only one populated at a given point in the SDR flow.
adminRouter.get('/sdr', async (c) => {
  type ProspectoRow = {
    id: string
    nombre: string | null
    empresa: string | null
    phone: string
    status: string
    turns_total: number
    calcom_booking_id: string | null
    created_at: string
  }

  const { data, error } = await supabase
    .from('sdr_prospectos')
    .select('id, nombre, empresa, phone, status, turns_total, calcom_booking_id, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[admin/sdr] prospectos query failed:', error)
    return c.json({ error: 'Internal server error' }, 500)
  }

  const prospectos = ((data ?? []) as unknown as ProspectoRow[]).map((row) => ({
    id: row.id,
    nombre: row.nombre ?? row.empresa,
    phone: maskPhone(row.phone),
    estado: row.status,
    turns_total: row.turns_total,
    calcom_booking_id: row.calcom_booking_id,
    created_at: row.created_at,
  }))

  return c.json(prospectos)
})

// ─── POST /api/admin/clients — create client (UI trigger) ────────────────────
//
// Calls provisionarCliente() DIRECTLY. NEVER import or call
// createProvisionHandler — that factory enforces `x-reporte-secret`
// (REPORTE_SECRET), which must never be exposed to the browser. roleGuard
// (mounted ahead of this router in index.ts, T-S2.6) is the SOLE gate here;
// any `x-reporte-secret` header on this route is simply never read.
adminRouter.post('/clients', async (c) => {
  let rawBody: unknown
  try {
    rawBody = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const parsed = ProvisionInputSchema.safeParse(rawBody)
  if (!parsed.success) {
    return c.json({ error: 'Validation error' }, 400)
  }

  try {
    const result = await provisionarCliente(parsed.data)
    const status = result.yaExistia ? 200 : 201
    return c.json(
      { org_id: result.orgId, usuario_id: result.usuarioId, ya_existia: result.yaExistia },
      status,
    )
  } catch (err) {
    console.error('[admin/clients] provisionarCliente failed:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ─── GET /api/admin/conversaciones — inbox list ───────────────────────────────
//
// T-H2.3 (founder-crm PR2, founder-inbox spec "Conversation list"). One round
// trip via getConversacionesList (T-H2.1). Every phone is maskPhone-masked —
// the raw phone MUST NOT appear in the response body (D28/D31). needs_attention
// mirrors the spec's "human_paused" rule only — founder_notified_at is set once
// and never cleared, so including it made the flag stick permanently (fix
// founder-crm-attention-label).
adminRouter.get('/conversaciones', async (c) => {
  try {
    const rows = await getConversacionesList()
    const conversaciones = rows.map((row) => ({
      id: row['id'],
      phone: maskPhone(row['phone'] as string),
      nombre: row['nombre'],
      empresa: row['empresa'],
      status: row['status'],
      handoff_status: row['handoff_status'],
      handoff_reason: row['handoff_reason'],
      ultima_interaccion: row['ultima_interaccion'],
      needs_attention: row['handoff_status'] === 'human_paused',
    }))
    return c.json(conversaciones)
  } catch (err) {
    console.error('[admin/conversaciones] list query failed:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ─── GET /api/admin/conversaciones/:id/mensajes — thread read ────────────────
//
// T-H2.4 (founder-crm PR2, founder-inbox spec "Conversation thread read" +
// "Isolation and non-enumeration"). Unlike the pause/resume routes, an unknown
// `:id` here returns 200 + [] (never 404) — this is a READ endpoint and the
// spec explicitly requires error responses not to leak existence vs. emptiness.
// getConversacionThread (T-H2.2) already returns [] for an unknown id with no
// throw, so this route needs no separate existence check.
adminRouter.get('/conversaciones/:id/mensajes', async (c) => {
  const id = c.req.param('id')
  try {
    const thread = await getConversacionThread(id)
    const masked = thread.map((row) => {
      const out = { ...row }
      if (typeof out['phone'] === 'string') out['phone'] = maskPhone(out['phone'] as string)
      return out
    })
    return c.json(masked)
  } catch (err) {
    console.error('[admin/conversaciones/:id/mensajes] failed:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ─── POST /api/admin/conversaciones/:id/pause | /resume — manual takeover ────
//
// T-H1.6 (founder-crm PR1b, REQ-hand-008/009). Addressed by prospecto UUID
// `:id`, never `:phone` — same D28/D31 phone-masking rationale as every other
// route on this router. Gated by the router's existing `roleGuard` mount
// (director-only, applied in src/index.ts ahead of this router).
//
// Supabase's `.update().eq()` does not error and does not report rows-affected
// on its own, so an unknown `:id` would otherwise silently 200. `findProspecto`
// does a minimal existence lookup first so unknown ids return 404 (P7 — no
// action can be taken on a target the caller can't confirm exists).
async function findProspecto(id: string): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('sdr_prospectos')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as { id: string } | null) ?? null
}

adminRouter.post('/conversaciones/:id/pause', async (c) => {
  const id = c.req.param('id')
  try {
    const prospecto = await findProspecto(id)
    if (!prospecto) return c.json({ error: 'Conversation not found' }, 404)

    // No founder ping here — the founder is the one triggering this transition,
    // unlike the auto-pause path in HandoffGateHandler.ts which pings because
    // the founder doesn't otherwise know the pause happened.
    await setHandoffEstado(id, {
      handoff_status: 'human_paused',
      handoff_reason: 'manual',
      handoff_paused_at: new Date().toISOString(),
    })
    return c.json({ status: 'paused' })
  } catch (err) {
    console.error('[admin/conversaciones/:id/pause] failed:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

adminRouter.post('/conversaciones/:id/resume', async (c) => {
  const id = c.req.param('id')
  try {
    const prospecto = await findProspecto(id)
    if (!prospecto) return c.json({ error: 'Conversation not found' }, 404)

    // Manual-only resume (REQ-hand-009) — clearing handoff_reason and
    // handoff_last_pinged_at re-arms the auto-pause ping-dedupe and pause
    // reason for the NEXT pause episode, whatever triggers it.
    await setHandoffEstado(id, {
      handoff_status: 'bot',
      handoff_resumed_at: new Date().toISOString(),
      handoff_reason: null,
      handoff_last_pinged_at: null,
    })
    return c.json({ status: 'resumed' })
  } catch (err) {
    console.error('[admin/conversaciones/:id/resume] failed:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ─── POST /api/admin/conversaciones/:id/enviar — send from panel ─────────────
//
// T-H3.2 (founder-crm PR3, founder-inbox spec "Send message from panel").
// The real phone is resolved server-side from the `:id` row and NEVER
// included in the JSON response (D28/D31 — same masking discipline as every
// read route on this router, taken further here: not even masked, simply
// absent). crearSenderWhatsApp() already wraps CostTrackedSender (verified
// T-H3.0) — called directly, no explicit wrap. Reuses the already-allowed
// tipo='founder_override' with action_taken=null (verified codebase fact,
// zero new migration). Send does NOT touch handoff_status — no auto-resume
// (P7): the founder explicitly calls /resume when they're done, same as the
// pause route explicitly calls /pause.
const EnviarMensajeSchema = z.object({ mensaje: z.string().min(1) })

adminRouter.post('/conversaciones/:id/enviar', async (c) => {
  const id = c.req.param('id')

  let rawBody: unknown
  try {
    rawBody = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const parsed = EnviarMensajeSchema.safeParse(rawBody)
  if (!parsed.success) {
    return c.json({ error: 'Validation error' }, 400)
  }

  try {
    const prospecto = await getSDRProspectoById(id)
    if (!prospecto) return c.json({ error: 'Conversation not found' }, 404)

    const phone = prospecto['phone'] as string
    const mensaje = parsed.data.mensaje

    await crearSenderWhatsApp().enviarTexto(phone, mensaje)

    // The message is already delivered. Persisting it to the thread is a
    // SECONDARY effect — if it fails, do NOT return an error: the founder would
    // resend and the prospect would get the message twice. Log-only and still
    // report success (the inbound trail + the founder's own record remain).
    try {
      await saveSDRInteraccion({
        prospecto_id: id,
        phone,
        turno: prospecto['turns_total'],
        tipo: 'founder_override',
        contenido: mensaje,
        action_taken: null,
      })
    } catch (persistErr) {
      console.error('[admin/conversaciones/:id/enviar] send OK but persist failed:', persistErr)
    }

    return c.json({ status: 'sent' })
  } catch (err) {
    console.error('[admin/conversaciones/:id/enviar] failed:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})
