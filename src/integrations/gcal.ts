// Google Calendar API — verificación de disponibilidad y creación de eventos con Meet.
// Requiere env vars: GCAL_CLIENT_ID, GCAL_CLIENT_SECRET, GCAL_REFRESH_TOKEN
// Obtener GCAL_REFRESH_TOKEN ejecutando: node scripts/setup-gcal-auth.mjs

import { google } from 'googleapis'

function getAuth() {
  const clientId = process.env['GCAL_CLIENT_ID']
  const clientSecret = process.env['GCAL_CLIENT_SECRET']
  const refreshToken = process.env['GCAL_REFRESH_TOKEN']
  if (!clientId || !clientSecret || !refreshToken) return null
  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })
  return auth
}

export function gcalConfigurado(): boolean {
  return !!(process.env['GCAL_CLIENT_ID'] && process.env['GCAL_CLIENT_SECRET'] && process.env['GCAL_REFRESH_TOKEN'])
}

export async function verificarDisponibilidad(
  startTime: Date,
  durationMinutes = 30,
): Promise<'available' | 'busy' | 'unknown'> {
  const auth = getAuth()
  if (!auth) return 'unknown'

  try {
    const calendar = google.calendar({ version: 'v3', auth })
    const endTime = new Date(startTime.getTime() + durationMinutes * 60_000)

    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        items: [{ id: 'primary' }],
      },
    })

    const busy = res.data.calendars?.['primary']?.busy ?? []
    return busy.length > 0 ? 'busy' : 'available'
  } catch (err) {
    console.error('[gcal] Error verificando disponibilidad:', err)
    return 'unknown'
  }
}

export async function crearReunionConMeet(
  startTime: Date,
  durationMinutes = 30,
  nombreContacto: string,
): Promise<{ meetLink: string; eventId: string } | null> {
  const auth = getAuth()
  if (!auth) return null

  try {
    const calendar = google.calendar({ version: 'v3', auth })
    const endTime = new Date(startTime.getTime() + durationMinutes * 60_000)

    const res = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      requestBody: {
        summary: `Demo Wasagro — ${nombreContacto}`,
        description: 'Demo de 30 minutos. Wasagro: reportes de campo por WhatsApp.',
        start: { dateTime: startTime.toISOString(), timeZone: 'America/Guayaquil' },
        end: { dateTime: endTime.toISOString(), timeZone: 'America/Guayaquil' },
        conferenceData: {
          createRequest: {
            requestId: `wasagro-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      },
    })

    const meetLink = res.data.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri
    const eventId = res.data.id ?? undefined

    if (!meetLink || !eventId) {
      console.error('[gcal] Evento creado pero sin link de Meet o sin ID')
      return null
    }

    return { meetLink, eventId }
  } catch (err) {
    console.error('[gcal] Error creando reunión con Meet:', err)
    return null
  }
}
