import { GoogleGenAI } from '@google/genai'

import {
  fetchCoastalSignal,
  fetchTropicalSignal,
  fetchWeatherSignal,
} from './data-sources'
import type {
  AgentIntel,
  CoastalSignal,
  Incident,
  IntelOverview,
  IntelSnapshot,
  OfficialAlert,
  SimulationScenario,
  ThreatLevel,
  TropicalSignal,
  WeatherSignal,
  ZoneRisk,
} from '../shared/types'

const LOCATION = {
  name: 'Tampa',
  county: 'Hillsborough County',
  lat: 27.9506,
  lon: -82.4572,
}

const THREAT_LEVELS: ThreatLevel[] = ['low', 'guarded', 'elevated', 'high', 'severe']

const ZONE_TEMPLATES = [
  {
    id: 'downtown',
    name: 'Downtown Tampa Core',
    neighborhood: 'Riverwalk / CBD',
    kind: 'urban' as const,
    lat: 27.9485,
    lon: -82.4604,
    floodBias: 0.45,
    weatherBias: 0.4,
    stormBias: 0.15,
    baseRisk: 0.1,
  },
  {
    id: 'davis-islands',
    name: 'Davis Islands',
    neighborhood: 'South Tampa',
    kind: 'coastal' as const,
    lat: 27.9162,
    lon: -82.4544,
    floodBias: 0.65,
    weatherBias: 0.2,
    stormBias: 0.15,
    baseRisk: 0.16,
  },
  {
    id: 'port',
    name: 'Port Tampa Gateway',
    neighborhood: 'Old Port / Shipping Channel',
    kind: 'coastal' as const,
    lat: 27.8578,
    lon: -82.5528,
    floodBias: 0.6,
    weatherBias: 0.2,
    stormBias: 0.2,
    baseRisk: 0.18,
  },
  {
    id: 'westshore',
    name: 'Westshore Corridor',
    neighborhood: 'Airport / Business District',
    kind: 'evacuation' as const,
    lat: 27.9522,
    lon: -82.5307,
    floodBias: 0.35,
    weatherBias: 0.35,
    stormBias: 0.3,
    baseRisk: 0.08,
  },
  {
    id: 'university',
    name: 'University Area',
    neighborhood: 'Hillsborough River approaches',
    kind: 'river' as const,
    lat: 28.0587,
    lon: -82.4139,
    floodBias: 0.3,
    weatherBias: 0.5,
    stormBias: 0.2,
    baseRisk: 0.05,
  },
]

interface JudgeVerdict {
  headline: string
  summary: string
  threatLevel: ThreatLevel
  confidence: number
  recommendations: string[]
}

function buildAlert(
  id: string,
  event: string,
  severity: string,
  headline: string,
  urgency = 'Immediate',
): OfficialAlert {
  return {
    id,
    event,
    severity,
    urgency,
    headline,
    effective: new Date().toISOString(),
    ends: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
  }
}

function simulationMeta(scenario: SimulationScenario) {
  switch (scenario) {
    case 'flood':
      return {
        label: 'Flood drill',
        description: 'Simulates intense rainfall plus elevated coastal water for flood-response testing.',
      }
    case 'hurricane':
      return {
        label: 'Hurricane drill',
        description: 'Simulates an approaching hurricane with surge, wind, and tropical advisories.',
      }
    case 'compound':
      return {
        label: 'Compound-event drill',
        description: 'Simulates a worst-case overlap of hurricane wind, surge, and urban flooding.',
      }
    default:
      return {
        label: 'Live feeds',
        description: 'Uses the live Tampa NWS, NOAA, and NHC data adapters.',
      }
  }
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)))
}

function scoreToThreat(score: number): ThreatLevel {
  if (score >= 0.85) {
    return 'severe'
  }
  if (score >= 0.68) {
    return 'high'
  }
  if (score >= 0.45) {
    return 'elevated'
  }
  if (score >= 0.22) {
    return 'guarded'
  }
  return 'low'
}

function scoreToAgentStatus(score: number): AgentIntel['status'] {
  if (score >= 0.85) {
    return 'critical'
  }
  if (score >= 0.58) {
    return 'alert'
  }
  if (score >= 0.28) {
    return 'watch'
  }
  return 'nominal'
}

