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
