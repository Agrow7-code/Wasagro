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
} from '../supabaseQueries.js'
import {
  reduceOnboardingContext,
  mapDatosToExtraction,
} from '../../agents/onboarding/context.js'
import {
  hydrateOnboardingContext,
  toContextoConversacion,
  toContextoAgricultor,
  serializeContextForSession,
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
import { transcribirAudio } from '../sttService.js'
import { downloadEvolutionMedia } from '../../integrations/whatsapp/EvolutionMediaClient.js'

// TODO: Extraer a un archivo de constantes compartidas
const CONSENT_TEXT_ADMIN = 'Para guardar los reportes de tu finca necesito tu autorización. Tus datos son tuyos — solo se usan para generar tus reportes. Nadie más los ve sin tu permiso. ¿Aceptas?'
const CONSENT_TEXT_AGRICULTOR = 'Para guardar tus reportes de campo necesito tu permiso. Tus datos solo se usan para los reportes de tu finca. ¿Está bien?'
const MAX_ONBOARDING_STEPS = 10

// ─── Onboarding admin / propietario ───────────────────────────────────────

export async function handleOnboardingAdmin(
  msg: NormalizedMessage,
  usuario: NonNullable<Awaited<ReturnType<typeof getUserByPhone>>>,
  mensajeId: string,
  traceId: string,
): Promise<void> {
  const session = await getOrCreateSession(msg.from, 'onboarding')
  
  let texto = msg.tipo === 'texto' ? (msg.texto ?? '') : ''
  if (msg.tipo === 'audio') {
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
      texto = await transcribirAudio(audioInput, traceId)
    } catch (err) {
      langfuse.trace({ id: traceId }).event({ name: 'stt_error', level: 'ERROR', input: { audio_ref: typeof audioInput === 'string' ? audioInput : '[buffer]', wamid: msg.wamid, error: String(err) } })
    }
  }

  // Fase F-2: hidratar OnboardingContext desde la sesión (legacy bag o key 'ctx'
  // si fue persistida por una corrida previa post-migración) + reduce con el
  // mensaje entrante del usuario antes de llamar al LLM.
  const ctx0 = hydrateOnboardingContext(session, usuario, 'admin')
  const ctxIn = reduceOnboardingContext(ctx0, { userMessage: texto })

  const resultado = await _llm!.onboardarAdmin(texto, toContextoConversacion(ctxIn), traceId)
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
        // Geocodificar dirección para centrar el mapa en el dashboard
        if (datos.finca_ubicacion_texto) {
          geocodeAndUpdateFinca(fincaId, datos.finca_ubicacion_texto, traceId).catch(() => {})
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

  if (!ctxNext.onboardingCompleto && ctxNext.pasoSiguiente >= MAX_ONBOARDING_STEPS) {
    langfuse.trace({ id: traceId }).event({ name: 'onboarding_admin_max_steps', level: 'WARNING', input: { steps: ctxNext.pasoSiguiente } })
  }

  await updateSession(session.session_id, {
    clarification_count: ctxNext.onboardingCompleto ? 0 : Math.min(ctxNext.pasoSiguiente, MAX_ONBOARDING_STEPS),
    contexto_parcial:    serializeContextForSession(ctxNext),
    status:              ctxNext.onboardingCompleto || ctxNext.pasoSiguiente >= MAX_ONBOARDING_STEPS ? 'completed' : 'active',
  })

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
  const session = await getOrCreateSession(msg.from, 'onboarding')

  let texto = msg.tipo === 'texto' ? (msg.texto ?? '') : ''
  if (msg.tipo === 'audio') {
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
      texto = await transcribirAudio(audioInput, traceId)
    } catch (err) {
      langfuse.trace({ id: traceId }).event({ name: 'stt_error', level: 'ERROR', input: { audio_ref: typeof audioInput === 'string' ? audioInput : '[buffer]', wamid: msg.wamid, error: String(err) } })
    }
  }

  // Fase F-2: hidratar contexto + reducir mensaje entrante antes de llamar al LLM.
  const ctx0Agr = hydrateOnboardingContext(session, usuario, 'agricultor')
  const ctxInAgr = reduceOnboardingContext(ctx0Agr, { userMessage: texto })

  // Lista de fincas disponibles para inyectar en el prompt (derivada de DB,
  // no se persiste en ctx — se calcula en cada turno).
  const fincas = await getFincasDisponibles()
  const fincasDisponibles = fincas.length > 0
    ? fincas.map(f => `- ${f.finca_id}: ${f.nombre} (${f.cultivo_principal ?? 'cultivo no especificado'})`).join('\n')
    : 'No hay fincas registradas aún'

  const resultado = await _llm!.onboardarAgricultor(texto, toContextoAgricultor(ctxInAgr, fincasDisponibles), traceId)
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

  if (!ctxNextAgr.onboardingCompleto && ctxNextAgr.pasoSiguiente >= MAX_ONBOARDING_STEPS) {
    langfuse.trace({ id: traceId }).event({ name: 'onboarding_agricultor_max_steps', level: 'WARNING', input: { steps: ctxNextAgr.pasoSiguiente } })
  }

  await updateSession(session.session_id, {
    clarification_count: ctxNextAgr.onboardingCompleto ? 0 : Math.min(ctxNextAgr.pasoSiguiente, MAX_ONBOARDING_STEPS),
    contexto_parcial:    serializeContextForSession(ctxNextAgr),
    status:              ctxNextAgr.onboardingCompleto || ctxNextAgr.pasoSiguiente >= MAX_ONBOARDING_STEPS ? 'completed' : 'active',
  })

  await _sender!.enviarTexto(msg.from, resultado.mensaje_para_usuario)
  await actualizarMensaje(mensajeId, { status: 'processed' })
}


