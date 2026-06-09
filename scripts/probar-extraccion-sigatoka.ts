/**
 * Prueba manual del extractor de muestreo Sigatoka (sp-03e) contra una ficha real.
 * Corre el LLM real → permite iterar el prompt sin deployar.
 *
 * Uso: railway run npx tsx scripts/probar-extraccion-sigatoka.ts ruta/a/ficha.jpg
 */
import { readFile } from 'node:fs/promises'
import { extname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { crearLLM } from '../src/integrations/llm/index.js'

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic',
}

async function main() {
  const ruta = process.argv[2]
  if (!ruta) { console.error('uso: railway run npx tsx scripts/probar-extraccion-sigatoka.ts ficha.jpg'); process.exit(1) }
  const mime = MIME[extname(ruta).toLowerCase()] ?? 'image/jpeg'
  const base64 = (await readFile(ruta)).toString('base64')

  const llm = crearLLM()
  const t0 = Date.now()
  const sig = await llm.extraerMuestreoSigatoka(base64, mime, randomUUID())
  console.log(`\n${basename(ruta)}  (${Date.now() - t0}ms)  conf=${sig.confidenceScore}`)
  console.log('identidad:', sig.zona, '|', sig.codigoFinca, '|', sig.nombreFinca, '| sem', sig.semana, '| per', sig.periodo, '|', sig.supervisor)
  console.log('\n── resumenColumnas (n=' + sig.resumenColumnas.length + ') ──')
  console.log(JSON.stringify(sig.resumenColumnas, null, 1))
  console.log('\n── puntosMuestreo (n=' + sig.puntosMuestreo.length + ') ── (estadio/piscas por planta)')
  for (const p of sig.puntosMuestreo) {
    const cell = (c: any) => c?.valor != null ? c.valor : (c?.estado === 'ilegible' ? '?' : '·')
    console.log(`${p.punto}${p.sector ? ' ['+p.sector+']' : ''}: ` +
      `H1 ${cell(p.planta1_estadio)}(${cell(p.planta1_piscas)}) | H2 ${cell(p.planta2_estadio)}(${cell(p.planta2_piscas)}) | H3 ${cell(p.planta3_estadio)}(${cell(p.planta3_piscas)}) ` +
      `| hVle ${cell(p.hVle)} hVlq ${cell(p.hVlq)} func ${cell(p.func)}`)
  }
  console.log('\n── plantas 11 sem (n=' + sig.plantas11sem.length + ') ──')
  console.log(JSON.stringify(sig.plantas11sem))
  console.log('── plantas 00 sem (n=' + (sig.plantas00sem?.length ?? 0) + ') ──')
  console.log(JSON.stringify(sig.plantas00sem))
  console.log('pEfFinca:', sig.pEfFinca, '| erradicadasBsv:', sig.erradicadasBsv)
  console.log('plagasFoliares:', JSON.stringify(sig.plagasFoliares))
  console.log('camposDudosos:', JSON.stringify(sig.camposDudosos))
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
