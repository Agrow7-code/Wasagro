import { Hono } from 'hono'
import { supabase } from '../../integrations/supabase.js'
import { maskPhone } from '../../utils/maskPhone.js'
import { ProvisionInputSchema, provisionarCliente } from '../provisioning/provisionarCliente.js'

export const adminRouter = new Hono()

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

  if (error) return c.json({ error: error.message }, 500)

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
    fincas: { count: number } | null
    usuarios: { count: number } | null
  }

  const orgs = ((data ?? []) as unknown as OrgRow[]).map((row) => ({
    org_id: row.org_id,
    nombre: row.nombre,
    plan: row.plan,
    subscription_status: row.subscription_status,
    trial_inicio: row.trial_inicio,
    trial_fin: row.trial_fin,
    fincas_count: row.fincas?.count ?? 0,
    usuarios_count: row.usuarios?.count ?? 0,
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
adminRouter.get('/orgs/:id', async (c) => {
  const orgId = c.req.param('id')

  const { data: org, error: orgError } = await supabase
    .from('organizaciones')
    .select('*')
    .eq('org_id', orgId)
    .single()

  if (orgError || !org) return c.json({ error: 'Org not found' }, 404)

  const { data: fincas, error: fincasError } = await supabase
    .from('fincas')
    .select('finca_id, nombre, cultivo_principal, config')
    .eq('org_id', orgId)
  if (fincasError) return c.json({ error: fincasError.message }, 500)

  type UsuarioRow = { id: string; nombre: string | null; rol: string; phone: string }
  const { data: usuarios, error: usuariosError } = await supabase
    .from('usuarios')
    .select('id, nombre, rol, phone')
    .eq('org_id', orgId)
  if (usuariosError) return c.json({ error: usuariosError.message }, 500)

  return c.json({
    ...(org as Record<string, unknown>),
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

  if (error) return c.json({ error: error.message }, 500)

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
      { orgId: result.orgId, usuario_id: result.usuarioId, ya_existia: result.yaExistia },
      status,
    )
  } catch (err) {
    console.error('[admin/clients] provisionarCliente failed:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})
