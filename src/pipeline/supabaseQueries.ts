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
  imagen_path?: string | null
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
  // Resume cualquier sesión no terminal (active + todos los pending_*). Excluir
  // SOLO 'completed' en vez de enumerar estados resumibles: enumerar dejaba
  // afuera pending_location_confirm / pending_excel_confirm / pending_sigatoka_aclaracion,
  // que se creaban de nuevo vacíos y perdían el flujo (cada estado nuevo recaía).
  const { data: existing, error: fetchError } = await client
    .from('sesiones_activas')
    .select('*')
    .eq('phone', phone)
    .eq('tipo_sesion', tipo)
    .neq('status', 'completed')
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

// Actualiza datos_evento + status de un evento ya persistido. Lo usa el follow-up
// de aclaración de Sigatoka: el evento se guarda primero como requires_review
// (P4 — no se pierde si el tomador no responde) y se actualiza con su respuesta.
export async function actualizarEventoDatos(
  eventoId: string,
  datos_evento: Record<string, unknown>,
  status: string,
  requiere_validacion: boolean,
  client: SupabaseClient = defaultClient,
): Promise<void> {
  const { error } = await client
    .from('eventos_campo')
    .update({ datos_evento, status, requiere_validacion })
    .eq('id', eventoId)
  if (error) throw error
}

export interface EventoRevisionSigatoka {
  id: string
  created_at: string
  datos_evento: Record<string, unknown>
  imagen_path: string | null
  confidence_score: number | null
}

// Lista los muestreos de Sigatoka en requires_review de una finca (cola de
// revisión del asesor, D28). Filtra por tipo_documento dentro del JSONB.
export async function getEventosRevisionSigatoka(
  fincaId: string,
  client: SupabaseClient = defaultClient,
): Promise<EventoRevisionSigatoka[]> {
  const { data, error } = await client
    .from('eventos_campo')
    .select('id, created_at, datos_evento, imagen_path, confidence_score')
    .eq('finca_id', fincaId)
    .eq('status', 'requires_review')
    .eq('datos_evento->>tipo_documento', 'muestreo_sigatoka_banano')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as EventoRevisionSigatoka[]
}

export interface EventoSigatokaDetalle extends EventoRevisionSigatoka {
  finca_id: string
  status: string
}

// Un evento por id (para la pantalla de revisión). Devuelve finca_id para que el
// router valide acceso (requireFincaAccess) antes de mostrar datos/imagen.
export async function getEventoSigatokaById(
  eventoId: string,
  client: SupabaseClient = defaultClient,
): Promise<EventoSigatokaDetalle | null> {
  const { data, error } = await client
    .from('eventos_campo')
    .select('id, finca_id, status, created_at, datos_evento, imagen_path, confidence_score')
    .eq('id', eventoId)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as EventoSigatokaDetalle | null
}

// ─── Feedback loop: correcciones de celdas Sigatoka ──────────────────────────
// Captura el par extraído-vs-corregido para el flywheel de evaluación de prompts (CR5).
// Nunca debe tumbar el flujo que la invoca (P4) — el caller captura excepciones.

export interface CorreccionSigatokaInsert {
  evento_id: string
  finca_id: string
  punto: string
  campo: string
  valor_extraido: number | null
  estado_extraido: string | null
  valor_corregido: number | null
  fuente: 'asesor_ui' | 'tomador_whatsapp'
  creado_por?: string | null
}

export async function guardarCorreccionesSigatoka(
  correcciones: CorreccionSigatokaInsert[],
  client: SupabaseClient = defaultClient,
): Promise<void> {
  if (correcciones.length === 0) return
  const { error } = await client.from('sigatoka_correcciones').insert(correcciones)
  if (error) throw error
}

