import { XMLParser } from 'fast-xml-parser'

import type {
  CoastalSignal,
  CoastalStationSignal,
  OfficialAlert,
  TropicalSignal,
  TropicalSystemSignal,
  WeatherSignal,
} from '../shared/types.ts'

const TAMPA_POINT = {
  lat: 27.9506,
  lon: -82.4572,
}

const NOAA_STATIONS = [
  { stationId: '8726607', name: 'Old Port Tampa', lat: 27.8578, lon: -82.5528 },
  { stationId: '8726520', name: 'St. Petersburg', lat: 27.7606, lon: -82.6269 },
  { stationId: '8726384', name: 'Port Manatee', lat: 27.6387, lon: -82.5621 },
]

const REQUEST_HEADERS = {
  Accept: 'application/geo+json, application/json, application/xml, text/xml;q=0.9, */*;q=0.8',
  'User-Agent': 'BayGuard Tampa Monitor/1.0 (local development)',
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
})

interface WeatherPointResponse {
  properties: {
    cwa: string
    forecastHourly: string
    forecastGridData: string
  }
}

interface HourlyForecastResponse {
  properties: {
    updateTime: string
    periods: Array<{
      startTime: string
      temperature: number
      shortForecast: string
      probabilityOfPrecipitation?: {
        value: number | null
      }
    }>
  }
}

interface GridValue {
  validTime: string
  value: number | null
}

interface GridDataResponse {
  properties: {
    quantitativePrecipitation: {
      values: GridValue[]
    }
    probabilityOfPrecipitation: {
      values: GridValue[]
    }
    windGust: {
      values: GridValue[]
    }
  }
}

interface AlertsResponse {
  features: Array<{
    id: string
    properties: {
      event: string
      severity: string
      urgency: string
      headline: string
      effective?: string
      ends?: string
    }
  }>
}

interface NoaaWaterLevelResponse {
  metadata?: {
    id: string
    name: string
    lat: string
    lon: string
  }
  data?: Array<{
    t: string
    v: string
  }>
}

interface NoaaPredictionsResponse {
  predictions?: Array<{
    t: string
    v: string
  }>
}

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: REQUEST_HEADERS })
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`)
  }

  return (await response.json()) as T
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: REQUEST_HEADERS })
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`)
  }

  return response.text()
}

function parseValidTimeStart(validTime: string): number {
  return Date.parse(validTime.split('/')[0] ?? validTime)
}

function isWithinWindow(validTime: string, windowHours: number): boolean {
  const start = parseValidTimeStart(validTime)
  return Number.isFinite(start) && start <= Date.now() + windowHours * 60 * 60 * 1000
}

