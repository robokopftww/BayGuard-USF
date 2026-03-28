import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { GoogleGenAI } from '@google/genai'
import { AlertTriangle, Clock, Loader2, MapPin, Navigation, Share2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface EvacPlan {
  floodZone: string
  mustEvacuate: boolean
  urgency: string
  urgencyColor: 'red' | 'orange' | 'yellow'
  reason: string
  shelter: {
    name: string
    address: string
    estimatedMiles: string
  }
  bestRoute: {
    highway: string
    direction: string
    firstTurn: string
    avoid: string
  }
  hoursBeforeLandfall: string
  steps: string[]
  supplies: string[]
}

export function EvacuatePage() {
  const [address, setAddress] = useState('')
  const [category, setCategory] = useState(2)
  const [plan, setPlan] = useState<EvacPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [locationLoading, setLocationLoading] = useState(false)
  const [locationDetected, setLocationDetected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stepChecks, setStepChecks] = useState<boolean[]>([])
  const [supplyChecks, setSupplyChecks] = useState<boolean[]>([])
  const [copied, setCopied] = useState(false)
  const addressInputRef = useRef<HTMLInputElement>(null)
  const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

  // Initialize Google Places Autocomplete
  useEffect(() => {
    if (!addressInputRef.current || !mapsApiKey) return
    const inputEl = addressInputRef.current
    let autocomplete: google.maps.places.Autocomplete | null = null

    const init = async () => {
      try {
        setOptions({ key: mapsApiKey, v: 'weekly' })
      } catch {
        // Options already configured by the map page — safe to continue
      }
      try {
        await importLibrary('places')
        if (!inputEl.isConnected) return
        autocomplete = new google.maps.places.Autocomplete(inputEl, {
          types: ['address'],
          componentRestrictions: { country: 'us' },
          fields: ['formatted_address'],
        })
        autocomplete.addListener('place_changed', () => {
          const place = autocomplete!.getPlace()
          if (place.formatted_address) {
            setAddress(place.formatted_address)
            setLocationDetected(false)
          }
        })
      } catch {
        // Autocomplete is non-critical — manual input still works
      }
    }

    void init()

    return () => {
      if (autocomplete && typeof google !== 'undefined') {
        google.maps.event.clearInstanceListeners(autocomplete)
      }
    }
  }, [mapsApiKey])

  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.')
      return
    }
    setLocationLoading(true)
    setLocationDetected(false)
    setError(null)

    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude: lat, longitude: lng } }) => {
        try {
          const res = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${mapsApiKey ?? ''}`,
          )
          const data = (await res.json()) as { results?: Array<{ formatted_address: string }> }
          const addr = data.results?.[0]?.formatted_address
          if (addr) {
            setAddress(addr)
            setLocationDetected(true)
          } else {
            setError('Could not determine your address from GPS coordinates.')
          }
        } catch {
          setError('Failed to look up your address. Check your internet connection.')
        } finally {
          setLocationLoading(false)
        }
      },
      (err) => {
        setLocationLoading(false)
        setError(`Location access denied: ${err.message}`)
      },
    )
  }, [mapsApiKey])

  const generatePlan = useCallback(async () => {
    if (!address.trim()) {
      setError('Please enter or detect your address first.')
      return
    }
    setLoading(true)
    setError(null)
    setPlan(null)

    const prompt = `You are a Tampa Bay emergency management AI.
Person's location: ${address}
Hurricane category approaching: ${category}

TAMPA FLOOD ZONES:
Zone A (Evacuate Cat 1+): Davis Islands, Apollo Beach,
Gandy Beach, MacDill AFB area, Ballast Point,
Port Tampa, Palmetto Beach coast
Zone B (Evacuate Cat 2+): South Tampa, Hyde Park,
Palma Ceia, Ybor City waterfront, Channelside
Zone C (Evacuate Cat 3+): New Tampa, Carrollwood,
Temple Terrace, Westchase, Brandon west side

EVACUATION ROUTES OUT OF TAMPA:
- North: I-275 North to I-75 North toward Ocala
- East: I-4 East toward Orlando
- Northeast: US-301 North toward Zephyrhills
- Avoid: Howard Frankland Bridge (floods),
  Gandy Bridge (surge risk),
  Courtney Campbell (closes early)

REAL SHELTERS:
1. HCC Dale Mabry - 4001 W Tampa Bay Blvd 33614
2. Jefferson High School - 4401 W Cypress St 33607
3. Blake High School - 1701 N Boulevard 33607
4. Freedom High School - 7154 Forest Grove Dr 33620
5. Armwood High School - 12000 US-92 Seffner 33584
6. Strawberry Crest High - 4691 Gallagher Rd Dover 33527

Respond ONLY in valid JSON no markdown backticks:
{
  "floodZone": "A" or "B" or "C" or "Unknown",
  "mustEvacuate": true or false,
  "urgency": "EVACUATE NOW" or "PREPARE TO LEAVE" or "MONITOR",
  "urgencyColor": "red" or "orange" or "yellow",
  "reason": "one specific sentence about their area",
  "shelter": {
    "name": "exact shelter name",
    "address": "full address",
    "estimatedMiles": "X miles from their location"
  },
  "bestRoute": {
    "highway": "specific highway name",
    "direction": "North/East/etc toward City name",
    "firstTurn": "specific first instruction from their address",
    "avoid": "specific roads to avoid"
  },
  "hoursBeforeLandfall": "leave X hours before",
  "steps": [
    "Step 1: ...",
    "Step 2: ...",
    "Step 3: ...",
    "Step 4: ...",
    "Step 5: ...",
    "Step 6: ..."
  ],
  "supplies": [
    "item 1", "item 2", "item 3", "item 4",
    "item 5", "item 6", "item 7", "item 8"
  ]
}`

    try {
      const geminiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined
      if (!geminiKey) throw new Error('VITE_GEMINI_API_KEY is not set in your .env file.')

      const genAI = new GoogleGenAI({ apiKey: geminiKey })
      const result = await genAI.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: prompt,
      })

      const text = result.text ?? ''
      const parsed = JSON.parse(text) as EvacPlan
      setPlan(parsed)
      setStepChecks(new Array(parsed.steps.length).fill(false) as boolean[])
      setSupplyChecks(new Array(parsed.supplies.length).fill(false) as boolean[])
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate evacuation plan. Try again.',
      )
    } finally {
      setLoading(false)
    }
  }, [address, category])

  const mapsUrl = plan
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(address)}&destination=${encodeURIComponent(plan.shelter.address)}&travelmode=driving`
    : ''

  const handleShare = useCallback(() => {
    if (!plan) return
    const shareText = `BayGuard Evacuation Plan
Location: ${address}
Zone: ${plan.floodZone} | Category ${category} Hurricane
GO TO: ${plan.shelter.name} - ${plan.shelter.address}
ROUTE: Take ${plan.bestRoute.highway} ${plan.bestRoute.direction}
Leave: ${plan.hoursBeforeLandfall}
Get the app: bayguard.vercel.app`
    void navigator.clipboard.writeText(shareText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }, [plan, address, category])

  const urgencyClass = plan
    ? ({ red: 'evac-urgency-red', orange: 'evac-urgency-orange', yellow: 'evac-urgency-yellow' }[
        plan.urgencyColor
      ] ?? 'evac-urgency-yellow')
    : ''

  return (
    <div className="page-grid page-grid-evacuate">
      {/* ── LEFT: Input form ── */}
      <section className="panel-card evac-form-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Evacuation planner</p>
            <h3>Your personal escape plan</h3>
          </div>
          <Navigation size={18} />
        </div>

        {/* Option 1 – GPS auto-detect */}
        <div className="evac-section">
          <button
            type="button"
            className="evac-location-btn"
            onClick={detectLocation}
            disabled={locationLoading}
          >
            {locationLoading ? <Loader2 size={16} className="spin" /> : <MapPin size={16} />}
            {locationLoading ? 'Detecting location...' : 'Use My Current Location'}
          </button>
          {locationDetected && (
            <div className="evac-location-detected">
              <span className="evac-detected-dot" />
              Location detected
            </div>
          )}
        </div>

        {/* Option 2 – Manual address input with Places autocomplete */}
        <div className="evac-section">
          <label className="evac-label" htmlFor="evac-address">
            Enter your Tampa address
          </label>
          <input
            ref={addressInputRef}
            id="evac-address"
            type="text"
            className="evac-input"
            placeholder="123 Bayshore Blvd, Tampa FL"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value)
              setLocationDetected(false)
            }}
          />
        </div>

        {/* Hurricane category selector */}
        <div className="evac-section">
          <p className="evac-label">Hurricane Category</p>
          <div className="evac-cat-row">
            {[1, 2, 3, 4, 5].map((cat) => (
              <button
                key={cat}
                type="button"
                className={`evac-cat-btn${category === cat ? ' active' : ''}`}
                onClick={() => setCategory(cat)}
              >
                CAT {cat}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="alert-banner" style={{ marginBottom: '1rem' }}>
            {error}
          </div>
        ) : null}

        <button
          type="button"
          className="evac-generate-btn"
          onClick={() => void generatePlan()}
          disabled={loading}
        >
          {loading ? <Loader2 size={16} className="spin" /> : <Navigation size={16} />}
          {loading ? 'AI agents analyzing your location...' : 'Generate My Evacuation Plan'}
        </button>
      </section>

      {/* ── RIGHT: Results ── */}
      {plan ? (
        <div className="evac-results">
          {/* 1. Urgency banner */}
          <div className={`evac-urgency-banner ${urgencyClass}`}>
            <div className="evac-urgency-left">
              <AlertTriangle size={20} />
              <strong>{plan.urgency}</strong>
            </div>
            <span className="evac-zone-badge">Zone {plan.floodZone}</span>
          </div>

          {/* 2. Route card */}
          <section className="panel-card evac-route-card">
            <div className="panel-head">
              <div>
                <p className="page-kicker">Best evacuation route</p>
                <h3>Take {plan.bestRoute.highway}</h3>
              </div>
              <Navigation size={24} className="evac-arrow-icon" />
            </div>
            <p className="evac-route-direction">{plan.bestRoute.direction}</p>
            <p className="evac-route-first">
              <strong>First:</strong> {plan.bestRoute.firstTurn}
            </p>
            <div className="evac-avoid-warning">
              <AlertTriangle size={14} />
              <span>AVOID: {plan.bestRoute.avoid}</span>
            </div>
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="evac-maps-btn">
              <MapPin size={16} />
              Open in Google Maps
            </a>
          </section>

          {/* 3. Shelter card */}
          <section className="panel-card">
            <div className="panel-head">
              <div>
                <p className="page-kicker">Nearest open shelter</p>
                <h3>{plan.shelter.name}</h3>
              </div>
              <MapPin size={18} />
            </div>
            <p className="evac-shelter-address">{plan.shelter.address}</p>
            <p className="evac-shelter-miles">{plan.shelter.estimatedMiles}</p>
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="evac-maps-btn">
              <MapPin size={16} />
              Get Directions
            </a>
          </section>

          {/* 4. Timeline card */}
          <section className="panel-card">
            <div className="panel-head">
              <div>
                <p className="page-kicker">Departure timeline</p>
                <h3>{plan.hoursBeforeLandfall}</h3>
              </div>
              <Clock size={18} />
            </div>
            <p className="evac-reason">{plan.reason}</p>
          </section>

          {/* 5. Step-by-step checklist */}
          <section className="panel-card">
            <div className="panel-head">
              <div>
                <p className="page-kicker">Action checklist</p>
                <h3>Step-by-step plan</h3>
              </div>
              <span className="evac-progress-label">
                {stepChecks.filter(Boolean).length}/{plan.steps.length}
              </span>
            </div>
            <div className="evac-progress-bar">
              <div
                style={{
                  width: `${(stepChecks.filter(Boolean).length / plan.steps.length) * 100}%`,
                }}
              />
            </div>
            <div className="evac-checklist">
              {plan.steps.map((step, i) => (
                <label key={i} className={`evac-check-item${stepChecks[i] ? ' checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={stepChecks[i] ?? false}
                    onChange={() => {
                      setStepChecks((prev) => {
                        const next = [...prev]
                        next[i] = !next[i]
                        return next
                      })
                    }}
                  />
                  <span className="evac-check-box" />
                  <span>{step}</span>
                </label>
              ))}
            </div>
          </section>

          {/* 6. Supplies checklist */}
          <section className="panel-card">
            <div className="panel-head">
              <div>
                <p className="page-kicker">Emergency supplies</p>
                <h3>What to pack</h3>
              </div>
            </div>
            <div className="evac-supplies-grid">
              {plan.supplies.map((item, i) => (
                <label key={i} className={`evac-check-item${supplyChecks[i] ? ' checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={supplyChecks[i] ?? false}
                    onChange={() => {
                      setSupplyChecks((prev) => {
                        const next = [...prev]
                        next[i] = !next[i]
                        return next
                      })
                    }}
                  />
                  <span className="evac-check-box" />
                  <span>{item}</span>
                </label>
              ))}
            </div>
          </section>

          {/* 7. Share button */}
          <button type="button" className="evac-share-btn" onClick={handleShare}>
            <Share2 size={16} />
            {copied ? 'Copied to clipboard!' : 'Share Plan with Family'}
          </button>
        </div>
      ) : (
        <div className="evac-no-results">
          <Navigation size={36} style={{ opacity: 0.25 }} />
          <strong>Your plan will appear here</strong>
          <p>Enter your address and select a hurricane category, then hit Generate.</p>
        </div>
      )}
    </div>
  )
}
