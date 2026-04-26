import { langfuse } from '../../integrations/langfuse.js'
import type { NormalizedMessage } from '../../integrations/whatsapp/NormalizedMessage.js'
import type { ContextoOnboardingAgricultor } from '../../types/dominio/Onboarding.js'
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
  actualizarMensaje
} from '../supabaseQueries.js'
import { _sender, _llm } from '../procesarMensajeEntrante.js'

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
  const texto = msg.tipo === 'texto' ? (msg.texto ?? '') : ''

  const contexto = {
    historial: (session.contexto_parcial['historial'] as Array<{ rol: 'usuario' | 'agente'; contenido: string }>) ?? [],
    preguntas_realizadas: session.clarification_count,
    datos_recolectados: (session.contexto_parcial['datos'] as Record<string, unknown>) ?? {},
  }

  const resultado = await _llm!.onboardarAdmin(texto, contexto, traceId)
  const datos = resultado.datos_extraidos ?? {}

  // P6: persist consent exactly once when the user accepts
  const consentAlreadySaved = Boolean(session.contexto_parcial['consent_saved'])
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

  const nextStep = session.clarification_count + 1
  if (!resultado.onboarding_completo && nextStep >= MAX_ONBOARDING_STEPS) {
    langfuse.trace({ id: traceId }).event({ name: 'onboarding_admin_max_steps', level: 'WARNING', input: { steps: nextStep } })
  }

  await updateSession(session.session_id, {
    clarification_count: resultado.onboarding_completo ? 0 : Math.min(nextStep, MAX_ONBOARDING_STEPS),
    contexto_parcial: {
      historial: [
        ...contexto.historial,
        { rol: 'usuario' as const, contenido: texto },
        { rol: 'agente' as const, contenido: resultado.mensaje_para_usuario },
      ],
      datos: { ...contexto.datos_recolectados, ...(resultado.datos_extraidos ?? {}) },
      consent_saved: datos.consentimiento === true ? true : consentAlreadySaved,
    },
    status: resultado.onboarding_completo || nextStep >= MAX_ONBOARDING_STEPS ? 'completed' : 'active',
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
  const texto = msg.tipo === 'texto' ? (msg.texto ?? '') : ''

  const historialPrevio = (session.contexto_parcial['historial'] as Array<{ rol: 'usuario' | 'agente'; contenido: string }>) ?? []
  const datosPrevios = (session.contexto_parcial['datos'] as Record<string, unknown>) ?? {}

  // Construir lista de fincas disponibles para inyectar en el prompt
  const fincas = await getFincasDisponibles()
  const fincasDisponibles = fincas.length > 0
    ? fincas.map(f => `- ${f.finca_id}: ${f.nombre} (${f.cultivo_principal ?? 'cultivo no especificado'})`).join('\n')
    : 'No hay fincas registradas aún'

  const contexto: ContextoOnboardingAgricultor = {
    historial: historialPrevio,
    paso_actual: session.clarification_count,
    datos_recolectados: datosPrevios,
    fincas_disponibles: fincasDisponibles,
  }

  const resultado = await _llm!.onboardarAgricultor(texto, contexto, traceId)
  const datosAgr = resultado.datos_extraidos ?? {}

  // P6: persist consent exactly once when the agricultor accepts
  const consentAlreadySavedAgr = Boolean(session.contexto_parcial['consent_saved'])
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

  const nextStepAgr = session.clarification_count + 1
  if (!resultado.onboarding_completo && nextStepAgr >= MAX_ONBOARDING_STEPS) {
    langfuse.trace({ id: traceId }).event({ name: 'onboarding_agricultor_max_steps', level: 'WARNING', input: { steps: nextStepAgr } })
  }

  await updateSession(session.session_id, {
    clarification_count: resultado.onboarding_completo ? 0 : Math.min(nextStepAgr, MAX_ONBOARDING_STEPS),
    contexto_parcial: {
      historial: [
        ...historialPrevio,
        { rol: 'usuario' as const, contenido: texto },
        { rol: 'agente' as const, contenido: resultado.mensaje_para_usuario },
      ],
      datos: { ...datosPrevios, ...(resultado.datos_extraidos ?? {}) },
      consent_saved: datosAgr.consentimiento === true ? true : consentAlreadySavedAgr,
    },
    status: resultado.onboarding_completo || nextStepAgr >= MAX_ONBOARDING_STEPS ? 'completed' : 'active',
  })

  await _sender!.enviarTexto(msg.from, resultado.mensaje_para_usuario)
  await actualizarMensaje(mensajeId, { status: 'processed' })
}


