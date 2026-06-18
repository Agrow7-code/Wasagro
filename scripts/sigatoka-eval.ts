/**
 * Eval de extracción Sigatoka (CR5 / D32).
 *
 * Mide DÓNDE falla la extracción usando las correcciones humanas guardadas en
 * `sigatoka_correcciones` (extraído-vs-corregido por celda). Distingue:
 *   - errores CONFIADOS (el modelo leyó un valor y estaba MAL, sin avisar) ← lo peligroso
 *   - ilegibles completados (el modelo avisó honestamente que no podía leer)
 *
 * Uso:
 *   tsx scripts/sigatoka-eval.ts                 # agregado de TODAS las correcciones
 *   tsx scripts/sigatoka-eval.ts <evento_id>     # solo ese muestreo
 *
 * Requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en el entorno.
 */
import { getCorreccionesParaEval } from '../src/pipeline/supabaseQueries.js'
import { analizarCorrecciones, type ReporteEval, type Seccion } from '../src/pipeline/sigatokaEval.js'

const NOMBRE_SECCION: Record<Seccion, string> = {
  matriz: 'Matriz de puntos (P1–P19)',
  sem11: 'Tabla 11 semanas',
  sem00: 'Tabla 00 semanas',
  otro: 'Otro',
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${Math.round((n / d) * 100)}%`
}

function imprimir(titulo: string, r: ReporteEval): void {
  console.log(`\n── ${titulo} ──`)
  console.log(`  Celdas tocadas:        ${r.total}`)
  console.log(`  Errores (valor cambió): ${r.errores}`)
  console.log(`  · Confiados (leída pero MAL): ${r.erroresConfiados}  ← los peligrosos, se cuelan sin marca`)
  console.log(`  · Ilegibles completados:      ${r.ilegiblesCompletados}  (el modelo avisó)`)
  console.log(`  Por sección (errores / de los cuales confiados):`)
  for (const sec of ['matriz', 'sem11', 'sem00', 'otro'] as Seccion[]) {
    const s = r.porSeccion[sec]
    if (s.errores === 0) continue
    console.log(`    - ${NOMBRE_SECCION[sec].padEnd(28)} ${s.errores} errores · ${s.confiados} confiados (${pct(s.confiados, s.errores)} de la sección)`)
  }
}

async function main(): Promise<void> {
  const eventoId = process.argv[2]
  const rows = await getCorreccionesParaEval(eventoId)

  if (rows.length === 0) {
    console.log(`Sin correcciones registradas${eventoId ? ` para el evento ${eventoId}` : ''}.`)
    console.log('Recordá GUARDAR las correcciones en la UI para que alimenten el eval.')
    return
  }

  // Agregado global
  imprimir(eventoId ? `Muestreo ${eventoId}` : `Agregado — TODAS las correcciones (${rows.length} celdas)`, analizarCorrecciones(rows))

  // Si es el agregado, además desglosá por muestreo para ver si un evento concentra los errores.
  if (!eventoId) {
    const porEvento = new Map<string, typeof rows>()
    for (const r of rows) {
      const arr = porEvento.get(r.evento_id) ?? []
      arr.push(r)
      porEvento.set(r.evento_id, arr)
    }
    if (porEvento.size > 1) {
      console.log(`\n── Por muestreo (${porEvento.size} eventos) ──`)
      for (const [evId, filas] of porEvento) {
        const r = analizarCorrecciones(filas)
        console.log(`  ${evId}: ${r.errores} errores (${r.erroresConfiados} confiados)`)
      }
    }
  }
  console.log()
}

main().catch(err => {
  console.error('[sigatoka-eval] error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
