// Script de autorización OAuth2 para Google Calendar.
// Ejecutar UNA SOLA VEZ: node scripts/setup-gcal-auth.mjs
//
// Prerequisitos:
//   1. Ir a https://console.cloud.google.com
//   2. Crear proyecto (o usar uno existente)
//   3. APIs & Services → Enable "Google Calendar API"
//   4. APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
//      - Application type: Desktop app
//      - Nombre: Wasagro
//   5. Descargar JSON → copiar client_id y client_secret como env vars locales:
//        export GCAL_CLIENT_ID="tu-client-id"
//        export GCAL_CLIENT_SECRET="tu-client-secret"
//   6. Ejecutar este script: node scripts/setup-gcal-auth.mjs
//   7. Abrir la URL que aparece → autorizar con tu cuenta Google
//   8. El script imprime GCAL_REFRESH_TOKEN → copiar a Railway

import { createServer } from 'node:http'
import { google } from 'googleapis'

const CLIENT_ID = process.env.GCAL_CLIENT_ID
const CLIENT_SECRET = process.env.GCAL_CLIENT_SECRET
const REDIRECT_URI = 'http://localhost:3456/callback'

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Faltan variables de entorno:')
  console.error('   export GCAL_CLIENT_ID="..."')
  console.error('   export GCAL_CLIENT_SECRET="..."')
  process.exit(1)
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/calendar'],
})

console.log('\n🔗 Abre esta URL en tu navegador y autoriza con tu cuenta Google:\n')
console.log(authUrl)
console.log('\n⏳ Esperando autorización...\n')

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3456')
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<h2>Error: ${error}</h2>`)
    console.error(`\n❌ Error de autorización: ${error}`)
    server.close()
    return
  }

  if (!code) {
    res.writeHead(400)
    res.end('No se recibió código')
    return
  }

  try {
    const { tokens } = await oauth2Client.getToken(code)

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<h2>✅ Autorización completada. Cierra esta ventana.</h2>')

    console.log('\n✅ Autorización exitosa. Agrega estas variables a Railway:\n')
    console.log(`GCAL_CLIENT_ID=${CLIENT_ID}`)
    console.log(`GCAL_CLIENT_SECRET=${CLIENT_SECRET}`)
    console.log(`GCAL_REFRESH_TOKEN=${tokens.refresh_token}`)
    console.log('\nComando Railway:')
    console.log(`railway variables set GCAL_CLIENT_ID="${CLIENT_ID}" GCAL_CLIENT_SECRET="${CLIENT_SECRET}" GCAL_REFRESH_TOKEN="${tokens.refresh_token}"`)
    console.log()
  } catch (err) {
    console.error('\n❌ Error obteniendo tokens:', err)
    res.writeHead(500)
    res.end('Error obteniendo tokens')
  }

  server.close()
})

server.listen(3456, () => {
  console.log('Servidor local escuchando en http://localhost:3456/callback')
})
