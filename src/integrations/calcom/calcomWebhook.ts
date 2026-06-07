import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { supabase } from '../supabase.js'
import { updateSDRProspecto, saveSDRInteraccion } from '../../pipeline/supabaseQueries.js'
import { crearSenderWhatsApp } from '../whatsapp/index.js'
import { langfuse } from '../langfuse.js'

// ── Cal.com webhook signature verification ──────────────────────────────────
// Cal.com signs webhook payloads with HMAC-SHA256 using the secret configured
// when the webhook subscription was created. The signature is sent in the
// `x-cal-signature-256` header. See: https://cal.com/docs/core-features/webhooks

export function verifyCalcomSignature(
  body: string,
  signature: string | undefined | null,
  secret: string,
): boolean {
  if (!signature) {
    console.warn('[calcom-sig] no signature header received')
    return false
  }
  const expected = createHmac('sha256', secret).update(body).digest('hex')
  // Cal.com may prefix the signature with `sha256=` (GitHub-style) or send the
  // raw hex digest depending on version. Strip the prefix if present.
  const cleanSig = signature.startsWith('sha256=') ? signature.slice(7) : signature
  const sigBuf = Buffer.from(cleanSig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length) {
    console.warn('[calcom-sig] length mismatch', {
      sigLen: sigBuf.length,
      expLen: expBuf.length,
      sigPrefix: cleanSig.slice(0, 16),
      expPrefix: expected.slice(0, 16),
      bodyLen: body.length,
      secretPrefix: secret.slice(0, 12),
    })
    return false
  }
  const matches = timingSafeEqual(sigBuf, expBuf)
  if (!matches) {
    console.warn('[calcom-sig] HMAC mismatch (same length)', {
      sigPrefix: cleanSig.slice(0, 16),
      expPrefix: expected.slice(0, 16),
      bodyLen: body.length,
      bodyStart: body.slice(0, 100),
      secretPrefix: secret.slice(0, 12),
    })
  }
  return matches
}

// ── Payload schemas ─────────────────────────────────────────────────────────
// Cal.com webhook v1 (version "2021-10-20") sends a top-level object with
// `triggerEvent` and a nested `payload` containing the booking details.
// When a payloadTemplate is configured, the shape is custom; we support both
// the default shape and a minimal template shape.

// Cal.com sends `null` (not undefined / missing) for fields the attendee left
// empty. `optional()` alone doesn't accept null — must be `nullable()` too.
// Coerced to empty strings downstream by the schema's default.
const AttendeeSchema = z.object({
  name: z.string().nullable().optional().transform(v => v ?? ''),
  email: z.union([z.string().email(), z.literal(''), z.null()]).optional().transform(v => v ?? ''),
  phoneNumber: z.string().nullable().optional().transform(v => v ?? ''),
})

const CalcomWebhookPayloadSchema = z.object({
  triggerEvent: z.string().optional(),
  type: z.string().optional(),
  payload: z.object({
    bookingId: z.union([z.string(), z.number()]).optional(),
    title: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    organizer: z.object({ name: z.string().optional(), email: z.string().optional() }).optional(),
    attendees: z.array(AttendeeSchema).optional().default([]),
    metadata: z.record(z.unknown()).optional(),
  }).passthrough(),
}).passthrough()

export type CalcomWebhookPayload = z.infer<typeof CalcomWebhookPayloadSchema>

// ── Webhook event types ─────────────────────────────────────────────────────

const BOOKING_EVENTS = new Set([
  'BOOKING_CREATED',
  'BOOKING_CONFIRMED',
])

const CANCEL_EVENTS = new Set([
  'BOOKING_CANCELLED',
])

// ── Core handler ────────────────────────────────────────────────────────────

