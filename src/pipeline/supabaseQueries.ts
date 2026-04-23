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
    .select('id, phone, nombre, rol, org_id, finca_id, email, onboarding_completo, consentimiento_datos')
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

export async function updateUsuario(
  id: string,
  updates: Partial<{ nombre: string; onboarding_completo: boolean; finca_id: string; status: string }>,
  client: SupabaseClient = defaultClient,
): Promise<void> {
  const { error } = await client
    .from('usuarios')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
