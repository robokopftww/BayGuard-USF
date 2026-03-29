import { GoogleGenAI } from '@google/genai'

import {
  fetchCoastalSignal,
  fetchTropicalSignal,
  fetchWeatherSignal,
} from './data-sources.js'
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
} from '../shared/types.js'

const LOCATION = {
  name: 'Tampa',
  county: 'Hillsborough County',
  lat: 27.9506,
  lon: -82.4572,
}

const THREAT_LEVELS: ThreatLevel[] = ['low', 'guarded', 'elevated', 'high', 'severe']

interface ZoneTemplate {
  id: string
  name: string
  neighborhood: string
  kind: ZoneRisk['kind']
  lat: number
  lon: number
  floodBias: number
  weatherBias: number
  stormBias: number
  baseRisk: number
  floodProfile: string
  weatherProfile: string
  stormProfile: string
}

const ZONE_TEMPLATES: ZoneTemplate[] = [
  {
    id: 'downtown',
    name: 'Downtown Tampa Core',
    neighborhood: 'Riverwalk / CBD',
    kind: 'urban',
    lat: 27.9485,
    lon: -82.4604,
    floodBias: 0.45,
    weatherBias: 0.4,
    stormBias: 0.15,
    baseRisk: 0.1,
    floodProfile: 'dense streets, drainage chokepoints, and riverfront runoff',
    weatherProfile: 'high foot traffic, street flooding risk, and exposed intersections',
    stormProfile: 'downtown high-rise wind exposure and core evacuation flow',
  },
  {
    id: 'channelside',
    name: 'Channelside / Water Street',
    neighborhood: 'Harborfront',
    kind: 'coastal',
    lat: 27.9431,
    lon: -82.4496,
    floodBias: 0.62,
    weatherBias: 0.24,
    stormBias: 0.14,
    baseRisk: 0.14,
    floodProfile: 'waterfront access roads and low-lying blocks near the port approach',
    weatherProfile: 'slick streets and heavy runoff near event and residential towers',
    stormProfile: 'bayfront wind exposure and visitor movement near the harbor',
  },
  {
    id: 'ybor',
    name: 'Ybor City',
    neighborhood: 'Historic District',
    kind: 'urban',
    lat: 27.9608,
    lon: -82.4362,
    floodBias: 0.4,
    weatherBias: 0.42,
    stormBias: 0.18,
    baseRisk: 0.09,
    floodProfile: 'older drainage, brick corridors, and quick street ponding',
    weatherProfile: 'dense nightlife streets and runoff around older blocks',
    stormProfile: 'event traffic shifts and wind exposure along open corridors',
  },
  {
    id: 'davis-islands',
    name: 'Davis Islands',
    neighborhood: 'South Tampa',
    kind: 'coastal',
    lat: 27.9162,
    lon: -82.4544,
    floodBias: 0.65,
    weatherBias: 0.2,
    stormBias: 0.15,
    baseRisk: 0.16,
    floodProfile: 'bayfront roads, seawall-adjacent blocks, and low-lying island access',
    weatherProfile: 'localized heavy rain over residential streets and marinas',
    stormProfile: 'coastal wind exposure and route constraints on and off the islands',
  },
  {
    id: 'hyde-park',
    name: 'Hyde Park / Bayshore',
    neighborhood: 'Bayshore Boulevard',
    kind: 'coastal',
    lat: 27.9318,
    lon: -82.4886,
    floodBias: 0.58,
    weatherBias: 0.24,
    stormBias: 0.18,
    baseRisk: 0.12,
    floodProfile: 'bayfront lanes, low-lying neighborhood streets, and shoreline runoff',
    weatherProfile: 'ponding-prone intersections and high-traffic neighborhood routes',
    stormProfile: 'wind exposure along the waterfront and evacuation-sensitive corridors',
  },
  {
    id: 'port',
    name: 'Port Tampa Gateway',
    neighborhood: 'Old Port / Shipping Channel',
    kind: 'coastal',
    lat: 27.8578,
    lon: -82.5528,
    floodBias: 0.6,
    weatherBias: 0.2,
    stormBias: 0.2,
    baseRisk: 0.18,
    floodProfile: 'port access roads, industrial drainage, and shipping-channel surge pressure',
    weatherProfile: 'heavy rain over freight routes and exposed logistics yards',
    stormProfile: 'storm routing importance near port operations and shoreline assets',
  },
  {
    id: 'westshore',
    name: 'Westshore Corridor',
    neighborhood: 'Airport / Business District',
    kind: 'evacuation',
    lat: 27.9522,
    lon: -82.5307,
    floodBias: 0.35,
    weatherBias: 0.35,
    stormBias: 0.3,
    baseRisk: 0.08,
    floodProfile: 'arterial roads, parking lots, and airport-adjacent runoff',
    weatherProfile: 'business-district travel disruption and roadway ponding',
    stormProfile: 'airport corridor travel reliability and evacuation traffic sensitivity',
  },
  {
    id: 'rocky-point',
    name: 'Rocky Point',
    neighborhood: 'Causeway / Bay Hotels',
    kind: 'coastal',
    lat: 27.9656,
    lon: -82.5719,
    floodBias: 0.63,
    weatherBias: 0.18,
    stormBias: 0.19,
    baseRisk: 0.14,
    floodProfile: 'causeway access, shoreline parking, and hotel district drainage',
    weatherProfile: 'travel disruption along the causeway during heavy rain',
    stormProfile: 'bay-exposed structures and water-adjacent access routes',
  },
  {
    id: 'seminole-heights',
    name: 'Seminole Heights',
    neighborhood: 'Central North Tampa',
    kind: 'urban',
    lat: 27.9955,
    lon: -82.4703,
    floodBias: 0.36,
    weatherBias: 0.42,
    stormBias: 0.22,
    baseRisk: 0.08,
    floodProfile: 'older drainage paths and neighborhood street ponding',
    weatherProfile: 'convective downpours over dense local streets and intersections',
    stormProfile: 'tree-lined streets and localized wind impact pockets',
  },
  {
    id: 'east-tampa',
    name: 'East Tampa',
    neighborhood: 'Adamo / 40th Street',
    kind: 'urban',
    lat: 27.9652,
    lon: -82.4147,
    floodBias: 0.38,
    weatherBias: 0.4,
    stormBias: 0.22,
    baseRisk: 0.07,
    floodProfile: 'flat urban runoff zones and industrial-adjacent drainage',
    weatherProfile: 'street flooding and reduced visibility on major connectors',
    stormProfile: 'wind-sensitive road network and utility exposure',
  },
  {
    id: 'sulphur-springs',
    name: 'Sulphur Springs',
    neighborhood: 'Hillsborough River bend',
    kind: 'river',
    lat: 28.0116,
    lon: -82.4565,
    floodBias: 0.42,
    weatherBias: 0.33,
    stormBias: 0.25,
    baseRisk: 0.09,
    floodProfile: 'river-adjacent runoff, creek paths, and low-lying residential streets',
    weatherProfile: 'heavy rain over neighborhoods near the river basin',
    stormProfile: 'storm runoff and river response overlap during strong systems',
  },
  {
    id: 'university',
    name: 'University Area',
    neighborhood: 'Hillsborough River approaches',
    kind: 'river',
    lat: 28.0587,
    lon: -82.4139,
    floodBias: 0.3,
    weatherBias: 0.5,
    stormBias: 0.2,
    baseRisk: 0.05,
    floodProfile: 'creeks, ponds, and fast-changing campus-adjacent drainage',
    weatherProfile: 'high rainfall sensitivity across dense residential and campus traffic',
    stormProfile: 'storm-routing importance for major north Tampa travel corridors',
  },
  {
    id: 'temple-terrace',
    name: 'Temple Terrace',
    neighborhood: 'River hills and campus edge',
    kind: 'river',
    lat: 28.0364,
    lon: -82.3896,
    floodBias: 0.34,
    weatherBias: 0.42,
    stormBias: 0.24,
    baseRisk: 0.06,
    floodProfile: 'river approaches, neighborhood creeks, and drainage retention areas',
    weatherProfile: 'downpours over tree-lined residential streets and local connectors',
    stormProfile: 'wind pockets around open parkways and river-adjacent neighborhoods',
  },
  {
    id: 'town-n-country',
    name: "Town 'N' Country",
    neighborhood: 'Northwest Tampa',
    kind: 'urban',
    lat: 27.9976,
    lon: -82.5773,
    floodBias: 0.37,
    weatherBias: 0.39,
    stormBias: 0.24,
    baseRisk: 0.07,
    floodProfile: 'broad paved corridors, retention systems, and heavy runoff streets',
    weatherProfile: 'street flooding risk along busy northwest corridors',
    stormProfile: 'wind-sensitive power and transport routes toward the bay',
  },
  {
    id: 'new-tampa',
    name: 'New Tampa',
    neighborhood: 'Northeast suburban edge',
    kind: 'river',
    lat: 28.1375,
    lon: -82.3528,
    floodBias: 0.28,
    weatherBias: 0.48,
    stormBias: 0.24,
    baseRisk: 0.05,
    floodProfile: 'retention ponds and fast runoff into suburban drainage systems',
    weatherProfile: 'strong thunderstorm exposure over wide suburban roadways',
    stormProfile: 'wind-driven tree and roadway impacts across the northeast edge',
  },
  {
    id: 'palm-river',
    name: 'Palm River / Clair-Mel',
    neighborhood: 'East bay approach',
    kind: 'coastal',
    lat: 27.9371,
    lon: -82.3867,
    floodBias: 0.56,
    weatherBias: 0.24,
    stormBias: 0.2,
    baseRisk: 0.11,
    floodProfile: 'low-lying east-bay drainage and neighborhood water back-up',
    weatherProfile: 'runoff-heavy streets and visibility loss during heavy rain',
    stormProfile: 'bay-adjacent routing and wind exposure across east approaches',
  },
]

