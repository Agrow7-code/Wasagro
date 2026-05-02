import type { Job } from 'pg-boss'
import { getSDRProspecto, saveSDRInteraccion } from '../pipeline/supabaseQueries.js'
import { crearSenderWhatsApp } from '../integrations/whatsapp/index.js'

export async function sdrChaserHandler(job: Job<{ prospecto_id: string, expected_turn: number }>) {
  const { prospecto_id, expected_turn } = job.data
  
  // No usamos client inyectado aquí para simplificar el worker asíncrono
  const prospecto = await getSDRProspectoById(prospecto_id)
  
  if (!prospecto) return
  
  if (prospecto['turns_total'] !== expected_turn) {
    console.log(`[sdr-chaser] Prospecto ${prospecto_id} ya respondió (turno actual ${prospecto['turns_total']} != esperado ${expected_turn}). Abortando.`)
    return
  }
  
  // Si el prospecto ya está calificado o agendado, no enviar chaser genérico
  if (['qualified', 'piloto_propuesto', 'reunion_agendada', 'descartado'].includes(prospecto['status'] as string)) {
    return
  }

  const sender = crearSenderWhatsApp()
  
  console.log(`[sdr-chaser] Enviando HSM de seguimiento a ${prospecto['phone']} (prospecto_id: ${prospecto_id})`)
  
  await sender.enviarTemplate(prospecto['phone'] as string, 'sdr_reenganche_24h', 'es')
  
  await saveSDRInteraccion({
    prospecto_id: prospecto['id'],
    phone: prospecto['phone'],
    turno: (prospecto['turns_total'] as number), // Se mantiene en el mismo turno lógico pero es un outbound
    tipo: 'outbound',
    contenido: '[HSM sdr_reenganche_24h enviado]',
    action_taken: 'chaser_sequence_1'
  })
}

// Helper local ya que supabaseQueries usa Record<string, unknown>
async function getSDRProspectoById(id: string) {
  const { supabase } = await import('../integrations/supabase.js')
  const { data, error } = await supabase.from('sdr_prospectos').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}
