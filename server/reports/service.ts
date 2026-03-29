import { randomUUID } from 'node:crypto'

import { GoogleGenAI } from '@google/genai'

import { createIntelSnapshot, getZoneCatalog } from '../orchestrator.js'
import {
  fetchEvacuationSignal,
  fetchTrafficSignal,
  fetchUtilityOutageSignal,
} from '../data-sources.js'
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
  EvacuationSignal,
  EvacuationZoneAssignment,
  Incident,
  IntelSnapshot,
  OfficialAlert,
  TrafficIncidentSignal,
  TrafficSignal,
  ThreatLevel,
  UtilityOutageIncidentSignal,
  UtilityOutageSignal,
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

const evacuationClaimKeywords = [
  'evacuate',
  'evacuation',
  'mandatory evacuation',
  'shelter in place',
  'evac order',
] as const

const hurricaneClaimKeywords = [
  'hurricane',
  'tropical storm',
  'storm surge',
  'category 1',
  'category 2',
  'category 3',
  'category 4',
  'category 5',
] as const

const tornadoClaimKeywords = ['tornado', 'twister', 'funnel cloud'] as const
const powerClaimKeywords = ['power outage', 'blackout', 'no power', 'transformer', 'downed line'] as const
const floodingClaimKeywords = ['flood', 'flooding', 'under water', 'standing water', 'ponding'] as const

interface VerificationDraft {
  zoneId?: string
  zoneName?: string
  verification: CommunityReport['verification']
}

interface ClaimFlags {
  mentionsEvacuation: boolean
  mentionsHurricane: boolean
  mentionsTornado: boolean
  mentionsPowerOutage: boolean
  mentionsFlooding: boolean
}

interface VerificationSignalContext {
  matchedZone: ZoneRisk | undefined
  matchingAlerts: OfficialAlert[]
  matchingIncidents: Incident[]
  nearbyTrafficIncidents: TrafficIncidentSignal[]
  nearbyOutages: UtilityOutageIncidentSignal[]
  matchedEvacuationZone: EvacuationZoneAssignment | undefined
  trafficEnabled: boolean
  totalUtilityOutages: number
  claimFlags: ClaimFlags
  hasOfficialStormSupport: boolean
  hasOfficialEvacuationSupport: boolean
  hasStrongRainSupport: boolean
  hasModerateRainSupport: boolean
  hasStrongWindSupport: boolean
  hasModerateWindSupport: boolean
  hasStrongCoastalSupport: boolean
  hasModerateCoastalSupport: boolean
}

