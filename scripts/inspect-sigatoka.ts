// Inspecciona el último muestreo de Sigatoka guardado. Para diagnóstico del
// test real por WhatsApp. Uso: railway run npx tsx scripts/inspect-sigatoka.ts
import { loadDotEnv } from './lib/loadDotEnv.js'
loadDotEnv()
import { supabase } from '../src/integrations/supabase.js'

async function main() {
  const { data, error } = await supabase
    .from('eventos_campo')
    .select('id, created_at, status, confidence_score, imagen_path, datos_evento')
    .eq('datos_evento->>tipo_documento', 'muestreo_sigatoka_banano')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) { console.error('ERROR:', error.message); process.exit(1) }
  if (!data) { console.log('No hay eventos de muestreo Sigatoka.'); return }

  const sig = (data.datos_evento as any)?.sigatoka ?? {}
  console.log('═══ EVENTO ═══')
  console.log('id:', data.id, '| status:', data.status, '| conf:', data.confidence_score, '| img:', data.imagen_path)
  console.log('classifier_source:', (data.datos_evento as any)?.classifier_source ?? (data.datos_evento as any)?.texto_ocr_origen ? 'ocr' : '?')
  console.log('semana:', sig.semana, '| finca:', sig.nombreFinca, '| zona:', sig.zona, '| supervisor:', sig.supervisor)
  console.log('confidenceScore:', sig.confidenceScore)
  console.log('\n── resumenColumnas (n=' + (sig.resumenColumnas?.length ?? 0) + ') ──')
  console.log(JSON.stringify(sig.resumenColumnas, null, 2))
  console.log('\n── puntosMuestreo: n=' + (sig.puntosMuestreo?.length ?? 0) + ' ──')
  console.log('primeros 3:', JSON.stringify(sig.puntosMuestreo?.slice(0, 3), null, 2))
  console.log('\n── plantas (EF): n=' + (sig.plantas?.length ?? 0) + ' ──')
  console.log('plantas11sem:', JSON.stringify(sig.plantas11sem))
  console.log('plantas00sem:', JSON.stringify(sig.plantas00sem))
  console.log('pEfFinca:', sig.pEfFinca, '| erradicadasBsv:', sig.erradicadasBsv)
  console.log('plagasFoliares:', JSON.stringify(sig.plagasFoliares))
  console.log('camposDudosos:', JSON.stringify(sig.camposDudosos))

  if (data.imagen_path) {
    const { getSignedUrlEvento } = await import('../src/integrations/supabaseStorage.js')
    const url = await getSignedUrlEvento(data.imagen_path, 3600)
    console.log('\nSIGNED_URL:', url)
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