export async function handleCalcomWebhook(
  rawBody: string,
  signature: string | undefined | null,
  secret: string,
): Promise<{ status: string; detail?: string }> {
  const trace = langfuse.trace({ name: 'calcom_webhook', tags: ['webhook', 'calcom'] })

  if (!verifyCalcomSignature(rawBody, signature, secret)) {
    trace.event({ name: 'signature_invalid', level: 'WARNING' })
    return { status: 'rejected', detail: 'Invalid signature' }
  }

  let parsed: CalcomWebhookPayload
  try {
    parsed = CalcomWebhookPayloadSchema.parse(JSON.parse(rawBody))
  } catch (err) {
    const issues = err instanceof z.ZodError ? err.issues : null
    const bodyPreview = rawBody.slice(0, 500)
    console.warn('[calcom-parse] payload Zod parse failed', {
      issues,
      errMsg: err instanceof Error ? err.message : String(err),
      bodyPreview,
      bodyLen: rawBody.length,
    })
    trace.event({ name: 'parse_error', level: 'ERROR', input: { issues, bodyPreview } })
    return { status: 'rejected', detail: 'Invalid payload' }
  }

  const eventType = parsed.triggerEvent ?? parsed.type ?? ''
  const bookingId = String(parsed.payload.bookingId ?? '')
  const attendees = parsed.payload.attendees ?? []
  const startTime = parsed.payload.startTime ?? ''
  const title = parsed.payload.title ?? ''

  trace.event({
    name: 'webhook_parsed',
    input: { eventType, bookingId, attendees: attendees.length, startTime },
  })

  if (BOOKING_EVENTS.has(eventType)) {
    const metadata = parsed.payload.metadata ?? {}
    return await handleBookingCreated(bookingId, attendees, startTime, title, metadata, trace.id)
  }

  if (CANCEL_EVENTS.has(eventType)) {
    return await handleBookingCancelled(bookingId, trace.id)
  }

  trace.event({ name: 'event_ignored', level: 'DEFAULT', input: { eventType } })
  return { status: 'ignored', detail: `Unhandled event type: ${eventType}` }
}

// ── BOOKING_CREATED / BOOKING_CONFIRMED ──────────────────────────────────────

async function handleBookingCreated(
  bookingId: string,
  attendees: z.infer<typeof AttendeeSchema>[],
  startTime: string,
  title: string,
  metadata: Record<string, unknown>,
  traceId: string,
): Promise<{ status: string; detail?: string }> {
  const trace = langfuse.trace({ id: traceId, name: 'calcom_booking_created' })

  if (!bookingId) {
    trace.event({ name: 'no_booking_id', level: 'ERROR' })
    return { status: 'error', detail: 'Missing bookingId' }
  }

  // Find the prospect by prospecto_id in metadata (primary) or attendee
  // email/phone (fallback). The prospecto_id is passed as a query param in
  // the Cal.com booking URL (?prospecto_id=xxx) and Cal.com preserves it in
  // payload.metadata — this is the 100% reliable matching path.
  const prospecto = await findProspectoByAttendee(attendees, metadata)
  if (!prospecto) {
    trace.event({ name: 'prospecto_not_found', level: 'WARNING', input: { attendees } })
    return { status: 'no_prospecto', detail: 'No matching prospect found' }
  }

  // Idempotency: skip if already processed
  if (prospecto['calcom_booking_id'] === bookingId) {
    trace.event({ name: 'duplicate_booking', level: 'DEFAULT' })
    return { status: 'duplicate', detail: `Booking ${bookingId} already processed` }
  }

  // Update prospect
  const reunionAgendadaAt = startTime || new Date().toISOString()
  await updateSDRProspecto(prospecto['id'] as string, {
    status: 'reunion_agendada',
    reunion_agendada_at: reunionAgendadaAt,
    calcom_booking_id: bookingId,
  })

  trace.event({
    name: 'prospecto_updated',
    input: { prospecto_id: prospecto['id'], bookingId, reunionAgendadaAt },
  })

  // Log interaction
  await saveSDRInteraccion({
    prospecto_id: prospecto['id'],
    phone: prospecto['phone'],
    turno: (prospecto['turns_total'] as number) ?? 0,
    tipo: 'outbound',
    contenido: `[Cal.com booking confirmed: ${bookingId}]`,
    // Must match sdr_interacciones_action_taken_check. 'meeting_confirmed'
    // is the canonical legal value semantically equivalent to a Cal.com
    // booking confirmation. Using 'booking_confirmed_webhook' (not in the
    // CHECK list) silently crashed the handler before notifyFounderBooking.
    action_taken: 'meeting_confirmed',
    langfuse_trace_id: traceId,
  })

  // SDR funnel score: booking confirmed via Cal.com → meeting_confirmed (+1).
  const { scoreTerminalTransition } = await import('../../agents/sdr/outcomeScoring.js')
  scoreTerminalTransition(trace, 'meeting_proposed', 'meeting_confirmed', {
    prospectoId: prospecto['id'] as string,
    phone:       prospecto['phone'] as string,
    narrativa:   (prospecto['narrativa_asignada'] as string | null) ?? null,
    cultivo:     (prospecto['cultivo_principal'] as string | null) ?? null,
    segmento:    (prospecto['segmento_icp'] as string | null) ?? null,
    turnCount:   (prospecto['turns_total'] as number) ?? 0,
    source:      'calcom_webhook',
  })

  // Notify founder
  await notifyFounderBooking(prospecto, reunionAgendadaAt, title, bookingId)

  return { status: 'ok', detail: `Booking ${bookingId} confirmed for prospecto ${prospecto['id']}` }
}

