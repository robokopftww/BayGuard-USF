import { GoogleGenAI } from '@google/genai'

import { createIntelSnapshot } from './orchestrator.js'
import { fetchEvacuationZoneForPoint } from './data-sources.js'
import {
  dispatchSmsForScenario,
  getSmsCenterState,
  removeDispatchFromSms,
  removeSubscriberFromSms,
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
  EvacuationPlan,
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

const fallbackShelters = [
  {
    name: 'Hillsborough Community College - Dale Mabry',
    address: '4001 W Tampa Bay Blvd, Tampa FL 33614',
  },
  {
    name: 'Jefferson High School',
    address: '4401 W Cypress St, Tampa FL 33607',
  },
  {
    name: 'Freedom High School',
    address: '7154 Forest Grove Dr, Tampa FL 33620',
  },
]

const fallbackZoneKeywords: Array<{
  zone: EvacuationPlan['floodZone']
  keywords: string[]
  shelterIndex: number
}> = [
  {
    zone: 'A',
    keywords: [
      'davis island',
      'davis islands',
      'apollo beach',
      'gandy',
      'ballast point',
      'harbour island',
      'harbor island',
      'port tampa',
    ],
    shelterIndex: 0,
  },
  {
    zone: 'B',
    keywords: [
      'south tampa',
      'palmetto beach',
      'st petersburg',
      'st pete',
      'channelside',
      'water street',
      'rocky point',
      'westshore',
    ],
    shelterIndex: 1,
  },
  {
    zone: 'C',
    keywords: [
      'new tampa',
      'carrollwood',
      'temple terrace',
      'brandon',
      'seminole heights',
      'town n country',
      'town n\' country',
      'university area',
      'usf',
    ],
    shelterIndex: 2,
  },
]

let cache: { value: IntelSnapshot; fetchedAt: number } | null = null

type EvacuationStatus = EvacuationPlan['status']

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

function inferFloodZoneFromAddress(address: string): EvacuationPlan['floodZone'] {
  const normalized = address.toLowerCase()

  for (const rule of fallbackZoneKeywords) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.zone
    }
  }

  return 'Unknown'
}

async function resolveFloodZone(
  address: string,
  lat?: number | null,
  lon?: number | null,
): Promise<EvacuationPlan['floodZone']> {
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    try {
      return await fetchEvacuationZoneForPoint(lat ?? 0, lon ?? 0)
    } catch {
      return inferFloodZoneFromAddress(address)
    }
  }

  return inferFloodZoneFromAddress(address)
}

function evacuationThresholdForZone(zone: EvacuationPlan['floodZone']): number | null {
  switch (zone) {
    case 'A':
      return 1
    case 'B':
      return 2
    case 'C':
      return 3
    default:
      return null
  }
}

function stormAlertEvents(snapshot: IntelSnapshot | null): string[] {
  if (!snapshot) {
    return []
  }

  return snapshot.signals.weather.alerts
    .map((alert) => alert.event)
    .filter((event) => /(hurricane|tropical storm|storm surge)/i.test(event))
}

function deriveCurrentStormCategory(snapshot: IntelSnapshot | null): number {
  if (!snapshot) {
    return 0
  }

  if (snapshot.simulation.scenario === 'compound') {
    return 4
  }

  if (snapshot.simulation.scenario === 'hurricane') {
    return 3
  }

  const stormAlerts = stormAlertEvents(snapshot)
  const hasHurricaneWarning = stormAlerts.some((event) => /hurricane warning|storm surge warning/i.test(event))
  const hasHurricaneWatch = stormAlerts.some((event) => /hurricane watch|storm surge watch/i.test(event))
  const hasTropicalStormWarning = stormAlerts.some((event) => /tropical storm warning/i.test(event))
  const activeSystems = snapshot.signals.tropical.activeSystems.length
  const maxWind = snapshot.signals.weather.maxWindGustMphNext12h

  if (hasHurricaneWarning || snapshot.overview.threatLevel === 'severe') {
    return 4
  }

  if (hasHurricaneWatch || snapshot.overview.threatLevel === 'high' || maxWind >= 75) {
    return 3
  }

  if (hasTropicalStormWarning || activeSystems > 0 || snapshot.overview.threatLevel === 'elevated' || maxWind >= 45) {
    return 2
  }

  if (snapshot.overview.threatLevel === 'guarded' && (stormAlerts.length > 0 || maxWind >= 30)) {
    return 1
  }

  return 0
}