function severityScore(severity: string): number {
  switch (severity.toLowerCase()) {
    case 'extreme':
      return 1
    case 'severe':
      return 0.88
    case 'moderate':
      return 0.68
    case 'minor':
      return 0.42
    default:
      return 0.32
  }
}

function thresholdScore(value: number, thresholds: Array<[number, number]>): number {
  return thresholds.reduce((score, [threshold, level]) => (value >= threshold ? level : score), 0)
}

function buildWeatherAgent(snapshot: Awaited<ReturnType<typeof fetchWeatherSignal>>): AgentIntel {
  const alertScore = snapshot.alerts.reduce((peak, alert) => Math.max(peak, severityScore(alert.severity)), 0)
  const rainScore = thresholdScore(snapshot.maxPrecipMmNext12h, [
    [3, 0.18],
    [10, 0.36],
    [25, 0.58],
    [50, 0.82],
  ])
  const popScore = thresholdScore(snapshot.maxPrecipChanceNext12h, [
    [20, 0.05],
    [40, 0.12],
    [60, 0.2],
    [80, 0.28],
  ])
  const windScore = thresholdScore(snapshot.maxWindGustMphNext12h, [
    [20, 0.18],
    [35, 0.42],
    [50, 0.72],
    [70, 0.92],
  ])

  const score = clamp(Math.max(alertScore, rainScore + popScore, windScore))
  const headline =
    snapshot.alerts[0]?.event ??
    (windScore > rainScore
      ? 'Wind and convection watch'
      : snapshot.maxPrecipMmNext12h > 0
        ? 'Rainfall watch'
        : 'Stable convective pattern')

  const summary =
    snapshot.alerts.length > 0
      ? `NWS ${snapshot.office} has ${snapshot.alerts.length} active official alert${snapshot.alerts.length > 1 ? 's' : ''} for Tampa.`
      : `Next-12-hour rainfall guidance peaks near ${snapshot.maxPrecipMmNext12h} mm with ${snapshot.maxPrecipChanceNext12h}% precipitation odds and gusts up to ${snapshot.maxWindGustMphNext12h} mph.`

  const recommendedActions = [
    snapshot.maxPrecipChanceNext12h >= 50 ? 'Pre-stage traffic messaging for ponding-prone corridors.' : '',
    snapshot.maxWindGustMphNext12h >= 35 ? 'Protect portable signage and field teams from gust exposure.' : '',
    snapshot.alerts.length > 0 ? 'Mirror active NWS wording into the public alert banner.' : '',
  ]

  return {
    id: 'weather',
    name: 'Weather Bot',
    role: 'Fuses NWS alerts, hourly forecast periods, rainfall probability, and wind gust guidance.',
    status: scoreToAgentStatus(score),
    score: round(score),
    headline,
    summary,
    evidence: unique([
      `NWS office: ${snapshot.office}`,
      `Official alerts: ${snapshot.alerts.length}`,
      `Peak rainfall next 12h: ${snapshot.maxPrecipMmNext12h} mm`,
      `Peak gust next 12h: ${snapshot.maxWindGustMphNext12h} mph`,
      snapshot.forecastSummary[0] ? `Immediate pattern: ${snapshot.forecastSummary.join(', ')}` : '',
    ]),
    recommendedActions: unique(recommendedActions),
    sourceLabels: ['NWS alerts', 'NWS hourly forecast', 'NWS gridpoint forecast'],
  }
}

