import { randomUUID } from 'node:crypto'

import { GoogleGenAI } from '@google/genai'

import { createIntelSnapshot, getZoneCatalog } from '../orchestrator.js'
import {
  buildCommunityReportsState,
  readCommunityReportStore,
  updateCommunityReportStore,
  type CommunityReportStoreData,
} from './store.js'
import type {
  CommunityReport,
  CommunityReportInput,
  CommunityReportType,
  CommunityReportsState,
  CommunityVerificationStatus,
  Incident,
  IntelSnapshot,
  OfficialAlert,
  ThreatLevel,
  ZoneReference,
  ZoneRisk,
} from '../../shared/types.js'

const reportTypes: CommunityReportType[] = [
  'flooding',
  'road-hazard',
  'wind-damage',
  'power-outage',
  'storm-impact',
  'other',
]

const threatLevels: ThreatLevel[] = ['low', 'guarded', 'elevated', 'high', 'severe']

const reportKeywords: Record<CommunityReportType, string[]> = {
  flooding: ['flood', 'flooding', 'water', 'ponding', 'overflow', 'drain', 'surge'],
  'road-hazard': ['road', 'street', 'closure', 'blocked', 'traffic', 'bridge', 'underpass'],
  'wind-damage': ['wind', 'tree', 'debris', 'damage', 'roof', 'gust'],
  'power-outage': ['power', 'outage', 'electric', 'line', 'transformer'],
  'storm-impact': ['storm', 'hurricane', 'thunderstorm', 'tornado', 'surge', 'lightning'],
  other: [],
}

interface VerificationDraft {
  zoneId?: string
  zoneName?: string
  verification: CommunityReport['verification']
}

function threatRank(level: ThreatLevel): number {
  return threatLevels.indexOf(level)
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

function formatThreat(level: ThreatLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1)
}

function formatReportType(type: CommunityReportType): string {
  switch (type) {
    case 'flooding':
      return 'Flooding'
    case 'road-hazard':
      return 'Road hazard'
    case 'wind-damage':
      return 'Wind damage'
    case 'power-outage':
      return 'Power outage'
    case 'storm-impact':
      return 'Storm impact'
    default:
      return 'Other'
  }
}

function normalizeReportType(value: unknown): CommunityReportType {
  if (typeof value === 'string' && reportTypes.includes(value as CommunityReportType)) {
    return value as CommunityReportType
  }

  return 'other'
}

function scoreZoneMatch(locationHint: string, zone: ZoneRisk): number {
  const normalizedHint = normalizeText(locationHint)
  if (!normalizedHint) {
    return 0
  }

  const normalizedName = normalizeText(zone.name)
  const normalizedNeighborhood = normalizeText(zone.neighborhood)

  if (normalizedHint.includes(normalizedName) || normalizedName.includes(normalizedHint)) {
    return 1
  }

  if (
    normalizedNeighborhood &&
    (normalizedHint.includes(normalizedNeighborhood) || normalizedNeighborhood.includes(normalizedHint))
  ) {
    return 0.82
  }

  const tokens = normalizedHint.split(' ').filter((token) => token.length > 2)
  if (!tokens.length) {
    return 0
  }

  const haystack = `${normalizedName} ${normalizedNeighborhood}`
  const matches = tokens.filter((token) => haystack.includes(token)).length
  return matches / tokens.length
}

function findMatchingZone(
  snapshot: IntelSnapshot,
  zoneId: string | undefined,
  locationHint: string,
): ZoneRisk | undefined {
  if (zoneId) {
    const exact = snapshot.zones.find((zone) => zone.id === zoneId)
    if (exact) {
      return exact
    }
  }

  const rankedZones = snapshot.zones
    .map((zone) => ({ zone, score: scoreZoneMatch(locationHint, zone) }))
    .filter((candidate) => candidate.score >= 0.34)
    .sort((left, right) => right.score - left.score || right.zone.score - left.zone.score)

  return rankedZones[0]?.zone
}

function matchesKeywords(value: string, keywords: string[]): boolean {
  if (keywords.length === 0) {
    return false
  }

  const normalized = normalizeText(value)
  return keywords.some((keyword) => normalized.includes(keyword))
}

function findMatchingAlerts(reportType: CommunityReportType, snapshot: IntelSnapshot): OfficialAlert[] {
  const keywords = reportKeywords[reportType]

  return snapshot.signals.weather.alerts.filter((alert) => {
    const haystack = `${alert.event} ${alert.headline}`

    if (reportType === 'road-hazard') {
      return (
        matchesKeywords(haystack, keywords) ||
        /flood|flash flood|coastal flood|severe thunderstorm/i.test(haystack)
      )
    }

    if (reportType === 'other') {
      return /flood|storm|hurricane|thunderstorm|tornado|surge/i.test(haystack)
    }

    return matchesKeywords(haystack, keywords)
  })
}

