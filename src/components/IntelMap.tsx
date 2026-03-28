import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { useEffect, useRef, useState } from 'react'

import type { Incident, ZoneRisk } from '../../shared/types'

interface IntelMapProps {
  center: [number, number]
  incidents: Incident[]
  zones: ZoneRisk[]
}

let configuredApiKey: string | null = null
let mapsLibrariesPromise:
  | Promise<{
      maps: google.maps.MapsLibrary
      marker: google.maps.MarkerLibrary
    }>
  | null = null

function threatColor(level: ZoneRisk['threatLevel'] | Incident['severity']): string {
  switch (level) {
    case 'severe':
      return '#d94827'
    case 'high':
      return '#ef6b3b'
    case 'elevated':
      return '#f0a239'
    case 'guarded':
      return '#198f88'
    default:
      return '#2874c9'
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function zoneInfoHtml(zone: ZoneRisk): string {
  return `
    <div style="min-width:220px;font-family:Space Grotesk, sans-serif;color:#132438">
      <strong style="display:block;font-size:16px;margin-bottom:6px;">${escapeHtml(zone.name)}</strong>
      <div style="color:#5e7384;font-size:13px;margin-bottom:8px;">${escapeHtml(zone.neighborhood)}</div>
      <div style="font-size:14px;line-height:1.45;">${escapeHtml(zone.reason)}</div>
    </div>
  `
}

function incidentInfoHtml(incident: Incident): string {
  return `
    <div style="min-width:240px;font-family:Space Grotesk, sans-serif;color:#132438">
      <strong style="display:block;font-size:16px;margin-bottom:6px;">${escapeHtml(incident.title)}</strong>
      <div style="color:#5e7384;font-size:13px;margin-bottom:8px;">${escapeHtml(incident.source)}</div>
      <div style="font-size:14px;line-height:1.45;margin-bottom:8px;">${escapeHtml(incident.description)}</div>
      <div style="font-size:13px;color:#294155;"><strong>Action:</strong> ${escapeHtml(incident.recommendation)}</div>
    </div>
  `
}

async function loadMaps(apiKey: string) {
  if (!configuredApiKey) {
    setOptions({
      key: apiKey,
      v: 'weekly',
    })
    configuredApiKey = apiKey
  } else if (configuredApiKey !== apiKey) {
    throw new Error('Google Maps was already initialized with a different API key.')
  }

  if (!mapsLibrariesPromise) {
    mapsLibrariesPromise = Promise.all([
      importLibrary('maps') as Promise<google.maps.MapsLibrary>,
      importLibrary('marker') as Promise<google.maps.MarkerLibrary>,
    ]).then(([maps, marker]) => ({ maps, marker }))
  }

  return mapsLibrariesPromise
}

const MAP_STYLES: google.maps.MapTypeStyle[] = [
  {
    elementType: 'geometry',
    stylers: [{ color: '#e7f0f4' }],
  },
  {
    elementType: 'labels.text.fill',
    stylers: [{ color: '#294155' }],
  },
  {
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#f8fbfc' }],
  },
  {
    featureType: 'administrative',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#c7d6e2' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#63798a' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#ffffff' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#d8e6ef' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#9fd7dd' }],
  },
]

export function IntelMap({ center, incidents, zones }: IntelMapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()

  useEffect(() => {
    if (!apiKey || !mapRef.current) {
      return
    }

    let cancelled = false
    const markers: google.maps.Marker[] = []
    const circles: google.maps.Circle[] = []
    let infoWindow: google.maps.InfoWindow | null = null
    const mapElement = mapRef.current

    async function initializeMap() {
      try {
        const { maps, marker } = await loadMaps(apiKey)
        if (cancelled) {
          return
        }

        const { Map, Circle, InfoWindow } = maps
        const { Marker } = marker

        mapElement.innerHTML = ''
        const map = new Map(mapElement, {
          center: { lat: center[0], lng: center[1] },
          zoom: 11,
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: true,
          styles: MAP_STYLES,
          clickableIcons: false,
          gestureHandling: 'greedy',
        })

        infoWindow = new InfoWindow()

        zones.forEach((zone) => {
          const circle = new Circle({
            map,
            center: { lat: zone.lat, lng: zone.lon },
            radius: 1100 + zone.score * 1600,
            strokeColor: threatColor(zone.threatLevel),
            strokeOpacity: 0.95,
            strokeWeight: 1.5,
            fillColor: threatColor(zone.threatLevel),
            fillOpacity: 0.12,
          })

          circle.addListener('click', (event: google.maps.MapMouseEvent) => {
            infoWindow?.setContent(zoneInfoHtml(zone))
            infoWindow?.setPosition(event.latLng ?? circle.getCenter() ?? undefined)
            infoWindow?.open({ map })
          })

          circles.push(circle)
        })

        incidents.forEach((incident) => {
          const incidentMarker = new Marker({
            map,
            position: { lat: incident.lat, lng: incident.lon },
            title: incident.title,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 9,
              fillColor: threatColor(incident.severity),
              fillOpacity: 0.97,
              strokeColor: '#132438',
              strokeWeight: 2,
            },
            zIndex: 2,
          })

          incidentMarker.addListener('click', () => {
            infoWindow?.setContent(incidentInfoHtml(incident))
            infoWindow?.open({
              anchor: incidentMarker,
              map,
            })
          })

          markers.push(incidentMarker)
        })

        setMapError(null)
      } catch (error) {
        if (!cancelled) {
          setMapError(
            error instanceof Error
              ? error.message
              : 'Google Maps could not be loaded for the Tampa operations view.',
          )
        }
      }
    }

    void initializeMap()

    return () => {
      cancelled = true
      infoWindow?.close()

      if (typeof google !== 'undefined') {
        markers.forEach((markerInstance) => {
          google.maps.event.clearInstanceListeners(markerInstance)
          markerInstance.setMap(null)
        })

        circles.forEach((circleInstance) => {
          google.maps.event.clearInstanceListeners(circleInstance)
          circleInstance.setMap(null)
        })
      }
    }
  }, [apiKey, center, incidents, zones])

  if (!apiKey) {
    return (
      <div className="map-fallback">
        <strong>Google Maps API key needed</strong>
        <p>
          Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to your <code>.env</code> file to enable the
          live Tampa map layer.
        </p>
      </div>
    )
  }

  if (mapError) {
    return (
      <div className="map-fallback">
        <strong>Google Maps could not load</strong>
        <p>{mapError}</p>
      </div>
    )
  }

  return <div ref={mapRef} className="intel-map" aria-label="Google map of Tampa risk zones" />
}
