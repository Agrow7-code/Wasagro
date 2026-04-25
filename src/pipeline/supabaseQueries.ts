import { supabase as defaultClient } from '../integrations/supabase.js'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface UsuarioRow {
  id: string
  phone: string
  nombre: string | null
  rol: string
  org_id: string
  finca_id: string | null
  email: string | null
  onboarding_completo: boolean
  consentimiento_datos: boolean
  status: string
}

export interface FincaRow {
  finca_id: string
  org_id: string
  nombre: string
  pais: string
  cultivo_principal: string | null
}

export interface LoteRow {
  lote_id: string
  finca_id: string
  nombre_coloquial: string
  hectareas: number | null
}

export interface MensajeEntradaRow {
  id: string
  wa_message_id: string
  status: string
}

export interface SesionActivaRow {
  session_id: string
  phone: string
  finca_id: string | null
  tipo_sesion: string
  clarification_count: number
  paso_onboarding: number | null
  contexto_parcial: Record<string, unknown>
  status: string
}

export interface MensajeInsert {
  wa_message_id: string
  phone: string
  tipo_mensaje: 'text' | 'audio' | 'image'
  contenido_raw?: string | null
  media_ref?: string | null
  finca_id?: string | null
  langfuse_trace_id?: string
  status?: string
}

export interface EventoCampoInsert {
  finca_id: string
  lote_id?: string | null
  tipo_evento: string
  status: string
  datos_evento: Record<string, unknown>
  descripcion_raw: string
  confidence_score?: number
  requiere_validacion?: boolean
  fecha_evento?: string | null
  created_by?: string
  mensaje_id?: string
}

export async function getMensajeByWamid(wamid: string, client: SupabaseClient = defaultClient): Promise<MensajeEntradaRow | null> {
  const { data, error } = await client
    .from('mensajes_entrada')
    .select('id, wa_message_id, status')
    .eq('wa_message_id', wamid)
    .maybeSingle()
  if (error) throw error
  return data as MensajeEntradaRow | null
}