function findMatchingIncidents(reportType: CommunityReportType, snapshot: IntelSnapshot): Incident[] {
  return snapshot.incidents.filter((incident) => {
    if (reportType === 'flooding') {
      return incident.category === 'flood'
    }

    if (reportType === 'storm-impact' || reportType === 'wind-damage' || reportType === 'power-outage') {
      return incident.category === 'storm' || incident.category === 'weather'
    }

    if (reportType === 'road-hazard') {
      return incident.category === 'flood' || incident.category === 'weather'
    }

    return true
  })
}

function buildDeterministicVerification(
  input: CommunityReportInput,
  snapshot: IntelSnapshot,
): VerificationDraft {
  const now = new Date().toISOString()
  const matchedZone = findMatchingZone(snapshot, input.zoneId, input.locationHint)
  const matchingAlerts = findMatchingAlerts(input.type, snapshot)
  const matchingIncidents = findMatchingIncidents(input.type, snapshot)
  const supportingSignals: string[] = []
  const sourceLabels = new Set<string>(['BayGuard live snapshot'])
  let score = 18

  if (matchedZone) {
    const zoneWeight = Math.round(12 + matchedZone.score * 22 + threatRank(matchedZone.threatLevel) * 4)
    score += zoneWeight
    supportingSignals.push(
      `${matchedZone.name} is already under ${formatThreat(matchedZone.threatLevel)} watch because ${matchedZone.reason}.`,
    )
    sourceLabels.add('BayGuard zone model')
  }

  if (matchingAlerts.length > 0) {
    score += 24
    supportingSignals.push(
      `Official weather notices already include ${matchingAlerts
        .slice(0, 2)
        .map((alert) => alert.event)
        .join(' and ')} for the Tampa area.`,
    )
    sourceLabels.add('NWS alerts')
  }

  if (matchingIncidents.length > 0) {
    score += 16
    supportingSignals.push(
      `BayGuard is already tracking nearby incident signals such as ${matchingIncidents
        .slice(0, 2)
        .map((incident) => incident.title)
        .join(' and ')}.`,
    )
    sourceLabels.add('BayGuard incident desk')
  }

  switch (input.type) {
    case 'flooding':
      if (snapshot.signals.weather.maxPrecipMmNext12h >= 18 || snapshot.signals.weather.maxPrecipChanceNext12h >= 65) {
        score += 14
        supportingSignals.push(
          `Rain guidance is elevated with up to ${snapshot.signals.weather.maxPrecipMmNext12h.toFixed(1)} mm and ${snapshot.signals.weather.maxPrecipChanceNext12h}% rain odds in the next 12 hours.`,
        )
        sourceLabels.add('NWS forecast')
      }

      if (snapshot.signals.coastal.maxPredictedFtNext24h >= 2 || snapshot.signals.coastal.maxObservedFt >= 1.7) {
        score += 12
        supportingSignals.push(
          `NOAA coastal gauges are peaking near ${snapshot.signals.coastal.maxPredictedFtNext24h.toFixed(2)} ft over the next day.`,
        )
        sourceLabels.add('NOAA CO-OPS')
      }
      break

    case 'road-hazard':
      if (snapshot.signals.weather.maxPrecipChanceNext12h >= 55 || snapshot.signals.weather.maxPrecipMmNext12h >= 12) {
        score += 14
        supportingSignals.push(
          `Heavy-rain conditions could affect streets and underpasses, with ${snapshot.signals.weather.maxPrecipChanceNext12h}% rain odds ahead.`,
        )
        sourceLabels.add('NWS forecast')
      }
      break

    case 'wind-damage':
      if (snapshot.signals.weather.maxWindGustMphNext12h >= 28) {
        score += 20
        supportingSignals.push(
          `Wind guidance is elevated with gusts up to ${snapshot.signals.weather.maxWindGustMphNext12h.toFixed(1)} mph in the next 12 hours.`,
        )
        sourceLabels.add('NWS forecast')
      }
      break

    case 'power-outage':
      if (snapshot.signals.weather.maxWindGustMphNext12h >= 35) {
        score += 18
        supportingSignals.push(
          `Stronger gusts near ${snapshot.signals.weather.maxWindGustMphNext12h.toFixed(1)} mph raise the chance of utility issues.`,
        )
        sourceLabels.add('NWS forecast')
      }
      break

    case 'storm-impact':
      if (snapshot.signals.weather.maxWindGustMphNext12h >= 26 || snapshot.signals.weather.maxPrecipChanceNext12h >= 60) {
        score += 18
        supportingSignals.push(
          `Storm ingredients are active with ${snapshot.signals.weather.maxPrecipChanceNext12h}% rain odds and gusts reaching ${snapshot.signals.weather.maxWindGustMphNext12h.toFixed(1)} mph.`,
        )
        sourceLabels.add('NWS forecast')
      }

      if (snapshot.signals.tropical.activeSystems.length > 0) {
        score += 8
        supportingSignals.push(
          `The tropical desk is tracking ${snapshot.signals.tropical.activeSystems.length} active Atlantic system${snapshot.signals.tropical.activeSystems.length === 1 ? '' : 's'}.`,
        )
        sourceLabels.add('NHC outlook')
      }
      break

    case 'other':
      if (snapshot.signals.weather.alerts.length > 0 || snapshot.incidents.length > 0) {
        score += 10
        supportingSignals.push('BayGuard is already carrying active weather or incident signals that make this report more plausible.')
      }
      break
  }

  const confidence = clampConfidence(score)
  const status: CommunityVerificationStatus =
    confidence >= 78 ? 'confirmed' : confidence >= 54 ? 'likely' : 'unverified'

  const summary =
    status === 'confirmed'
      ? `${formatReportType(input.type)} reports near ${matchedZone?.name ?? input.locationHint} line up with current BayGuard conditions and official signals.`
      : status === 'likely'
        ? `${formatReportType(input.type)} reports near ${matchedZone?.name ?? input.locationHint} are plausible, but BayGuard only has partial live confirmation right now.`
        : `${formatReportType(input.type)} reports near ${matchedZone?.name ?? input.locationHint} are not clearly supported by the live BayGuard signal stack yet.`

  return {
    zoneId: matchedZone?.id,
    zoneName: matchedZone?.name,
    verification: {
      status,
      confidence,
      summary,
      supportingSignals: uniqueStrings(supportingSignals).slice(0, 4),
      sourceLabels: uniqueStrings([...sourceLabels]).slice(0, 5),
      checkedAt: now,
      mode: 'fallback',
    },
  }
}

