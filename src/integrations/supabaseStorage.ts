import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase.js'

export const EVENTOS_MEDIA_BUCKET = 'eventos-media'

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  // WhatsApp voice notes (Evolution) come as ogg/opus; keep a few common
  // fallbacks in case a prospect sends an audio file instead of a voice note.
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
}

/**
 * Construye la ruta del objeto dentro del bucket. Pura y testeable.
 * Scoped por finca para que el aislamiento por organización (P5) sea trivial
 * a nivel de Storage: F001/uuid.jpg
 */
export function buildImagenPath(fincaId: string, mimeType: string, id: string = randomUUID()): string {
  const ext = MIME_EXT[mimeType.toLowerCase()] ?? 'bin'
  const finca = (fincaId || 'sin-finca').replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${finca}/${id}.${ext}`
}

/**
 * Genera una URL firmada temporal para ver la imagen privada de un evento (UI de
 * revisión). NUNCA lanza: ante path vacío o error de Storage devuelve null para
 * que la UI muestre "sin imagen" en vez de romperse (P4). Default 1h de validez.
 */
export async function getSignedUrlEvento(
  path: string | null | undefined,
  expiresInSec: number = 3600,
  client: SupabaseClient = supabase,
): Promise<string | null> {
  if (!path) return null
  try {
    const { data, error } = await client.storage
      .from(EVENTOS_MEDIA_BUCKET)
      .createSignedUrl(path, expiresInSec)
    if (error || !data?.signedUrl) {
      if (error) console.error('[supabaseStorage] createSignedUrl falló:', error.message)
      return null
    }
    return data.signedUrl
  } catch (err) {
    console.error('[supabaseStorage] createSignedUrl excepción:', String(err))
    return null
  }
}

/**
 * Sube la imagen original de un evento al bucket privado eventos-media y
 * devuelve la ruta del objeto. NUNCA lanza: si Storage falla, loggea y devuelve
 * null para que el pipeline guarde el evento igual con imagen_path=null (P4 —
 * nada de errores silenciosos que tumben el flujo).
 */
export async function subirImagenEvento(
  base64: string,
  mimeType: string,
  fincaId: string,
  client: SupabaseClient = supabase,
): Promise<string | null> {
  try {
    const path = buildImagenPath(fincaId, mimeType)
    const buffer = Buffer.from(base64, 'base64')
    const { error } = await client.storage
      .from(EVENTOS_MEDIA_BUCKET)
      .upload(path, buffer, { contentType: mimeType, upsert: false })
    if (error) {
      console.error('[supabaseStorage] upload falló:', error.message)
      return null
    }
    return path
  } catch (err) {
    console.error('[supabaseStorage] upload excepción:', String(err))
    return null
  }
}

/**
 * Construye la ruta del objeto para el media (audio/imagen) de un prospecto
 * SDR, dentro del mismo bucket privado eventos-media (D8/D29 reuse — sin
 * bucket nuevo), scoped bajo sdr/<telefono>/. Pura y testeable.
 */
export function buildMediaPathSDR(phone: string, mimeType: string, id: string = randomUUID()): string {
  const ext = MIME_EXT[mimeType.toLowerCase()] ?? 'bin'
  const safePhone = (phone || 'sin-telefono').replace(/[^a-zA-Z0-9_-]/g, '_')
  return `sdr/${safePhone}/${id}.${ext}`
}

/**
 * Sube el audio/imagen entrante de un prospecto SDR al bucket privado
 * eventos-media, bajo sdr/. NUNCA lanza: si Storage falla, loggea y devuelve
 * null — el ingest de media SDR es best-effort y jamás debe romper el
 * pipeline (P3/P4).
 */
export async function subirMediaSDR(
  base64: string,
  mimeType: string,
  phone: string,
  client: SupabaseClient = supabase,
): Promise<string | null> {
  try {
    const path = buildMediaPathSDR(phone, mimeType)
    const buffer = Buffer.from(base64, 'base64')
    const { error } = await client.storage
      .from(EVENTOS_MEDIA_BUCKET)
      .upload(path, buffer, { contentType: mimeType, upsert: false })
    if (error) {
      console.error('[supabaseStorage] upload SDR falló:', error.message)
      return null
    }
    return path
  } catch (err) {
    console.error('[supabaseStorage] upload SDR excepción:', String(err))
    return null
  }
}
