import { initPgBoss, getBoss } from '../src/workers/pgBoss.js'

async function testPgBoss() {
  console.log('--- Comprobando variables de entorno ---')
  const envVars = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'WHATSAPP_PROVIDER', 'WASAGRO_LLM']
  for (const v of envVars) {
    console.log(`${v}: ${process.env[v] ? '✅ Configurada' : '❌ Falta'}`)
  }

  if (!process.env.DATABASE_URL) {
    console.error('No se puede probar pg-boss sin DATABASE_URL')
    process.exit(1)
  }

  console.log('\n--- Inicializando pg-boss ---')
  try {
    await initPgBoss()
    const boss = getBoss()

    console.log('\n--- Prueba de Encolado y Deduplicación ---')
    const traceId = 'test-trace-' + Date.now()
    const msgId = 'test-msg-id-123'
    const msg = {
      id: msgId,
      text: 'Hola, esta es una prueba de integración',
      phone: '1234567890',
      timestamp: Date.now()
    }

    // Primer intento
    const jobId1 = await boss.send('procesar-mensaje', { msg, traceId }, {
      singletonKey: msg.id,
      retryLimit: 1, // Reducido para la prueba
      retryBackoff: true,
    })
    console.log(`Intento 1: Job encolado con ID: ${jobId1}`)

    // Segundo intento casi inmediato con el mismo ID (debería ser null o el mismo ID pero no ejecutar doble)
    const jobId2 = await boss.send('procesar-mensaje', { msg, traceId }, {
      singletonKey: msg.id,
      retryLimit: 1,
      retryBackoff: true,
    })
    console.log(`Intento 2 (duplicado): Job encolado con ID: ${jobId2} (debería ser null por deduplicación)`)

    // Esperar unos segundos para ver si el worker procesa el mensaje
    console.log('\nEsperando a que el worker procese el mensaje (10s)...')
    await new Promise(resolve => setTimeout(resolve, 10000))

    console.log('\n--- Finalizando prueba ---')
    await boss.stop()
    process.exit(0)
  } catch (error) {
    console.error('Error durante la prueba:', error)
    process.exit(1)
  }
}

testPgBoss()
