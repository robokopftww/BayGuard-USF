import { GoogleGenAI } from '@google/genai'

import { createIntelSnapshot } from './orchestrator.js'
import {
  dispatchSmsForScenario,
  getSmsCenterState,
  runAutomaticSmsEvaluation,
  subscribeToSms,
  unsubscribeFromSms,
} from './notifications/service.js'
import {
  deleteCommunityReport,
  getCommunityReportsState,
  parseCommunityReportType,
  reverifyCommunityReport,
  submitCommunityReport,
  verifyUnsavedCommunityClaim,
} from './reports/service.js'
import type {
  CommunityReportInput,
  CommunityReportType,
  IntelSnapshot,
  SimulationScenario,
  SmsAlertType,
  SmsSubscribeInput,
  ThreatLevel,
} from '../shared/types.js'

export class ApiError extends Error {
  status: number
  payload: Record<string, unknown>

  constructor(status: number, payload: Record<string, unknown>) {
    super(typeof payload.message === 'string' ? payload.message : 'API request failed.')
    this.status = status
    this.payload = payload
  }
}

const allowedScenarios: SimulationScenario[] = ['live', 'flood', 'hurricane', 'compound']
const allowedThreatLevels: ThreatLevel[] = ['low', 'guarded', 'elevated', 'high', 'severe']
const allowedAlertTypes: SmsAlertType[] = ['general', 'flood', 'storm', 'weather']
const cacheWindowMs = 2 * 60 * 1000

let cache: { value: IntelSnapshot; fetchedAt: number } | null = null

export function parseScenario(value: unknown): SimulationScenario {
  if (typeof value === 'string' && allowedScenarios.includes(value as SimulationScenario)) {
    return value as SimulationScenario
  }

  return 'live'
}

export function parseThreatLevel(value: unknown): ThreatLevel {
  if (typeof value === 'string' && allowedThreatLevels.includes(value as ThreatLevel)) {
    return value as ThreatLevel
  }

  return 'high'
}

export function parseAlertTypes(value: unknown): SmsAlertType[] {
  if (!Array.isArray(value)) {
    return ['general', 'flood', 'storm', 'weather']
  }

  const filtered = value.filter((item): item is SmsAlertType =>
    typeof item === 'string' && allowedAlertTypes.includes(item as SmsAlertType),
  )

  return filtered.length > 0 ? filtered : ['general', 'flood', 'storm', 'weather']
}

export function getHealthPayload() {
  return {
    ok: true,
    mode: process.env.GEMINI_API_KEY ? 'gemini-ready' : 'fallback',
    fetchedAt: cache?.value.generatedAt ?? null,
  }
}

export async function getIntelPayload(input: {
  refresh?: unknown
  scenario?: unknown
}): Promise<IntelSnapshot> {
  const forceRefresh = input.refresh === '1' || input.refresh === true
  const scenario = parseScenario(input.scenario)
  const cached = cache

  if (
    !forceRefresh &&
    cached &&
    cached.value.simulation.scenario === scenario &&
    Date.now() - cached.fetchedAt < cacheWindowMs
  ) {
    return cached.value
  }

  try {
    const snapshot = await createIntelSnapshot(scenario)
    cache = {
      value: snapshot,
      fetchedAt: Date.now(),
    }

    return snapshot
  } catch (error) {
    if (cached && cached.value.simulation.scenario === scenario) {
      return cached.value
    }

    throw error
  }
}

export async function getSmsPayload() {
  return getSmsCenterState()
}

export async function createSmsSubscriberPayload(body: Partial<SmsSubscribeInput>) {
  if (!body.phone?.trim()) {
    throw new ApiError(400, { message: 'Phone number is required.' })
  }

  return subscribeToSms({
    name: body.name,
    phone: body.phone,
    minThreatLevel: parseThreatLevel(body.minThreatLevel),
    alertTypes: parseAlertTypes(body.alertTypes),
  })
}

export async function unsubscribeSmsSubscriberPayload(id: unknown) {
  if (typeof id !== 'string' || !id.trim()) {
    throw new ApiError(400, { message: 'Subscriber id is required.' })
  }

  try {
    return await unsubscribeFromSms(id)
  } catch (error) {
    throw new ApiError(404, {
      message: error instanceof Error ? error.message : 'Subscriber not found.',
    })
  }
}

export async function dispatchSmsPayload(body: { scenario?: unknown; force?: unknown }) {
  const scenario = parseScenario(body.scenario)
  const force = typeof body.force === 'boolean' ? body.force : scenario !== 'live'
  return dispatchSmsForScenario(scenario, force)
}

export async function evaluateSmsPayload() {
  const result = await runAutomaticSmsEvaluation()
  return result ?? { outcome: 'skipped', reason: 'SMS evaluator is disabled on this deployment.' }
}

export async function getCommunityReportsPayload() {
  return getCommunityReportsState()
}