function deriveEvacuationStatus(
  floodZone: EvacuationPlan['floodZone'],
  stormCategory: number,
  mustEvacuate: boolean,
): EvacuationStatus {
  if (mustEvacuate) {
    return 'evacuate'
  }

  if (stormCategory > 0 || floodZone === 'Unknown') {
    return stormCategory > 0 ? 'watch' : 'normal'
  }

  return 'normal'
}

function buildFallbackEvacuationPlan(
  address: string,
  stormCategory: number,
  floodZone: EvacuationPlan['floodZone'],
): EvacuationPlan {
  const threshold = evacuationThresholdForZone(floodZone)
  const mustEvacuate = threshold !== null && stormCategory >= threshold
  const status = deriveEvacuationStatus(floodZone, stormCategory, mustEvacuate)
  const matchingRule = fallbackZoneKeywords.find((rule) => rule.zone === floodZone)
  const shelter = mustEvacuate && matchingRule ? fallbackShelters[matchingRule.shelterIndex] : null

  const reason =
    floodZone === 'Unknown'
      ? stormCategory > 0
        ? 'BayGuard could not confidently match this address to a Tampa evacuation zone, so keep checking local guidance as conditions change.'
        : 'BayGuard could not confidently match this address to a Tampa evacuation zone, but current conditions look normal right now.'
      : mustEvacuate
        ? `This address appears to sit in Zone ${floodZone}, and current storm conditions are strong enough for that zone to evacuate now.`
        : stormCategory > 0
          ? `This address appears to sit in Zone ${floodZone}, but current conditions are not strong enough for that zone to evacuate yet.`
          : `This address appears to sit in Zone ${floodZone}, and no evacuation is needed under current conditions.`

  const steps = mustEvacuate
    ? [
        'Leave early before roads and gas stations get busier.',
        shelter
          ? `Head toward ${shelter.name}.`
          : 'Choose a local shelter or a safer inland stay with friends or family.',
        'Bring medication, IDs, chargers, and enough clothing for two days.',
        'Avoid shoreline roads and low underpasses on the way out.',
      ]
    : status === 'watch'
      ? floodZone === 'Unknown'
        ? [
            'Double-check the address or nearby neighborhood name.',
            'Watch official Hillsborough County evacuation updates if conditions worsen.',
            'Keep a plan ready in case the storm track shifts.',
          ]
        : [
            'Stay ready and keep checking official local updates.',
            'Review your route before conditions worsen.',
            'Prepare a small go-bag in case conditions escalate.',
          ]
      : [
          'Normal activity is okay right now.',
          'Keep alerts on so you see changes early.',
          'Review your route and supplies before conditions worsen.',
        ]

  return {
    address,
    stormCategory,
    floodZone,
    status,
    mustEvacuate,
    reason,
    shelter: shelter ?? null,
    steps,
    supplies: [
      'Phone charger',
      'Medications',
      'Water',
      'Important documents',
      'Flashlight',
      'Change of clothes',
    ],
    mode: 'fallback',
  }
}