function buildFloodAgent(
  coastal: Awaited<ReturnType<typeof fetchCoastalSignal>>,
  weather: Awaited<ReturnType<typeof fetchWeatherSignal>>,
): AgentIntel {
  const floodAlertScore = weather.alerts
    .filter((alert) => /(flood|storm surge|coastal)/i.test(alert.event))
    .reduce((peak, alert) => Math.max(peak, severityScore(alert.severity)), 0)

  const tideScore = thresholdScore(coastal.maxPredictedFtNext24h, [
    [2.0, 0.22],
    [2.3, 0.42],
    [2.7, 0.66],
    [3.1, 0.86],
  ])

  const observedScore = thresholdScore(coastal.maxObservedFt, [
    [1.8, 0.12],
    [2.1, 0.22],
    [2.4, 0.34],
  ])

  const rainCoupling = thresholdScore(weather.maxPrecipMmNext12h, [
    [10, 0.08],
    [25, 0.16],
    [50, 0.24],
  ])

  const score = clamp(Math.max(floodAlertScore, tideScore + observedScore + rainCoupling))
  const headline =
    floodAlertScore > 0
      ? 'Official flood-related alert in force'
      : coastal.maxPredictedFtNext24h >= 2.3
        ? 'Coastal water level watch'
        : 'Drainage and bayfront monitoring'

  const highestStation = coastal.stations.reduce(
    (current, station) =>
      station.maxPredictedFtNext24h > current.maxPredictedFtNext24h ? station : current,
    coastal.stations[0],
  )

  return {
    id: 'flood',
    name: 'Flood Bot',
    role: 'Tracks NOAA coastal water levels and couples them with near-term rain loading.',
    status: scoreToAgentStatus(score),
    score: round(score),
    headline,
    summary: `${highestStation.name} is the highest coastal signal right now with ${highestStation.latestObservedFt} ft observed and ${highestStation.maxPredictedFtNext24h} ft forecast over the next 24 hours.`,
    evidence: unique([
      `Peak observed coastal level: ${coastal.maxObservedFt} ft`,
      `Peak predicted coastal level: ${coastal.maxPredictedFtNext24h} ft`,
      `Flood-related official alerts: ${weather.alerts.filter((alert) => /(flood|storm surge|coastal)/i.test(alert.event)).length}`,
      weather.maxPrecipMmNext12h > 0 ? `Rainfall coupling signal: ${weather.maxPrecipMmNext12h} mm` : '',
    ]),
    recommendedActions: unique([
      coastal.maxPredictedFtNext24h >= 2.3 ? 'Inspect low-lying bayfront routes and trouble drains before the next tide cycle.' : '',
      weather.maxPrecipMmNext12h >= 10 ? 'Pair tide timing with rainfall windows for neighborhood flood messaging.' : '',
      floodAlertScore > 0 ? 'Escalate localized flood watch language in South Tampa and port-adjacent zones.' : '',
    ]),
    sourceLabels: ['NOAA CO-OPS water level', 'NOAA CO-OPS tide predictions'],
  }
}

function buildStormAgent(
  tropical: Awaited<ReturnType<typeof fetchTropicalSignal>>,
  weather: Awaited<ReturnType<typeof fetchWeatherSignal>>,
): AgentIntel {
  const officialStormAlertScore = weather.alerts
    .filter((alert) => /(hurricane|tropical storm|storm surge)/i.test(alert.event))
    .reduce((peak, alert) => Math.max(peak, severityScore(alert.severity)), 0)

  const activeSystemScore = tropical.activeSystems.length > 0 ? 0.85 : 0
  const outlookScore =
    /not expected during the next 7 days|season runs from/i.test(tropical.outlook) ? 0.06 : 0.42

  const score = clamp(Math.max(officialStormAlertScore, activeSystemScore, outlookScore))
  const headline =
    tropical.activeSystems[0]?.title ??
    (officialStormAlertScore > 0 ? 'Official tropical alert in force' : 'Atlantic basin monitor')

  return {
    id: 'storm',
    name: 'Storm Bot',
    role: 'Monitors National Hurricane Center Atlantic outlooks and storm advisories.',
    status: scoreToAgentStatus(score),
    score: round(score),
    headline,
    summary:
      tropical.activeSystems.length > 0
        ? `${tropical.activeSystems.length} active Atlantic advisory item${tropical.activeSystems.length > 1 ? 's are' : ' is'} being tracked by the hurricane desk.`
        : tropical.outlook,
    evidence: unique([
      `Active Atlantic systems: ${tropical.activeSystems.length}`,
      `Official tropical alerts: ${weather.alerts.filter((alert) => /(hurricane|tropical storm|storm surge)/i.test(alert.event)).length}`,
      tropical.outlook ? `NHC outlook: ${tropical.outlook.slice(0, 140)}${tropical.outlook.length > 140 ? '…' : ''}` : '',
    ]),
    recommendedActions: unique([
      tropical.activeSystems.length > 0 ? 'Stage executive briefing language around tropical track uncertainty.' : '',
      officialStormAlertScore > 0 ? 'Shift the dashboard into storm ops mode and verify evacuation route messaging.' : '',
      score <= 0.1 ? 'Keep the storm desk in passive monitoring until NHC activity resumes.' : '',
    ]),
    sourceLabels: ['National Hurricane Center outlook', 'National Hurricane Center Atlantic advisories'],
  }
}

