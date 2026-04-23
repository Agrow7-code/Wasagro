// Checks availability via Google Calendar private ICS feed (read-only).
// Cannot create bookings — use Calendly for that.

const ICS_URL = process.env['CALENDAR_ICS_URL'] ?? ''

interface IcsEvent {
  start: Date
  end: Date
}

function unfoldIcs(text: string): string {
  return text.replace(/\r?\n[ \t]/g, '')
}

function parseIcsDt(raw: string): Date | null {
  // Strip TZID=... prefix: DTSTART;TZID=America/Guayaquil:20260423T150000
  const value = raw.includes(':') ? raw.split(':').pop()! : raw
  const s = value.trim()

  if (s.length === 8) {
    // All-day: YYYYMMDD → treat as midnight UTC
    return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)))
  }

  if (s.length >= 15) {
    // YYYYMMDDTHHMMSS[Z]
    const y = +s.slice(0, 4)
    const mo = +s.slice(4, 6) - 1
    const d = +s.slice(6, 8)
    const h = +s.slice(9, 11)
    const mi = +s.slice(11, 13)
    const se = +s.slice(13, 15)

    if (s.endsWith('Z')) {
      return new Date(Date.UTC(y, mo, d, h, mi, se))
    }
    // Localtime without Z — assume America/Guayaquil (UTC-5)
    return new Date(Date.UTC(y, mo, d, h + 5, mi, se))
  }

  return null
}

function parseIcsEvents(icsText: string): IcsEvent[] {
  const unfolded = unfoldIcs(icsText)
  const events: IcsEvent[] = []
  const blocks = unfolded.split('BEGIN:VEVENT')

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i] ?? ''

    const startLine = block.match(/\nDTSTART(?:;[^\n:]*)?:([^\n\r]+)/)
    const endLine = block.match(/\nDTEND(?:;[^\n:]*)?:([^\n\r]+)/)

    if (!startLine?.[1] || !endLine?.[1]) continue

    const start = parseIcsDt(startLine[1])
    const end = parseIcsDt(endLine[1])

    if (start && end) events.push({ start, end })
  }

  return events
}

export async function checkCalendarAvailability(
  requestedTime: Date,
  durationMinutes = 30,
): Promise<'available' | 'busy' | 'unknown'> {
  if (!ICS_URL) return 'unknown'

  try {
    const res = await fetch(ICS_URL, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return 'unknown'

    const icsText = await res.text()
    const events = parseIcsEvents(icsText)

    const slotEnd = new Date(requestedTime.getTime() + durationMinutes * 60_000)

    for (const ev of events) {
      if (ev.start < slotEnd && ev.end > requestedTime) return 'busy'
    }

    return 'available'
  } catch (err) {
    console.error('[calendar] Error checking ICS availability:', err)
    return 'unknown'
  }
}

export function buildCalendlyUrl(baseUrl: string, preferredDate?: Date): string {
  if (!preferredDate) return baseUrl

  const y = preferredDate.getUTCFullYear()
  const m = String(preferredDate.getUTCMonth() + 1).padStart(2, '0')
  const d = String(preferredDate.getUTCDate()).padStart(2, '0')

  return `${baseUrl}?month=${y}-${m}&date=${y}-${m}-${d}`
}
