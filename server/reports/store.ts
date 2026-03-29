import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readKvJson, resolveStoreBackend, writeKvJson } from '../store/kv.js'
import type { CommunityReport, CommunityReportsState, ZoneReference } from '../../shared/types.js'

export interface CommunityReportStoreData {
  reports: CommunityReport[]
  meta: {
    lastSubmissionAt?: string
    lastVerifiedAt?: string
  }
}

interface CommunityReportsRuntime {
  verificationMode: CommunityReportsState['verificationMode']
  note: string
  zones: ZoneReference[]
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const storeFilePath = path.resolve(__dirname, '../../data/community-reports.json')
const storeKey = 'bayguard:community-reports'

let storeQueue = Promise.resolve()
let memoryStore = createEmptyStore()

function createEmptyStore(): CommunityReportStoreData {
  return {
    reports: [],
    meta: {},
  }
}

async function ensureStoreDirectory(): Promise<void> {
  await mkdir(path.dirname(storeFilePath), { recursive: true })
}

async function readStoreFile(): Promise<CommunityReportStoreData> {
  const backend = resolveStoreBackend()

  if (backend === 'memory') {
    return structuredClone(memoryStore)
  }

  if (backend === 'kv') {
    return readKvJson<CommunityReportStoreData>(storeKey, createEmptyStore)
  }

  try {
    await ensureStoreDirectory()
    const raw = await readFile(storeFilePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<CommunityReportStoreData>

    return {
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
      meta: parsed.meta ?? {},
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createEmptyStore()
    }

    throw error
  }
}

async function writeStoreFile(store: CommunityReportStoreData): Promise<void> {
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

export async function readCommunityReportStore(): Promise<CommunityReportStoreData> {
  return readStoreFile()
}

export async function updateCommunityReportStore<T>(
  mutator: (store: CommunityReportStoreData) => Promise<T> | T,
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

export function buildCommunityReportsState(
  store: CommunityReportStoreData,
  runtime: CommunityReportsRuntime,
): CommunityReportsState {
  const reports = store.reports
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 24)

  const confirmedCount = reports.filter((report) => report.verification.status === 'confirmed').length
  const likelyCount = reports.filter((report) => report.verification.status === 'likely').length
  const unverifiedCount = reports.filter((report) => report.verification.status === 'unverified').length

  return {
    verificationMode: runtime.verificationMode,
    note: runtime.note,
    zones: runtime.zones,
    reports,
    stats: {
      totalReports: reports.length,
      confirmedCount,
      likelyCount,
      unverifiedCount,
    },
    lastSubmissionAt: store.meta.lastSubmissionAt,
    lastVerifiedAt: store.meta.lastVerifiedAt,
  }
}
