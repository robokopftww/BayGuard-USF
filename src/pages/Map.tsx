import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader } from '@googlemaps/js-api-loader'
import './pages.css'

/* ── Types ── */

interface NWSAlert {
  id: string
  event: string
  headline: string
  description: string
  severity: string
  areaDesc: string
  lat: number
  lng: number
}

interface MapIncident {
  id: string
  title: string
  severity: string
  lat: number
  lng: number
  detail: string
  isDemo: boolean
}

/* ── Constants ── */

const DEMO_INCIDENTS: MapIncident[] = [
  {
    id: 'demo-1',
    title: 'Storm Surge Warning — Bayshore Blvd',
    severity: 'Extreme',
    lat: 27.9241,
    lng: -82.4824,
    detail: 'Water 3–5 ft above ground. Immediate evacuation required.',
    isDemo: true,
  },
  {
    id: 'demo-2',
    title: 'Flash Flood — Dale Mabry Hwy',
    severity: 'Severe',
    lat: 27.9697,
    lng: -82.5083,
    detail: 'Road impassable. 2 ft standing water reported near I-275.',
    isDemo: true,
  },
  {
    id: 'demo-3',
    title: 'Downed Power Lines — MacDill Ave',
    severity: 'Moderate',
    lat: 27.9102,
    lng: -82.4808,
    detail: 'Live lines across roadway. TECO responding.',
    isDemo: true,
  },
  {
    id: 'demo-4',
    title: 'Mandatory Evacuation — Davis Islands',
    severity: 'Extreme',
    lat: 27.9187,
    lng: -82.453,
    detail: 'Zone A mandatory evacuation order issued. Bridges may close.',
    isDemo: true,
  },
  {
    id: 'demo-5',
    title: 'Road Closure — I-275 & Hillsborough Ave',
    severity: 'Moderate',
    lat: 27.9925,
    lng: -82.4607,
    detail: 'FDOT closure northbound due to standing water and debris.',
    isDemo: true,
  },
]

const SEVERITY_COLORS: Record<string, string> = {
  Extreme: '#ef4444',
  Severe: '#ef4444',
  Moderate: '#f97316',
  Minor: '#eab308',
  Unknown: '#6b7280',
}

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#0d1117' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0d1117' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8ab4f8' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry',
    stylers: [{ color: '#1c2333' }],
  },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#bdc1c6' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#757575' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#0a1628' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#1a2a4a' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#212a37' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#9aa0a6' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#2c3e6a' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#1f2835' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#f3d19c' }],
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#2f3948' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#0d2137' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#515c6d' }],
  },
]

/* ── Helpers ── */

function severityColor(s: string): string {
  return SEVERITY_COLORS[s] ?? '#6b7280'
}

function polygonCentroid(coords: [number, number][]): { lat: number; lng: number } {
  let lat = 0
  let lng = 0
  for (const [lo, la] of coords) {
    lng += lo
    lat += la
  }
  return { lat: lat / coords.length, lng: lng / coords.length }
}

/* ── Component ── */

