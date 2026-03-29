import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readKvJson, resolveStoreBackend, writeKvJson } from '../store/kv.js'
import type {
  SmsAlertType,
  SmsCenterState,
  SmsDispatchRecord,
  SmsSubscribeInput,
  ThreatLevel,
} from '../../shared/types.js'

export interface StoredSubscriber {
  id: string
  name: string
  phone: string
  minThreatLevel: ThreatLevel
  alertTypes: SmsAlertType[]
  isActive: boolean
  createdAt: string
  updatedAt: string
  lastAlertAt?: string
}

export interface StoredDispatch extends SmsDispatchRecord {
  dedupeKey: string
}

export interface NotificationStoreData {
  subscribers: StoredSubscriber[]
  dispatches: StoredDispatch[]
  meta: {
    lastEvaluationAt?: string
    lastSuccessfulSendAt?: string
  }
}

interface SmsRuntimeSummary {
  provider: SmsCenterState['provider']
  sendMode: SmsCenterState['sendMode']
  schedulerEnabled: boolean
  evaluationIntervalMinutes: number
  cooldownMinutes: number
  note: string
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const storeFilePath = path.resolve(__dirname, '../../data/sms-store.json')
const storeKey = 'bayguard:sms-store'

let storeQueue = Promise.resolve()
let memoryStore = createEmptyStore()

function createEmptyStore(): NotificationStoreData {
  return {
    subscribers: [],
    dispatches: [],
    meta: {},
  }
}

async function ensureStoreDirectory(): Promise<void> {
  await mkdir(path.dirname(storeFilePath), { recursive: true })
}

export function normalizeAlertTypes(alertTypes: SmsAlertType[]): SmsAlertType[] {
  const unique = Array.from(new Set(alertTypes))
  return unique.length > 0 ? unique : ['general', 'flood', 'storm', 'weather']
}

export function normalizePhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, '')

  if (digits.length === 10) {
    return `+1${digits}`
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }

  if (value.trim().startsWith('+') && digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`
  }

  throw new Error('Enter a valid US phone number, for example 813-555-0100.')
}

export function maskPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const local = digits.slice(-10)
  const line = local.slice(6)

  return `***-***-${line}`
}

async function readStoreFile(): Promise<NotificationStoreData> {
  const backend = resolveStoreBackend()

  if (backend === 'memory') {
    return structuredClone(memoryStore)
  }

  if (backend === 'kv') {
    return readKvJson<NotificationStoreData>(storeKey, createEmptyStore)
  }

  try {
    await ensureStoreDirectory()
    const raw = await readFile(storeFilePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<NotificationStoreData>

    return {
      subscribers: Array.isArray(parsed.subscribers) ? parsed.subscribers : [],
      dispatches: Array.isArray(parsed.dispatches) ? parsed.dispatches : [],
      meta: parsed.meta ?? {},
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createEmptyStore()
    }

    throw error
  }
}

async function writeStoreFile(store: NotificationStoreData): Promise<void> {
  const backend = resolveStoreBackend()

  if (backend === 'memory') {
    memoryStore = structuredClone(store)
    return
  }

  if (backend === 'kv') {
    await writeKvJson(storeKey, store)
    return
  }

  await ensureStoreDirectory()
  await writeFile(storeFilePath, JSON.stringify(store, null, 2))
}

export async function readNotificationStore(): Promise<NotificationStoreData> {
  return readStoreFile()
}

export async function updateNotificationStore<T>(
  mutator: (store: NotificationStoreData) => Promise<T> | T,
): Promise<T> {
  const run = async () => {
    const store = await readStoreFile()
    const result = await mutator(store)
    await writeStoreFile(store)
    return result
  }

  const nextRun = storeQueue.then(run, run)
  storeQueue = nextRun.then(
    () => undefined,
    () => undefined,
  )

  return nextRun
}

export async function saveSubscriber(input: SmsSubscribeInput): Promise<StoredSubscriber> {
  const phone = normalizePhoneNumber(input.phone)
  const now = new Date().toISOString()

  return updateNotificationStore((store) => {
    const existing = store.subscribers.find((subscriber) => subscriber.phone === phone)

    if (existing) {
      existing.name = input.name?.trim() || existing.name
      existing.minThreatLevel = input.minThreatLevel
      existing.alertTypes = normalizeAlertTypes(input.alertTypes)
      existing.isActive = true
      existing.updatedAt = now
      return existing
    }

    const subscriber: StoredSubscriber = {
      id: randomUUID(),
      name: input.name?.trim() || 'BayGuard subscriber',
      phone,
      minThreatLevel: input.minThreatLevel,
      alertTypes: normalizeAlertTypes(input.alertTypes),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }

    store.subscribers.unshift(subscriber)
    return subscriber
  })
}

export async function deactivateSubscriber(id: string): Promise<StoredSubscriber | null> {
  return updateNotificationStore((store) => {
    const subscriber = store.subscribers.find((item) => item.id === id)
    if (!subscriber) {
      return null
    }

    subscriber.isActive = false
    subscriber.updatedAt = new Date().toISOString()
    return subscriber
  })
}

export function buildSmsCenterState(
  store: NotificationStoreData,
  runtime: SmsRuntimeSummary,
): SmsCenterState {
  return {
    provider: runtime.provider,
    sendMode: runtime.sendMode,
    schedulerEnabled: runtime.schedulerEnabled,
    evaluationIntervalMinutes: runtime.evaluationIntervalMinutes,
    cooldownMinutes: runtime.cooldownMinutes,
    note: runtime.note,
    subscribers: store.subscribers
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((subscriber) => ({
        id: subscriber.id,
        name: subscriber.name,
        phoneMasked: maskPhoneNumber(subscriber.phone),
        minThreatLevel: subscriber.minThreatLevel,
        alertTypes: subscriber.alertTypes,
        isActive: subscriber.isActive,
        createdAt: subscriber.createdAt,
        updatedAt: subscriber.updatedAt,
        lastAlertAt: subscriber.lastAlertAt,
      })),
    recentDispatches: store.dispatches
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 10)
      .map((dispatch) => ({
        id: dispatch.id,
        scenario: dispatch.scenario,
        headline: dispatch.headline,
        threatLevel: dispatch.threatLevel,
        categories: dispatch.categories,
        createdAt: dispatch.createdAt,
        recipientCount: dispatch.recipientCount,
        deliveredCount: dispatch.deliveredCount,
        failedCount: dispatch.failedCount,
        provider: dispatch.provider,
        status: dispatch.status,
        messagePreview: dispatch.messagePreview,
        reason: dispatch.reason,
      })),
    lastEvaluationAt: store.meta.lastEvaluationAt,
    lastSuccessfulSendAt: store.meta.lastSuccessfulSendAt,
  }
}
