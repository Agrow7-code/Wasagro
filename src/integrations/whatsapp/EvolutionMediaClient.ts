export interface MediaResult {
  base64: string
  mimeType: string
}

export async function downloadEvolutionMedia(
  rawPayload: unknown,
  apiUrl: string,
  apiKey: string,
  instance: string,
): Promise<MediaResult> {
  const data = (rawPayload as any)?.data
  if (!data?.key || !data?.message) {
    throw new Error('rawPayload no contiene key/message de Evolution')
  }

  const res = await fetch(`${apiUrl}/chat/getBase64FromMediaMessage/${instance}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({ message: { key: data.key, message: data.message } }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Evolution media download HTTP ${res.status}: ${detail}`)
  }

  const json = (await res.json()) as any
  if (!json?.base64) throw new Error('Evolution media response sin campo base64')

  return {
    base64: json.base64 as string,
    mimeType: (json.mimetype as string) ?? 'image/jpeg',
  }
}