function fallbackJudge(
  weather: AgentIntel,
  flood: AgentIntel,
  storm: AgentIntel,
): JudgeVerdict {
  const weighted = weather.score * 0.34 + flood.score * 0.42 + storm.score * 0.24
  const emphasis = Math.max(weather.score, flood.score, storm.score) * 0.88
  const score = clamp(Math.max(weighted, emphasis))
  const threatLevel = scoreToThreat(score)

  const dominant =
    flood.score >= weather.score && flood.score >= storm.score
      ? 'coastal water and drainage'
      : weather.score >= storm.score
        ? 'rainfall and wind'
        : 'Atlantic tropical monitoring'

  const summary =
    threatLevel === 'low'
      ? 'No official hazards are active for Tampa, so BayGuard stays in quiet monitoring mode while keeping coastal, rainfall, and tropical sensors online.'
      : `BayGuard is prioritizing ${dominant} signals for Tampa and will escalate if the next weather cycle strengthens.`

  return {
    headline:
      threatLevel === 'low'
        ? 'Quiet watch over Tampa'
        : threatLevel === 'guarded'
          ? 'Guarded monitoring posture'
          : threatLevel === 'elevated'
            ? 'Elevated hazard watch'
            : threatLevel === 'high'
              ? 'High-priority operational alert'
              : 'Severe citywide alert posture',
    summary,
    threatLevel,
    confidence: round(clamp(0.62 + score * 0.28 + (weather.score > 0.5 ? 0.04 : 0)), 2),
    recommendations: unique([
      ...flood.recommendedActions,
      ...weather.recommendedActions,
      ...storm.recommendedActions,
      threatLevel === 'low' ? 'Maintain passive monitoring and refresh the dashboard every few minutes.' : '',
    ]).slice(0, 5),
  }
}

async function maybeRunGeminiJudge(
  fallback: JudgeVerdict,
  weather: AgentIntel,
  flood: AgentIntel,
  storm: AgentIntel,
): Promise<JudgeVerdict | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return null
  }

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
  const ai = new GoogleGenAI({ apiKey })

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          text: [
            'You are the final decision judge for a Tampa disaster monitoring dashboard.',
            'Use only the evidence provided.',
            'Choose one threat level from: low, guarded, elevated, high, severe.',
            'Return strict JSON with keys: headline, summary, threatLevel, confidence, recommendations.',
            'Confidence must be a number between 0 and 1.',
            'Keep the summary under 60 words.',
            `Fallback verdict: ${JSON.stringify(fallback)}`,
            `Weather agent: ${JSON.stringify(weather)}`,
            `Flood agent: ${JSON.stringify(flood)}`,
            `Storm agent: ${JSON.stringify(storm)}`,
          ].join('\n'),
        },
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    })

    const text = response.text
    if (!text) {
      return null
    }

    const parsed = JSON.parse(text) as Partial<JudgeVerdict>
    const fallbackIndex = THREAT_LEVELS.indexOf(fallback.threatLevel)
    const chosenThreat = THREAT_LEVELS.includes(parsed.threatLevel as ThreatLevel)
      ? (parsed.threatLevel as ThreatLevel)
      : fallback.threatLevel
    const chosenIndex = THREAT_LEVELS.indexOf(chosenThreat)
    const boundedThreat =
      Math.abs(chosenIndex - fallbackIndex) <= 1 ? chosenThreat : fallback.threatLevel

    return {
      headline: parsed.headline?.trim() || fallback.headline,
      summary: parsed.summary?.trim() || fallback.summary,
      threatLevel: boundedThreat,
      confidence: round(clamp(Number(parsed.confidence ?? fallback.confidence), 0.55, 0.99), 2),
      recommendations:
        Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0
          ? unique(parsed.recommendations.map((item) => String(item)).slice(0, 5))
          : fallback.recommendations,
    }
  } catch {
    return null
  }
}

