import Redis from 'ioredis'

let redisClient: Redis | null = null

export function getRedisClient(): Redis {
  if (!redisClient) {
    const connectionUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
    redisClient = new Redis(connectionUrl, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      connectTimeout: 5000,
    })
    
    redisClient.on('error', (err) => {
      console.error('[Redis] Connection Error:', err)
    })
  }
  return redisClient
}

export async function getCachedContext(phone: string): Promise<string | null> {
  try {
    const client = getRedisClient()
    return await client.get(`sdr_ctx:${phone}`)
  } catch (err) {
    console.warn('[Redis] getCachedContext failed, falling back to DB', err)
    return null
  }
}

export async function setCachedContext(phone: string, context: string, ttlSeconds: number = 3600): Promise<void> {
  try {
    const client = getRedisClient()
    await client.set(`sdr_ctx:${phone}`, context, 'EX', ttlSeconds)
  } catch (err) {
    console.warn('[Redis] setCachedContext failed', err)
  }
}

// Atomic SET-if-not-exists with TTL. Used for cross-instance deduplication
// (e.g. WhatsApp webhook wamid dedup). Returns true if the key was set (first
// time we see this id), false if it already existed (duplicate).
//
// Why this exists: an in-memory Set per process doesn't dedupe across multiple
// Railway/Vercel instances, so the same webhook delivered twice within seconds
// hit different instances and both processed it. Using Redis SET NX EX makes
// the check atomic and shared across the fleet.
export async function setIfNotExists(key: string, ttlSeconds: number): Promise<boolean> {
  try {
    const client = getRedisClient()
    const result = await client.set(key, '1', 'EX', ttlSeconds, 'NX')
    // ioredis returns 'OK' when the key was set, null when NX rejected
    return result === 'OK'
  } catch (err) {
    console.warn('[Redis] setIfNotExists failed, caller should fallback:', err)
    // Re-throw so the caller can apply its own degradation strategy
    // (e.g. fall back to an in-memory dedup with its known limitations).
    throw err
  }
}
