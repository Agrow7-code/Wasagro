/**
 * Prueba manual del pase de calidad de Sigatoka (sp-03f) contra fotos reales.
 *
 * Uso (con tu env de LLM cargado en el shell):
 *   npx tsx scripts/probar-calidad-sigatoka.ts ruta/a/foto1.jpg ruta/a/foto2.jpg
 *   npx tsx scripts/probar-calidad-sigatoka.ts ./set-fotos/*.jpg
 *
 * Imprime, por imagen: la salida cruda del gate (secciones, legibilidad,
 * confianza) y el VEREDICTO determinista (aceptable / cortada / borrosa).
 * Sirve para medir falsos positivos: las fotos BUENAS deben dar "aceptable".
 */
import { readFile } from 'node:fs/promises'
import { extname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { crearLLM } from '../src/integrations/llm/index.js'
import { evaluarCalidadSigatoka } from '../src/types/dominio/CalidadSigatoka.js'

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic',
}

async function main() {
  const rutas = process.argv.slice(2)
  if (rutas.length === 0) {
    console.error('Pasá al menos una imagen: npx tsx scripts/probar-calidad-sigatoka.ts foto.jpg')
    process.exit(1)
  }

  const llm = crearLLM()

  for (const ruta of rutas) {
    try {
      const mime = MIME[extname(ruta).toLowerCase()]
      if (!mime) { console.log(`\n⏭️  ${basename(ruta)} — extensión no soportada`); continue }

      const base64 = (await readFile(ruta)).toString('base64')
      const t0 = Date.now()
      const calidad = await llm.evaluarCalidadFichaSigatoka(base64, mime, randomUUID())
      const veredicto = evaluarCalidadSigatoka(calidad)
      const ms = Date.now() - t0

      const icono = veredicto.aceptable ? '✅' : '❌'
      console.log(`\n${icono} ${basename(ruta)}  (${ms}ms)`)
      console.log(`   visibles:   ${calidad.secciones_visibles.join(', ') || '—'}`)
      console.log(`   faltantes:  ${calidad.secciones_faltantes.join(', ') || '—'}`)
      console.log(`   matriz:     ${calidad.legibilidad_matriz}   confianza: ${calidad.confianza}`)
      if (calidad.motivo) console.log(`   motivo:     ${calidad.motivo}`)
      console.log(`   VEREDICTO:  ${veredicto.aceptable ? 'ACEPTABLE' : veredicto.problema?.toUpperCase()}`)
      if (veredicto.mensaje) console.log(`   → al user:  "${veredicto.mensaje}"`)
    } catch (err) {
      console.error(`\n💥 ${basename(ruta)} — error: ${String(err)}`)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
