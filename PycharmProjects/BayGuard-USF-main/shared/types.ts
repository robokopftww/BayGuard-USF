export type ThreatLevel = 'low' | 'guarded' | 'elevated' | 'high' | 'severe'

export type AgentStatus = 'nominal' | 'watch' | 'alert' | 'critical'

export type SimulationScenario = 'live' | 'flood' | 'hurricane' | 'compound'

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