const ZONE_TEMPLATE_BY_ID = new Map(ZONE_TEMPLATES.map((zone) => [zone.id, zone]))

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

function buildFallbackHourlyPeriods() {
  return Array.from({ length: 12 }, (_, index) => {
    const startTime = new Date(Date.now() + index * 60 * 60 * 1000).toISOString()

    return {
      startTime,
      temperature: 78,
      shortForecast: 'Monitoring data source availability',
      precipitationChance: 0,
    }
  })
}

function buildFallbackWeatherSignal(reason?: unknown): WeatherSignal {
  return {
    updatedAt: new Date().toISOString(),
    office: 'TBW',
    forecastSummary: ['Weather feed temporarily unavailable'],
    hourly: buildFallbackHourlyPeriods(),
    maxPrecipMmNext12h: 0,
    maxPrecipChanceNext12h: 0,
    maxWindGustMphNext12h: 0,
    alerts: reason
      ? [
          buildAlert(
            'weather-feed-degraded',
            'Weather Feed Degraded',
            'Minor',
            'BayGuard is using fallback weather telemetry while the NWS feed is unavailable.',
            'Expected',
          ),
        ]
      : [],
  }
}

function buildFallbackCoastalSignal(): CoastalSignal {
  return {
    updatedAt: new Date().toISOString(),
    stations: [
      {
        stationId: '8726607',
        name: 'Old Port Tampa',
        lat: 27.8578,
        lon: -82.5528,
        latestObservedFt: 0,
        observedAt: new Date().toISOString(),
        maxPredictedFtNext24h: 0,
      },
      {
        stationId: '8726520',
        name: 'St. Petersburg',
        lat: 27.7606,
        lon: -82.6269,
        latestObservedFt: 0,
        observedAt: new Date().toISOString(),
        maxPredictedFtNext24h: 0,
      },
      {
        stationId: '8726384',
        name: 'Port Manatee',
        lat: 27.6387,
        lon: -82.5621,
        latestObservedFt: 0,
        observedAt: new Date().toISOString(),
        maxPredictedFtNext24h: 0,
      },
    ],
    maxObservedFt: 0,
    maxPredictedFtNext24h: 0,
  }
}

