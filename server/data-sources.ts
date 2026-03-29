import { XMLParser } from 'fast-xml-parser'

import type {
  CoastalSignal,
  CoastalStationSignal,
  EvacuationSignal,
  TrafficIncidentSignal,
  TrafficSignal,
  EvacuationZoneAssignment,
  OfficialAlert,
  TropicalSignal,
  TropicalSystemSignal,
  UtilityOutageIncidentSignal,
  UtilityOutageSignal,
  WeatherSignal,
  ZoneReference,
} from '../shared/types.js'

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

const TECO_CONFIG_URL =
  'https://outage-data-prod-hrcadje2h9aje9c9.a03.azurefd.net/api/v1/config'
const TECO_CDN_BASE = 'https://tecocdn-anc9hvc0bcebdnd3.a03.azurefd.net'
const HILLSBOROUGH_EVACUATION_LAYER_QUERY_URL =
  'https://maps.hillsboroughcounty.org/arcgis/rest/services/InfoLayers/infoLayers/MapServer/9/query?where=1%3D1&returnGeometry=true&outFields=ZONE&outSR=4326&f=json'

const TAMPA_TRAFFIC_BOUNDS = {
  north: 28.21,
  south: 27.72,
  west: -82.67,
  east: -82.22,
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

interface Florida511ResponseShape {
  events?: unknown[]
  Events?: unknown[]
  alerts?: unknown[]
  Alerts?: unknown[]
  data?: unknown[]
  Data?: unknown[]
  results?: unknown[]
  Results?: unknown[]
}

interface TecoConfigResponse {
  index: string
  tileContainer: string
  lastDateTime?: string
}

interface TecoManifestResponse {
  generated?: string
  totalOutages?: number
  tiles?: Record<
    string,
    {
      blob?: string
      outageCount?: number
    }
  >
}

interface TecoTileResponse {
  outages?: Array<{
    incidentId?: string
    polygonCenter?: [number, number]
    customerCount?: number
    estimatedTimeOfRestoration?: string
    reason?: string
    status?: string
    updateTime?: string
  }>
}

interface ArcGisEvacuationFeature {
  attributes?: {
    ZONE?: string
  }
  geometry?: {
    rings?: number[][][]
  }
}

interface ArcGisEvacuationResponse {
  features?: ArcGisEvacuationFeature[]
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

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = readNumber(source[key])
    if (value !== undefined) {
      return value
    }
  }

  return undefined
}

function collectArrayLike(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.map(readObject).filter((item): item is Record<string, unknown> => Boolean(item))
  }

  const objectPayload = readObject(payload)
  if (!objectPayload) {
    return []
  }

  for (const key of ['events', 'Events', 'alerts', 'Alerts', 'data', 'Data', 'results', 'Results']) {
    const value = objectPayload[key]
    if (Array.isArray(value)) {
      return value.map(readObject).filter((item): item is Record<string, unknown> => Boolean(item))
    }
  }

  return []
}

function withinTampaBounds(lat: number, lon: number): boolean {
  return (
    lat >= TAMPA_TRAFFIC_BOUNDS.south &&
    lat <= TAMPA_TRAFFIC_BOUNDS.north &&
    lon >= TAMPA_TRAFFIC_BOUNDS.west &&
    lon <= TAMPA_TRAFFIC_BOUNDS.east
  )
}