export async function createCommunityReportPayload(body: Partial<CommunityReportInput>) {
  const locationHint = typeof body.locationHint === 'string' ? body.locationHint.trim() : ''
  const details = typeof body.details === 'string' ? body.details.trim() : ''

  if (!locationHint) {
    throw new ApiError(400, { message: 'Location is required.' })
  }

  if (!details) {
    throw new ApiError(400, { message: 'Report details are required.' })
  }

  return submitCommunityReport({
    reporterName: typeof body.reporterName === 'string' ? body.reporterName : undefined,
    type: parseCommunityReportType(body.type),
    locationHint,
    zoneId: typeof body.zoneId === 'string' && body.zoneId.trim() ? body.zoneId : undefined,
    details,
  })
}

export async function reverifyCommunityReportPayload(body: { id?: unknown }) {
  if (typeof body.id !== 'string' || !body.id.trim()) {
    throw new ApiError(400, { message: 'Report id is required.' })
  }

  try {
    return await reverifyCommunityReport(body.id)
  } catch (error) {
    throw new ApiError(404, {
      message: error instanceof Error ? error.message : 'Report not found.',
    })
  }
}

export async function deleteCommunityReportPayload(input: { id?: unknown }) {
  if (typeof input.id !== 'string' || !input.id.trim()) {
    throw new ApiError(400, { message: 'Report id is required.' })
  }

  try {
    return await deleteCommunityReport(input.id)
  } catch (error) {
    throw new ApiError(404, {
      message: error instanceof Error ? error.message : 'Report not found.',
    })
  }
}

export async function verifyPayload(body: { report?: unknown; issueType?: unknown }) {
  const report = typeof body.report === 'string' ? body.report.trim() : ''
  const issueType = typeof body.issueType === 'string' ? body.issueType : 'other'

  if (!report) {
    throw new ApiError(400, { error: 'report is required' })
  }

  const issueTypeMap: Record<string, CommunityReportType> = {
    flood: 'flooding',
    flooding: 'flooding',
    road: 'road-hazard',
    traffic: 'road-hazard',
    wind: 'wind-damage',
    damage: 'wind-damage',
    power: 'power-outage',
    outage: 'power-outage',
    storm: 'storm-impact',
    weather: 'storm-impact',
    general: 'other',
    other: 'other',
  }

  const verification = await verifyUnsavedCommunityClaim({
    reporterName: 'API verification',
    type: issueTypeMap[issueType.toLowerCase()] ?? 'other',
    locationHint: 'Tampa',
    details: report,
  })

  return {
    status: verification.verification.status.toUpperCase(),
    confidence: verification.verification.confidence,
    sources: verification.verification.sourceLabels,
    explanation: verification.verification.summary,
    zoneName: verification.zoneName ?? null,
  }
}

export async function evacuatePayload(body: { address?: unknown; category?: unknown }) {
  const address = typeof body.address === 'string' ? body.address.trim() : ''
  const category = typeof body.category === 'number' ? body.category : Number(body.category)

  if (!address || !Number.isFinite(category) || category <= 0) {
    throw new ApiError(400, { error: 'address and category are required' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new ApiError(500, { error: 'Gemini API key not configured on server' })
  }

  const prompt = [
    'You are a Tampa Bay emergency management AI.',
    `Someone lives at: ${address}.`,
    `A Category ${category} hurricane is approaching Tampa Bay.`,
    '',
    'Tampa Flood Zones:',
    '- Zone A: Evacuate for Cat 1+. Lowest elevation, storm surge risk. Areas: Davis Islands, Apollo Beach, Gandy area, Ballast Point waterfront.',
    '- Zone B: Evacuate for Cat 2+. Areas: South Tampa, Harbour Island, Palmetto Beach, parts of St. Pete.',
    '- Zone C: Evacuate for Cat 3+. Areas: New Tampa, Carrollwood, Temple Terrace, Brandon.',
    '',
    'Real Tampa Shelters:',
    '1. Hillsborough Community College - Dale Mabry, 4001 W Tampa Bay Blvd, Tampa FL 33614',
    '2. Jefferson High School, 4401 W Cypress St, Tampa FL 33607',
    '3. Blake High School, 1701 N Boulevard, Tampa FL 33607',
    '4. Freedom High School, 7154 Forest Grove Dr, Tampa FL 33620',
    '5. Armwood High School, 12000 US-92, Seffner FL 33584',
    '',
    'Generate a specific, realistic evacuation plan for this address and hurricane category.',
    'Respond ONLY in this JSON format:',
    '{',
    '  "floodZone": "A" | "B" | "C" | "Unknown",',
    '  "mustEvacuate": true | false,',
    '  "reason": "<one sentence explaining why or why not>",',
    '  "shelter": { "name": "<shelter name>", "address": "<full address>" },',
    '  "steps": ["<5-7 specific action steps in order>"],',
    '  "supplies": ["<8-10 items to bring>"]',
    '}',
  ].join('\n')

  const ai = new GoogleGenAI({ apiKey })
  const geminiResponse = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? 'gemini-1.5-flash',
    contents: [{ text: prompt }],
    config: { responseMimeType: 'application/json', temperature: 0.4 },
  })

  return JSON.parse(geminiResponse.text ?? '{}')
}
