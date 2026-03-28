import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  Home,
  Loader2,
  MapPin,
  Navigation,
  Package,
} from 'lucide-react'
import './pages.css'

/* ── Types ── */

interface EvacuateResult {
  floodZone: 'A' | 'B' | 'C' | 'Unknown'
  mustEvacuate: boolean
  reason: string
  shelter: { name: string; address: string }
  steps: string[]
  supplies: string[]
}

/* ── Constants ── */

const CATEGORY_LABELS: Record<number, string> = {
  1: '74–95 mph winds',
  2: '96–110 mph winds',
  3: '111–129 mph winds',
  4: '130–156 mph winds',
  5: '157+ mph winds',
}

const ZONE_COLORS: Record<string, string> = {
  A: '#ef4444',
  B: '#f97316',
  C: '#eab308',
  Unknown: '#6b7280',
}

/* ── Component ── */

export default function EvacuatePage() {
  const [address, setAddress] = useState('')
  const [category, setCategory] = useState(3)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<EvacuateResult | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!address.trim()) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/evacuate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: address.trim(), category }),
      })

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? `Server error ${res.status}`)
      }

      const data = (await res.json()) as EvacuateResult
      setResult(data)
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not generate evacuation plan.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Evacuation Planner</h1>
        <p>
          Enter your Tampa address and the approaching hurricane's category. We'll
          identify your flood zone, nearest shelter, and give you a personalized
          step-by-step evacuation plan.
        </p>
      </div>

      {/* Form */}
      <form className="report-form card-panel" onSubmit={handleSubmit}>
        <label className="field-label">
          Your Tampa address
          <input
            type="text"
            className="field-input"
            placeholder='"123 Bayshore Blvd, Tampa FL"'
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
          />
        </label>

        <label className="field-label">
          Hurricane category
          <select
            className="field-select"
            value={category}
            onChange={(e) => setCategory(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5].map((c) => (
              <option key={c} value={c}>
                Category {c} — {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>

        <button
          className="submit-btn"
          type="submit"
          disabled={loading || !address.trim()}
        >
          {loading ? (
            <>
              <Loader2 size={16} className="spin" />
              Generating plan…
            </>
          ) : (
            'Generate Evacuation Plan'
          )}
        </button>
      </form>

      {/* Loading */}
      {loading && (
        <div className="card-panel loading-panel">
          <div className="page-spinner large" />
          <div>
            <strong>Building your evacuation plan…</strong>
            <p>Analyzing flood zone, nearby shelters, and route options</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card-panel error-panel">
          <AlertTriangle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="evac-result">
          {/* Hero: zone + status */}
          <div className="card-panel evac-hero">
            <div className="evac-zone-row">
              <span className="zone-label-text">Flood Zone</span>
              <span
                className="zone-value-text"
                style={{ color: ZONE_COLORS[result.floodZone] }}
              >
                Zone {result.floodZone}
              </span>
            </div>

            <div
              className={`evac-status-row ${result.mustEvacuate ? 'must-go' : 'no-go'}`}
            >
              {result.mustEvacuate ? (
                <>
                  <AlertTriangle size={20} />
                  EVACUATE NOW — Category {category} Order
                </>
              ) : (
                <>
                  <CheckCircle size={20} />
                  No Mandatory Evacuation for Category {category}
                </>
              )}
            </div>

            <p className="evac-reason">{result.reason}</p>
          </div>

          {/* Two-col: shelter + steps */}
          <div className="evac-two-col">
            {/* Shelter */}
            <div className="card-panel">
              <div className="evac-section-title">
                <MapPin size={15} />
                Nearest Shelter
              </div>
              <div className="shelter-name">{result.shelter.name}</div>
              <div className="shelter-address">{result.shelter.address}</div>
              <a
                className="directions-link"
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(result.shelter.address)}`}
                target="_blank"
                rel="noreferrer"
              >
                <Navigation size={14} />
                Get Directions
              </a>
            </div>

            {/* Steps */}
            <div className="card-panel">
              <div className="evac-section-title">
                <Home size={15} />
                Action Steps
              </div>
              <ol className="evac-steps-list">
                {result.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          </div>

          {/* Supplies */}
          <div className="card-panel">
            <div className="evac-section-title">
              <Package size={15} />
              What to Bring
            </div>
            <div className="supplies-grid">
              {result.supplies.map((item, i) => (
                <div key={i} className="supply-item">
                  <span className="supply-check">✓</span>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
