export type ThreatLevel = 'low' | 'guarded' | 'elevated' | 'high' | 'severe'

export type AgentStatus = 'nominal' | 'watch' | 'alert' | 'critical'

export type SimulationScenario = 'live' | 'flood' | 'hurricane' | 'compound'

export type SmsProvider = 'mock' | 'twilio' | 'textbelt'

export type SmsAlertType = 'general' | 'flood' | 'storm' | 'weather'

export type SmsDispatchStatus = 'mocked' | 'sent' | 'skipped' | 'failed'

export type CommunityReportType =
  | 'flooding'
  | 'road-hazard'
  | 'wind-damage'
  | 'power-outage'
  | 'storm-impact'
  | 'other'

export type CommunityVerificationStatus = 'confirmed' | 'likely' | 'unverified'

export interface LocationInfo {
  name: string
  county: string
  lat: number
  lon: number
}

export interface OfficialAlert {
  id: string
  event: string
  severity: string
  urgency: string
  headline: string
  effective?: string
  ends?: string
}

export interface HourlyPeriod {
  startTime: string
  temperature: number
  shortForecast: string
  precipitationChance: number | null
}

export interface WeatherSignal {
  updatedAt: string
  office: string
  forecastSummary: string[]
  hourly: HourlyPeriod[]
  maxPrecipMmNext12h: number
  maxPrecipChanceNext12h: number
  maxWindGustMphNext12h: number
  alerts: OfficialAlert[]
}

export interface CoastalStationSignal {
  stationId: string
  name: string
  lat: number
  lon: number
  latestObservedFt: number
  observedAt: string
  maxPredictedFtNext24h: number
}

export interface CoastalSignal {
  updatedAt: string
  stations: CoastalStationSignal[]
  maxObservedFt: number
  maxPredictedFtNext24h: number
}

export interface TropicalSystemSignal {
  title: string
  link: string
  publishedAt?: string
}

export interface TropicalSignal {
  updatedAt: string
  basin: string
  outlook: string
  activeSystems: TropicalSystemSignal[]
}

export interface TrafficIncidentSignal {
  id: string
  title: string
  lat: number
  lon: number
  category: 'closure' | 'incident' | 'flood' | 'construction' | 'other'
  roadName?: string
  severity?: string
  updatedAt?: string
}

export interface TrafficSignal {
  updatedAt: string
  provider: 'fl511'
  enabled: boolean
  note: string
  incidents: TrafficIncidentSignal[]
}

export interface UtilityOutageIncidentSignal {
  id: string
  lat: number
  lon: number
  customerCount: number
  status?: string
  reason?: string
  estimatedTimeOfRestoration?: string
  updatedAt?: string
}

export interface UtilityOutageSignal {
  updatedAt: string
  provider: 'teco'
  note: string
  totalOutages: number
  incidents: UtilityOutageIncidentSignal[]
}

export interface EvacuationZoneAssignment {
  zoneId: string
  zoneName: string
  zoneCode?: string
}

export interface EvacuationSignal {
  updatedAt: string
  provider: 'hillsborough'
  note: string
  assignments: EvacuationZoneAssignment[]
}

export interface AgentIntel {
  id: 'weather' | 'flood' | 'storm' | 'judge'
  name: string
  role: string
  status: AgentStatus
  score: number
  headline: string
  summary: string
  evidence: string[]
  recommendedActions: string[]
  sourceLabels: string[]
}

export interface Incident {
  id: string
  title: string
  category: 'flood' | 'storm' | 'weather'
  severity: ThreatLevel
  status: 'monitoring' | 'active' | 'warning'
  lat: number
  lon: number
  description: string
  recommendation: string
  source: string
}

export interface ZoneRisk {
  id: string
  name: string
  neighborhood: string
  kind: 'coastal' | 'urban' | 'river' | 'evacuation'
  lat: number
  lon: number
  score: number
  threatLevel: ThreatLevel
  reason: string
}