interface ReportSupplementalSignals {
  traffic: TrafficSignal
  outages: UtilityOutageSignal
  evacuation: EvacuationSignal
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

function verificationStatusForConfidence(confidence: number): CommunityVerificationStatus {
  return confidence >= 82 ? 'confirmed' : confidence >= 62 ? 'likely' : 'unverified'
}

function zoneSignalWeightForReportType(type: CommunityReportType): number {
  switch (type) {
    case 'flooding':
    case 'road-hazard':
      return 1
    case 'wind-damage':
      return 0.7
    case 'power-outage':
      return 0.2
    case 'storm-impact':
      return 0.34
    default:
      return 0.3
  }
}

function normalizeReportType(value: unknown): CommunityReportType {
  if (typeof value === 'string' && reportTypes.includes(value as CommunityReportType)) {
    return value as CommunityReportType
  }

  return 'other'
}

function includesAnyPhrase(value: string, phrases: readonly string[]): boolean {
  const normalized = normalizeText(value)
  return phrases.some((phrase) => normalized.includes(normalizeText(phrase)))
}

function deriveClaimFlags(input: CommunityReportInput): ClaimFlags {
  const claimText = `${input.locationHint} ${input.details}`

  return {
    mentionsEvacuation: includesAnyPhrase(claimText, evacuationClaimKeywords),
    mentionsHurricane: includesAnyPhrase(claimText, hurricaneClaimKeywords),
    mentionsTornado: includesAnyPhrase(claimText, tornadoClaimKeywords),
    mentionsPowerOutage:
      input.type === 'power-outage' || includesAnyPhrase(claimText, powerClaimKeywords),
    mentionsFlooding: input.type === 'flooding' || includesAnyPhrase(claimText, floodingClaimKeywords),
  }
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

function alertsInclude(snapshot: IntelSnapshot, pattern: RegExp): boolean {
  return snapshot.signals.weather.alerts.some((alert) =>
    pattern.test(`${alert.event} ${alert.headline}`),
  )
}

function distanceKm(
  leftLat: number,
  leftLon: number,
  rightLat: number,
  rightLon: number,
): number {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadiusKm = 6371
  const deltaLat = toRadians(rightLat - leftLat)
  const deltaLon = toRadians(rightLon - leftLon)
  const originLat = toRadians(leftLat)
  const destinationLat = toRadians(rightLat)
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(originLat) * Math.cos(destinationLat) * Math.sin(deltaLon / 2) ** 2

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function incidentProximityScore(incident: Incident, zone: ZoneRisk | undefined): number {
  if (!zone) {
    return incident.status === 'warning' ? 0.55 : 0.35
  }

  const km = distanceKm(zone.lat, zone.lon, incident.lat, incident.lon)

  if (km <= 4) {
    return 1
  }

  if (km <= 8) {
    return 0.78
  }

  if (km <= 14) {
    return 0.42
  }

  return 0
}

function findMatchingIncidents(
  reportType: CommunityReportType,
  snapshot: IntelSnapshot,
  zone: ZoneRisk | undefined,
): Incident[] {
  return snapshot.incidents
    .filter((incident) => {
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
    .map((incident) => ({ incident, score: incidentProximityScore(incident, zone) }))
    .filter((candidate) => candidate.score >= 0.5)
    .sort((left, right) => right.score - left.score)
    .map((candidate) => candidate.incident)
}

function findNearbyTrafficIncidents(
  input: CommunityReportInput,
  traffic: TrafficSignal,
  zone: ZoneRisk | undefined,
): TrafficIncidentSignal[] {
  if (!traffic.enabled) {
    return []
  }

  const normalizedHint = normalizeText(input.locationHint)

  return traffic.incidents
    .filter((incident) => {
      const nearZone =
        zone !== undefined && distanceKm(zone.lat, zone.lon, incident.lat, incident.lon) <= 8
      const textMatch =
        normalizedHint.length > 0 &&
        normalizeText(`${incident.title} ${incident.roadName ?? ''}`).includes(normalizedHint)

      if (input.type === 'road-hazard') {
        return incident.category !== 'other' && (nearZone || textMatch)
      }

      return nearZone || textMatch
    })
    .sort((left, right) => {
      if (!zone) {
        return 0
      }

      return (
        distanceKm(zone.lat, zone.lon, left.lat, left.lon) -
        distanceKm(zone.lat, zone.lon, right.lat, right.lon)
      )
    })
}

function findNearbyOutages(
  outages: UtilityOutageSignal,
  zone: ZoneRisk | undefined,
): UtilityOutageIncidentSignal[] {
  if (!zone) {
    return []
  }

  return outages.incidents
    .filter((outage) => distanceKm(zone.lat, zone.lon, outage.lat, outage.lon) <= 7)
    .sort(
      (left, right) =>
        distanceKm(zone.lat, zone.lon, left.lat, left.lon) -
        distanceKm(zone.lat, zone.lon, right.lat, right.lon),
    )
}

function buildVerificationSignalContext(
  input: CommunityReportInput,
  snapshot: IntelSnapshot,
  zoneId: string | undefined,
  supplemental: ReportSupplementalSignals,
): VerificationSignalContext {
  const matchedZone = findMatchingZone(snapshot, zoneId, input.locationHint)
  const matchingAlerts = findMatchingAlerts(input.type, snapshot)
  const matchingIncidents = findMatchingIncidents(input.type, snapshot, matchedZone)
  const claimFlags = deriveClaimFlags(input)
  const nearbyTrafficIncidents = findNearbyTrafficIncidents(input, supplemental.traffic, matchedZone)
  const nearbyOutages = findNearbyOutages(supplemental.outages, matchedZone)
  const weather = snapshot.signals.weather
  const coastal = snapshot.signals.coastal

  return {
    matchedZone,
    matchingAlerts,
    matchingIncidents,
    nearbyTrafficIncidents,
    nearbyOutages,
    matchedEvacuationZone: matchedZone
      ? supplemental.evacuation.assignments.find((assignment) => assignment.zoneId === matchedZone.id)
      : undefined,
    trafficEnabled: supplemental.traffic.enabled,
    totalUtilityOutages: supplemental.outages.totalOutages,
    claimFlags,
    hasOfficialStormSupport: alertsInclude(
      snapshot,
      /hurricane|tropical storm|storm surge|tornado|severe thunderstorm/i,
    ),
    hasOfficialEvacuationSupport: alertsInclude(
      snapshot,
      /evacuat|hurricane warning|storm surge warning|mandatory/i,
    ),
    hasStrongRainSupport:
      weather.maxPrecipMmNext12h >= 18 || weather.maxPrecipChanceNext12h >= 70,
    hasModerateRainSupport:
      weather.maxPrecipMmNext12h >= 10 || weather.maxPrecipChanceNext12h >= 50,
    hasStrongWindSupport: weather.maxWindGustMphNext12h >= 38,
    hasModerateWindSupport: weather.maxWindGustMphNext12h >= 28,
    hasStrongCoastalSupport:
      coastal.maxPredictedFtNext24h >= 2.2 || coastal.maxObservedFt >= 1.9,
    hasModerateCoastalSupport:
      coastal.maxPredictedFtNext24h >= 1.8 || coastal.maxObservedFt >= 1.5,
  }
}

function deriveGeminiConfidenceCap(
  input: CommunityReportInput,
  snapshot: IntelSnapshot,
  heuristic: VerificationDraft,
  context: VerificationSignalContext,
): number {
  let cap = 100
  const weather = snapshot.signals.weather
  const tropical = snapshot.signals.tropical
  const lowEvidence =
    context.matchingAlerts.length === 0 &&
    context.matchingIncidents.length === 0 &&
    !context.hasModerateRainSupport &&
    !context.hasModerateWindSupport &&
    !context.hasModerateCoastalSupport

  if (lowEvidence) {
    cap = Math.min(cap, context.matchedZone ? 40 : 26)
  }

  switch (input.type) {
    case 'flooding':
      if (
        context.claimFlags.mentionsFlooding &&
        context.matchingAlerts.length === 0 &&
        !context.hasModerateCoastalSupport &&
        !context.hasModerateRainSupport
      ) {
        cap = Math.min(cap, 42)
      }
      break

    case 'road-hazard':
      if (
        !context.hasStrongRainSupport &&
        context.matchingAlerts.length === 0 &&
        context.matchingIncidents.length === 0 &&
        context.nearbyTrafficIncidents.length === 0
      ) {
        cap = Math.min(cap, context.trafficEnabled ? 28 : 44)
      }
      break

    case 'wind-damage':
      if (
        !context.hasModerateWindSupport &&
        context.matchingAlerts.length === 0 &&
        context.matchingIncidents.length === 0
      ) {
        cap = Math.min(cap, 38)
      }
      break

    case 'power-outage':
      if (context.nearbyOutages.length > 0) {
        break
      }

      if (context.totalUtilityOutages === 0) {
        cap = Math.min(cap, 14)
      } else if (
        weather.maxWindGustMphNext12h < 32 &&
        context.matchingAlerts.length === 0 &&
        context.matchingIncidents.length === 0
      ) {
        cap = Math.min(cap, 22)
      }
      break

    case 'storm-impact':
      if (
        context.claimFlags.mentionsHurricane &&
        !context.hasOfficialStormSupport &&
        tropical.activeSystems.length === 0
      ) {
        cap = Math.min(cap, 24)
      }

      if (context.claimFlags.mentionsEvacuation && !context.hasOfficialEvacuationSupport) {
        cap = Math.min(cap, 18)
      }

      if (context.claimFlags.mentionsEvacuation && !context.matchedEvacuationZone?.zoneCode) {
        cap = Math.min(cap, 12)
      }

      if (
        context.claimFlags.mentionsTornado &&
        !alertsInclude(snapshot, /tornado|severe thunderstorm/i) &&
        weather.maxWindGustMphNext12h < 45
      ) {
        cap = Math.min(cap, 28)
      }

      if (
        context.matchingAlerts.length === 0 &&
        context.matchingIncidents.length === 0 &&
        !context.hasStrongWindSupport &&
        !context.hasStrongRainSupport
      ) {
        cap = Math.min(cap, 38)
      }

      if (
        context.nearbyTrafficIncidents.length === 0 &&
        context.trafficEnabled &&
        context.claimFlags.mentionsEvacuation
      ) {
        cap = Math.min(cap, 18)
      }
      break

    case 'other':
      if (context.matchingAlerts.length === 0 && context.matchingIncidents.length === 0) {
        cap = Math.min(cap, 40)
      }
      break
  }

  const heuristicBuffer =
    heuristic.verification.status === 'confirmed'
      ? 12
      : heuristic.verification.status === 'likely'
        ? 10
        : heuristic.verification.confidence >= 45
          ? 10
          : 6

  return Math.min(cap, heuristic.verification.confidence + heuristicBuffer)
}

function buildDeterministicVerification(
  input: CommunityReportInput,
  snapshot: IntelSnapshot,
  supplemental: ReportSupplementalSignals,
): VerificationDraft {
  const now = new Date().toISOString()
  const context = buildVerificationSignalContext(input, snapshot, input.zoneId, supplemental)
  const {
    matchedZone,
    matchingAlerts,
    matchingIncidents,
    nearbyTrafficIncidents,
    nearbyOutages,
    matchedEvacuationZone,
    trafficEnabled,
    totalUtilityOutages,
    claimFlags,
    hasOfficialStormSupport,
    hasOfficialEvacuationSupport,
    hasStrongRainSupport,
    hasModerateRainSupport,
    hasStrongWindSupport,
    hasModerateWindSupport,
    hasStrongCoastalSupport,
    hasModerateCoastalSupport,
  } = context
  const positiveSignals: string[] = []
  const cautionSignals: string[] = []
  const sourceLabels = new Set<string>(['BayGuard live snapshot'])
  let score = 6
  let confidenceCap = 100

  const weather = snapshot.signals.weather
  const coastal = snapshot.signals.coastal
  const tropical = snapshot.signals.tropical

  if (matchedZone) {
    const zoneWeight = Math.round(
      (6 + matchedZone.score * 14 + threatRank(matchedZone.threatLevel) * 3) *
        zoneSignalWeightForReportType(input.type),
    )
    score += zoneWeight
    positiveSignals.push(
      `${matchedZone.name} is already under ${formatThreat(matchedZone.threatLevel)} watch because ${matchedZone.reason}.`,
    )
    sourceLabels.add('BayGuard zone model')
  }

  if (matchingAlerts.length > 0) {
    score += 24
    positiveSignals.push(
      `Official weather notices already include ${matchingAlerts
        .slice(0, 2)
        .map((alert) => alert.event)
        .join(' and ')} for the Tampa area.`,
    )
    sourceLabels.add('NWS alerts')
  }

  if (matchingIncidents.length > 0) {
    score += Math.round(8 + matchingIncidents.length * 2)
    positiveSignals.push(
      `BayGuard is already tracking nearby incident signals such as ${matchingIncidents
        .slice(0, 2)
        .map((incident) => incident.title)
        .join(' and ')}.`,
    )
    sourceLabels.add('BayGuard alerts')
  }

  switch (input.type) {
    case 'flooding':
      if (hasStrongRainSupport) {
        score += 14
        positiveSignals.push(
          `Rain guidance is elevated with up to ${weather.maxPrecipMmNext12h.toFixed(1)} mm and ${weather.maxPrecipChanceNext12h}% rain odds in the next 12 hours.`,
        )
        sourceLabels.add('NWS forecast')
      } else if (!matchingAlerts.length && !matchingIncidents.length && !hasModerateRainSupport) {
        score -= 10
        cautionSignals.push('Rainfall support is weak right now, so there is not much weather evidence behind this flooding claim.')
      }

      if (hasStrongCoastalSupport) {
        score += 12
        positiveSignals.push(
          `NOAA coastal gauges are peaking near ${coastal.maxPredictedFtNext24h.toFixed(2)} ft over the next day.`,
        )
        sourceLabels.add('NOAA CO-OPS')
      } else if (claimFlags.mentionsFlooding && !matchingAlerts.length && !hasModerateCoastalSupport && !hasModerateRainSupport) {
        score -= 8
        confidenceCap = Math.min(confidenceCap, 42)
        cautionSignals.push('BayGuard does not see stronger rain or coastal flooding conditions that would usually support a flooding report here.')
      }
      break

    case 'road-hazard':
      if (nearbyTrafficIncidents.length > 0) {
        score += 18
        positiveSignals.push(
          `Florida 511 is already showing nearby road issues such as ${nearbyTrafficIncidents
            .slice(0, 2)
            .map((incident) => incident.title)
            .join(' and ')}.`,
        )
        sourceLabels.add('Florida 511')
      }

      if (hasStrongRainSupport) {
        score += 14
        positiveSignals.push(
          `Heavy-rain conditions could affect streets and underpasses, with ${weather.maxPrecipChanceNext12h}% rain odds ahead.`,
        )
        sourceLabels.add('NWS forecast')
      } else if (!matchingAlerts.length && !matchingIncidents.length && nearbyTrafficIncidents.length === 0) {
        score -= 8
        confidenceCap = Math.min(confidenceCap, trafficEnabled ? 28 : 44)
        cautionSignals.push(
          trafficEnabled
            ? 'Florida 511 is not showing a nearby road closure or hazard, and rain support is weak right now.'
            : 'There is not much rain or recent road-related evidence supporting a road hazard report right now.',
        )
        if (trafficEnabled) {
          sourceLabels.add('Florida 511')
        }
      }
      break

    case 'wind-damage':
      if (hasStrongWindSupport) {
        score += 20
        positiveSignals.push(
          `Wind guidance is elevated with gusts up to ${weather.maxWindGustMphNext12h.toFixed(1)} mph in the next 12 hours.`,
        )
        sourceLabels.add('NWS forecast')
      } else if (hasModerateWindSupport) {
        score += 6
        positiveSignals.push(`Winds are somewhat elevated, with gusts reaching ${weather.maxWindGustMphNext12h.toFixed(1)} mph.`)
        sourceLabels.add('NWS forecast')
      } else {
        score -= 14
        confidenceCap = Math.min(confidenceCap, 38)
        cautionSignals.push('Winds are not strong enough right now to strongly support a damage report.')
      }
      break

    case 'power-outage':
      if (nearbyOutages.length > 0) {
        const impactedCustomers = nearbyOutages.reduce(
          (total, outage) => total + Math.max(1, outage.customerCount),
          0,
        )
        if (impactedCustomers >= 10) {
          score += impactedCustomers >= 50 ? 28 : 16
          positiveSignals.push(
            `Tampa Electric is showing ${impactedCustomers} affected customer${impactedCustomers === 1 ? '' : 's'} near ${matchedZone?.name ?? input.locationHint}.`,
          )
        } else if (impactedCustomers >= 3) {
          score += 8
          positiveSignals.push(
            `Tampa Electric is showing a small nearby outage cluster affecting ${impactedCustomers} customers near ${matchedZone?.name ?? input.locationHint}.`,
          )
        } else {
          score += 1
          cautionSignals.push(
            `Tampa Electric is showing only ${impactedCustomers} nearby customer outage${impactedCustomers === 1 ? '' : 's'}, which is not enough to support a large-area outage claim by itself.`,
          )
        }
        sourceLabels.add('TECO outage map')
      }

      if (weather.maxWindGustMphNext12h >= 42) {
        score += 18
        positiveSignals.push(
          `Stronger gusts near ${weather.maxWindGustMphNext12h.toFixed(1)} mph raise the chance of utility issues.`,
        )
        sourceLabels.add('NWS forecast')
      } else if (weather.maxWindGustMphNext12h >= 32) {
        score += 8
        positiveSignals.push(
          `Moderately strong winds near ${weather.maxWindGustMphNext12h.toFixed(1)} mph could create scattered utility issues.`,
        )
        sourceLabels.add('NWS forecast')
      } else if (nearbyOutages.length === 0) {
        score -= 16
        confidenceCap = Math.min(confidenceCap, totalUtilityOutages === 0 ? 14 : 22)
        cautionSignals.push(
          totalUtilityOutages === 0
            ? 'Tampa Electric is not showing active outages right now, and BayGuard does not see strong utility-related evidence behind this report.'
            : 'Tampa Electric shows outages elsewhere, but not near this location right now.',
        )
        sourceLabels.add('TECO outage map')
      }
      break

    case 'storm-impact':
      if (hasStrongWindSupport || hasStrongRainSupport) {
        score += 18
        positiveSignals.push(
          `Storm ingredients are active with ${weather.maxPrecipChanceNext12h}% rain odds and gusts reaching ${weather.maxWindGustMphNext12h.toFixed(1)} mph.`,
        )
        sourceLabels.add('NWS forecast')
      } else if (hasModerateWindSupport || hasModerateRainSupport) {
        score += 6
        positiveSignals.push('Some storm ingredients are present, but they are not especially strong right now.')
        sourceLabels.add('NWS forecast')
      } else {
        score -= 12
        cautionSignals.push('Current wind and rain conditions are too light to strongly support a major storm-impact report.')
      }

      if (tropical.activeSystems.length > 0) {
        score += 8
        positiveSignals.push(
          `The Atlantic outlook is tracking ${tropical.activeSystems.length} active system${tropical.activeSystems.length === 1 ? '' : 's'}.`,
        )
        sourceLabels.add('NHC outlook')
      }

      if (claimFlags.mentionsHurricane && !hasOfficialStormSupport && tropical.activeSystems.length === 0) {
        score -= 24
        confidenceCap = Math.min(confidenceCap, 24)
        cautionSignals.push('BayGuard does not see an active hurricane or tropical warning supporting this claim.')
        sourceLabels.add('NHC outlook')
      }

      if (claimFlags.mentionsEvacuation && !hasOfficialEvacuationSupport) {
        score -= 30
        confidenceCap = Math.min(confidenceCap, 18)
        cautionSignals.push('There is no evacuation order or storm-surge warning active for Tampa right now.')
        sourceLabels.add('NWS alerts')
      }

      if (claimFlags.mentionsEvacuation) {
        if (matchedEvacuationZone?.zoneCode) {
          if (hasOfficialStormSupport) {
            score += ['A', 'B'].includes(matchedEvacuationZone.zoneCode) ? 8 : 4
          }
          positiveSignals.push(
            `${matchedZone?.name ?? input.locationHint} falls within official Hillsborough evacuation zone ${matchedEvacuationZone.zoneCode}.`,
          )
          sourceLabels.add('Hillsborough evacuation zones')
        } else {
          score -= 8
          confidenceCap = Math.min(confidenceCap, 12)
          cautionSignals.push('BayGuard could not match this location to an official Hillsborough evacuation zone.')
          sourceLabels.add('Hillsborough evacuation zones')
        }
      }

      if (claimFlags.mentionsTornado && !alertsInclude(snapshot, /tornado|severe thunderstorm/i) && weather.maxWindGustMphNext12h < 45) {
        score -= 18
        confidenceCap = Math.min(confidenceCap, 28)
        cautionSignals.push('BayGuard does not see tornado warnings or severe storm evidence supporting that kind of claim right now.')
        sourceLabels.add('NWS alerts')
      }

      if (nearbyTrafficIncidents.length > 0) {
        score += 8
        positiveSignals.push(
          `Nearby travel disruptions are already appearing in Florida 511, including ${nearbyTrafficIncidents
            .slice(0, 2)
            .map((incident) => incident.title)
            .join(' and ')}.`,
        )
        sourceLabels.add('Florida 511')
      } else if (trafficEnabled && claimFlags.mentionsEvacuation) {
        cautionSignals.push('Florida 511 is not showing a nearby travel disruption that would usually accompany an evacuation order.')
        sourceLabels.add('Florida 511')
      }

      if (!matchingAlerts.length && !matchingIncidents.length && !hasStrongWindSupport && !hasStrongRainSupport) {
        confidenceCap = Math.min(confidenceCap, 38)
      }
      break

    case 'other':
      if (weather.alerts.length > 0 || snapshot.incidents.length > 0) {
        score += 10
        positiveSignals.push('There are already active weather or local alerts that make this report somewhat more plausible.')
      } else {
        score -= 6
        confidenceCap = Math.min(confidenceCap, 40)
      }
      break
  }

  if (!matchingAlerts.length && !matchingIncidents.length && !hasModerateRainSupport && !hasModerateWindSupport && !hasModerateCoastalSupport) {
    confidenceCap = Math.min(confidenceCap, matchedZone ? 40 : 26)
  }

  const confidence = Math.min(clampConfidence(score), confidenceCap)
  const status = verificationStatusForConfidence(confidence)

  const evidenceTrail =
    status === 'unverified'
      ? [...cautionSignals, ...positiveSignals]
      : [...positiveSignals, ...cautionSignals]
  const primaryCaution = cautionSignals[0]

  const summary =
    status === 'confirmed'
      ? `${formatReportType(input.type)} reports near ${matchedZone?.name ?? input.locationHint} line up with current BayGuard conditions and official signals.`
      : status === 'likely'
        ? `${formatReportType(input.type)} reports near ${matchedZone?.name ?? input.locationHint} are plausible, but BayGuard only has partial live confirmation right now.`
        : primaryCaution
          ? `${formatReportType(input.type)} reports near ${matchedZone?.name ?? input.locationHint} are not clearly supported right now. ${primaryCaution}`
          : `${formatReportType(input.type)} reports near ${matchedZone?.name ?? input.locationHint} are not clearly supported by current conditions yet.`

  return {
    zoneId: matchedZone?.id,
    zoneName: matchedZone?.name,
    verification: {
      status,
      confidence,
      summary,
      supportingSignals: uniqueStrings(evidenceTrail).slice(0, 4),
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
  supplemental: ReportSupplementalSignals,
): Promise<VerificationDraft> {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    return heuristic
  }

  const context = buildVerificationSignalContext(
    input,
    snapshot,
    heuristic.zoneId ?? input.zoneId,
    supplemental,
  )

  const promptContext = {
    report: {
      type: input.type,
      locationHint: input.locationHint,
      zoneId: heuristic.zoneId ?? input.zoneId ?? null,
      zoneName: heuristic.zoneName ?? null,
      details: input.details,
    },
    claimFlags: context.claimFlags,
    overview: snapshot.overview,
    matchingZone: context.matchedZone ?? null,
    alerts: context.matchingAlerts.slice(0, 3),
    incidents: context.matchingIncidents.slice(0, 3),
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
    traffic: {
      enabled: context.trafficEnabled,
      nearbyIncidents: context.nearbyTrafficIncidents.slice(0, 3),
    },
    outages: {
      totalUtilityOutages: context.totalUtilityOutages,
      nearbyOutages: context.nearbyOutages.slice(0, 3),
    },
    evacuation: {
      matchedZoneCode: context.matchedEvacuationZone?.zoneCode ?? null,
    },
    heuristic,
  }

  const prompt = [
    'You are BayGuard, a Tampa community-report verification assistant.',
    'Review the citizen report against the live BayGuard context and decide whether the claim is supported.',
    'Be conservative: only use CONFIRMED when the evidence lines up clearly.',
    'If a report mentions evacuations, hurricanes, tornadoes, or other severe impacts without matching official alerts or strong live support, keep the result UNVERIFIED and keep confidence low.',
    'Do not treat a matched neighborhood by itself as strong evidence. A location match only proves where the report was filed, not whether the claim is true.',
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
    const heuristicCap = deriveGeminiConfidenceCap(input, snapshot, heuristic, context)
    const confidence = Math.min(
      heuristicCap,
      typeof parsed.confidence === 'number'
        ? clampConfidence(parsed.confidence)
        : heuristic.verification.confidence,
    )
    const boundedStatus = verificationStatusForConfidence(confidence)
    const summary =
      normalizedStatus === boundedStatus &&
      typeof parsed.summary === 'string' &&
      parsed.summary.trim().length > 0
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
        status: boundedStatus,
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

function buildFallbackSupplementalSignals(): ReportSupplementalSignals {
  return {
    traffic: {
      updatedAt: new Date().toISOString(),
      provider: 'fl511',
      enabled: false,
      note: 'Florida 511 traffic verification is unavailable right now.',
      incidents: [],
    },
    outages: {
      updatedAt: new Date().toISOString(),
      provider: 'teco',
      note: 'Utility outage verification is unavailable right now.',
      totalOutages: 0,
      incidents: [],
    },
    evacuation: {
      updatedAt: new Date().toISOString(),
      provider: 'hillsborough',
      note: 'Evacuation zone lookup is unavailable right now.',
      assignments: [],
    },
  }
}

async function verifyCommunityReport(input: CommunityReportInput): Promise<VerificationDraft> {
  const [snapshot, trafficResult, outageResult, evacuationResult] = await Promise.all([
    createIntelSnapshot('live'),
    fetchTrafficSignal().catch(() => buildFallbackSupplementalSignals().traffic),
    fetchUtilityOutageSignal().catch(() => buildFallbackSupplementalSignals().outages),
    fetchEvacuationSignal(getZoneCatalog()).catch(() => buildFallbackSupplementalSignals().evacuation),
  ])

  const supplemental: ReportSupplementalSignals = {
    traffic: trafficResult,
    outages: outageResult,
    evacuation: evacuationResult,
  }

  const heuristic = buildDeterministicVerification(input, snapshot, supplemental)
  return maybeGeminiVerification(input, snapshot, heuristic, supplemental)
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
        ? 'BayGuard is comparing reports with live weather, water, outage, evacuation-zone, and available traffic signals.'
        : 'BayGuard is comparing reports with live weather, water, outage, evacuation-zone, and available traffic signals.',
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

export async function deleteCommunityReport(id: string): Promise<CommunityReportsState> {
  return updateCommunityReportStore((store) => {
    const reportIndex = store.reports.findIndex((report) => report.id === id)

    if (reportIndex === -1) {
      throw new Error('Report not found.')
    }

    store.reports.splice(reportIndex, 1)
    return buildStateFromStore(store)
  })
}

export async function verifyUnsavedCommunityClaim(input: CommunityReportInput) {
  return verifyCommunityReport(input)
}