function buildIncidents(weather: AgentIntel, flood: AgentIntel, storm: AgentIntel): Incident[] {
  const incidents: Incident[] = []

  if (flood.score >= 0.45) {
    incidents.push({
      id: 'flood-watch',
      title: flood.headline,
      category: 'flood',
      severity: scoreToThreat(flood.score),
      status: flood.score >= 0.68 ? 'warning' : 'active',
      lat: 27.9162,
      lon: -82.4544,
      description: flood.summary,
      recommendation:
        flood.recommendedActions[0] ?? 'Inspect low-lying streets and stormwater chokepoints.',
      source: 'NOAA CO-OPS',
    })
  }

  if (weather.score >= 0.45) {
    incidents.push({
      id: 'weather-watch',
      title: weather.headline,
      category: 'weather',
      severity: scoreToThreat(weather.score),
      status: weather.score >= 0.68 ? 'warning' : 'active',
      lat: 27.9485,
      lon: -82.4604,
      description: weather.summary,
      recommendation:
        weather.recommendedActions[0] ?? 'Prepare traffic and field teams for sharp weather changes.',
      source: 'NWS TBW',
    })
  }

  if (storm.score >= 0.45) {
    incidents.push({
      id: 'storm-watch',
      title: storm.headline,
      category: 'storm',
      severity: scoreToThreat(storm.score),
      status: storm.score >= 0.68 ? 'warning' : 'active',
      lat: 27.8578,
      lon: -82.5528,
      description: storm.summary,
      recommendation:
        storm.recommendedActions[0] ?? 'Brief leadership on tropical positioning and confidence bands.',
      source: 'NHC Atlantic',
    })
  }

  return incidents
}

function buildZones(weather: AgentIntel, flood: AgentIntel, storm: AgentIntel): ZoneRisk[] {
  return ZONE_TEMPLATES.map((zone) => {
    const score = clamp(
      zone.baseRisk +
        flood.score * zone.floodBias +
        weather.score * zone.weatherBias +
        storm.score * zone.stormBias,
    )

    const dominant =
      zone.floodBias >= zone.weatherBias && zone.floodBias >= zone.stormBias
        ? 'coastal and drainage exposure'
        : zone.weatherBias >= zone.stormBias
          ? 'rainfall and street runoff sensitivity'
          : 'storm routing importance'

    return {
      id: zone.id,
      name: zone.name,
      neighborhood: zone.neighborhood,
      kind: zone.kind,
      lat: zone.lat,
      lon: zone.lon,
      score: round(score),
      threatLevel: scoreToThreat(score),
      reason: `${zone.name} carries elevated ${dominant} compared with the citywide baseline.`,
    }
  })
}

function buildJudgeAgent(verdict: JudgeVerdict, mode: 'gemini' | 'fallback', model?: string): AgentIntel {
  return {
    id: 'judge',
    name: mode === 'gemini' ? 'Gemini Command Judge' : 'BayGuard Guardrail Judge',
    role: 'Makes the final citywide decision by reconciling weather, flood, and tropical evidence.',
    status: scoreToAgentStatus(
      THREAT_LEVELS.indexOf(verdict.threatLevel) / (THREAT_LEVELS.length - 1),
    ),
    score: round(THREAT_LEVELS.indexOf(verdict.threatLevel) / (THREAT_LEVELS.length - 1)),
    headline: verdict.headline,
    summary: verdict.summary,
    evidence: unique([
      `Decision mode: ${mode === 'gemini' ? `Gemini (${model ?? 'configured model'})` : 'Deterministic guardrails'}`,
      `Chosen threat level: ${verdict.threatLevel}`,
      `Confidence: ${verdict.confidence}`,
    ]),
    recommendedActions: verdict.recommendations,
    sourceLabels:
      mode === 'gemini'
        ? ['Gemini orchestration', 'NWS', 'NOAA CO-OPS', 'NHC']
        : ['BayGuard fallback orchestration', 'NWS', 'NOAA CO-OPS', 'NHC'],
  }
}

function buildOverview(verdict: JudgeVerdict, mode: 'gemini' | 'fallback'): IntelOverview {
  return {
    threatLevel: verdict.threatLevel,
    headline: verdict.headline,
    summary: verdict.summary,
    confidence: verdict.confidence,
    monitoringMode:
      mode === 'gemini'
        ? 'Gemini is synthesizing the final alert posture with deterministic guardrails.'
        : 'Guardrail mode is active until a Gemini API key is configured.',
  }
}