function maxValue(values: GridValue[], windowHours: number, transform?: (value: number) => number): number {
  return values
    .filter((item) => item.value !== null && isWithinWindow(item.validTime, windowHours))
    .map((item) => transform?.(item.value as number) ?? (item.value as number))
    .reduce((peak, value) => Math.max(peak, value), 0)
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function cleanHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function fetchWeatherSignal(): Promise<WeatherSignal> {
  const point = await fetchJson<WeatherPointResponse>(
    `https://api.weather.gov/points/${TAMPA_POINT.lat},${TAMPA_POINT.lon}`,
  )

  const [hourly, grid, alerts] = await Promise.all([
    fetchJson<HourlyForecastResponse>(point.properties.forecastHourly),
    fetchJson<GridDataResponse>(point.properties.forecastGridData),
    fetchJson<AlertsResponse>(
      `https://api.weather.gov/alerts/active?point=${TAMPA_POINT.lat},${TAMPA_POINT.lon}`,
    ),
  ])

  const forecastSummary = hourly.properties.periods
    .slice(0, 4)
    .map((period) => period.shortForecast)
    .filter((summary, index, items) => items.indexOf(summary) === index)

  const officialAlerts: OfficialAlert[] = alerts.features.map((feature) => ({
    id: feature.id,
    event: feature.properties.event,
    severity: feature.properties.severity,
    urgency: feature.properties.urgency,
    headline: feature.properties.headline,
    effective: feature.properties.effective,
    ends: feature.properties.ends,
  }))

  return {
    updatedAt: hourly.properties.updateTime,
    office: point.properties.cwa,
    forecastSummary,
    hourly: hourly.properties.periods.slice(0, 12).map((period) => ({
      startTime: period.startTime,
      temperature: period.temperature,
      shortForecast: period.shortForecast,
      precipitationChance: period.probabilityOfPrecipitation?.value ?? null,
    })),
    maxPrecipMmNext12h: round(maxValue(grid.properties.quantitativePrecipitation.values, 12), 1),
    maxPrecipChanceNext12h: Math.round(
      maxValue(grid.properties.probabilityOfPrecipitation.values, 12),
    ),
    maxWindGustMphNext12h: round(
      maxValue(grid.properties.windGust.values, 12, (kilometersPerHour) => kilometersPerHour * 0.621371),
      1,
    ),
    alerts: officialAlerts,
  }
}

async function fetchCoastalStationSignal(
  station: (typeof NOAA_STATIONS)[number],
): Promise<CoastalStationSignal> {
  const [latest, predictions] = await Promise.all([
    fetchJson<NoaaWaterLevelResponse>(
      `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&application=BayGuard&date=latest&station=${station.stationId}&datum=MLLW&units=english&time_zone=lst_ldt&format=json`,
    ),
    fetchJson<NoaaPredictionsResponse>(
      `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=BayGuard&begin_date=${new Date().toISOString().slice(0, 10).replaceAll('-', '')}&range=24&station=${station.stationId}&datum=MLLW&units=english&time_zone=lst_ldt&interval=h&format=json`,
    ),
  ])

  const latestRecord = latest.data?.[0]
  const predictedPeak = predictions.predictions
    ?.map((entry) => Number(entry.v))
    .filter((value) => Number.isFinite(value))
    .reduce((peak, value) => Math.max(peak, value), 0)

  return {
    stationId: station.stationId,
    name: station.name,
    lat: station.lat,
    lon: station.lon,
    latestObservedFt: round(Number(latestRecord?.v ?? 0), 2),
    observedAt: latestRecord?.t ?? new Date().toISOString(),
    maxPredictedFtNext24h: round(predictedPeak ?? 0, 2),
  }
}

export async function fetchCoastalSignal(): Promise<CoastalSignal> {
  const stations = await Promise.all(NOAA_STATIONS.map(fetchCoastalStationSignal))

  return {
    updatedAt: new Date().toISOString(),
    stations,
    maxObservedFt: round(
      stations.reduce((peak, station) => Math.max(peak, station.latestObservedFt), 0),
      2,
    ),
    maxPredictedFtNext24h: round(
      stations.reduce((peak, station) => Math.max(peak, station.maxPredictedFtNext24h), 0),
      2,
    ),
  }
}

export async function fetchTropicalSignal(): Promise<TropicalSignal> {
  const [outlookXml, activeXml] = await Promise.all([
    fetchText('https://www.nhc.noaa.gov/gtwo.xml'),
    fetchText('https://www.nhc.noaa.gov/index-at.xml'),
  ])

  const parsedOutlook = xmlParser.parse(outlookXml) as {
    rss?: {
      channel?: {
        title?: string
        pubDate?: string
        item?: Array<{
          title?: string
          description?: string
        }>
      }
    }
  }

  const parsedActive = xmlParser.parse(activeXml) as {
    rss?: {
      channel?: {
        pubDate?: string
        item?: Array<{
          title?: string
          link?: string
          pubDate?: string
        }>
      }
    }
  }

  const outlookChannel = parsedOutlook.rss?.channel
  const activeChannel = parsedActive.rss?.channel
  const outlookItem = ensureArray(outlookChannel?.item)[0]

  const activeSystems: TropicalSystemSignal[] = ensureArray(activeChannel?.item)
    .filter((item) => item.link && item.link !== 'https://www.nhc.noaa.gov/')
    .map((item) => ({
      title: item.title ?? 'Active Atlantic system',
      link: item.link ?? 'https://www.nhc.noaa.gov/',
      publishedAt: item.pubDate,
    }))

  return {
    updatedAt: activeChannel?.pubDate ?? outlookChannel?.pubDate ?? new Date().toISOString(),
    basin: 'Atlantic / Gulf',
    outlook: cleanHtml(
      outlookItem?.description ??
        'The National Hurricane Center outlook feed is temporarily unavailable.',
    ),
    activeSystems,
  }
}
