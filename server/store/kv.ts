import { Redis } from '@upstash/redis'
import { createClient } from 'redis'

export type StoreBackend = 'memory' | 'file' | 'kv'

interface KvConfig {
  url: string
  token: string
}

let kvClient: Redis | null | undefined
type StandardRedisClient = ReturnType<typeof createClient>

let redisClientPromise: Promise<StandardRedisClient> | null = null

function readEnvValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) {
      return value
    }
  }

  return undefined
}

function resolveKvConfig(): KvConfig | null {
  const url = readEnvValue('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL')
  const token = readEnvValue('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN')

  if (!url || !token) {
    return null
  }

  return { url, token }
}

function resolveRedisUrl(): string | null {
  return readEnvValue('REDIS_URL') ?? null
}

function getKvClient(): Redis | null {
  if (kvClient !== undefined) {
    return kvClient
  }

  const config = resolveKvConfig()
  kvClient = config ? new Redis({ url: config.url, token: config.token }) : null
  return kvClient
}

export function hasKvStore(): boolean {
  return resolveKvConfig() !== null || resolveRedisUrl() !== null
}

export function resolveStoreBackend(): StoreBackend {
  const preferredMode = process.env.BAYGUARD_STORE_MODE

  if (preferredMode === 'memory') {
    return 'memory'
  }

  if (preferredMode === 'file') {
    return 'file'
  }

  if (preferredMode === 'kv') {
    if (hasKvStore()) {
      return 'kv'
    }

    return process.env.VERCEL === '1' ? 'memory' : 'file'
  }

  if (hasKvStore()) {
    return 'kv'
  }

  if (process.env.VERCEL === '1') {
    return 'memory'
  }

  return 'file'
}

async function getRedisClient(): Promise<StandardRedisClient | null> {
  const redisUrl = resolveRedisUrl()

  if (!redisUrl) {
    return null
  }

  if (!redisClientPromise) {
    const client = createClient({ url: redisUrl })
    redisClientPromise = client.connect().then(() => client)
  }

  return redisClientPromise
}

export async function readKvJson<T>(key: string, fallbackFactory: () => T): Promise<T> {
  const restClient = getKvClient()

  if (restClient) {
    const raw = await restClient.get<unknown>(key)

    if (raw == null) {
      return fallbackFactory()
    }

    if (typeof raw !== 'string') {
      return raw as T
    }

    try {
      return JSON.parse(raw) as T
    } catch {
      return fallbackFactory()
    }
  }

  const redisClient = await getRedisClient()

  if (!redisClient) {
    return fallbackFactory()
  }

  const raw = await redisClient.get(key)

  if (!raw) {
    return fallbackFactory()
  }

  const rawValue = raw as string | Uint8Array
  const rawText =
    typeof rawValue === 'string' ? rawValue : Buffer.from(rawValue).toString('utf8')

  try {
    return JSON.parse(rawText) as T
  } catch {
    return fallbackFactory()
  }
}

export async function writeKvJson<T>(key: string, value: T): Promise<void> {
  const restClient = getKvClient()

  if (restClient) {
    await restClient.set(key, JSON.stringify(value))
    return
  }

  const redisClient = await getRedisClient()

  if (!redisClient) {
    throw new Error('Redis or Vercel KV is not configured.')
  }

  await redisClient.set(key, JSON.stringify(value))
}
