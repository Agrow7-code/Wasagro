import { PgBoss } from 'pg-boss'
import { procesarMensajeEntrante } from '../pipeline/procesarMensajeEntrante.js'
import { sendOTPViaWhatsApp } from '../auth/whatsappAuthService.js'
import { langfuse } from '../integrations/langfuse.js'

let boss: PgBoss

export async function initPgBoss() {
  const connectionString = process.env['DATABASE_URL']
  if (!connectionString) {
    throw new Error('DATABASE_URL requerida para pg-boss')
  }

  boss = new PgBoss(connectionString)

  boss.on('error', (error) => console.error('[pg-boss] Error:', error))

  await boss.start()
  console.log('[pg-boss] Iniciado correctamente')

  await boss.work('procesar-mensaje', async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs]
    for (const job of jobList) {
      const { msg, traceId } = job.data as any
      try {
        await procesarMensajeEntrante(msg, traceId)
      } catch (err) {
        langfuse.trace({ id: traceId }).event({
          name: 'job_attempt_failed',
          level: 'ERROR',
          output: { error: String(err), jobId: job.id }
        })
        throw err
      }
    }
  })

  await boss.work('enviar-otp-whatsapp', async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs]
    for (const job of jobList) {
      const { phone, code, traceId } = job.data as { phone: string; code: string; traceId: string }
      const trace = langfuse.trace({ id: traceId, name: 'otp_whatsapp_send', input: { phone } })
      try {
        await sendOTPViaWhatsApp(phone, code)
        trace.event({ name: 'otp_whatsapp_sent', output: { phone } })
        console.log(`[pg-boss] OTP enviado por WhatsApp a ${phone.slice(-4)}***`)
      } catch (err) {
        trace.event({ name: 'otp_whatsapp_failed', level: 'ERROR', output: { error: String(err), jobId: job.id } })
        console.error(`[pg-boss] Error enviando OTP a ${phone.slice(-4)}***:`, err)
        throw err
      }
    }
  })

  return boss
}

export function getBoss(): PgBoss {
  if (!boss) throw new Error('pg-boss no inicializado')
  return boss
}

export function isPgBossReady(): boolean {
  return !!boss
}
