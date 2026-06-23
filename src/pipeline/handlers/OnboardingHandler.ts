import { langfuse } from '../../integrations/langfuse.js'
import type { NormalizedMessage } from '../../integrations/whatsapp/NormalizedMessage.js'
import { timedFetch } from '../../integrations/timedFetch.js'
import {
  getUserByPhone,
  getOrCreateSession,
  updateSession,
  getFincasDisponibles,
  updateUsuario,
  saveUserConsent,
  getNextFincaId,
  createFinca,
  createLote,
  getJefeByFinca,
  actualizarMensaje,
  updateFincaCoordenadas,
  setOnboardingEstado,
} from '../supabaseQueries.js'
import type { SesionActivaRow, UsuarioRow } from '../supabaseQueries.js'
import { alertarFounder } from '../../integrations/whatsapp/founderAlerts.js'
import {
  decidirDesenlaceOnboarding,
  mensajeEnEspera,
  ONBOARDING_MAX_STEPS,
} from '../onboardingOutcome.js'
import type { OnboardingContext } from '../../agents/onboarding/context.js'
import {
  reduceOnboardingContext,
  mapDatosToExtraction,
} from '../../agents/onboarding/context.js'
import {
  hydrateOnboardingContext,
  toContextoConversacion,
  toContextoAgricultor,
  serializeContextForSession,
  loadCachedOnboardingContext,
  cacheOnboardingContext,
} from '../../agents/onboarding/contextStore.js'