function applySimulation(
  weather: WeatherSignal,
  coastal: CoastalSignal,
  tropical: TropicalSignal,
  scenario: SimulationScenario,
) {
  const now = new Date().toISOString()

  if (scenario === 'live') {
    return { weatherSignal: weather, coastalSignal: coastal, tropicalSignal: tropical }
  }

  if (scenario === 'flood') {
    return {
      weatherSignal: {
        ...weather,
        updatedAt: now,
        forecastSummary: ['Torrential Rain', 'Flash Flood Warning', 'Coastal Flood Advisory'],
        hourly: weather.hourly.map((period, index) => ({
          ...period,
          shortForecast: index < 4 ? 'Heavy Rain and Thunderstorms' : 'Flooding Downpours',
          precipitationChance: Math.max(74, 100 - index * 3),
        })),
        maxPrecipMmNext12h: 92,
        maxPrecipChanceNext12h: 98,
        maxWindGustMphNext12h: 42,
        alerts: [
          buildAlert(
            'sim-flood-warning',
            'Flash Flood Warning',
            'Severe',
            'Simulation: Flash flooding is impacting low-lying parts of Tampa.',
          ),
          buildAlert(
            'sim-coastal-flood',
            'Coastal Flood Advisory',
            'Moderate',
            'Simulation: Elevated bay water is slowing drainage in South Tampa.',
          ),
        ],
      },
      coastalSignal: {
        ...coastal,
        updatedAt: now,
        maxObservedFt: 3.08,
        maxPredictedFtNext24h: 3.74,
        stations: coastal.stations.map((station, index) => ({
          ...station,
          observedAt: now,
          latestObservedFt: [3.08, 2.96, 2.81][index] ?? 2.88,
          maxPredictedFtNext24h: [3.74, 3.61, 3.48][index] ?? 3.5,
        })),
      },
      tropicalSignal: {
        ...tropical,
        updatedAt: now,
        activeSystems: [],
        outlook:
          'Simulation mode: flood impacts are being driven by training rain bands and coastal water back-up rather than an active tropical cyclone.',
      },
    }
  }

  if (scenario === 'hurricane') {
    return {
      weatherSignal: {
        ...weather,
        updatedAt: now,
        forecastSummary: ['Hurricane Conditions', 'Outer Rain Bands', 'Storm Surge Threat'],
        hourly: weather.hourly.map((period, index) => ({
          ...period,
          shortForecast: index < 6 ? 'Hurricane Force Wind and Rain' : 'Bands of Heavy Rain',
          precipitationChance: Math.max(82, 100 - index * 2),
        })),
        maxPrecipMmNext12h: 138,
        maxPrecipChanceNext12h: 100,
        maxWindGustMphNext12h: 96,
        alerts: [
          buildAlert(
            'sim-hurricane-warning',
            'Hurricane Warning',
            'Extreme',
            'Simulation: Hurricane conditions are expected in Tampa within hours.',
          ),
          buildAlert(
            'sim-surge-warning',
            'Storm Surge Warning',
            'Extreme',
            'Simulation: Life-threatening storm surge is possible along Tampa Bay.',
          ),
        ],
      },
      coastalSignal: {
        ...coastal,
        updatedAt: now,
        maxObservedFt: 4.28,
        maxPredictedFtNext24h: 5.46,
        stations: coastal.stations.map((station, index) => ({
          ...station,
          observedAt: now,
          latestObservedFt: [4.28, 4.02, 3.94][index] ?? 4.1,
          maxPredictedFtNext24h: [5.46, 5.11, 4.88][index] ?? 5.02,
        })),
      },
      tropicalSignal: {
        ...tropical,
        updatedAt: now,
        activeSystems: [
          {
            title: 'Simulation: Hurricane Zara Advisory 18',
            link: 'https://www.nhc.noaa.gov/',
            publishedAt: now,
          },
        ],
        outlook:
          'Simulation mode: Hurricane Zara is moving through the eastern Gulf with destructive wind and dangerous storm surge aimed toward Tampa Bay.',
      },
    }
  }

  return {
    weatherSignal: {
      ...weather,
      updatedAt: now,
      forecastSummary: ['Extreme Surge', 'Flash Flooding', 'Hurricane Core Impacts'],
      hourly: weather.hourly.map((period, index) => ({
        ...period,
        shortForecast: index < 8 ? 'Hurricane Core with Extreme Rain' : 'Catastrophic Flooding',
        precipitationChance: 100,
      })),
      maxPrecipMmNext12h: 224,
      maxPrecipChanceNext12h: 100,
      maxWindGustMphNext12h: 114,
      alerts: [
        buildAlert(
          'sim-compound-hurricane',
          'Hurricane Warning',
          'Extreme',
          'Simulation: Catastrophic hurricane conditions are expected across Tampa.',
        ),
        buildAlert(
          'sim-compound-flood',
          'Flash Flood Warning',
          'Extreme',
          'Simulation: Significant life-threatening flooding is underway in the urban core.',
        ),
        buildAlert(
          'sim-compound-surge',
          'Storm Surge Warning',
          'Extreme',
          'Simulation: Dangerous bay surge threatens South Tampa and port approaches.',
        ),
      ],
    },
    coastalSignal: {
      ...coastal,
      updatedAt: now,
      maxObservedFt: 5.18,
      maxPredictedFtNext24h: 6.34,
      stations: coastal.stations.map((station, index) => ({
        ...station,
        observedAt: now,
        latestObservedFt: [5.18, 4.82, 4.69][index] ?? 4.9,
        maxPredictedFtNext24h: [6.34, 5.98, 5.76][index] ?? 5.92,
      })),
    },
    tropicalSignal: {
      ...tropical,
      updatedAt: now,
      activeSystems: [
        {
          title: 'Simulation: Major Hurricane Zara Advisory 22',
          link: 'https://www.nhc.noaa.gov/',
          publishedAt: now,
        },
      ],
      outlook:
        'Simulation mode: a major hurricane is driving overlapping storm surge, extreme rainfall, and citywide wind impacts into Tampa Bay.',
    },
  }
}