function buildFallbackTropicalSignal(reason?: unknown): TropicalSignal {
  return {
    updatedAt: new Date().toISOString(),
    basin: 'Atlantic / Gulf',
    outlook: reason
      ? 'The National Hurricane Center feed is temporarily unavailable, so BayGuard is keeping the storm desk in conservative fallback monitoring.'
      : 'The Atlantic desk is in fallback monitoring mode.',
    activeSystems: [],
  }
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

function zoneTemplateFor(zoneId: string): ZoneTemplate {
  return ZONE_TEMPLATE_BY_ID.get(zoneId) ?? ZONE_TEMPLATES[0]
}

function dominantZoneDriver(zone: ZoneTemplate, flood: AgentIntel, weather: AgentIntel, storm: AgentIntel) {
  const contributions = [
    {
      key: 'flood' as const,
      score: zone.baseRisk + flood.score * zone.floodBias,
      label: zone.floodProfile,
    },
    {
      key: 'weather' as const,
      score: weather.score * zone.weatherBias,
      label: zone.weatherProfile,
    },
    {
      key: 'storm' as const,
      score: storm.score * zone.stormBias,
      label: zone.stormProfile,
    },
  ].sort((left, right) => right.score - left.score)

  return contributions[0]
}

function localizedZoneBoost(
  zone: ZoneTemplate,
  weatherSignal: WeatherSignal,
  coastalSignal: CoastalSignal,
  tropicalSignal: TropicalSignal,
): number {
  const floodAlertCount = weatherSignal.alerts.filter((alert) => /(flood|storm surge|coastal)/i.test(alert.event)).length
  const stormAlertCount = weatherSignal.alerts.filter((alert) => /(hurricane|tropical storm|storm surge)/i.test(alert.event)).length
  const heavyRainBoost =
    zone.kind === 'urban' || zone.kind === 'river'
      ? thresholdScore(weatherSignal.maxPrecipMmNext12h, [
          [10, 0.03],
          [25, 0.06],
          [50, 0.1],
        ])
      : 0
  const coastalBoost =
    zone.kind === 'coastal'
      ? thresholdScore(coastalSignal.maxPredictedFtNext24h, [
          [2.1, 0.03],
          [2.6, 0.06],
          [3.2, 0.11],
        ])
      : 0
  const evacuationBoost =
    zone.kind === 'evacuation'
      ? thresholdScore(weatherSignal.maxWindGustMphNext12h, [
          [30, 0.04],
          [45, 0.08],
          [70, 0.14],
        ])
      : 0
  const stormTrackBoost =
    tropicalSignal.activeSystems.length > 0
      ? zone.kind === 'coastal' || zone.kind === 'evacuation'
        ? 0.08
        : 0.04
      : 0

  return clamp(
    heavyRainBoost +
      coastalBoost +
      evacuationBoost +
      stormTrackBoost +
      floodAlertCount * (zone.kind === 'coastal' ? 0.03 : 0.015) +
      stormAlertCount * (zone.kind === 'evacuation' || zone.kind === 'coastal' ? 0.03 : 0.01),
    0,
    0.24,
  )
}

function zoneReason(
  zone: ZoneTemplate,
  dominant: ReturnType<typeof dominantZoneDriver>,
  weatherSignal: WeatherSignal,
  coastalSignal: CoastalSignal,
  tropicalSignal: TropicalSignal,
): string {
  switch (dominant.key) {
    case 'flood':
      return `${zone.name} stands out for ${dominant.label}; coastal guidance peaks near ${coastalSignal.maxPredictedFtNext24h.toFixed(2)} ft and rain guidance reaches ${weatherSignal.maxPrecipMmNext12h.toFixed(1)} mm.`
    case 'storm':
      return tropicalSignal.activeSystems.length > 0
        ? `${zone.name} is elevated by ${dominant.label} while ${tropicalSignal.activeSystems.length} active tropical advisory item${tropicalSignal.activeSystems.length > 1 ? 's' : ''} remain on the Atlantic desk.`
        : `${zone.name} is elevated by ${dominant.label} with gust guidance up to ${weatherSignal.maxWindGustMphNext12h.toFixed(1)} mph.`
    default:
      return `${zone.name} is elevated by ${dominant.label} with rainfall guidance reaching ${weatherSignal.maxPrecipMmNext12h.toFixed(1)} mm and ${weatherSignal.maxPrecipChanceNext12h}% precipitation odds.`
  }
}

function pickIncidentZone(zones: ZoneRisk[], driver: 'flood' | 'weather' | 'storm'): ZoneRisk | undefined {
  const sortedZones = [...zones].sort((left, right) => {
      const leftTemplate = zoneTemplateFor(left.id)
      const rightTemplate = zoneTemplateFor(right.id)
      const leftBias =
        driver === 'flood'
          ? leftTemplate.floodBias
          : driver === 'weather'
            ? leftTemplate.weatherBias
            : leftTemplate.stormBias
      const rightBias =
        driver === 'flood'
          ? rightTemplate.floodBias
          : driver === 'weather'
            ? rightTemplate.weatherBias
            : rightTemplate.stormBias

      return right.score * (rightBias + 0.35) - left.score * (leftBias + 0.35)
    })

  return sortedZones[0]
}

function buildIncidents(
  zones: ZoneRisk[],
  weather: AgentIntel,
  flood: AgentIntel,
  storm: AgentIntel,
): Incident[] {
  const incidents: Incident[] = []
  const floodZone = pickIncidentZone(zones, 'flood')
  const weatherZone = pickIncidentZone(zones, 'weather')
  const stormZone = pickIncidentZone(zones, 'storm')

  if (flood.score >= 0.45 && floodZone) {
    incidents.push({
      id: 'flood-watch',
      title: `${floodZone.name}: ${flood.headline}`,
      category: 'flood',
      severity: scoreToThreat(flood.score),
      status: flood.score >= 0.68 ? 'warning' : 'active',
      lat: floodZone.lat,
      lon: floodZone.lon,
      description: `${flood.summary} Focus area: ${floodZone.neighborhood}.`,
      recommendation:
        `${flood.recommendedActions[0] ?? 'Inspect low-lying streets and stormwater chokepoints.'} Start with ${floodZone.name}.`,
      source: 'NOAA CO-OPS',
    })
  }

  if (weather.score >= 0.45 && weatherZone) {
    incidents.push({
      id: 'weather-watch',
      title: `${weatherZone.name}: ${weather.headline}`,
      category: 'weather',
      severity: scoreToThreat(weather.score),
      status: weather.score >= 0.68 ? 'warning' : 'active',
      lat: weatherZone.lat,
      lon: weatherZone.lon,
      description: `${weather.summary} Watch ${weatherZone.neighborhood} first.`,
      recommendation:
        `${weather.recommendedActions[0] ?? 'Prepare traffic and field teams for sharp weather changes.'} Prioritize ${weatherZone.name}.`,
      source: 'NWS TBW',
    })
  }

  if (storm.score >= 0.45 && stormZone) {
    incidents.push({
      id: 'storm-watch',
      title: `${stormZone.name}: ${storm.headline}`,
      category: 'storm',
      severity: scoreToThreat(storm.score),
      status: storm.score >= 0.68 ? 'warning' : 'active',
      lat: stormZone.lat,
      lon: stormZone.lon,
      description: `${storm.summary} Priority zone: ${stormZone.neighborhood}.`,
      recommendation:
        `${storm.recommendedActions[0] ?? 'Brief leadership on tropical positioning and confidence bands.'} Use ${stormZone.name} as the lead watch area.`,
      source: 'NHC Atlantic',
    })
  }

  return incidents
}

function buildZones(
  weather: AgentIntel,
  flood: AgentIntel,
  storm: AgentIntel,
  weatherSignal: WeatherSignal,
  coastalSignal: CoastalSignal,
  tropicalSignal: TropicalSignal,
): ZoneRisk[] {
  return ZONE_TEMPLATES.map((zone) => {
    const localizedBoost = localizedZoneBoost(zone, weatherSignal, coastalSignal, tropicalSignal)
    const score = clamp(
      zone.baseRisk +
        flood.score * zone.floodBias +
        weather.score * zone.weatherBias +
        storm.score * zone.stormBias +
        localizedBoost,
    )
    const dominant = dominantZoneDriver(zone, flood, weather, storm)

    return {
      id: zone.id,
      name: zone.name,
      neighborhood: zone.neighborhood,
      kind: zone.kind,
      lat: zone.lat,
      lon: zone.lon,
      score: round(score),
      threatLevel: scoreToThreat(score),
      reason: zoneReason(zone, dominant, weatherSignal, coastalSignal, tropicalSignal),
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
  const [weatherResult, coastalResult, tropicalResult] = await Promise.allSettled([
    fetchWeatherSignal(),
    fetchCoastalSignal(),
    fetchTropicalSignal(),
  ])

  const liveWeatherSignal =
    weatherResult.status === 'fulfilled'
      ? weatherResult.value
      : buildFallbackWeatherSignal(weatherResult.reason)
  const liveCoastalSignal =
    coastalResult.status === 'fulfilled' ? coastalResult.value : buildFallbackCoastalSignal()
  const liveTropicalSignal =
    tropicalResult.status === 'fulfilled'
      ? tropicalResult.value
      : buildFallbackTropicalSignal(tropicalResult.reason)

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
  const zones = buildZones(
    weatherAgent,
    floodAgent,
    stormAgent,
    weatherSignal,
    coastalSignal,
    tropicalSignal,
  )
  const incidents = buildIncidents(zones, weatherAgent, floodAgent, stormAgent)

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
    incidents,
    zones,
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
