import { PgBoss } from 'pg-boss'
import { procesarMensajeEntrante } from '../pipeline/procesarMensajeEntrante.js'
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

  // Iniciar el worker para procesar mensajes
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
        throw err // Lanzar para que pg-boss lo reintente
      }
    }
  })

  return boss
}

export function getBoss(): PgBoss {
  if (!boss) throw new Error('pg-boss no inicializado')
  return boss
}