export interface ZoneReference {
  id: string
  name: string
  neighborhood: string
  kind: ZoneRisk['kind']
  lat: number
  lon: number
}

export interface SourceRef {
  name: string
  url: string
  updatedAt?: string
}

export interface IntelOverview {
  threatLevel: ThreatLevel
  headline: string
  summary: string
  confidence: number
  monitoringMode: string
}

export interface IntelSnapshot {
  generatedAt: string
  location: LocationInfo
  simulation: {
    scenario: SimulationScenario
    label: string
    description: string
    isSimulated: boolean
  }
  orchestrator: {
    mode: 'gemini' | 'fallback'
    model?: string
    judgeName: string
  }
  overview: IntelOverview
  agents: AgentIntel[]
  incidents: Incident[]
  zones: ZoneRisk[]
  recommendations: string[]
  sources: SourceRef[]
  signals: {
    weather: WeatherSignal
    coastal: CoastalSignal
    tropical: TropicalSignal
  }
}

export interface SmsSubscriber {
  id: string
  name: string
  phoneMasked: string
  minThreatLevel: ThreatLevel
  alertTypes: SmsAlertType[]
  isActive: boolean
  createdAt: string
  updatedAt: string
  lastAlertAt?: string
}

export interface SmsDispatchRecord {
  id: string
  scenario: SimulationScenario
  headline: string
  threatLevel: ThreatLevel
  categories: SmsAlertType[]
  createdAt: string
  recipientCount: number
  deliveredCount: number
  failedCount: number
  provider: SmsProvider
  status: SmsDispatchStatus
  messagePreview: string
  reason: string
}

export interface SmsCenterState {
  provider: SmsProvider
  sendMode: 'dry-run' | 'live'
  schedulerEnabled: boolean
  evaluationIntervalMinutes: number
  cooldownMinutes: number
  note: string
  subscribers: SmsSubscriber[]
  recentDispatches: SmsDispatchRecord[]
  lastEvaluationAt?: string
  lastSuccessfulSendAt?: string
}

export interface SmsSubscribeInput {
  name?: string
  phone: string
  minThreatLevel: ThreatLevel
  alertTypes: SmsAlertType[]
}

export interface SmsDispatchRequest {
  scenario?: SimulationScenario
  force?: boolean
}

export interface SmsDispatchResult {
  outcome: SmsDispatchStatus
  reason: string
  provider: SmsProvider
  recipients: number
  deliveredCount: number
  failedCount: number
  event?: SmsDispatchRecord
}

export interface EvacuationPlan {
  address: string
  stormCategory: number
  floodZone: 'A' | 'B' | 'C' | 'Unknown'
  status: 'normal' | 'watch' | 'evacuate'
  mustEvacuate: boolean
  reason: string
  shelter: {
    name: string
    address: string
  } | null
  steps: string[]
  supplies: string[]
  mode: 'gemini' | 'fallback'
}

export interface CommunityReportVerification {
  status: CommunityVerificationStatus
  confidence: number
  summary: string
  supportingSignals: string[]
  sourceLabels: string[]
  checkedAt: string
  mode: 'gemini' | 'fallback'
}

export interface CommunityReport {
  id: string
  reporterName: string
  type: CommunityReportType
  locationHint: string
  zoneId?: string
  zoneName?: string
  details: string
  createdAt: string
  updatedAt: string
  verification: CommunityReportVerification
}

export interface CommunityReportInput {
  reporterName?: string
  type: CommunityReportType
  locationHint: string
  zoneId?: string
  details: string
}

export interface CommunityReportsState {
  verificationMode: 'gemini' | 'fallback'
  note: string
  stats: {
    totalReports: number
    confirmedCount: number
    likelyCount: number
    unverifiedCount: number
  }
  zones: ZoneReference[]
  reports: CommunityReport[]
  lastSubmissionAt?: string
  lastVerifiedAt?: string
}
