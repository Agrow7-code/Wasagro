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