// ── BOOKING_CANCELLED ────────────────────────────────────────────────────────

async function handleBookingCancelled(
  bookingId: string,
  traceId: string,
): Promise<{ status: string; detail?: string }> {
  const trace = langfuse.trace({ id: traceId, name: 'calcom_booking_cancelled' })

  if (!bookingId) {
    trace.event({ name: 'no_booking_id', level: 'ERROR' })
    return { status: 'error', detail: 'Missing bookingId' }
  }

  const { data, error } = await supabase
    .from('sdr_prospectos')
    .select('*')
    .eq('calcom_booking_id', bookingId)
    .maybeSingle()

  if (error || !data) {
    trace.event({ name: 'booking_not_found', level: 'WARNING', input: { bookingId } })
    return { status: 'no_prospecto', detail: `No prospecto with booking ${bookingId}` }
  }

  const prospecto = data as Record<string, unknown>

 // Rule 3 (AGENTS.md): Do NOT auto-revert status or nullify booking_id —
 // that's an irreversible change without human approval. Instead, record
 // the cancellation timestamp and notify the founder. The founder decides
 // whether to revert the prospect to piloto_propuesto.
 await updateSDRProspecto(prospecto['id'] as string, {
 booking_cancelled_at: new Date().toISOString(),
 })

 await saveSDRInteraccion({
 prospecto_id: prospecto['id'],
 phone: prospecto['phone'],
 turno: (prospecto['turns_total'] as number) ?? 0,
 tipo: 'outbound',
 contenido: `[Cal.com booking cancelled: ${bookingId}]`,
 // Must match sdr_interacciones_action_taken_check. Cancellation maps
 // closest to 'graceful_exit' from the legal list (cancellation is a soft
 // disengagement from the SDR funnel without immediate re-engagement).
 action_taken: 'graceful_exit',
 langfuse_trace_id: traceId,
 })

 // Notify founder of cancellation so they can take action
 await notifyFounderCancellation(prospecto, bookingId)

 trace.event({ name: 'booking_cancelled', input: { prospecto_id: prospecto['id'], bookingId } })
 return { status: 'ok', detail: `Booking ${bookingId} cancellation logged for prospecto ${prospecto['id']}` }
}

// ── Prospect lookup ──────────────────────────────────────────────────────────

async function findProspectoByAttendee(
  attendees: z.infer<typeof AttendeeSchema>[],
  metadata?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  // Primary: prospecto_id from Cal.com metadata (set via ?prospecto_id=xxx
  // query param on the booking URL). This is the 100% reliable matching path.
  if (metadata) {
    const prospectoId = metadata['prospecto_id'] as string | undefined
    if (prospectoId) {
      const { data } = await supabase
        .from('sdr_prospectos')
        .select('*')
        .eq('id', prospectoId)
        .maybeSingle()
      if (data) {
        return data as Record<string, unknown>
      }
    }
  }

  // Fallback 1: phone match (most reliable for WhatsApp-based prospects)
  for (const att of attendees) {
    const phone = normalizePhone(att.phoneNumber ?? '')
    if (phone) {
      const { data } = await supabase
        .from('sdr_prospectos')
        .select('*')
        .eq('phone', phone)
        .maybeSingle()
      if (data) return data as Record<string, unknown>
    }
  }

  // Fallback 2: email match
  for (const att of attendees) {
    const email = att.email
    if (email && email !== '') {
      const { data } = await supabase
        .from('sdr_prospectos')
        .select('*')
        .eq('email', email)
        .maybeSingle()
      if (data) return data as Record<string, unknown>
    }
  }

  return null
}

