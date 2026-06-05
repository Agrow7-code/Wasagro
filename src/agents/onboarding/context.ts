// OnboardingContext — Fase F second half of ADR-009.
//
// Mirrors the SDR Fase C pattern (src/agents/sdr/context.ts) for the onboarding
// pipeline. Replaces the untyped session.contexto_parcial bag (Record<string,
// unknown> mutated inline in OnboardingHandler.ts) with a Zod-schema-validated
// typed context + a pure reducer.
//
// Anti-pattern guards from ADR-009 §6 carry over:
//   - reduceOnboardingContext is pure: no LLM, no DB, no side effects.
//   - Confirmed values (non-null) are never overwritten by extraction. The
//     LLM can only FILL nulls, not flip already-confirmed facts.
//   - Consent is monotonic: once true, stays true. Reset would require an
//     explicit "withdraw consent" flow, not silent classifier output.
//   - onboardingCompleto is monotonic: once true, stays true. No accidental
//     un-completion from a confused LLM turn.

import { z } from 'zod'

// ─── Enums ───────────────────────────────────────────────────────────────────

export const OnboardingFlowEnum = z.enum(['admin', 'agricultor'])
export type OnboardingFlow = z.infer<typeof OnboardingFlowEnum>

export const HistorialEntrySchema = z.object({
  rol: z.enum(['usuario', 'agente']),
  contenido: z.string(),
})

export const LoteSchema = z.object({
  nombre_coloquial: z.string(),
  hectareas: z.number().nullable(),
})

// ─── Schema ──────────────────────────────────────────────────────────────────

export const OnboardingContextSchema = z.object({
  // Identity (persistent — usuarios row)
  userId:    z.string(),
  phone:     z.string(),
  tipoFlujo: OnboardingFlowEnum,

  // Prospect facts (persistent — accumulated across turns, never overwritten
  // once non-null except via explicit re-flow).
  nombre:               z.string().nullable(),
  rol:                  z.string().nullable(),
  consentimiento:       z.boolean(),  // monotonic — once true, stays true
  fincaNombre:          z.string().nullable(),
  fincaUbicacionTexto:  z.string().nullable(),
  fincaId:              z.string().nullable(),
  cultivoPrincipal:     z.string().nullable(),
  pais:                 z.string().nullable(),
  lotes:                z.array(LoteSchema),

  // Session state (Redis-backed in commit 3).
  historial:              z.array(HistorialEntrySchema).max(20),
  pasoCompletado:         z.number().int().nonnegative(),
  pasoSiguiente:          z.number().int().nonnegative(),
  clarificationTurnsUsed: z.number().int().min(0).max(2),  // P2 invariant

  // Derived flags (set by reducer, monotonic).
  onboardingCompleto: z.boolean(),
})

export type OnboardingContext = z.infer<typeof OnboardingContextSchema>

// ─── Reducer inputs ──────────────────────────────────────────────────────────

export interface ExtractionUpdate {
  nombre?: string | null
  rol?: string | null
  consentimiento?: boolean | null
  fincaNombre?: string | null
  fincaUbicacionTexto?: string | null
  fincaId?: string | null
  cultivoPrincipal?: string | null
  pais?: string | null
  lotes?: Array<{ nombre_coloquial: string; hectareas: number | null }>
}