export default function MapPage() {
  const canvasRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)

  const [alerts, setAlerts] = useState<NWSAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [demoMode, setDemoMode] = useState(false)
  const [mapReady, setMapReady] = useState(false)

  /* Fetch NWS alerts */
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('https://api.weather.gov/alerts/active?area=FL', {
          headers: { 'User-Agent': 'BayGuard/1.0 (hackathon)' },
        })
        const data = await res.json()

        const filtered: NWSAlert[] = (data.features ?? [])
          .filter((f: any) =>
            /Tampa|Hillsborough|Pinellas/i.test(f.properties?.areaDesc ?? ''),
          )
          .map((f: any, i: number) => {
            /* Default: scatter around Tampa Bay center */
            let lat = 27.9506 + (Math.random() - 0.5) * 0.12
            let lng = -82.4572 + (Math.random() - 0.5) * 0.18

            const geo = f.geometry
            if (geo?.type === 'Polygon' && geo.coordinates?.[0]?.length) {
              const c = polygonCentroid(geo.coordinates[0] as [number, number][])
              lat = c.lat
              lng = c.lng
            } else if (geo?.type === 'MultiPolygon' && geo.coordinates?.[0]?.[0]?.length) {
              const c = polygonCentroid(geo.coordinates[0][0] as [number, number][])
              lat = c.lat
              lng = c.lng
            }

            return {
              id: f.id ?? `alert-${i}`,
              event: f.properties.event ?? 'Weather Alert',
              headline: f.properties.headline ?? '',
              description: (f.properties.description ?? '').slice(0, 200),
              severity: f.properties.severity ?? 'Unknown',
              areaDesc: f.properties.areaDesc ?? '',
              lat,
              lng,
            }
          })

        setAlerts(filtered)
      } catch {
        setError('Could not reach NWS — check your connection.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  /* Init Google Maps after alerts load */
  useEffect(() => {
    if (loading || !canvasRef.current) return

    const loader = new Loader({
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '',
      version: 'weekly',
    })

    loader
      .importLibrary('maps')
      .then(({ Map }) => {
        if (!canvasRef.current) return
        const map = new Map(canvasRef.current, {
          center: { lat: 27.9506, lng: -82.4572 },
          zoom: 11,
          styles: DARK_MAP_STYLES,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          zoomControl: true,
        })
        infoWindowRef.current = new google.maps.InfoWindow()
        mapRef.current = map
        setMapReady(true)
      })
      .catch(() => setError('Google Maps failed to load — check your API key.'))
  }, [loading])

  /* Update markers whenever alerts or demoMode changes */
  const updateMarkers = useCallback(() => {
    if (!mapRef.current) return

    for (const m of markersRef.current) m.setMap(null)
    markersRef.current = []

    const items: MapIncident[] = [
      ...alerts.map((a) => ({
        id: a.id,
        title: a.event,
        severity: a.severity,
        lat: a.lat,
        lng: a.lng,
        detail: a.headline || a.areaDesc.split(';')[0]?.trim() || '',
        isDemo: false,
      })),
      ...(demoMode ? DEMO_INCIDENTS : []),
    ]

    for (const item of items) {
      const color = severityColor(item.severity)
      const marker = new google.maps.Marker({
        position: { lat: item.lat, lng: item.lng },
        map: mapRef.current,
        title: item.title,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: item.isDemo ? 14 : 11,
          fillColor: color,
          fillOpacity: 0.88,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      })

      marker.addListener('click', () => {
        if (!infoWindowRef.current) return
        infoWindowRef.current.setContent(
          `<div style="background:#0d1117;color:#f1f5f9;padding:12px 14px;border-radius:8px;max-width:260px;font-family:system-ui,sans-serif;border:1px solid ${color}44">
            ${item.isDemo ? `<div style="font-size:10px;color:#f97316;font-weight:700;letter-spacing:1px;margin-bottom:4px">DEMO MODE</div>` : ''}
            <strong style="color:${color};font-size:13px;display:block;margin-bottom:6px">${item.title}</strong>
            <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5">${item.detail}</p>
          </div>`,
        )
        infoWindowRef.current.open(mapRef.current, marker)
      })

      markersRef.current.push(marker)
    }
  }, [alerts, demoMode])

  useEffect(() => {
    if (mapReady) updateMarkers()
  }, [mapReady, updateMarkers])

  /* Cleanup */
  useEffect(() => {
    return () => {
      for (const m of markersRef.current) m.setMap(null)
      markersRef.current = []
    }
  }, [])

  return (
    <div className="map-page">
      {/* Sidebar */}
      <aside className="map-sidebar">
        <div className="sidebar-header">
          <h2>Live Alerts</h2>
          <span className="count-badge">{alerts.length} Tampa area</span>
        </div>

        <button
          className={`demo-trigger-btn${demoMode ? ' demo-active' : ''}`}
          onClick={() => setDemoMode((d) => !d)}
        >
          {demoMode ? '◼  EXIT DEMO MODE' : '⚡  TRIGGER DEMO MODE'}
        </button>

        {error && <div className="page-error">{error}</div>}

        {loading && (
          <div className="sidebar-loading">
            <div className="page-spinner" />
            Loading NWS alerts…
          </div>
        )}

        {demoMode && (
          <div className="alert-group">
            <div className="group-label">Simulated Incidents</div>
            {DEMO_INCIDENTS.map((inc) => (
              <div key={inc.id} className="alert-item demo-item">
                <span
                  className="severity-dot"
                  style={{ background: severityColor(inc.severity) }}
                />
                <div>
                  <div className="alert-name">{inc.title}</div>
                  <div className="alert-meta demo-tag-label">DEMO · {inc.severity}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="alert-group">
          <div className="group-label">NWS Weather Alerts</div>
          {!loading && alerts.length === 0 && (
            <div className="empty-panel">No active Tampa-area alerts right now.</div>
          )}
          {alerts.map((alert) => (
            <div key={alert.id} className="alert-item">
              <span
                className="severity-dot"
                style={{ background: severityColor(alert.severity) }}
              />
              <div>
                <div className="alert-name">{alert.event}</div>
                <div className="alert-meta">
                  {alert.areaDesc.split(';')[0]?.trim()}
                </div>
                {alert.description && (
                  <div className="alert-desc">{alert.description.slice(0, 100)}…</div>
                )}
                <span
                  className="severity-pill"
                  style={{
                    background: severityColor(alert.severity) + '20',
                    color: severityColor(alert.severity),
                  }}
                >
                  {alert.severity}
                </span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Map canvas */}
      <div className="map-canvas" ref={canvasRef}>
        {(!mapReady || loading) && (
          <div className="map-placeholder">
            <div className="page-spinner large" />
            <span>Loading Tampa Bay map…</span>
          </div>
        )}
      </div>
    </div>
  )
}
