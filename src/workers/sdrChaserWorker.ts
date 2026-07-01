import type { Job } from 'pg-boss'
import { saveSDRInteraccion } from '../pipeline/supabaseQueries.js'
import { crearSenderWhatsApp } from '../integrations/whatsapp/index.js'
import { langfuse } from '../integrations/langfuse.js'
import { redactPhone } from '../integrations/logRedact.js'

type ChaserJobData = {
 prospecto_id: string
 expected_turn: number
 reminder_type?: 'booking'
}

export async function sdrChaserHandler(job: Job<ChaserJobData>) {
 const { prospecto_id, expected_turn, reminder_type } = job.data
 const trace = langfuse.trace({ name: 'sdr_chaser', input: { prospecto_id, expected_turn, reminder_type } })

 const prospecto = await getSDRProspectoById(prospecto_id)

 if (!prospecto) {
 trace.event({ name: 'prospecto_not_found', level: 'WARNING' })
 return
 }

 // Idempotency: abort if prospect already replied since the job was enqueued
 if (prospecto['turns_total'] !== expected_turn) {
 console.log(`[sdr-chaser] Prospecto ${prospecto_id} ya respondió (turno actual ${prospecto['turns_total']} != esperado ${expected_turn}). Abortando.`)
 trace.event({ name: 'prospect_already_replied', level: 'DEFAULT' })
 return
 }

 // Skip if prospect already advanced beyond the chaser stage
 if (['qualified', 'piloto_propuesto', 'reunion_agendada', 'descartado'].includes(prospecto['status'] as string)) {
 trace.event({ name: 'prospect_advanced', level: 'DEFAULT', input: { status: prospecto['status'] } })
 return
 }

 // D24/REQ-hand-010: paused conversations get zero chasers. Read fresh at
 // execution time (getSDRProspectoById below), so a chaser enqueued BEFORE
 // the pause still sees the paused column and aborts.
 if (prospecto['handoff_status'] === 'human_paused') {
 trace.event({ name: 'chaser_skipped_paused', level: 'DEFAULT' })
 return
 }

 // D23: Skip if prospect already booked via Cal.com AND the booking wasn't
 // cancelled (webhook should have set reunion_agendada, but calcom_booking_id
 // is the canonical check — protects against race conditions where the
 // webhook arrives after status check). If booking_cancelled_at is set,
 // the prospect still needs re-engagement.
 if (prospecto['calcom_booking_id'] && !prospecto['booking_cancelled_at']) {
 console.log(`[sdr-chaser] Prospecto ${prospecto_id} ya tiene booking en Cal.com (${prospecto['calcom_booking_id']}). Abortando.`)
 trace.event({ name: 'prospect_already_booked', level: 'DEFAULT', input: { calcom_booking_id: prospecto['calcom_booking_id'] } })
 return
 }

 if (reminder_type === 'booking') {
 await sendBookingReminder(prospecto, trace.id)
 } else {
 await sendGenericReengagement(prospecto, trace.id)
 }
}

async function sendBookingReminder(prospecto: Record<string, unknown>, traceId: string): Promise<void> {
  const bookingUrl = process.env['CALCOM_BOOKING_URL'] ?? process.env['DEMO_BOOKING_URL']
  const phone = prospecto['phone'] as string
  const nombre = (prospecto['nombre'] as string | null) ?? ''
  const prospectoId = prospecto['id'] as string

  const saludo = nombre ? `${nombre}, ` : ''
  const urlWithParam = bookingUrl ? `${bookingUrl}?prospecto_id=${encodeURIComponent(prospectoId)}` : ''
  const linkPart = urlWithParam ? ` Podés agendar cuando te quede bien: ${urlWithParam}` : ' Dime qué día y hora te viene bien y lo coordinamos.'

 const mensaje = `${saludo}¿Te quedó alguna duda sobre la demo?${linkPart}`

 const sender = crearSenderWhatsApp()
 console.log(`[sdr-chaser] Enviando booking reminder a ${redactPhone(phone)} (prospecto_id: ${prospecto['id']})`)
 await sender.enviarTexto(phone, mensaje)

 await saveSDRInteraccion({
 prospecto_id: prospecto['id'],
 phone: prospecto['phone'],
 turno: (prospecto['turns_total'] as number),
 tipo: 'outbound',
 contenido: `[Booking reminder 24h enviado]`,
 action_taken: 'booking_reminder_24h',
 langfuse_trace_id: traceId,
 })
}

async function sendGenericReengagement(prospecto: Record<string, unknown>, traceId: string): Promise<void> {
 const sender = crearSenderWhatsApp()

 console.log(`[sdr-chaser] Enviando HSM de seguimiento a ${redactPhone(prospecto['phone'] as string)} (prospecto_id: ${prospecto['id']})`)

 await sender.enviarTemplate(prospecto['phone'] as string, 'sdr_reenganche_24h', 'es')

 await saveSDRInteraccion({
 prospecto_id: prospecto['id'],
 phone: prospecto['phone'],
 turno: (prospecto['turns_total'] as number),
 tipo: 'outbound',
 contenido: '[HSM sdr_reenganche_24h enviado]',
 action_taken: 'chaser_sequence_1',
 langfuse_trace_id: traceId,
 })
}

async function getSDRProspectoById(id: string) {
  const { supabase } = await import('../integrations/supabase.js')
  const { data, error } = await supabase.from('sdr_prospectos').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}
