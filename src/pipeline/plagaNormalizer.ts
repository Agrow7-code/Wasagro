type PlagaInfo = {
  nombre_comun: string
  nombre_cientifico: string
  cultivos: string[]
  alerta_cuarentena?: boolean
}

// Claves en minúsculas sin acento — el lookup normaliza el input antes de buscar
const PLAGAS: Record<string, PlagaInfo> = {
  // ── Cacao ────────────────────────────────────────────────────────────────
  'moniliasis':          { nombre_comun: 'Moniliasis',          nombre_cientifico: 'Moniliophthora roreri',              cultivos: ['cacao'] },
  'helada':              { nombre_comun: 'Moniliasis',          nombre_cientifico: 'Moniliophthora roreri',              cultivos: ['cacao'] },
  'escoba':              { nombre_comun: 'Escoba de bruja',     nombre_cientifico: 'Moniliophthora perniciosa',          cultivos: ['cacao'] },
  'escoba de bruja':     { nombre_comun: 'Escoba de bruja',     nombre_cientifico: 'Moniliophthora perniciosa',          cultivos: ['cacao'] },
  'mazorca negra':       { nombre_comun: 'Mazorca negra',       nombre_cientifico: 'Phytophthora palmivora',             cultivos: ['cacao'] },
  'phytophthora':        { nombre_comun: 'Mazorca negra',       nombre_cientifico: 'Phytophthora palmivora',             cultivos: ['cacao'] },
  'antracnosis':         { nombre_comun: 'Antracnosis',         nombre_cientifico: 'Colletotrichum gloeosporioides',     cultivos: ['cacao'] },
  'cochinilla':          { nombre_comun: 'Cochinilla harinosa', nombre_cientifico: 'Planococcus citri',                  cultivos: ['cacao'] },
  'cochinilla harinosa': { nombre_comun: 'Cochinilla harinosa', nombre_cientifico: 'Planococcus citri',                  cultivos: ['cacao'] },
  'barrenador':          { nombre_comun: 'Barrenador del tronco', nombre_cientifico: 'Xylotrechus quadripes',           cultivos: ['cacao'] },
  'barrenador del tronco': { nombre_comun: 'Barrenador del tronco', nombre_cientifico: 'Xylotrechus quadripes',         cultivos: ['cacao'] },

  // ── Banano / Plátano ─────────────────────────────────────────────────────
  'sigatoka negra':      { nombre_comun: 'Sigatoka negra',      nombre_cientifico: 'Mycosphaerella fijiensis',          cultivos: ['banano', 'platano'] },
  'mancha negra':        { nombre_comun: 'Sigatoka negra',      nombre_cientifico: 'Mycosphaerella fijiensis',          cultivos: ['banano', 'platano'] },
  'sigatoka amarilla':   { nombre_comun: 'Sigatoka amarilla',   nombre_cientifico: 'Mycosphaerella musicola',           cultivos: ['banano', 'platano'] },
  'mancha amarilla':     { nombre_comun: 'Sigatoka amarilla',   nombre_cientifico: 'Mycosphaerella musicola',           cultivos: ['banano', 'platano'] },
  'moko':                { nombre_comun: 'Moko bacteriano',     nombre_cientifico: 'Ralstonia solanacearum',            cultivos: ['banano', 'platano'], alerta_cuarentena: true },
  'moko bacteriano':     { nombre_comun: 'Moko bacteriano',     nombre_cientifico: 'Ralstonia solanacearum',            cultivos: ['banano', 'platano'], alerta_cuarentena: true },
  'picudo':              { nombre_comun: 'Picudo negro',        nombre_cientifico: 'Cosmopolites sordidus',             cultivos: ['banano', 'platano'] },
  'picudo negro':        { nombre_comun: 'Picudo negro',        nombre_cientifico: 'Cosmopolites sordidus',             cultivos: ['banano', 'platano'] },
  'corazon muerto':      { nombre_comun: 'Picudo negro',        nombre_cientifico: 'Cosmopolites sordidus',             cultivos: ['banano', 'platano'] },
  'trips':               { nombre_comun: 'Trips de la mancha roja', nombre_cientifico: 'Chaetanaphothrips signipennis', cultivos: ['banano', 'platano'] },
  'trips mancha roja':   { nombre_comun: 'Trips de la mancha roja', nombre_cientifico: 'Chaetanaphothrips signipennis', cultivos: ['banano', 'platano'] },
  'nematodos':           { nombre_comun: 'Nematodos',           nombre_cientifico: 'Radopholus similis',                cultivos: ['banano', 'platano'] },
  'fusarium':            { nombre_comun: 'Mal de Panamá',       nombre_cientifico: 'Fusarium oxysporum f.sp. cubense', cultivos: ['banano', 'platano'], alerta_cuarentena: true },
  'mal de panama':       { nombre_comun: 'Mal de Panamá',       nombre_cientifico: 'Fusarium oxysporum f.sp. cubense', cultivos: ['banano', 'platano'], alerta_cuarentena: true },

  // ── Arroz ────────────────────────────────────────────────────────────────
  'pyricularia':         { nombre_comun: 'Pyricularia',         nombre_cientifico: 'Pyricularia oryzae',                cultivos: ['arroz'] },
  'quemazón':            { nombre_comun: 'Pyricularia',         nombre_cientifico: 'Pyricularia oryzae',                cultivos: ['arroz'] },
  'quemazón de arroz':   { nombre_comun: 'Pyricularia',         nombre_cientifico: 'Pyricularia oryzae',                cultivos: ['arroz'] },
  'chinche':             { nombre_comun: 'Chinche de la espiga', nombre_cientifico: 'Oebalus pugnax',                  cultivos: ['arroz'] },
  'sogata':              { nombre_comun: 'Sogata',              nombre_cientifico: 'Tagosodes orizicolus',              cultivos: ['arroz'] },
  'punta blanca':        { nombre_comun: 'Punta blanca',        nombre_cientifico: 'Hirschmanniella oryzae',           cultivos: ['arroz'] },

  // ── Café ─────────────────────────────────────────────────────────────────
  'roya':                { nombre_comun: 'Roya',                nombre_cientifico: 'Hemileia vastatrix',                cultivos: ['cafe'] },
  'broca':               { nombre_comun: 'Broca',               nombre_cientifico: 'Hypothenemus hampei',               cultivos: ['cafe'] },
  'ojo de gallo':        { nombre_comun: 'Ojo de gallo',        nombre_cientifico: 'Mycena citricolor',                 cultivos: ['cafe'] },
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

function cultivoContiene(cultivoPrincipal: string, cultivosTarget: string[]): boolean {
  const base = normalizar(cultivoPrincipal).split(/[\s/,]+/)[0] ?? ''
  return cultivosTarget.some(c => base.includes(c) || c.includes(base))
}

export type ResultadoNormalizacion = {
  plaga_tipo: string
  nombre_comun: string
  nombre_cientifico: string
  alerta_cuarentena: boolean
}

/**
 * Normaliza el nombre de la plaga al canónico de la tabla para el cultivo dado.
 * Retorna null si no encuentra coincidencia (el valor original permanece intacto).
 */
export function normalizarPlaga(
  plaga_tipo: string | null | undefined,
  cultivo_principal: string | null | undefined,
): ResultadoNormalizacion | null {
  if (!plaga_tipo) return null

  const key = normalizar(plaga_tipo)
  const info = PLAGAS[key]
  if (!info) return null

  // Si tenemos cultivo, validar que esta plaga afecte ese cultivo.
  // Sin cultivo, aceptar la normalización igual (mejor que nada).
  if (cultivo_principal && !cultivoContiene(cultivo_principal, info.cultivos)) return null

  return {
    plaga_tipo: info.nombre_comun,
    nombre_comun: info.nombre_comun,
    nombre_cientifico: info.nombre_cientifico,
    alerta_cuarentena: info.alerta_cuarentena ?? false,
  }
}
