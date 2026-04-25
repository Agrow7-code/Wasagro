const URL_BANANA_TRADERS = 'https://www.banana-traders.com/'

export interface PrecioBanano {
  fecha: string   // DD.MM.YYYY
  precio: number  // USD por caja
}

// Extrae fecha (DD.MM.YYYY) y precio ($X,XX) de filas consecutivas de la tabla.
// Formato HTML esperado: <td>24.04.2026</td><td>$5,00</td>
// La regex se crea dentro de la función para evitar que lastIndex persista entre llamadas.
function crearRowPattern() {
  return /<td[^>]*>\s*(\d{2}\.\d{2}\.\d{4})\s*<\/td>\s*<td[^>]*>\s*\$([0-9,]+)\s*<\/td>/gi
}

function parsearPrecio(raw: string): number {
  return parseFloat(raw.replace(',', '.'))
}

export async function getUltimosPreciosBanano(
  deps: { fetchClient?: typeof fetch } = {},
): Promise<[PrecioBanano, PrecioBanano] | null> {
  const fetchClient = deps.fetchClient ?? globalThis.fetch

  const res = await fetchClient(URL_BANANA_TRADERS)
  if (!res.ok) throw new Error(`[BananaTraders] HTTP ${res.status}`)

  const html = await res.text()
  const entradas: PrecioBanano[] = []

  const rowPattern = crearRowPattern()
  let match: RegExpExecArray | null
  while ((match = rowPattern.exec(html)) !== null && entradas.length < 2) {
    const fecha = match[1] ?? ''
    const precio = parsearPrecio(match[2] ?? '0')
    if (fecha && !Number.isNaN(precio)) entradas.push({ fecha, precio })
  }

  if (entradas.length < 2) {
    console.warn('[BananaTraders] No se encontraron 2 entradas de precio — la estructura de la página puede haber cambiado')
    return null
  }

  return [entradas[0], entradas[1]] as [PrecioBanano, PrecioBanano]
}
