import { supabase } from '../integrations/supabase.js'
import { langfuse } from '../integrations/langfuse.js'
import type { PgBoss } from 'pg-boss'

const QUEUE_NAME = 'cost-aggregation'

export async function costAggregationHandler(job: { id: string; data: { mes?: string } }): Promise<void> {
  const mes = job.data.mes ?? getDefaultMes()
  const trace = langfuse.trace({ name: 'cost_aggregation', input: { mes } })

  try {
    const { error } = await supabase.rpc('aggregate_monthly_costs', { target_mes: mes })

    if (error) {
      trace.event({ name: 'aggregation_error', level: 'ERROR', output: { error: error.message, mes } })
      throw error
    }

    trace.event({ name: 'aggregation_complete', output: { mes } })
    console.log(`[cost-aggregation] Agregación completada para ${mes}`)
  } catch (err) {
    console.error(`[cost-aggregation] Error para ${mes}:`, err)
    throw err
  }
}

function getDefaultMes(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export async function registerCostAggregationWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUE_NAME)

  await boss.work(QUEUE_NAME, async (jobs) => {
    for (const job of jobs) {
      try {
        await costAggregationHandler(job as any)
      } catch (err) {
        console.error(`[pg-boss] ${QUEUE_NAME} job ${job.id} falló:`, err)
        throw err
      }
    }
  })

  console.log(`[pg-boss] Worker "${QUEUE_NAME}" registrado`)
}

export async function scheduleMonthlyCostAggregation(boss: PgBoss): Promise<void> {
  const lastMonth = new Date()
  lastMonth.setMonth(lastMonth.getMonth() - 1)
  const mes = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`

  await boss.send(QUEUE_NAME, { mes }, { startAfter: 30, retryLimit: 3 })
  console.log(`[cost-aggregation] Job agendado para mes ${mes}`)
}