function normalizePhone(raw: string): string {
  let p = raw.replace(/[^0-9+]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (p.startsWith('00')) p = p.slice(2)
  return p
}

// ── Founder notification ────────────────────────────────────────────────────

async function notifyFounderBooking(
  prospecto: Record<string, unknown>,
  startTime: string,
  title: string,
  bookingId: string,
): Promise<void> {
  const founderPhone = process.env['FOUNDER_PHONE']
  console.log('[calcom-notify] start', { hasPhone: !!founderPhone, phonePrefix: founderPhone?.slice(0, 6), bookingId })
  if (!founderPhone) {
    console.warn('[calcom-notify] FOUNDER_PHONE not set — skipping WhatsApp notification')
    return
  }

  const nombre = (prospecto['nombre'] as string | null) ?? (prospecto['phone'] as string)
  const dateStr = startTime
    ? new Date(startTime).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'full', timeStyle: 'short' })
    : 'Por confirmar'

  const msg = [
    `🟢 Nuevo booking confirmado`,
    ``,
    `Prospecto: ${nombre}`,
    `Teléfono: ${prospecto['phone']}`,
    `Reunión: ${title || 'Demo Wasagro'}`,
    `Fecha: ${dateStr}`,
    `Booking ID: ${bookingId}`,
  ].join('\n')

  try {
    const sender = crearSenderWhatsApp()
    console.log('[calcom-notify] sending WhatsApp', { to: founderPhone, msgLen: msg.length })
    await sender.enviarTexto(founderPhone, msg)
    console.log('[calcom-notify] WhatsApp sent OK')
  } catch (err) {
    console.error('[calcom-notify] WhatsApp send FAILED:', err instanceof Error ? err.message : String(err))
    console.error('[calcom-notify] stack:', err instanceof Error ? err.stack?.slice(0, 1500) : 'no-stack')
  }

  // Email notification via Resend (if configured)
  await notifyFounderEmail(nombre, prospecto['phone'] as string, dateStr, title, bookingId)
}

async function notifyFounderEmail(
  nombre: string,
  phone: string,
  dateStr: string,
  title: string,
  bookingId: string,
): Promise<void> {
  const resendKey = process.env['RESEND_API_KEY']
  if (!resendKey) return

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(resendKey)
    const fromEmail = process.env['RESEND_FROM_EMAIL'] ?? 'onboarding@resend.dev'
    const toEmail = process.env['FOUNDER_EMAIL'] ?? 'wasagro@proton.me'

    await resend.emails.send({
      from: `Wasagro SDR <${fromEmail}>`,
      to: toEmail,
      subject: `🟢 Booking confirmado: ${nombre}`,
      html: [
        `<h2>Booking confirmado via Cal.com</h2>`,
        `<ul>`,
        `<li><strong>Prospecto:</strong> ${nombre}</li>`,
        `<li><strong>Teléfono:</strong> ${phone}</li>`,
        `<li><strong>Reunión:</strong> ${title || 'Demo Wasagro'}</li>`,
        `<li><strong>Fecha:</strong> ${dateStr}</li>`,
        `<li><strong>Booking ID:</strong> ${bookingId}</li>`,
        `</ul>`,
      ].join(''),
    })
 } catch (err) {
 console.error('[calcom] Error sending founder email:', err)
 }
}

async function notifyFounderCancellation(
 prospecto: Record<string, unknown>,
 bookingId: string,
): Promise<void> {
 const founderPhone = process.env['FOUNDER_PHONE']
 if (!founderPhone) {
 console.warn('[calcom] FOUNDER_PHONE not set — skipping cancellation WhatsApp notification')
 return
 }

 const nombre = (prospecto['nombre'] as string | null) ?? (prospecto['phone'] as string)

 const msg = [
 `🔴 Booking cancelado`,
 ``,
 `Prospecto: ${nombre}`,
 `Teléfono: ${prospecto['phone']}`,
 `Booking ID: ${bookingId}`,
 ``,
 `El prospecto sigue en status "reunion_agendada". Decidí si lo revertís a piloto_propuesto.`,
 ].join('\n')

 try {
 const sender = crearSenderWhatsApp()
 await sender.enviarTexto(founderPhone, msg)
 } catch (err) {
 console.error('[calcom] Error notifying founder of cancellation via WhatsApp:', err)
 }
}