// Lee las correcciones humanas para el eval de extracción (CR5). Opcionalmente
// acotado a un evento. El shape es estructuralmente compatible con CorreccionEval.
export async function getCorreccionesParaEval(
  eventoId?: string,
  client: SupabaseClient = defaultClient,
): Promise<Array<{ evento_id: string; punto: string; campo: string; estado_extraido: string | null; valor_extraido: number | null; valor_corregido: number | null }>> {
  let q = client
    .from('sigatoka_correcciones')
    .select('evento_id, punto, campo, estado_extraido, valor_extraido, valor_corregido')
  if (eventoId) q = q.eq('evento_id', eventoId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Array<{ evento_id: string; punto: string; campo: string; estado_extraido: string | null; valor_extraido: number | null; valor_corregido: number | null }>
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
  // Intentar usar la función RPC primero (más eficiente)
  try {
    const { data, error } = await client.rpc('get_fincas_con_coordenadas')
    if (!error) return (data ?? []) as FincaConCoordenadasRow[]
    
    // Si falla la función, loggear y continuar con fallback
    console.warn('[getFincasConCoordenadas] RPC function error, using fallback query:', error.message)
  } catch (err) {
    console.warn('[getFincasConCoordenadas] RPC not available, using fallback query:', err)
  }
  
  // Fallback: query directa si la función no existe o falla
  const { data, error } = await client
    .from('fincas')
    .select('finca_id, nombre, cultivo_principal, coordenadas')
    .eq('activa', true)
    .not('coordenadas', 'is', null)
  
  if (error) {
    console.error('[getFincasConCoordenadas] Fallback query failed:', error)
    throw error
  }
  
  // Transformar coordenadas PostGIS a lat/lng
  return (data ?? []).map((finca: any) => {
    // coordenadas viene como string "POINT(lng lat)" o objeto
    let lat: number | null = null
    let lng: number | null = null
    
    if (finca.coordenadas) {
      if (typeof finca.coordenadas === 'object' && finca.coordenadas.coordinates) {
        // Formato GeoJSON: [lng, lat]
        lng = finca.coordenadas.coordinates[0]
        lat = finca.coordenadas.coordinates[1]
      } else if (typeof finca.coordenadas === 'string') {
        // Parsear "POINT(lng lat)"
        const match = finca.coordenadas.match(/POINT\(([^\s]+)\s+([^\)]+)\)/i)
        if (match) {
          lng = parseFloat(match[1])
          lat = parseFloat(match[2])
        }
      }
    }
    
    return {
      finca_id: finca.finca_id,
      nombre: finca.nombre,
      cultivo_principal: finca.cultivo_principal,
      lat: lat ?? 0,
      lng: lng ?? 0,
    }
  })
}

export interface EventoResumenRow {
  id: string
  created_at: string
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
    .select('id, created_at, tipo_evento, fecha_evento, lote_id, datos_evento, descripcion_raw, confidence_score, status')
    .eq('finca_id', fincaId)
    .gte('created_at', desde.toISOString())
    .lt('created_at', hasta.toISOString())
    .neq('status', 'draft')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as EventoResumenRow[]
}

// ── Resumen de plagas por nivel de umbral para el reporte semanal ─────────────

export interface PlaguaNivelResumen {
  plaga_tipo:    string
  bajo:          string[]   // nombres de lotes
  medio:         string[]
  alto:          string[]
  critico:       string[]
  sin_umbral:    string[]   // detectada pero sin métrica configurada
}