function distanceKm(leftLat: number, leftLon: number, rightLat: number, rightLon: number): number {
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

function classifyTrafficCategory(title: string): TrafficIncidentSignal['category'] {
  const normalized = cleanHtml(title).toLowerCase()

  if (/(flood|water over road|ponding)/i.test(normalized)) {
    return 'flood'
  }
  if (/(closure|closed|blocked|detour)/i.test(normalized)) {
    return 'closure'
  }
  if (/(construction|lane closure|work zone)/i.test(normalized)) {
    return 'construction'
  }
  if (/(crash|incident|disabled vehicle|debris)/i.test(normalized)) {
    return 'incident'
  }

  return 'other'
}

function parseFlorida511Item(item: Record<string, unknown>): TrafficIncidentSignal | null {
  const location = readObject(item.location)
  const geometry = readObject(item.geometry)

  const lat =
    pickNumber(item, ['latitude', 'Latitude', 'lat', 'Lat']) ??
    pickNumber(location ?? {}, ['latitude', 'Latitude', 'lat', 'Lat']) ??
    pickNumber(geometry ?? {}, ['latitude', 'Latitude', 'lat', 'Lat', 'y', 'Y'])
  const lon =
    pickNumber(item, ['longitude', 'Longitude', 'lng', 'Lon', 'long']) ??
    pickNumber(location ?? {}, ['longitude', 'Longitude', 'lng', 'Lon', 'long']) ??
    pickNumber(geometry ?? {}, ['longitude', 'Longitude', 'lng', 'Lon', 'long', 'x', 'X'])

  if (lat === undefined || lon === undefined || !withinTampaBounds(lat, lon)) {
    return null
  }

  const title =
    [
      item.title,
      item.eventHeadline,
      item.headline,
      item.description,
      item.comment,
      item.details,
      item.roadName,
      item.locationName,
    ]
      .map((value) => (typeof value === 'string' ? cleanHtml(value) : ''))
      .find(Boolean) ?? 'Florida 511 advisory'

  const id =
    (typeof item.id === 'string' && item.id) ||
    (typeof item.eventId === 'string' && item.eventId) ||
    (typeof item.guid === 'string' && item.guid) ||
    `${lat.toFixed(4)}:${lon.toFixed(4)}:${title}`

  return {
    id,
    title,
    lat,
    lon,
    category: classifyTrafficCategory(title),
    roadName:
      (typeof item.roadName === 'string' && item.roadName) ||
      (typeof item.routeName === 'string' && item.routeName) ||
      undefined,
    severity:
      (typeof item.severity === 'string' && item.severity) ||
      (typeof item.priority === 'string' && item.priority) ||
      undefined,
    updatedAt:
      (typeof item.updatedAt === 'string' && item.updatedAt) ||
      (typeof item.lastUpdated === 'string' && item.lastUpdated) ||
      (typeof item.startTime === 'string' && item.startTime) ||
      undefined,
  }
}

function pointInRing(lat: number, lon: number, ring: number[][]): boolean {
  let inside = false

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLon, currentLat] = ring[index] ?? []
    const [previousLon, previousLat] = ring[previous] ?? []

    if (
      currentLon === undefined ||
      currentLat === undefined ||
      previousLon === undefined ||
      previousLat === undefined
    ) {
      continue
    }

    const intersects =
      currentLat > lat !== previousLat > lat &&
      lon <
        ((previousLon - currentLon) * (lat - currentLat)) / (previousLat - currentLat || 1e-9) +
          currentLon

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function pointInPolygon(lat: number, lon: number, rings: number[][][]): boolean {
  return rings.some((ring) => pointInRing(lat, lon, ring))
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

export async function fetchTrafficSignal(): Promise<TrafficSignal> {
  const apiKey = process.env.FL511_API_KEY?.trim()

  if (!apiKey) {
    return {
      updatedAt: new Date().toISOString(),
      provider: 'fl511',
      enabled: false,
      note: 'Florida 511 traffic events are available when FL511_API_KEY is configured.',
      incidents: [],
    }
  }

  const payload = await fetchJson<Florida511ResponseShape | unknown>(
    `https://fl511.com/api/v2/get/events?key=${encodeURIComponent(apiKey)}&format=json`,
  )
  const incidents = collectArrayLike(payload)
    .map(parseFlorida511Item)
    .filter((item): item is TrafficIncidentSignal => Boolean(item))
    .sort((left, right) => {
      const leftDistance = distanceKm(TAMPA_POINT.lat, TAMPA_POINT.lon, left.lat, left.lon)
      const rightDistance = distanceKm(TAMPA_POINT.lat, TAMPA_POINT.lon, right.lat, right.lon)
      return leftDistance - rightDistance
    })

  return {
    updatedAt: new Date().toISOString(),
    provider: 'fl511',
    enabled: true,
    note:
      incidents.length > 0
        ? 'Florida 511 traffic incidents are being checked around Tampa.'
        : 'Florida 511 is connected, but there are no matching Tampa traffic incidents in the feed right now.',
    incidents,
  }
}

export async function fetchUtilityOutageSignal(): Promise<UtilityOutageSignal> {
  const config = await fetchJson<TecoConfigResponse>(TECO_CONFIG_URL)
  const manifest = await fetchJson<TecoManifestResponse>(
    `${TECO_CDN_BASE}/${config.tileContainer}/${config.index}/manifest.json`,
  )

  const tileEntries = Object.entries(manifest.tiles ?? {})
    .filter(([, tile]) => (tile.outageCount ?? 0) > 0 && tile.blob)
    .map(([tileKey, tile]) => ({
      tileKey,
      zoom: Number(tileKey.split('/')[0] ?? 0),
      blob: tile.blob as string,
    }))

  const highestZoom = tileEntries.reduce((peak, tile) => Math.max(peak, tile.zoom), 0)
  const selectedTiles = tileEntries.filter((tile) => tile.zoom === highestZoom)

  const tilePayloads = await Promise.all(
    selectedTiles.map((tile) =>
      fetchJson<TecoTileResponse>(`${TECO_CDN_BASE}/outagemap-tiles-prod/${tile.blob}`).catch(() => ({
        outages: [],
      })),
    ),
  )

  const deduped = new Map<string, UtilityOutageIncidentSignal>()

  for (const tile of tilePayloads) {
    for (const outage of tile.outages ?? []) {
      const polygonCenter = outage.polygonCenter
      const centerLon = polygonCenter?.[0]
      const centerLat = polygonCenter?.[1]

      if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon)) {
        continue
      }

      const lat = centerLat as number
      const lon = centerLon as number

      const id = outage.incidentId ?? `${lat}:${lon}`
      if (deduped.has(id)) {
        continue
      }

      deduped.set(id, {
        id,
        lat,
        lon,
        customerCount: Math.max(1, Math.round(outage.customerCount ?? 1)),
        status: outage.status,
        reason: outage.reason,
        estimatedTimeOfRestoration: outage.estimatedTimeOfRestoration,
        updatedAt: outage.updateTime,
      })
    }
  }

  return {
    updatedAt: manifest.generated ?? config.lastDateTime ?? new Date().toISOString(),
    provider: 'teco',
    note:
      (manifest.totalOutages ?? 0) > 0
        ? 'Tampa Electric outage polygons are being checked around BayGuard locations.'
        : 'Tampa Electric is not showing active outages in the public outage map right now.',
    totalOutages: manifest.totalOutages ?? 0,
    incidents: Array.from(deduped.values()),
  }
}

export async function fetchEvacuationSignal(zones: ZoneReference[]): Promise<EvacuationSignal> {
  const payload = await fetchJson<ArcGisEvacuationResponse>(HILLSBOROUGH_EVACUATION_LAYER_QUERY_URL)
  const features = (payload.features ?? []).filter(
    (feature): feature is ArcGisEvacuationFeature & { attributes: { ZONE?: string }; geometry: { rings: number[][][] } } =>
      Array.isArray(feature.geometry?.rings),
  )

  const assignments: EvacuationZoneAssignment[] = zones.map((zone) => {
    const matchedFeature = features.find((feature) =>
      pointInPolygon(zone.lat, zone.lon, feature.geometry.rings),
    )

    return {
      zoneId: zone.id,
      zoneName: zone.name,
      zoneCode: matchedFeature?.attributes?.ZONE,
    }
  })

  return {
    updatedAt: new Date().toISOString(),
    provider: 'hillsborough',
    note: 'Official Hillsborough County evacuation zones are loaded for BayGuard neighborhoods.',
    assignments,
  }
}
