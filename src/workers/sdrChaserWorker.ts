import type { Job } from 'pg-boss'
import { saveSDRInteraccion } from '../pipeline/supabaseQueries.js'
import { crearSenderWhatsApp } from '../integrations/whatsapp/index.js'

type ChaserJobData = {
  prospecto_id: string
  expected_turn: number
  reminder_type?: 'booking'
}

export async function sdrChaserHandler(job: Job<ChaserJobData>) {
  const { prospecto_id, expected_turn, reminder_type } = job.data

  const prospecto = await getSDRProspectoById(prospecto_id)

  if (!prospecto) return

  // Idempotency: abort if prospect already replied since the job was enqueued
  if (prospecto['turns_total'] !== expected_turn) {
    console.log(`[sdr-chaser] Prospecto ${prospecto_id} ya respondió (turno actual ${prospecto['turns_total']} != esperado ${expected_turn}). Abortando.`)
    return
  }

  // Skip if prospect already advanced beyond the chaser stage
  if (['qualified', 'piloto_propuesto', 'reunion_agendada', 'descartado'].includes(prospecto['status'] as string)) {
    return
  }

  // D23: Skip if prospect already booked via Cal.com (webhook should have set
  // reunion_agendada, but calcom_booking_id is the canonical check — protects
  // against race conditions where the webhook arrives after status check)
  if (prospecto['calcom_booking_id']) {
    console.log(`[sdr-chaser] Prospecto ${prospecto_id} ya tiene booking en Cal.com (${prospecto['calcom_booking_id']}). Abortando.`)
    return
  }

  if (reminder_type === 'booking') {
    await sendBookingReminder(prospecto)
  } else {
    await sendGenericReengagement(prospecto)
  }
}

async function sendBookingReminder(prospecto: Record<string, unknown>): Promise<void> {
  const bookingUrl = process.env['CALCOM_BOOKING_URL'] ?? process.env['DEMO_BOOKING_URL']
  const phone = prospecto['phone'] as string
  const nombre = (prospecto['nombre'] as string | null) ?? ''

  const saludo = nombre ? `${nombre}, ` : ''
  const linkPart = bookingUrl ? ` Podés agendar cuando te quede bien: ${bookingUrl}` : ' Dime qué día y hora te viene bien y lo coordinamos.'

  const mensaje = `${saludo}¿Te quedó alguna duda sobre la demo?${linkPart}`

  const sender = crearSenderWhatsApp()
  console.log(`[sdr-chaser] Enviando booking reminder a ${phone} (prospecto_id: ${prospecto['id']})`)
  await sender.enviarTexto(phone, mensaje)

  await saveSDRInteraccion({
    prospecto_id: prospecto['id'],
    phone: prospecto['phone'],
    turno: (prospecto['turns_total'] as number),
    tipo: 'outbound',
    contenido: `[Booking reminder 24h enviado]`,
    action_taken: 'booking_reminder_24h',
  })
}

async function sendGenericReengagement(prospecto: Record<string, unknown>): Promise<void> {
  const sender = crearSenderWhatsApp()

  console.log(`[sdr-chaser] Enviando HSM de seguimiento a ${prospecto['phone']} (prospecto_id: ${prospecto['id']})`)

  await sender.enviarTemplate(prospecto['phone'] as string, 'sdr_reenganche_24h', 'es')

  await saveSDRInteraccion({
    prospecto_id: prospecto['id'],
    phone: prospecto['phone'],
    turno: (prospecto['turns_total'] as number),
    tipo: 'outbound',
    contenido: '[HSM sdr_reenganche_24h enviado]',
    action_taken: 'chaser_sequence_1',
  })
}

async function getSDRProspectoById(id: string) {
  const { supabase } = await import('../integrations/supabase.js')
  const { data, error } = await supabase.from('sdr_prospectos').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}