function normalizeVerificationStatus(value: unknown): CommunityVerificationStatus | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.toLowerCase()
  return normalized === 'confirmed' || normalized === 'likely' || normalized === 'unverified'
    ? normalized
    : null
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

async function maybeGeminiVerification(
  input: CommunityReportInput,
  snapshot: IntelSnapshot,
  heuristic: VerificationDraft,
): Promise<VerificationDraft> {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    return heuristic
  }

  const promptContext = {
    report: {
      type: input.type,
      locationHint: input.locationHint,
      zoneId: heuristic.zoneId ?? input.zoneId ?? null,
      zoneName: heuristic.zoneName ?? null,
      details: input.details,
    },
    overview: snapshot.overview,
    matchingZone: snapshot.zones.find((zone) => zone.id === heuristic.zoneId) ?? null,
    alerts: findMatchingAlerts(input.type, snapshot).slice(0, 3),
    incidents: findMatchingIncidents(input.type, snapshot).slice(0, 3),
    weather: {
      maxPrecipMmNext12h: snapshot.signals.weather.maxPrecipMmNext12h,
      maxPrecipChanceNext12h: snapshot.signals.weather.maxPrecipChanceNext12h,
      maxWindGustMphNext12h: snapshot.signals.weather.maxWindGustMphNext12h,
    },
    coastal: {
      maxObservedFt: snapshot.signals.coastal.maxObservedFt,
      maxPredictedFtNext24h: snapshot.signals.coastal.maxPredictedFtNext24h,
    },
    tropical: {
      basin: snapshot.signals.tropical.basin,
      outlook: snapshot.signals.tropical.outlook,
      activeSystems: snapshot.signals.tropical.activeSystems.length,
    },
    heuristic,
  }

  const prompt = [
    'You are BayGuard, a Tampa community-report verification assistant.',
    'Review the citizen report against the live BayGuard context and decide whether the claim is supported.',
    'Be conservative: only use CONFIRMED when the evidence lines up clearly.',
    `Context: ${JSON.stringify(promptContext).slice(0, 7200)}`,
    'Respond only as JSON in this exact shape:',
    '{',
    '  "status": "confirmed" | "likely" | "unverified",',
    '  "confidence": 0-100,',
    '  "summary": "2-3 sentences, plain English",',
    '  "supportingSignals": ["short evidence bullet", "short evidence bullet"],',
    '  "sourceLabels": ["NWS alerts", "BayGuard zone model"]',
    '}',
  ].join('\n')

  try {
    const ai = new GoogleGenAI({ apiKey })
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
      contents: [{ text: prompt }],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    })

    const parsed = JSON.parse(response.text ?? '{}') as Record<string, unknown>
    const normalizedStatus = normalizeVerificationStatus(parsed.status)
    const confidence =
      typeof parsed.confidence === 'number'
        ? clampConfidence(parsed.confidence)
        : heuristic.verification.confidence
    const summary =
      typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : heuristic.verification.summary
    const supportingSignals = uniqueStrings([
      ...normalizeStringArray(parsed.supportingSignals),
      ...heuristic.verification.supportingSignals,
    ]).slice(0, 4)
    const sourceLabels = uniqueStrings([
      ...normalizeStringArray(parsed.sourceLabels),
      ...heuristic.verification.sourceLabels,
    ]).slice(0, 5)

    return {
      zoneId: heuristic.zoneId,
      zoneName: heuristic.zoneName,
      verification: {
        status: normalizedStatus ?? heuristic.verification.status,
        confidence,
        summary,
        supportingSignals,
        sourceLabels,
        checkedAt: new Date().toISOString(),
        mode: 'gemini',
      },
    }
  } catch {
    return heuristic
  }
}

