import { sign, verify } from 'hono/jwt'

const JWT_SECRET = process.env['JWT_SECRET'] ?? ''
const MIN_SECRET_BYTES = 32

const JWT_ISSUER = 'wasagro'
const JWT_AUDIENCE = 'wasagro-api'

if (process.env['NODE_ENV'] !== 'test') {
  if (!JWT_SECRET) {
    console.error('[jwtService] JWT_SECRET no configurado — el sistema de autenticación no funcionará')
  } else if (Buffer.byteLength(JWT_SECRET, 'utf8') < MIN_SECRET_BYTES) {
    throw new Error(
      `JWT_SECRET muy corto (${Buffer.byteLength(JWT_SECRET, 'utf8')} bytes). Mínimo ${MIN_SECRET_BYTES} bytes para HS256. ` +
      'Generá uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
    )
  }
}

export interface WasagroJWTPayload {
  sub: string
  phone: string
  rol: string
  finca_id: string | null
  org_id: string | null
  iss: string
  aud: string
  iat: number
  exp: number
}

const JWT_EXPIRY_SECONDS = 7 * 24 * 60 * 60

export async function emitirJWT(payload: { id: string; phone: string; rol: string; finca_id: string | null; org_id?: string | null }): Promise<string> {
  if (!JWT_SECRET) throw new Error('JWT_SECRET no configurado')
  const now = Math.floor(Date.now() / 1000)
  return sign(
    {
      sub: payload.id,
      phone: payload.phone,
      rol: payload.rol,
      finca_id: payload.finca_id,
      org_id: payload.org_id ?? null,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      iat: now,
      exp: now + JWT_EXPIRY_SECONDS,
    },
    JWT_SECRET,
  )
}

export async function verificarJWT(token: string): Promise<WasagroJWTPayload> {
  if (!JWT_SECRET) throw new Error('JWT_SECRET no configurado')
  const decoded = await verify(token, JWT_SECRET, 'HS256') as unknown as WasagroJWTPayload

  if (decoded.iss !== JWT_ISSUER) {
    throw new Error(`JWT issuer inválido: ${decoded.iss}`)
  }
  if (decoded.aud !== JWT_AUDIENCE) {
    throw new Error(`JWT audience inválido: ${decoded.aud}`)
  }

  return decoded
}

export function requireJwtSecret(): void {
  if (!JWT_SECRET) throw new Error('JWT_SECRET es requerido para autenticación')
}