async function getLiveSnapshotForEvacuation(): Promise<IntelSnapshot | null> {
  try {
    return await getIntelPayload({ scenario: 'live' })
  } catch {
    return cache?.value.simulation.scenario === 'live' ? cache.value : null
  }
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

export async function deleteSmsSubscriberPayload(input: { id?: unknown }) {
  if (typeof input.id !== 'string' || !input.id.trim()) {
    throw new ApiError(400, { message: 'Subscriber id is required.' })
  }

  try {
    return await removeSubscriberFromSms(input.id)
  } catch (error) {
    throw new ApiError(404, {
      message: error instanceof Error ? error.message : 'Subscriber not found.',
    })
  }
}

export async function deleteSmsDispatchPayload(input: { id?: unknown }) {
  if (typeof input.id !== 'string' || !input.id.trim()) {
    throw new ApiError(400, { message: 'Text alert id is required.' })
  }

  try {
    return await removeDispatchFromSms(input.id)
  } catch (error) {
    throw new ApiError(404, {
      message: error instanceof Error ? error.message : 'Text alert not found.',
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

export async function evacuatePayload(body: {
  address?: unknown
  lat?: unknown
  lon?: unknown
}): Promise<EvacuationPlan> {
  const address = typeof body.address === 'string' ? body.address.trim() : ''
  const lat = typeof body.lat === 'number' ? body.lat : Number(body.lat)
  const lon = typeof body.lon === 'number' ? body.lon : Number(body.lon)

  if (!address) {
    throw new ApiError(400, { error: 'address is required' })
  }

  const snapshot = await getLiveSnapshotForEvacuation()
  const stormCategory = deriveCurrentStormCategory(snapshot)
  const floodZone = await resolveFloodZone(address, Number.isFinite(lat) ? lat : null, Number.isFinite(lon) ? lon : null)
  const fallbackPlan = buildFallbackEvacuationPlan(address, stormCategory, floodZone)
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return fallbackPlan
  }

  const stormEvents = stormAlertEvents(snapshot)
  const liveSummary =
    snapshot?.overview.summary ??
    'BayGuard is checking live Tampa weather, tide, and storm conditions.'

  const prompt = [
    'You are a Tampa Bay emergency management AI.',
    `Someone lives at: ${address}.`,
    `BayGuard currently sees storm category ${stormCategory === 0 ? '0 (normal / no active evacuation trigger)' : stormCategory} conditions for Tampa.`,
    `Current BayGuard summary: ${liveSummary}`,
    `Current storm-related alerts: ${stormEvents.length > 0 ? stormEvents.join(', ') : 'none'}.`,
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
    'Generate a specific, realistic address check for current Tampa conditions.',
    'Respond ONLY in this JSON format:',
    '{',
    '  "floodZone": "A" | "B" | "C" | "Unknown",',
    '  "status": "normal" | "watch" | "evacuate",',
    '  "mustEvacuate": true | false,',
    '  "reason": "<one sentence explaining why or why not>",',
    '  "shelter": { "name": "<shelter name>", "address": "<full address>" },',
    '  "steps": ["<5-7 specific action steps in order>"],',
    '  "supplies": ["<8-10 items to bring>"]',
    '}',
  ].join('\n')

  try {
    const ai = new GoogleGenAI({ apiKey })
    const geminiResponse = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL ?? 'gemini-1.5-flash',
      contents: [{ text: prompt }],
      config: { responseMimeType: 'application/json', temperature: 0.4 },
    })

    const parsed = JSON.parse(geminiResponse.text ?? '{}') as Partial<EvacuationPlan> & {
      shelter?: { name?: string; address?: string } | null
    }

    const normalizedFloodZone =
      parsed.floodZone === 'A' || parsed.floodZone === 'B' || parsed.floodZone === 'C'
        ? parsed.floodZone
        : fallbackPlan.floodZone
    const normalizedMustEvacuate =
      typeof parsed.mustEvacuate === 'boolean' ? parsed.mustEvacuate : fallbackPlan.mustEvacuate
    const normalizedStatus =
      parsed.status === 'normal' || parsed.status === 'watch' || parsed.status === 'evacuate'
        ? parsed.status
        : deriveEvacuationStatus(normalizedFloodZone, stormCategory, normalizedMustEvacuate)

    return {
      address,
      stormCategory,
      floodZone: normalizedFloodZone,
      status: normalizedStatus,
      mustEvacuate: normalizedMustEvacuate,
      reason:
        typeof parsed.reason === 'string' && parsed.reason.trim()
          ? parsed.reason.trim()
          : fallbackPlan.reason,
      shelter:
        parsed.shelter &&
        typeof parsed.shelter.name === 'string' &&
        typeof parsed.shelter.address === 'string'
          ? {
              name: parsed.shelter.name,
              address: parsed.shelter.address,
            }
          : fallbackPlan.shelter,
      steps:
        Array.isArray(parsed.steps) && parsed.steps.filter((item): item is string => typeof item === 'string').length
          ? parsed.steps.filter((item): item is string => typeof item === 'string').slice(0, 6)
          : fallbackPlan.steps,
      supplies:
        Array.isArray(parsed.supplies) &&
        parsed.supplies.filter((item): item is string => typeof item === 'string').length
          ? parsed.supplies.filter((item): item is string => typeof item === 'string').slice(0, 8)
          : fallbackPlan.supplies,
      mode: 'gemini',
    }
  } catch {
    return fallbackPlan
  }
}
