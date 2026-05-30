import { promises as dns } from 'node:dns'
import net from 'node:net'

// IPv4 ranges that must never be reachable from user-input-controlled URLs.
const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  // ranges expressed as [first octet, mask check via prefix-test]
]

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return false
  const [a = 0, b = 0] = parts
  if (a === 10) return true                              // 10.0.0.0/8
  if (a === 127) return true                             // 127.0.0.0/8 — loopback
  if (a === 0) return true                               // 0.0.0.0/8 — "this network"
  if (a === 169 && b === 254) return true                // 169.254.0.0/16 — link-local + AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true       // 172.16.0.0/12
  if (a === 192 && b === 168) return true                // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true      // 100.64.0.0/10 — CGNAT
  if (a >= 224) return true                              // multicast + reserved
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true   // unique local
  if (lower.startsWith('fe80:') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true // link-local
  if (lower.startsWith('ff')) return true                              // multicast
  // IPv4-mapped IPv6: ::ffff:a.b.c.d
  const v4MappedMatch = lower.match(/^::ffff:([0-9.]+)$/)
  if (v4MappedMatch && v4MappedMatch[1]) return isPrivateIPv4(v4MappedMatch[1])
  // IPv4-compatible IPv6: ::a.b.c.d
  const v4CompatMatch = lower.match(/^::([0-9.]+)$/)
  if (v4CompatMatch && v4CompatMatch[1]) return isPrivateIPv4(v4CompatMatch[1])
  return false
}

function stripIPv6Brackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1)
  }
  return hostname
}

export class SSRFError extends Error {
  constructor(url: string, reason: string) {
    super(`[SSRF] URL bloqueada (${reason}): ${url}`)
    this.name = 'SSRFError'
  }
}

interface ValidateOptions {
  allowedHosts?: string[]
  resolveDns?: boolean   // default true — disable only for tests
}

export async function validateUrlAgainstSSRF(rawUrl: string, opts: ValidateOptions = {}): Promise<string> {
  const { allowedHosts, resolveDns = true } = opts

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SSRFError(rawUrl, 'URL inválida')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SSRFError(rawUrl, `protocolo no permitido: ${url.protocol}`)
  }

  const hostname = stripIPv6Brackets(url.hostname)

  if (allowedHosts?.length && !allowedHosts.includes(url.hostname)) {
    throw new SSRFError(rawUrl, 'host fuera de la allowlist')
  }

  // If hostname is already a literal IP, validate it directly.
  const ipKind = net.isIP(hostname)
  if (ipKind === 4) {
    if (isPrivateIPv4(hostname)) throw new SSRFError(rawUrl, `IPv4 privada: ${hostname}`)
    return rawUrl
  }
  if (ipKind === 6) {
    if (isPrivateIPv6(hostname)) throw new SSRFError(rawUrl, `IPv6 privada: ${hostname}`)
    return rawUrl
  }

  // Hostname is a DNS name → resolve and validate every returned IP.
  // In test mode, skip DNS resolution: the test runner often has no network
  // and tests already use mocked fetch clients. Production always resolves.
  if (!resolveDns || process.env['NODE_ENV'] === 'test') return rawUrl

  let addrs4: string[] = []
  let addrs6: string[] = []
  try {
    addrs4 = await dns.resolve4(hostname).catch(() => [] as string[])
    addrs6 = await dns.resolve6(hostname).catch(() => [] as string[])
  } catch {
    throw new SSRFError(rawUrl, 'DNS resolution falló')
  }

  if (addrs4.length === 0 && addrs6.length === 0) {
    throw new SSRFError(rawUrl, `DNS no resuelve a ninguna IP: ${hostname}`)
  }

  for (const a of addrs4) {
    if (isPrivateIPv4(a)) throw new SSRFError(rawUrl, `${hostname} → IPv4 privada ${a}`)
  }
  for (const a of addrs6) {
    if (isPrivateIPv6(a)) throw new SSRFError(rawUrl, `${hostname} → IPv6 privada ${a}`)
  }

  return rawUrl
}
