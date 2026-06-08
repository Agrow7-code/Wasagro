/**
 * Reproducción del PASO de clasificación (sp-03c) contra fotos reales.
 *
 * Uso (con env de LLM cargado — p.ej. `railway run`):
 *   railway run npx tsx scripts/probar-clasificador-sigatoka.ts "foto 1.jpeg" "foto 2.jpeg"
 *
 * Imprime el `tipo` que devuelve clasificarTipoImagen por imagen y deja ver
 * los logs del LLMRouter (qué adapter del tier `fast` respondió o falló).
 * Sirve para diagnosticar por qué una ficha Sigatoka no se rutea al extractor.
 */
import { readFile } from 'node:fs/promises'
import { extname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { crearLLM } from '../src/integrations/llm/index.js'
import { detectarFormularioSigatoka } from '../src/pipeline/handlers/SigatokaHandler.js'

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic',
}

async function main() {
  const args = process.argv.slice(2)
  // --model=gemini-3-flash fuerza un único adapter Gemini con ese modelo en tier fast
  const modelArg = args.find(a => a.startsWith('--model='))?.split('=')[1]
  const rutas = args.filter(a => !a.startsWith('--'))
  if (rutas.length === 0) {
    console.error('Pasá al menos una imagen.')
    process.exit(1)
  }

  if (modelArg) {
    process.env['WASAGRO_LLM'] = 'gemini'
    process.env['GEMINI_FAST_MODEL'] = modelArg
  }

  console.log(`WASAGRO_LLM=${process.env['WASAGRO_LLM'] ?? '(auto)'}  modelo_fast=${modelArg ?? '(router)'}`)
  const llm = crearLLM()

  for (const ruta of rutas) {
    try {
      const mime = MIME[extname(ruta).toLowerCase()]
      if (!mime) { console.log(`\n⏭️  ${basename(ruta)} — extensión no soportada`); continue }

      const base64 = (await readFile(ruta)).toString('base64')
      const t0 = Date.now()
      // Replica la decisión paralela del EventHandler tras el fix
      const [esSigatoka, tipoBase] = await Promise.all([
        llm.detectarFichaSigatoka(base64, mime, randomUUID()),
        llm.clasificarTipoImagen(base64, mime, randomUUID()),
      ])
      const tipo = esSigatoka ? 'muestreo_sigatoka_banano' : tipoBase
      const ms = Date.now() - t0

      const ok = tipo === 'muestreo_sigatoka_banano'
      console.log(`\n${ok ? '✅' : '❌'} ${basename(ruta)}  (${ms}ms)`)
      console.log(`   detector_binario=${esSigatoka}  clasificador_base=${tipoBase}  → tipo=${tipo}`)

      // Red de seguridad Nivel B: si clasifica documento_tabla, corre OCR y
      // chequea los marcadores. Replica exactamente la ruta de EventHandler.
      if (tipo === 'documento_tabla') {
        const ocr = await llm.extraerDocumentoOCR(base64, mime, { lista_lotes: 'Sin lotes' }, randomUUID())
        const detecta = detectarFormularioSigatoka(ocr.texto_completo_visible)
        console.log(`   OCR confianza=${ocr.confianza_lectura}  detectarFormularioSigatoka=${detecta ? '✅ SÍ' : '❌ NO'}`)
        console.log(`   OCR texto (300c): ${(ocr.texto_completo_visible ?? '').slice(0, 300).replace(/\n/g, ' ')}`)
      }
    } catch (err) {
      console.error(`\n💥 ${basename(ruta)} — error: ${String(err)}`)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
