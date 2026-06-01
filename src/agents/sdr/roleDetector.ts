// Detects the prospect's self-declared role from free-text messages and maps
// it to a typed Segmento. Pure function, no LLM, no IO — runs in router.ts
// after each extraction so the segmento is set as early as the prospect speaks.
//
// Why this exists: the previous heuristic in inferBrochureSegment() decided
// segmento by 'fincas >= 10', which misclassifies an agricultor with 30 hectáreas
// of one finca as 'exportadora'. The real signal is what the prospect SAYS they
// are, not how big they are. Size is a secondary signal at best.

import type { Segmento } from './context.js'

// Ordered: stronger / less ambiguous patterns first.
// Each entry: { pattern, segmento, reason }. Reason is for logging only.
const ROLE_PATTERNS: ReadonlyArray<{ pattern: RegExp; segmento: Segmento; reason: string }> = [
  // ── exportadora — explicit role declarations ─────────────────────────
  { pattern: /\b(soy|trabajo en|trabajamos en|somos una?) (?:(?:la|una|el) )?exportadora\b/i, segmento: 'exportadora', reason: 'self-declared exportadora' },
  { pattern: /\b(gerente|director|jefe) (?:de|en) (?:(?:la|una|el) )?exportadora\b/i, segmento: 'exportadora', reason: 'role at exportadora' },
  { pattern: /\b(exporto|exportamos)\b.*\b(a|para|hacia)\b/i, segmento: 'exportadora', reason: 'exports to' },
  { pattern: /\b(vendo|vendemos|colocamos)\b.*\b(europa|ee\.?\s?uu|estados unidos|asia|china|japón)\b/i, segmento: 'exportadora', reason: 'sells abroad' },
  { pattern: /\b(EUDR|cumplimiento de la UE|deforestación)\b/i, segmento: 'exportadora', reason: 'EUDR concern' },

  // ── cooperativa — explicit ─────────────────────────────────────────
  { pattern: /\b(somos una?|representamos|trabajo en (la )?|en mi) cooperativa\b/i, segmento: 'cooperativa', reason: 'self-declared cooperativa' },
  { pattern: /\bcooperativa de\b/i, segmento: 'cooperativa', reason: 'cooperativa mention' },
  { pattern: /\basociación de productores\b/i, segmento: 'cooperativa', reason: 'producer association' },

  // ── ONG ──────────────────────────────────────────────────────────────
  { pattern: /\b(somos una?|trabajo en una?|fundación|ONG|sin fines de lucro|cooperación)\b/i, segmento: 'ong', reason: 'ONG / fundación' },

  // ── agricultor — explicit possession / individual ownership ──────────
  { pattern: /\b(tengo|tenemos) (mi|mis|una|unas?|nuestra|nuestras?) (propia )?finca/i, segmento: 'agricultor', reason: 'owns finca personally' },
  { pattern: /\bmi (propia )?(finca|hacienda|chacra|parcela|cultivo|propiedad)\b/i, segmento: 'agricultor', reason: 'my finca/etc' },
  { pattern: /\b(soy|somos) (productor|productora|agricultor|agricultora|finquer|cacaotero|bananero|cafetalero|pequeño productor)/i, segmento: 'agricultor', reason: 'self-declared agricultor' },
  { pattern: /\bes (mi|nuestra) finca\b/i, segmento: 'agricultor', reason: 'my finca' },
  { pattern: /\b(quiero|queremos) empezar con wasagro\b/i, segmento: 'agricultor', reason: 'individual signup intent' },
]

export interface RoleDetection {
  segmento: Segmento
  reason: string
  matchedPattern: string
}

// Detect role from a single text. Returns null if no pattern matches.
// Caller decides what to do with the null (typically: keep current segmento).
export function detectRoleFromText(texto: string): RoleDetection | null {
  if (!texto || texto.length < 3) return null
  for (const { pattern, segmento, reason } of ROLE_PATTERNS) {
    if (pattern.test(texto)) {
      return { segmento, reason, matchedPattern: pattern.source }
    }
  }
  return null
}

// Map any segmento to the actual brochure URL slug we have.
// Currently we publish two brochures: exportadora and agricultor.
// 'cooperativa' falls back to 'agricultor' (closest fit until we ship a cooperativa brochure).
// 'ong' falls back to 'exportadora' (institutional pitch is closer than smallholder).
export function segmentoToBrochureSlug(segmento: Segmento): 'exportadora' | 'agricultor' {
  switch (segmento) {
    case 'exportadora':
    case 'ong':
      return 'exportadora'
    case 'agricultor':
    case 'cooperativa':
    case 'desconocido':
    default:
      return 'agricultor'
  }
}
