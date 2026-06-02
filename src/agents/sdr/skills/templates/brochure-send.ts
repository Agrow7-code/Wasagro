import type { ConvContext } from '../../context.js'
import { segmentoToBrochureSlug } from '../../roleDetector.js'

// The brochure delivery message. The slug comes from segmentoToBrochureSlug()
// which is the only function in the codebase that maps Segmento -> brochure
// URL slug. Today we publish two brochures (exportadora + agricultor); the
// helper handles every other Segmento value with a documented fallback.
//
// The URL base is WASAGRO_BROCHURE_URL (env). Default kept for the unlikely
// case the var disappears in prod.

// TODO [FASE-A]: mensaje duplicado post-brochure
// Causa: posible worker duplicado o singletonKey no cubre este path de Evolution API
// Investigar después de que Redis wiring esté estable
export function brochureSend({ ctx }: { ctx: ConvContext }): string {
  const slug = segmentoToBrochureSlug(ctx.segmento)
  const base = process.env['WASAGRO_BROCHURE_URL'] ?? 'https://wasagro.vercel.app/brochure'
  const url = `${base}?segment=${slug}`
  return `¡Claro! Acá el brochure pensado para tu perfil de ${slug}: ${url}\n\nDale una mirada y cualquier duda me avisas por acá. ✅`
}