async function geocodeAndUpdateFinca(fincaId: string, address: string, traceId: string): Promise<void> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&accept-language=es`
    const res = await timedFetch(10_000)(url, { headers: { 'User-Agent': 'Wasagro/1.0 (wasagro@proton.me)' } })
    const data = await res.json() as Array<{ lat: string; lon: string }>
  if (!data?.length) return
  const lat = parseFloat(data[0]!.lat)
  const lng = parseFloat(data[0]!.lon)
    await updateFincaCoordenadas(fincaId, lat, lng)
    langfuse.trace({ id: traceId }).event({ name: 'finca_geocoded', level: 'DEFAULT', output: { finca_id: fincaId, lat, lng, address } })
  } catch (err) {
    langfuse.trace({ id: traceId }).event({ name: 'finca_geocode_failed', level: 'WARNING', input: { address, error: String(err) } })
  }
}
import { _sender, _llm } from '../procesarMensajeEntrante.js'
import type { CostContext } from '../../integrations/llm/IWasagroLLM.js'
import { transcribirAudio } from '../sttService.js'
import { downloadEvolutionMedia } from '../../integrations/whatsapp/EvolutionMediaClient.js'

// TODO: Extraer a un archivo de constantes compartidas
const CONSENT_TEXT_ADMIN = 'Para guardar los reportes de tu finca necesito tu autorización. Tus datos son tuyos — solo se usan para generar tus reportes. Nadie más los ve sin tu permiso. ¿Aceptas?'
const CONSENT_TEXT_AGRICULTOR = 'Para guardar tus reportes de campo necesito tu permiso. Tus datos solo se usan para los reportes de tu finca. ¿Está bien?'
const MAX_ONBOARDING_STEPS = ONBOARDING_MAX_STEPS

// ─── Terminal/recovery helpers (change: onboarding-hardening) ───────────────

/** Extracts text from a WhatsApp message; transcribes audio. Returns '' when
 *  transcription fails or yields nothing — the caller decides degradation. */
async function obtenerTextoEntrada(msg: NormalizedMessage, traceId: string): Promise<string> {
  if (msg.tipo === 'texto') return msg.texto ?? ''
  if (msg.tipo !== 'audio') return ''
  let audioInput: string | Buffer = msg.audioUrl ?? ''
  const evApiUrl = process.env['EVOLUTION_API_URL']
  const evApiKey = process.env['EVOLUTION_API_KEY']
  const evInstance = process.env['EVOLUTION_INSTANCE']
  if (evApiUrl && evApiKey && evInstance) {
    try {
      const media = await downloadEvolutionMedia(msg.rawPayload, evApiUrl, evApiKey, evInstance)
      audioInput = Buffer.from(media.base64, 'base64')
    } catch (downloadErr) {
      langfuse.trace({ id: traceId }).event({ name: 'audio_download_failed', level: 'WARNING', input: { error: String(downloadErr), wamid: msg.wamid } })
    }
  }
  try {
    return await transcribirAudio(audioInput, traceId)
  } catch (err) {
    langfuse.trace({ id: traceId }).event({ name: 'stt_error', level: 'ERROR', input: { audio_ref: typeof audioInput === 'string' ? audioInput : '[buffer]', wamid: msg.wamid, error: String(err) } })
    return ''
  }
}

/** STT degradation (#7): explicit ask-to-type instead of a blind LLM re-ask. */
async function manejarSttDegradado(msg: NormalizedMessage, mensajeId: string, traceId: string): Promise<void> {
  langfuse.trace({ id: traceId }).event({ name: 'onboarding_stt_degraded', level: 'WARNING', input: { phone: msg.from, wamid: msg.wamid } })
  await _sender!.enviarTexto(msg.from, 'No te entendí el audio, ¿lo escribís? ⚠️')
  await actualizarMensaje(mensajeId, { status: 'processed' }).catch(() => {})
}

/** Stuck recovery (#1, #6): durable requiere_revision + holding + once-only
 *  founder alert (driven by the compare-and-set transition). */
async function finalizarOnboardingTrabado(
  usuario: UsuarioRow,
  session: SesionActivaRow,
  ctxNext: OnboardingContext,
  pasoTrabado: number,
  msg: NormalizedMessage,
  mensajeId: string,
  traceId: string,
): Promise<void> {
  const { transitioned } = await setOnboardingEstado(usuario.id, 'requiere_revision', { pasoTrabado })
    .catch(err => { console.error('[onboarding] setOnboardingEstado requiere_revision falló:', err); return { transitioned: false } })
  await updateSession(session.session_id, { status: 'fallback_nota_libre', contexto_parcial: serializeContextForSession(ctxNext) })
    .catch(err => console.error('[onboarding] updateSession trabado falló:', err))
  langfuse.trace({ id: traceId }).event({ name: 'onboarding_stuck', level: 'WARNING', input: { phone: msg.from, paso: pasoTrabado, finca_id: usuario.finca_id } })
  if (transitioned) {
    await alertarFounder('onboarding_requiere_revision', { phone: msg.from, nombre: usuario.nombre, finca: usuario.finca_id, org: usuario.org_id, detalle: `trabado en el paso ${pasoTrabado}` })
  }
  await _sender!.enviarTexto(msg.from, mensajeEnEspera('requiere_revision'))
  await actualizarMensaje(mensajeId, { status: 'processed' }).catch(() => {})
}

/** Consent rejection (#3): explicit terminal + founder signal, never a mute loop. */
async function finalizarConsentRechazado(
  usuario: UsuarioRow,
  session: SesionActivaRow,
  msg: NormalizedMessage,
  mensajeId: string,
  traceId: string,
): Promise<void> {
  const { transitioned } = await setOnboardingEstado(usuario.id, 'rechazo_consentimiento')
    .catch(err => { console.error('[onboarding] setOnboardingEstado rechazo falló:', err); return { transitioned: false } })
  await updateSession(session.session_id, { status: 'fallback_nota_libre' })
    .catch(err => console.error('[onboarding] updateSession rechazo falló:', err))
  langfuse.trace({ id: traceId }).event({ name: 'onboarding_consent_rejected', level: 'WARNING', input: { phone: msg.from } })
  if (transitioned) {
    await alertarFounder('consentimiento_rechazado', { phone: msg.from, nombre: usuario.nombre, finca: usuario.finca_id, org: usuario.org_id, detalle: 'rechazó el consentimiento de datos' })
  }
  await _sender!.enviarTexto(msg.from, mensajeEnEspera('rechazo_consentimiento'))
  await actualizarMensaje(mensajeId, { status: 'processed' }).catch(() => {})
}

// ─── Onboarding admin / propietario ───────────────────────────────────────

export async function handleOnboardingAdmin(
  msg: NormalizedMessage,
  usuario: NonNullable<Awaited<ReturnType<typeof getUserByPhone>>>,
  mensajeId: string,
  traceId: string,
): Promise<void> {
  // Trace de onboarding: extiende la trace root (inbound_message) con tags
  // específicos del flow. langfuse.trace({id, tags, metadata}) hace upsert,
  // así que merge con lo seteado en procesarMensajeEntrante.
  langfuse.trace({
    id:       traceId,
    name:     'onboarding_pipeline',
    tags:     ['onboarding', 'admin'],
    metadata: { usuario_id: usuario.id, phone: msg.from, finca_id: usuario.finca_id ?? null, rol: usuario.rol },
  })

  const session = await getOrCreateSession(msg.from, 'onboarding')

  const texto = await obtenerTextoEntrada(msg, traceId)
  // STT degradation (#7): an unusable audio gets an explicit ask-to-type, not a
  // blind LLM re-ask with empty input.
  if (msg.tipo === 'audio' && texto.trim() === '') {
    await manejarSttDegradado(msg, mensajeId, traceId)
    return
  }

  // Fase F-2 commit 3: Redis cache primero (TTL 24h) — evita el parsing del
  // bag legacy de Supabase en turnos sucesivos. Fallback a hydrate-desde-row
  // si Redis miss / corrupt / drift. Supabase sigue siendo source of truth.
  const ctx0 = (await loadCachedOnboardingContext(msg.from))
    ?? hydrateOnboardingContext(session, usuario, 'admin')
  const ctxIn = reduceOnboardingContext(ctx0, { userMessage: texto })

  const resultado = await _llm!.onboardarAdmin(texto, toContextoConversacion(ctxIn), traceId, { orgId: usuario.org_id, fincaId: usuario.finca_id ?? undefined } satisfies CostContext)
  const datos = resultado.datos_extraidos ?? {}

  // P6: persist consent exactly once when the user accepts. ctx0.consentimiento
  // captura el "ya fue confirmado alguna vez" (monotónico por reducer), así que
  // el guard idempotente sobrevive a writes parciales/retries del worker.
  const consentAlreadySaved = ctx0.consentimiento
  if (datos.consentimiento === true && !consentAlreadySaved) {
    await saveUserConsent({ user_id: usuario.id, phone: msg.from, tipo: 'datos', texto_mostrado: CONSENT_TEXT_ADMIN, aceptado: true })
      .catch(err => {
        console.error('[pipeline] Error guardando consentimiento admin:', err)
        langfuse.trace({ id: traceId }).event({ name: 'save_consent_error', level: 'ERROR', input: { error: String(err) } })
      })
    await updateUsuario(usuario.id, { consentimiento_datos: true })
      .catch(err => console.error('[pipeline] Error actualizando consentimiento_datos admin:', err))
  }

  // Consent rejection (#3): terminal + founder signal, not a mute re-loop. Only
  // when not already consented (reducer keeps consent monotonic).
  if (datos.consentimiento === false && !consentAlreadySaved) {
    await finalizarConsentRechazado(usuario, session, msg, mensajeId, traceId)
    return
  }

  // When onboarding completes: create finca and lotes under the admin's org
  if (resultado.onboarding_completo) {
    if (datos.finca_nombre) {
      try {
        const fincaId = await getNextFincaId()
        await createFinca({
          finca_id: fincaId,
          org_id: usuario.org_id,
          nombre: datos.finca_nombre,
          pais: datos.pais ?? null,
          cultivo_principal: datos.cultivo_principal ?? null,
          ubicacion: datos.finca_ubicacion_texto ?? null,
        })
        // Geocodificar dirección para centrar el mapa en el dashboard.
        // Fire-and-forget — el onboarding no debe bloquearse por una API
        // externa lenta de Nominatim. Si falla, el dashboard simplemente
        // muestra la finca sin coordenadas y se geocodifica en el próximo
        // edit manual.
        if (datos.finca_ubicacion_texto) {
          geocodeAndUpdateFinca(fincaId, datos.finca_ubicacion_texto, traceId).catch(err => {
            console.warn('[OnboardingHandler] geocodeAndUpdateFinca falló (no-bloqueante):', err)
          })
        }
        const lotes = datos.lotes ?? []
        for (const [i, lote] of lotes.entries()) {
          const loteNum = String(i + 1).padStart(2, '0')
          await createLote({ lote_id: `${fincaId}-L${loteNum}`, finca_id: fincaId, nombre_coloquial: lote.nombre_coloquial, hectareas: lote.hectareas ?? null })
        }
        await updateUsuario(usuario.id, { finca_id: fincaId, onboarding_completo: true })
        langfuse.trace({ id: traceId }).event({ name: 'finca_creada', level: 'DEFAULT', output: { finca_id: fincaId, lotes: lotes.length } })
      } catch (err) {
        console.error('[pipeline] Error creando finca/lotes en onboarding admin:', err)
        langfuse.trace({ id: traceId }).event({ name: 'create_finca_error', level: 'ERROR', input: { error: String(err) } })
      }
    } else {
      await updateUsuario(usuario.id, { onboarding_completo: true }).catch(err => {
        console.error('[pipeline] Error actualizando usuario onboarding admin:', err)
        langfuse.trace({ id: traceId }).event({ name: 'update_usuario_error', level: 'ERROR', input: { error: String(err) } })
      })
    }
  }

  // Reduce con la respuesta del LLM: extracción, paso, completitud, mensaje del bot
  // (que se appendea al historial vía el reducer).
  const ctxNext = reduceOnboardingContext(ctxIn, {
    extraction:         mapDatosToExtraction(datos),
    pasoCompletado:     resultado.paso_completado,
    pasoSiguiente:      resultado.siguiente_paso,
    onboardingCompleto: resultado.onboarding_completo,
    botMessage:         resultado.mensaje_para_usuario,
  })

  // Recovery (#1, #6): a non-completing onboarding that hits the step ceiling
  // OR exhausts the per-step attempts (P2 backstop, computed by the reducer,
  // not the LLM) goes to a durable requiere_revision — never the old loop.
  const desenlace = decidirDesenlaceOnboarding({
    onboardingCompleto:     ctxNext.onboardingCompleto,
    consentRejected:        false, // handled earlier with an early return
    pasoSiguiente:          ctxNext.pasoSiguiente,
    clarificationTurnsUsed: ctxNext.clarificationTurnsUsed,
  })

  if (desenlace.kind === 'stuck') {
    await finalizarOnboardingTrabado(usuario, session, ctxNext, desenlace.pasoTrabado, msg, mensajeId, traceId)
    return
  }

  await updateSession(session.session_id, {
    clarification_count: ctxNext.onboardingCompleto ? 0 : Math.min(ctxNext.pasoSiguiente, MAX_ONBOARDING_STEPS),
    contexto_parcial:    serializeContextForSession(ctxNext),
    status:              ctxNext.onboardingCompleto ? 'completed' : 'active',
  })

  // Keep the durable onboarding_estado in sync (compare-and-set stamps once).
  await setOnboardingEstado(usuario.id, ctxNext.onboardingCompleto ? 'completo' : 'en_progreso')
    .catch(err => console.error('[onboarding] setOnboardingEstado admin falló:', err))

  // Cache después de Supabase (source-of-truth first). Si Redis falla, no
  // fatal — próximo turno paga el round-trip a Postgres hasta que Redis vuelva.
  await cacheOnboardingContext(ctxNext)

  await _sender!.enviarTexto(msg.from, resultado.mensaje_para_usuario)
  await actualizarMensaje(mensajeId, { status: 'processed' })
}


// ─── Onboarding agricultor / técnico ──────────────────────────────────────

export async function handleOnboardingAgricultor(
  msg: NormalizedMessage,
  usuario: NonNullable<Awaited<ReturnType<typeof getUserByPhone>>>,
  mensajeId: string,
  traceId: string,
): Promise<void> {
  langfuse.trace({
    id:       traceId,
    name:     'onboarding_pipeline',
    tags:     ['onboarding', 'agricultor'],
    metadata: { usuario_id: usuario.id, phone: msg.from, finca_id: usuario.finca_id ?? null, rol: usuario.rol },
  })

  const session = await getOrCreateSession(msg.from, 'onboarding')

  const texto = await obtenerTextoEntrada(msg, traceId)
  if (msg.tipo === 'audio' && texto.trim() === '') {
    await manejarSttDegradado(msg, mensajeId, traceId)
    return
  }

  // Fase F-2 commit 3: cache Redis primero, fallback a hydrate-from-row.
  const ctx0Agr = (await loadCachedOnboardingContext(msg.from))
    ?? hydrateOnboardingContext(session, usuario, 'agricultor')
  const ctxInAgr = reduceOnboardingContext(ctx0Agr, { userMessage: texto })

  // Lista de fincas disponibles para inyectar en el prompt (derivada de DB,
  // no se persiste en ctx — se calcula en cada turno).
  const fincas = await getFincasDisponibles()
  const fincasDisponibles = fincas.length > 0
    ? fincas.map(f => `- ${f.finca_id}: ${f.nombre} (${f.cultivo_principal ?? 'cultivo no especificado'})`).join('\n')
    : 'No hay fincas registradas aún'

  const resultado = await _llm!.onboardarAgricultor(texto, toContextoAgricultor(ctxInAgr, fincasDisponibles), traceId, { orgId: usuario.org_id, fincaId: usuario.finca_id ?? undefined } satisfies CostContext)
  const datosAgr = resultado.datos_extraidos ?? {}

  // P6: persist consent exactly once. ctx0Agr.consentimiento es monotónico —
  // guardrail idempotente igual que en el flow admin.
  const consentAlreadySavedAgr = ctx0Agr.consentimiento
  if (datosAgr.consentimiento === true && !consentAlreadySavedAgr) {
    await saveUserConsent({ user_id: usuario.id, phone: msg.from, tipo: 'datos', texto_mostrado: CONSENT_TEXT_AGRICULTOR, aceptado: true })
      .catch(err => {
        console.error('[pipeline] Error guardando consentimiento agricultor:', err)
        langfuse.trace({ id: traceId }).event({ name: 'save_consent_error', level: 'ERROR', input: { error: String(err) } })
      })
    await updateUsuario(usuario.id, { consentimiento_datos: true })
      .catch(err => console.error('[pipeline] Error actualizando consentimiento_datos agricultor:', err))
  }

  // Consent rejection (#3): terminal + founder signal, not a mute re-loop.
  if (datosAgr.consentimiento === false && !consentAlreadySavedAgr) {
    await finalizarConsentRechazado(usuario, session, msg, mensajeId, traceId)
    return
  }

  // Assign finca_id when the agricultor selects their finca
  if (datosAgr.finca_id && usuario.finca_id !== datosAgr.finca_id) {
    await updateUsuario(usuario.id, { finca_id: datosAgr.finca_id }).catch(err => {
      console.error('[pipeline] Error asignando finca_id a agricultor:', err)
      langfuse.trace({ id: traceId }).event({ name: 'assign_finca_error', level: 'ERROR', input: { error: String(err) } })
    })
  }

  // Mark as pending and notify jefe
  if (resultado.status_usuario === 'pendiente_aprobacion') {
    await updateUsuario(usuario.id, { status: 'pendiente_aprobacion' })
      .catch(err => console.error('[pipeline] Error actualizando status agricultor:', err))
    langfuse.trace({ id: traceId }).event({
      name: 'agricultor_pendiente_aprobacion',
      input: { usuario_id: usuario.id, phone: msg.from, finca_id: datosAgr.finca_id },
    })
    const fincaIdParaJefe = datosAgr.finca_id ?? usuario.finca_id
    if (fincaIdParaJefe) {
      const jefe = await getJefeByFinca(fincaIdParaJefe).catch(err => {
        console.error('[pipeline] Error buscando jefe para notificación:', err)
        return null
      })
      if (jefe) {
        const nombreAgr = datosAgr.nombre ?? msg.from
        await _sender!.enviarTexto(
          jefe.phone,
          `⚠️ ${nombreAgr} quiere unirse a tu finca. Responde *aprobar ${nombreAgr}* para activarlo.`,
        ).catch(err => console.error('[pipeline] Error notificando al jefe:', err))
      }
    }
  }

  if (resultado.onboarding_completo) {
    await updateUsuario(usuario.id, { onboarding_completo: true }).catch(err => {
      console.error('[pipeline] Error actualizando agricultor onboarding:', err)
      langfuse.trace({ id: traceId }).event({ name: 'update_usuario_error', level: 'ERROR', input: { error: String(err) } })
    })
  }

  // Reduce con la respuesta del LLM (extracción, paso, completitud, mensaje bot).
  const ctxNextAgr = reduceOnboardingContext(ctxInAgr, {
    extraction:         mapDatosToExtraction(datosAgr),
    pasoCompletado:     resultado.paso_completado,
    pasoSiguiente:      resultado.siguiente_paso,
    onboardingCompleto: resultado.onboarding_completo,
    botMessage:         resultado.mensaje_para_usuario,
  })

  // pendiente_aprobacion is legitimate waiting (#5), NOT a stuck onboarding —
  // never let the P2 backstop mark a waiting agricultor as requiere_revision.
  const esEsperaAprobacion = resultado.status_usuario === 'pendiente_aprobacion' || usuario.status === 'pendiente_aprobacion'

  const desenlaceAgr = decidirDesenlaceOnboarding({
    onboardingCompleto:     ctxNextAgr.onboardingCompleto,
    consentRejected:        false, // handled earlier with an early return
    pasoSiguiente:          ctxNextAgr.pasoSiguiente,
    clarificationTurnsUsed: ctxNextAgr.clarificationTurnsUsed,
  })

  if (desenlaceAgr.kind === 'stuck' && !esEsperaAprobacion) {
    await finalizarOnboardingTrabado(usuario, session, ctxNextAgr, desenlaceAgr.pasoTrabado, msg, mensajeId, traceId)
    return
  }

  await updateSession(session.session_id, {
    clarification_count: ctxNextAgr.onboardingCompleto ? 0 : Math.min(ctxNextAgr.pasoSiguiente, MAX_ONBOARDING_STEPS),
    contexto_parcial:    serializeContextForSession(ctxNextAgr),
    status:              ctxNextAgr.onboardingCompleto ? 'completed' : 'active',
  })

  // Keep durable onboarding_estado in sync (waiting agricultor stays en_progreso).
  await setOnboardingEstado(usuario.id, ctxNextAgr.onboardingCompleto ? 'completo' : 'en_progreso')
    .catch(err => console.error('[onboarding] setOnboardingEstado agricultor falló:', err))

  // Cache después de Supabase (source-of-truth first).
  await cacheOnboardingContext(ctxNextAgr)

  await _sender!.enviarTexto(msg.from, resultado.mensaje_para_usuario)
  await actualizarMensaje(mensajeId, { status: 'processed' })
}