export async function registrarMensaje(insert: MensajeInsert, client: SupabaseClient = defaultClient): Promise<string> {
  const { data, error } = await client
    .from('mensajes_entrada')
    .insert({ ...insert, status: insert.status ?? 'processing' })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function actualizarMensaje(
  id: string,
  updates: Partial<{ status: string; contenido_raw: string; evento_id: string; error_detail: string }>,
  client: SupabaseClient = defaultClient,
): Promise<void> {
  const { error } = await client
    .from('mensajes_entrada')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function getUserByPhone(phone: string, client: SupabaseClient = defaultClient): Promise<UsuarioRow | null> {
  const { data, error } = await client
    .from('usuarios')
    .select('id, phone, nombre, rol, org_id, finca_id, email, onboarding_completo, consentimiento_datos, status')
    .eq('phone', phone)
    .maybeSingle()
  if (error) throw error
  return data as UsuarioRow | null
}

export async function getFincaById(fincaId: string, client: SupabaseClient = defaultClient): Promise<FincaRow | null> {
  const { data, error } = await client
    .from('fincas')
    .select('finca_id, org_id, nombre, pais, cultivo_principal')
    .eq('finca_id', fincaId)
    .maybeSingle()
  if (error) throw error
  return data as FincaRow | null
}

export async function getLotesByFinca(fincaId: string, client: SupabaseClient = defaultClient): Promise<LoteRow[]> {
  const { data, error } = await client
    .from('lotes')
    .select('lote_id, finca_id, nombre_coloquial, hectareas')
    .eq('finca_id', fincaId)
    .eq('activo', true)
  if (error) throw error
  return (data ?? []) as LoteRow[]
}

export async function getOrCreateSession(
  phone: string,
  tipo: 'reporte' | 'onboarding',
  client: SupabaseClient = defaultClient,
): Promise<SesionActivaRow> {
  const { data: existing, error: fetchError } = await client
    .from('sesiones_activas')
    .select('*')
    .eq('phone', phone)
    .eq('tipo_sesion', tipo)
    .in('status', ['active', 'pending_confirmation'])
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (fetchError) throw fetchError
  if (existing) return existing as SesionActivaRow

  const { data: created, error: insertError } = await client
    .from('sesiones_activas')
    .insert({
      phone,
      tipo_sesion: tipo,
      clarification_count: 0,
      contexto_parcial: {},
      status: 'active',
    })
    .select('*')
    .single()

  if (insertError) throw insertError
  return created as SesionActivaRow
}

export async function updateSession(
  sessionId: string,
  updates: Partial<{ clarification_count: number; contexto_parcial: Record<string, unknown>; status: string; paso_onboarding: number }>,
  client: SupabaseClient = defaultClient,
): Promise<void> {
  const { error } = await client
    .from('sesiones_activas')
    .update({ ...updates, ultimo_mensaje_at: new Date().toISOString() })
    .eq('session_id', sessionId)
  if (error) throw error
}

export async function saveEvento(insert: EventoCampoInsert, client: SupabaseClient = defaultClient): Promise<string> {
  const { data, error } = await client
    .from('eventos_campo')
    .insert({
      ...insert,
      datos_evento: insert.datos_evento,
      requiere_validacion: insert.requiere_validacion ?? false,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export interface ProspectoInsert {
  phone: string
  tipo_contacto: 'trabajador' | 'decision_maker' | 'otro'
  nombre?: string | null
  finca_nombre?: string | null
  cultivo_principal?: string | null
  pais?: string | null
  tamanio_aproximado?: string | null
  interes_demo?: boolean
}

export async function saveProspecto(insert: ProspectoInsert, client: SupabaseClient = defaultClient): Promise<string> {
  const { data, error } = await client
    .from('prospectos')
    .insert({ ...insert, interes_demo: insert.interes_demo ?? false })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function getFincasDisponibles(client: SupabaseClient = defaultClient): Promise<FincaRow[]> {
  const { data, error } = await client
    .from('fincas')
    .select('finca_id, org_id, nombre, pais, cultivo_principal')
  if (error) throw error
  return (data ?? []) as FincaRow[]
}

export async function getFincasActivas(client: SupabaseClient = defaultClient): Promise<FincaRow[]> {
  const { data, error } = await client
    .from('fincas')
    .select('finca_id, org_id, nombre, pais, cultivo_principal')
    .eq('activa', true)
  if (error) throw error
  return (data ?? []) as FincaRow[]
}

export interface FincaConCoordenadasRow {
  finca_id: string
  nombre: string
  cultivo_principal: string | null
  lat: number
  lng: number
}

export async function getFincasConCoordenadas(client: SupabaseClient = defaultClient): Promise<FincaConCoordenadasRow[]> {
  const { data, error } = await client.rpc('get_fincas_con_coordenadas')
  if (error) throw error
  return (data ?? []) as FincaConCoordenadasRow[]
}

export interface EventoResumenRow {
  tipo_evento: string
  fecha_evento: string | null
  lote_id: string | null
  datos_evento: Record<string, unknown>
  descripcion_raw: string
  confidence_score: number
  status: string
}

export async function getEventosByFincaRango(
  fincaId: string,
  desde: Date,
  hasta: Date,
  client: SupabaseClient = defaultClient,
): Promise<EventoResumenRow[]> {
  const { data, error } = await client
    .from('eventos_campo')
    .select('tipo_evento, fecha_evento, lote_id, datos_evento, descripcion_raw, confidence_score, status')
    .eq('finca_id', fincaId)
    .gte('created_at', desde.toISOString())
    .lt('created_at', hasta.toISOString())
    .neq('status', 'draft')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as EventoResumenRow[]
}

export interface AdminRow {
  id: string
  phone: string
  nombre: string | null
  rol: string
}

export async function getAdminsByFinca(
  fincaId: string,
  client: SupabaseClient = defaultClient,
): Promise<AdminRow[]> {
  const { data, error } = await client
    .from('usuarios')
    .select('id, phone, nombre, rol')
    .eq('finca_id', fincaId)
    .eq('onboarding_completo', true)
    .in('rol', ['propietario', 'administrador', 'gerente'])
  if (error) throw error
  return (data ?? []) as AdminRow[]
}

export async function updateUsuario(
  id: string,
  updates: Partial<{ nombre: string; onboarding_completo: boolean; finca_id: string; org_id: string; status: string; consentimiento_datos: boolean }>,
  client: SupabaseClient = defaultClient,
): Promise<void> {
  const { error } = await client
    .from('usuarios')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export interface UserConsentInsert {
  user_id: string
  phone: string
  tipo: 'datos' | 'comunicaciones' | 'ubicacion'
  texto_mostrado: string
  aceptado: boolean
}

export async function saveUserConsent(data: UserConsentInsert, client: SupabaseClient = defaultClient): Promise<void> {
  const { error } = await client.from('user_consents').insert(data)
  if (error) throw error
}

export async function getNextFincaId(client: SupabaseClient = defaultClient): Promise<string> {
  const { data, error } = await client
    .from('fincas')
    .select('finca_id')
    .order('finca_id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const match = (data as { finca_id: string } | null)?.finca_id?.match(/^F(\d+)$/)
  const next = match?.[1] != null ? parseInt(match[1], 10) + 1 : 1
  return `F${String(next).padStart(3, '0')}`
}

export interface FincaInsert {
  finca_id: string
  org_id: string
  nombre: string
  pais: string | null
  cultivo_principal?: string | null
  ubicacion?: string | null
}

export async function updateFincaCoordenadas(
  fincaId: string,
  lat: number,
  lng: number,
  client: SupabaseClient = defaultClient,
): Promise<void> {
  const { error } = await client.rpc('update_finca_coordenadas', {
    p_finca_id: fincaId,
    p_lat: lat,
    p_lng: lng,
  })
  if (error) throw error
}

export async function createFinca(data: FincaInsert, client: SupabaseClient = defaultClient): Promise<void> {
  const { error } = await client.from('fincas').insert({
    finca_id: data.finca_id,
    org_id: data.org_id,
    nombre: data.nombre,
    pais: data.pais,
    cultivo_principal: data.cultivo_principal ?? null,
    ubicacion: data.ubicacion ?? null,
    activa: true,
  })
  if (error) throw error
}

export interface LoteInsert {
  lote_id: string
  finca_id: string
  nombre_coloquial: string
  hectareas?: number | null
}

export async function createLote(data: LoteInsert, client: SupabaseClient = defaultClient): Promise<void> {
  const { error } = await client.from('lotes').insert({
    lote_id: data.lote_id,
    finca_id: data.finca_id,
    nombre_coloquial: data.nombre_coloquial,
    hectareas: data.hectareas ?? null,
    activo: true,
  })
  if (error) throw error
}

export async function getJefeByFinca(fincaId: string, client: SupabaseClient = defaultClient): Promise<AdminRow | null> {
  const { data, error } = await client
    .from('usuarios')
    .select('id, phone, nombre, rol')
    .eq('finca_id', fincaId)
    .in('rol', ['propietario', 'jefe_finca', 'admin_org', 'director'])
    .eq('onboarding_completo', true)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as AdminRow | null
}

export async function getPendingAgricultoresByFinca(fincaId: string, client: SupabaseClient = defaultClient): Promise<UsuarioRow[]> {
  const { data, error } = await client
    .from('usuarios')
    .select('id, phone, nombre, rol, org_id, finca_id, email, onboarding_completo, consentimiento_datos, status')
    .eq('finca_id', fincaId)
    .eq('status', 'pendiente_aprobacion')
  if (error) throw error
  return (data ?? []) as UsuarioRow[]
}

export async function approveAgricultor(userId: string, client: SupabaseClient = defaultClient): Promise<void> {
  const { error } = await client
    .from('usuarios')
    .update({ status: 'activo', onboarding_completo: true, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw error
}

// ─── SDR Prospectos ────────────────────────────────────────────────────────

export async function getSDRProspecto(phone: string, client: SupabaseClient = defaultClient): Promise<Record<string, unknown> | null> {
  const { data, error } = await client
    .from('sdr_prospectos')
    .select('*')
    .eq('phone', phone)
    .maybeSingle()
  if (error) throw error
  return data as Record<string, unknown> | null
}

export interface SDRProspectoInsertDB {
  phone: string
  narrativa_asignada: 'A' | 'B'
  nombre?: string | null
  empresa?: string | null
  segmento_icp?: string
}

export async function createSDRProspecto(insert: SDRProspectoInsertDB, client: SupabaseClient = defaultClient): Promise<Record<string, unknown>> {
  const { data, error } = await client
    .from('sdr_prospectos')
    .insert({
      phone: insert.phone,
      narrativa_asignada: insert.narrativa_asignada,
      nombre: insert.nombre ?? null,
      empresa: insert.empresa ?? null,
      segmento_icp: insert.segmento_icp ?? 'desconocido',
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Record<string, unknown>
}

export async function updateSDRProspecto(id: string, updates: Record<string, unknown>, client: SupabaseClient = defaultClient): Promise<void> {
  const { error } = await client
    .from('sdr_prospectos')
    .update({ ...updates, ultima_interaccion: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function saveSDRInteraccion(insert: Record<string, unknown>, client: SupabaseClient = defaultClient): Promise<void> {
  const { error } = await client
    .from('sdr_interacciones')
    .insert({ ...insert, created_at: new Date().toISOString() })
  if (error) throw error
}

export async function getSDRProspectosPendingApproval(client: SupabaseClient = defaultClient): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await client
    .from('sdr_prospectos')
    .select('*')
    .eq('status', 'qualified')
    .not('founder_notified_at', 'is', null)
    .order('founder_notified_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Array<Record<string, unknown>>
}