async function verifyCommunityReport(input: CommunityReportInput): Promise<VerificationDraft> {
  const snapshot = await createIntelSnapshot('live')
  const heuristic = buildDeterministicVerification(input, snapshot)
  return maybeGeminiVerification(input, snapshot, heuristic)
}

function buildRuntimeState(): {
  verificationMode: CommunityReportsState['verificationMode']
  note: string
  zones: ZoneReference[]
} {
  const verificationMode = process.env.GEMINI_API_KEY ? 'gemini' : 'fallback'

  return {
    verificationMode,
    note:
      verificationMode === 'gemini'
        ? 'Gemini is cross-checking community reports against live BayGuard signals and official feeds.'
        : 'Fallback verification is checking reports against live BayGuard signals until Gemini is configured.',
    zones: getZoneCatalog(),
  }
}

function buildStateFromStore(store: CommunityReportStoreData): CommunityReportsState {
  return buildCommunityReportsState(store, buildRuntimeState())
}

export function parseCommunityReportType(value: unknown): CommunityReportType {
  return normalizeReportType(value)
}

export async function getCommunityReportsState(): Promise<CommunityReportsState> {
  const store = await readCommunityReportStore()
  return buildStateFromStore(store)
}

export async function submitCommunityReport(input: CommunityReportInput): Promise<CommunityReportsState> {
  const verified = await verifyCommunityReport(input)
  const now = new Date().toISOString()
  const report: CommunityReport = {
    id: randomUUID(),
    reporterName: input.reporterName?.trim() || 'Community member',
    type: input.type,
    locationHint: input.locationHint.trim(),
    zoneId: verified.zoneId,
    zoneName: verified.zoneName,
    details: input.details.trim(),
    createdAt: now,
    updatedAt: now,
    verification: verified.verification,
  }

  return updateCommunityReportStore((store) => {
    store.reports.unshift(report)
    store.reports = store.reports.slice(0, 40)
    store.meta.lastSubmissionAt = now
    store.meta.lastVerifiedAt = report.verification.checkedAt
    return buildStateFromStore(store)
  })
}

export async function reverifyCommunityReport(id: string): Promise<CommunityReportsState> {
  const store = await readCommunityReportStore()
  const existing = store.reports.find((report) => report.id === id)

  if (!existing) {
    throw new Error('Report not found.')
  }

  const refreshed = await verifyCommunityReport({
    reporterName: existing.reporterName,
    type: existing.type,
    locationHint: existing.locationHint,
    zoneId: existing.zoneId,
    details: existing.details,
  })

  return updateCommunityReportStore((currentStore) => {
    const target = currentStore.reports.find((report) => report.id === id)
    if (!target) {
      throw new Error('Report not found.')
    }

    target.zoneId = refreshed.zoneId
    target.zoneName = refreshed.zoneName
    target.verification = refreshed.verification
    target.updatedAt = new Date().toISOString()
    currentStore.meta.lastVerifiedAt = refreshed.verification.checkedAt

    return buildStateFromStore(currentStore)
  })
}

export async function verifyUnsavedCommunityClaim(input: CommunityReportInput) {
  return verifyCommunityReport(input)
}