export interface ReduceInput {
  extraction?:         ExtractionUpdate
  pasoCompletado?:     number
  pasoSiguiente?:      number
  onboardingCompleto?: boolean
  userMessage?:        string | null
  botMessage?:         string | null
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_HISTORIAL          = 20
const MAX_CLARIFICATION_TURNS = 2

// ─── Pure helpers ────────────────────────────────────────────────────────────

export function createDefaultContext(
  userId: string,
  phone: string,
  tipoFlujo: OnboardingFlow,
): OnboardingContext {
  return {
    userId,
    phone,
    tipoFlujo,
    nombre:               null,
    rol:                  null,
    consentimiento:       false,
    fincaNombre:          null,
    fincaUbicacionTexto:  null,
    fincaId:              null,
    cultivoPrincipal:     null,
    pais:                 null,
    lotes:                [],
    historial:              [],
    pasoCompletado:         0,
    pasoSiguiente:          1,
    clarificationTurnsUsed: 0,
    onboardingCompleto:     false,
  }
}

// ─── THE REDUCER ─────────────────────────────────────────────────────────────
// Pure: same input → same output. No LLM, no DB, no fetch. Anti-pattern guard
// #3 of ADR-009 forbids mutating prospect/onboarding fields outside of here.

export function reduceOnboardingContext(
  ctx: OnboardingContext,
  input: ReduceInput,
): OnboardingContext {
  const ext = input.extraction ?? {}

  // 1. Apply extraction. Confirmed value (non-null) wins over the LLM's
  //    latest claim. Extraction only fills missing fields. If the user
  //    contradicts themselves later, an explicit re-flow has to clear the
  //    field; a single LLM turn cannot silently flip it.
  const nombre              = ctx.nombre              ?? ext.nombre              ?? null
  const rol                 = ctx.rol                 ?? ext.rol                 ?? null
  const fincaNombre         = ctx.fincaNombre         ?? ext.fincaNombre         ?? null
  const fincaUbicacionTexto = ctx.fincaUbicacionTexto ?? ext.fincaUbicacionTexto ?? null
  const fincaId             = ctx.fincaId             ?? ext.fincaId             ?? null
  const cultivoPrincipal    = ctx.cultivoPrincipal    ?? ext.cultivoPrincipal    ?? null
  const pais                = ctx.pais                ?? ext.pais                ?? null

  // 2. Consentimiento: monotonic — once true, stays true. The LLM can only
  //    flip false → true, never the other way. Withdraw-consent is a separate
  //    explicit flow outside the reducer's scope.
  const consentimiento = ctx.consentimiento || ext.consentimiento === true

  // 3. Lotes: latest extraction wins when present (the handler decides when
  //    to overwrite, not the reducer). Empty extraction keeps current lotes.
  const lotes = ext.lotes ?? ctx.lotes

  // 4. Historial: append user message then bot message, slide-window to MAX.
  let historial = [...ctx.historial]
  if (input.userMessage != null && input.userMessage !== '') {
    historial = [...historial, { rol: 'usuario' as const, contenido: input.userMessage }]
  }
  if (input.botMessage != null && input.botMessage !== '') {
    historial = [...historial, { rol: 'agente' as const, contenido: input.botMessage }]
  }
  historial = historial.slice(-MAX_HISTORIAL)

  // 5. Step counters: take input's if provided, else carry forward.
  const pasoCompletado = input.pasoCompletado ?? ctx.pasoCompletado
  const pasoSiguiente  = input.pasoSiguiente  ?? ctx.pasoSiguiente

  // 6. Clarification counter: incremento cuando el paso NO avanza (es decir,
  //    el LLM repreguntó). Reset al avanzar. Cap MAX_CLARIFICATION_TURNS
  //    enforza P2 — máximo 2 preguntas de clarificación seguidas.
  let clarificationTurnsUsed = ctx.clarificationTurnsUsed
  if (input.pasoCompletado !== undefined) {
    if (input.pasoCompletado === ctx.pasoCompletado) {
      clarificationTurnsUsed = Math.min(clarificationTurnsUsed + 1, MAX_CLARIFICATION_TURNS)
    } else if (input.pasoCompletado > ctx.pasoCompletado) {
      clarificationTurnsUsed = 0
    }
  }

  // 7. onboardingCompleto: monotonic — once true, stays true. Even if the
  //    LLM returns the fallback shape (onboarding_completo: false) on a
  //    later turn, we never un-complete a completed onboarding.
  const onboardingCompleto = ctx.onboardingCompleto || input.onboardingCompleto === true

  return {
    userId:               ctx.userId,
    phone:                ctx.phone,
    tipoFlujo:            ctx.tipoFlujo,
    nombre,
    rol,
    consentimiento,
    fincaNombre,
    fincaUbicacionTexto,
    fincaId,
    cultivoPrincipal,
    pais,
    lotes,
    historial,
    pasoCompletado,
    pasoSiguiente,
    clarificationTurnsUsed,
    onboardingCompleto,
  }
}

// ─── Bridge helpers (used by handler in commit 2) ────────────────────────────

// Build the LLM-facing contexto string. tipoFlujo determines whether
// fincas_disponibles is included (agricultor flow only). fincasDisponibles is
// passed in as a parameter — it's not stored in the context because it's
// derived from a DB query at session start, not a reducer-owned field.
export function buildContextoForLLM(
  ctx: OnboardingContext,
  fincasDisponibles?: string,
): string {
  const lines: string[] = [
    `Paso siguiente: ${ctx.pasoSiguiente}`,
    `Nombre del usuario: ${ctx.nombre ?? ''}`,
    `Datos recopilados: ${JSON.stringify(extractDatosForLLM(ctx))}`,
  ]
  if (ctx.tipoFlujo === 'agricultor' && fincasDisponibles) {
    lines.push(`Fincas disponibles: ${fincasDisponibles}`)
  }
  return lines.join('\n')
}

// Project ctx back to the snake_case shape the LLM consumes
// (DatosExtraidosOnboarding in RespuestaOnboardingSchema).
function extractDatosForLLM(ctx: OnboardingContext): Record<string, unknown> {
  return {
    nombre:                 ctx.nombre,
    rol:                    ctx.rol,
    consentimiento:         ctx.consentimiento,
    finca_nombre:           ctx.fincaNombre,
    finca_ubicacion_texto:  ctx.fincaUbicacionTexto,
    finca_id:               ctx.fincaId,
    cultivo_principal:      ctx.cultivoPrincipal,
    pais:                   ctx.pais,
    lotes:                  ctx.lotes,
  }
}

// Map DatosExtraidosOnboarding (snake_case from LLM response) to ExtractionUpdate
// (camelCase reducer input). Accepts undefined-or-null inputs so DatosExtraidosOnboarding
// (which has every field optional+nullable per Zod schema) can be passed directly.
export function mapDatosToExtraction(datos: {
  nombre?:                  string  | null | undefined
  rol?:                     string  | null | undefined
  consentimiento?:          boolean | null | undefined
  finca_nombre?:            string  | null | undefined
  finca_ubicacion_texto?:   string  | null | undefined
  finca_id?:                string  | null | undefined
  cultivo_principal?:       string  | null | undefined
  pais?:                    string  | null | undefined
  lotes?:                   Array<{ nombre_coloquial: string; hectareas: number | null }> | undefined
}): ExtractionUpdate {
  const out: ExtractionUpdate = {}
  if (datos.nombre                !== undefined) out.nombre              = datos.nombre
  if (datos.rol                   !== undefined) out.rol                 = datos.rol
  if (datos.consentimiento        !== undefined) out.consentimiento      = datos.consentimiento
  if (datos.finca_nombre          !== undefined) out.fincaNombre         = datos.finca_nombre
  if (datos.finca_ubicacion_texto !== undefined) out.fincaUbicacionTexto = datos.finca_ubicacion_texto
  if (datos.finca_id              !== undefined) out.fincaId             = datos.finca_id
  if (datos.cultivo_principal     !== undefined) out.cultivoPrincipal    = datos.cultivo_principal
  if (datos.pais                  !== undefined) out.pais                = datos.pais
  if (datos.lotes                 !== undefined) out.lotes               = datos.lotes
  return out
}