export async function getPlagasPorNivelSemanal(
  fincaId: string,
  desde: Date,
  hasta: Date,
  client: SupabaseClient = defaultClient,
): Promise<PlaguaNivelResumen[]> {
  const fechaInicio = desde.toISOString().slice(0, 10)
  const fechaFin    = hasta.toISOString().slice(0, 10)

  // 1. Eventos de plaga de la semana con nombre de lote
  const { data: eventosPlaga, error: errEventos } = await client
    .from('eventos_campo')
    .select('lote_id, datos_evento, lotes(nombre_coloquial)')
    .eq('finca_id', fincaId)
    .eq('tipo_evento', 'plaga')
    .gte('created_at', desde.toISOString())
    .lt('created_at', hasta.toISOString())
    .neq('status', 'draft')

  if (errEventos) throw new Error(`[getPlagasPorNivelSemanal] query eventos_campo: ${errEventos.message}`)
  if (!eventosPlaga?.length) return []

  // 2. Resultados de métricas en el mismo periodo (D18)
  const { data: resultados, error: errResultados } = await client
    .from('resultados_metricas')
    .select('lote_id, nivel_actual, metricas_finca(tipo_evento, nombre)')
    .eq('finca_id', fincaId)
    .eq('metricas_finca.tipo_evento', 'plaga')
    .gte('fecha_inicio', fechaInicio)
    .lte('fecha_fin', fechaFin)
    .not('lote_id', 'is', null)

  if (errResultados) throw new Error(`[getPlagasPorNivelSemanal] query resultados_metricas: ${errResultados.message}`)

  // Mapa lote_id → nivel_actual (de la métrica más reciente)
  const nivelPorLote = new Map<string, string>()
  for (const r of resultados ?? []) {
    if (r.lote_id && r.nivel_actual) {
      nivelPorLote.set(r.lote_id, r.nivel_actual)
    }
  }

  // 3. Agrupar por plaga_tipo → niveles → lotes
  const mapa = new Map<string, PlaguaNivelResumen>()

  for (const ev of eventosPlaga) {
    const datos     = ev.datos_evento as Record<string, unknown>
    const plagaTipo = (datos['plaga_tipo'] ?? datos['nombre_comun'] ?? 'Plaga desconocida') as string
    const loteNombre = (ev as unknown as Record<string, unknown>)['lotes']
      ? ((ev as unknown as Record<string, { nombre_coloquial: string }>)['lotes'] as { nombre_coloquial: string })?.nombre_coloquial
      : ev.lote_id ?? 'Lote desconocido'

    if (!mapa.has(plagaTipo)) {
      mapa.set(plagaTipo, { plaga_tipo: plagaTipo, bajo: [], medio: [], alto: [], critico: [], sin_umbral: [] })
    }

    const grupo = mapa.get(plagaTipo)!
    const nivel = ev.lote_id ? nivelPorLote.get(ev.lote_id) : undefined

    switch (nivel) {
      case 'bajo':    if (!grupo.bajo.includes(loteNombre))    grupo.bajo.push(loteNombre);    break
      case 'medio':   if (!grupo.medio.includes(loteNombre))   grupo.medio.push(loteNombre);   break
      case 'alto':    if (!grupo.alto.includes(loteNombre))    grupo.alto.push(loteNombre);    break
      case 'critico': if (!grupo.critico.includes(loteNombre)) grupo.critico.push(loteNombre); break
      default:        if (!grupo.sin_umbral.includes(loteNombre)) grupo.sin_umbral.push(loteNombre)
    }
  }

  return Array.from(mapa.values())
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
  source_context?: string | null
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
      source_context: insert.source_context ?? null,
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

export async function guardarEmbeddingEnEvento(
  eventoId: string,
  embeddingVector: string,
  client: SupabaseClient = defaultClient,
): Promise<void> {
  const { error } = await client
    .from('eventos_campo')
    .update({ embedding: embeddingVector })
    .eq('id', eventoId)
  if (error) throw error
}

export interface IntencionPendiente {
  tipo_evento: string
  job_id: string
  status: 'pending' | 'completed' | 'failed'
  evento_extraido: Record<string, unknown> | null
  evento_id: string | null
}

export async function guardarLoteIntenciones(
  sessionId: string,
  intenciones: IntencionPendiente[],
  transaccionOriginal: string,
  client: SupabaseClient = defaultClient,
): Promise<void> {
  const { error } = await client
    .from('sesiones_activas')
    .update({
      contexto_parcial: {
        intenciones_pendientes: intenciones,
        transaccion_original: transaccionOriginal,
        total_intenciones: intenciones.length,
        completadas: 0,
        fallidas: 0,
      },
      status: 'processing_intentions',
    })
    .eq('session_id', sessionId)
  if (error) throw error
}

// Marca una intención (completada o fallida) de forma ATÓMICA vía la RPC
// `marcar_intencion_estado`, que toma el lock de fila (SELECT ... FOR UPDATE)
// y muta el ledger JSONB dentro de Postgres. Esto elimina la condición de
// carrera del read-modify-write previo: con varios workers concurrentes
// terminando intenciones del mismo mensaje, ya no se pisan los updates.
export async function marcarIntencionCompletada(
  sessionId: string,
  jobId: string,
  eventoExtraido: Record<string, unknown>,
  eventoId: string,
  client: SupabaseClient = defaultClient,
): Promise<{ todas_completas: boolean; intenciones: IntencionPendiente[]; transaccion_original: string }> {
  const { data, error } = await client.rpc('marcar_intencion_estado', {
    p_session_id: sessionId,
    p_job_id: jobId,
    p_status: 'completed',
    p_evento_extraido: eventoExtraido,
    p_evento_id: eventoId,
  })
  if (error) throw error

  const r = data as { todas_completas: boolean; intenciones: IntencionPendiente[]; transaccion_original: string }
  return {
    todas_completas: r.todas_completas,
    intenciones: r.intenciones ?? [],
    transaccion_original: r.transaccion_original ?? '',
  }
}

export async function marcarIntencionFallida(
  sessionId: string,
  jobId: string,
  errorDetail: string,
  client: SupabaseClient = defaultClient,
): Promise<{ todas_completas: boolean; intenciones: IntencionPendiente[] }> {
  const { data, error } = await client.rpc('marcar_intencion_estado', {
    p_session_id: sessionId,
    p_job_id: jobId,
    p_status: 'failed',
    p_evento_extraido: { error: errorDetail },
    p_evento_id: null,
  })
  if (error) throw error

  const r = data as { todas_completas: boolean; intenciones: IntencionPendiente[] }
  return { todas_completas: r.todas_completas, intenciones: r.intenciones ?? [] }
}

// ─── Provisioning helpers (T-07, client-provisioning change) ──────────────────

/**
 * Returns the next available org_id (e.g. 'ORG001', 'ORG002', 'ORG1000').
 * Reads the highest existing org_id, increments the numeric suffix, and pads
 * to at least 3 digits. Zero-based when the table is empty.
 *
 * NOTE: Concurrency-unsafe (no advisory lock). Acceptable for H0-R (founder-driven,
 * ≤1 concurrent provisioning). For H1, replace with a Postgres sequence or
 * advisory lock before allowing concurrent provisioning.
 */
export async function getNextOrgId(client: SupabaseClient = defaultClient): Promise<string> {
  const { data, error } = await client
    .from('organizaciones')
    .select('org_id')
    .order('org_id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const match = (data as { org_id: string } | null)?.org_id?.match(/^ORG(\d+)$/)
  const next = match?.[1] != null ? parseInt(match[1], 10) + 1 : 1
  // Pad to 3 digits minimum; numbers > 999 are NOT truncated (no overflow).
  return `ORG${String(next).padStart(3, '0')}`
}

// NOT exported — these are partial-state helpers that skip consent registration.
// Using them standalone creates consent-less tenants, violating P6. They exist only
// as internal primitives for testing and recovery paths that go through the full
// provisionar_cliente_atomico RPC flow. DO NOT export.
interface OrganizacionInsert {
  org_id: string
  nombre: string
  tipo: 'individual' | 'empresa'
  pais: string
  plan?: string
  activa?: boolean
  fincas_contratadas?: number
  usuarios_contratados?: number
  is_test_org?: boolean
}

async function createOrganizacion(data: OrganizacionInsert, client: SupabaseClient = defaultClient): Promise<void> {
  const { error } = await client.from('organizaciones').insert({
    org_id: data.org_id,
    nombre: data.nombre,
    tipo: data.tipo,
    pais: data.pais,
    plan: data.plan ?? 'trial',
    activa: data.activa ?? true,
    trial_inicio: null,
    trial_fin: null,
    fincas_contratadas: data.fincas_contratadas ?? 1,
    usuarios_contratados: data.usuarios_contratados ?? 1,
    is_test_org: data.is_test_org ?? false,
  })
  if (error) throw error
}

interface UsuarioAdminInsert {
  phone: string
  nombre: string
  org_id: string
}

async function createUsuarioAdmin(data: UsuarioAdminInsert, client: SupabaseClient = defaultClient): Promise<string> {
  const { data: row, error } = await client
    .from('usuarios')
    .insert({
      phone: data.phone,
      nombre: data.nombre,
      rol: 'admin_org',
      org_id: data.org_id,
      onboarding_completo: false,
      consentimiento_datos: true,
    })
    .select('id')
    .single()
  if (error) throw error
  return (row as { id: string }).id
}

// Silence unused-variable warnings: these remain available for internal recovery paths.
void createOrganizacion
void createUsuarioAdmin

export interface ProvisionarClienteAtomicoArgs {
  // Note: p_org_id is NOT in this interface — org_id generation is now atomic inside the
  // RPC (advisory lock + sequential assignment in a single transaction). This eliminates
  // the TOCTOU race that existed when the TS caller pre-computed it before the INSERT.
  p_nombre_org: string
  p_tipo: 'individual' | 'empresa'
  p_pais: string
  p_fincas: number
  p_usuarios: number
  p_phone: string
  p_nombre_admin: string
  p_consent_texto: string
}

export interface ProvisionarClienteAtomicoResult {
  orgId: string
  usuarioId: string
}

/**
 * Thin wrapper around the provisionar_cliente_atomico SQL RPC.
 * The RPC generates org_id atomically (advisory lock) and creates org + admin +
 * user_consent in a single transaction (all three or none, P4/P6).
 * Returns both the generated org_id and the UUID of the created admin user.
 */
export async function provisionarClienteAtomico(
  args: ProvisionarClienteAtomicoArgs,
  client: SupabaseClient = defaultClient,
): Promise<ProvisionarClienteAtomicoResult> {
  const { data, error } = await client.rpc('provisionar_cliente_atomico', args)
  if (error) throw new Error(error.message)
  const row = data as { usuario_id: string; org_id: string }
  return { orgId: row.org_id, usuarioId: row.usuario_id }
}