export async function createIntelSnapshot(scenario: SimulationScenario = 'live'): Promise<IntelSnapshot> {
  const [liveWeatherSignal, liveCoastalSignal, liveTropicalSignal] = await Promise.all([
    fetchWeatherSignal(),
    fetchCoastalSignal(),
    fetchTropicalSignal(),
  ])

  const { weatherSignal, coastalSignal, tropicalSignal } = applySimulation(
    liveWeatherSignal,
    liveCoastalSignal,
    liveTropicalSignal,
    scenario,
  )

  const weatherAgent = buildWeatherAgent(weatherSignal)
  const floodAgent = buildFloodAgent(coastalSignal, weatherSignal)
  const stormAgent = buildStormAgent(tropicalSignal, weatherSignal)

  const fallback = fallbackJudge(weatherAgent, floodAgent, stormAgent)
  const geminiVerdict = await maybeRunGeminiJudge(fallback, weatherAgent, floodAgent, stormAgent)
  const finalVerdict = geminiVerdict ?? fallback
  const mode = geminiVerdict ? 'gemini' : 'fallback'
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
  const judgeAgent = buildJudgeAgent(finalVerdict, mode, mode === 'gemini' ? model : undefined)

  return {
    generatedAt: new Date().toISOString(),
    location: LOCATION,
    simulation: {
      scenario,
      ...simulationMeta(scenario),
      isSimulated: scenario !== 'live',
    },
    orchestrator: {
      mode,
      model: mode === 'gemini' ? model : undefined,
      judgeName: judgeAgent.name,
    },
    overview: buildOverview(finalVerdict, mode),
    agents: [weatherAgent, floodAgent, stormAgent, judgeAgent],
    incidents: buildIncidents(weatherAgent, floodAgent, stormAgent),
    zones: buildZones(weatherAgent, floodAgent, stormAgent),
    recommendations: finalVerdict.recommendations,
    sources: [
      {
        name: 'NWS API',
        url: 'https://www.weather.gov/documentation/services-web-api',
        updatedAt: weatherSignal.updatedAt,
      },
      {
        name: 'NOAA CO-OPS API',
        url: 'https://api.tidesandcurrents.noaa.gov/api/prod/',
        updatedAt: coastalSignal.updatedAt,
      },
      {
        name: 'NHC Atlantic Outlook',
        url: 'https://www.nhc.noaa.gov/gtwo.xml',
        updatedAt: tropicalSignal.updatedAt,
      },
    ],
    signals: {
      weather: weatherSignal,
      coastal: coastalSignal,
      tropical: tropicalSignal,
    },
  }
}
