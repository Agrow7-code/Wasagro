import { describe, expect, it, vi } from 'vitest'
import { getUltimosPreciosBanano } from '../../../src/integrations/market/BananaTradersClient.js'

function crearFetchMock(html: string, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    text: async () => html,
  })
}

const HTML_TIPICO = `
<html><body>
<table>
  <thead><tr><th>Date</th><th>Spot Price</th><th>Difference</th></tr></thead>
  <tbody>
    <tr><td>24.04.2026</td><td>$5,00</td><td>+$0,50</td></tr>
    <tr><td>17.04.2026</td><td>$4,50</td><td>-$0,25</td></tr>
    <tr><td>10.04.2026</td><td>$4,75</td><td>+$0,75</td></tr>
  </tbody>
</table>
</body></html>
`

describe('getUltimosPreciosBanano', () => {
  it('retorna los dos registros más recientes', async () => {
    const fetch = crearFetchMock(HTML_TIPICO)
    const result = await getUltimosPreciosBanano({ fetchClient: fetch as any })

    expect(result).not.toBeNull()
    expect(result![0].precio).toBe(5.0)
    expect(result![0].fecha).toBe('24.04.2026')
    expect(result![1].precio).toBe(4.5)
    expect(result![1].fecha).toBe('17.04.2026')
  })

  it('parsea precio con coma decimal correctamente ($4,75 → 4.75)', async () => {
    const html = HTML_TIPICO.replace('$5,00', '$4,75').replace('$4,50', '$3,25')
    const fetch = crearFetchMock(html)
    const result = await getUltimosPreciosBanano({ fetchClient: fetch as any })

    expect(result![0].precio).toBe(4.75)
    expect(result![1].precio).toBe(3.25)
  })

  it('retorna null si hay menos de 2 filas con precios', async () => {
    const htmlIncompleto = `<table><tr><td>24.04.2026</td><td>$5,00</td><td>+</td></tr></table>`
    const fetch = crearFetchMock(htmlIncompleto)
    const result = await getUltimosPreciosBanano({ fetchClient: fetch as any })

    expect(result).toBeNull()
  })

  it('lanza error si la página responde con error HTTP', async () => {
    const fetch = crearFetchMock('', false)
    await expect(getUltimosPreciosBanano({ fetchClient: fetch as any })).rejects.toThrow('HTTP 503')
  })

  it('funciona con atributos en los td (clases, estilos)', async () => {
    const htmlConAtributos = `
      <table>
        <tr><td class="date">24.04.2026</td><td class="price">$5,00</td><td>+</td></tr>
        <tr><td class="date">17.04.2026</td><td class="price">$4,50</td><td>-</td></tr>
      </table>`
    const fetch = crearFetchMock(htmlConAtributos)
    const result = await getUltimosPreciosBanano({ fetchClient: fetch as any })

    expect(result).not.toBeNull()
    expect(result![0].precio).toBe(5.0)
  })
})
