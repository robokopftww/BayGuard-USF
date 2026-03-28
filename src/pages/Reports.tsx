import { useState } from 'react'
import { AlertCircle, CheckCircle, HelpCircle, Loader2 } from 'lucide-react'
import './pages.css'

/* ── Types ── */

interface VerifyResult {
  status: 'CONFIRMED' | 'LIKELY' | 'UNVERIFIED'
  confidence: number
  sources: string[]
  explanation: string
}

/* ── Constants ── */

const ISSUE_TYPES = [
  'Flooding',
  'Downed Tree',
  'Road Hazard',
  'Storm Surge',
  'Power Outage',
  'Other',
]

const STATUS_CONFIG = {
  CONFIRMED: {
    color: '#22c55e',
    Icon: CheckCircle,
    label: 'CONFIRMED',
  },
  LIKELY: {
    color: '#eab308',
    Icon: AlertCircle,
    label: 'LIKELY',
  },
  UNVERIFIED: {
    color: '#94a3b8',
    Icon: HelpCircle,
    label: 'UNVERIFIED',
  },
} as const

/* ── Component ── */

export default function ReportsPage() {
  const [report, setReport] = useState('')
  const [issueType, setIssueType] = useState('Flooding')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<VerifyResult | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!report.trim()) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: report.trim(), issueType }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? `Server error ${res.status}`)
      }

      const data = (await res.json()) as VerifyResult
      setResult(data)
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Verification failed. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  const statusConfig = result ? STATUS_CONFIG[result.status] : null

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Citizen Report Verifier</h1>
        <p>
          Describe what you see on the ground. Our AI cross-references your report against
          live NOAA water levels, NWS alerts, and NWS forecast data to determine its
          likelihood.
        </p>
      </div>

      {/* Form */}
      <form className="report-form card-panel" onSubmit={handleSubmit}>
        <label className="field-label">
          What are you seeing?
          <textarea
            className="field-textarea"
            placeholder='"I see flooding on Dale Mabry Highway — water about 2 ft deep and rising."'
            value={report}
            onChange={(e) => setReport(e.target.value)}
            rows={4}
            required
          />
        </label>

        <label className="field-label">
          Issue type
          <select
            className="field-select"
            value={issueType}
            onChange={(e) => setIssueType(e.target.value)}
          >
            {ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <button
          className="submit-btn"
          type="submit"
          disabled={loading || !report.trim()}
        >
          {loading ? (
            <>
              <Loader2 size={16} className="spin" />
              Verifying against live data…
            </>
          ) : (
            'Submit for Verification'
          )}
        </button>
      </form>

      {/* Loading state */}
      {loading && (
        <div className="card-panel loading-panel">
          <div className="page-spinner large" />
          <div>
            <strong>Checking live sensors…</strong>
            <p>
              Fetching NWS alerts · USGS water gauge · NWS forecast — then sending to
              Gemini for verification
            </p>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="card-panel error-panel">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Result card */}
      {result && statusConfig && (
        <div className="card-panel result-panel">
          {/* Header: badge + confidence */}
          <div className="result-header">
            <div
              className="status-badge"
              style={{
                background: statusConfig.color + '18',
                color: statusConfig.color,
                borderColor: statusConfig.color + '40',
              }}
            >
              <statusConfig.Icon size={18} />
              {statusConfig.label}
            </div>

            <div className="confidence-block">
              <div className="confidence-label">Confidence</div>
              <div className="confidence-value">{result.confidence}%</div>
              <div className="confidence-bar-track">
                <div
                  className="confidence-bar-fill"
                  style={{
                    width: `${result.confidence}%`,
                    background: statusConfig.color,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Explanation */}
          <div className="result-explanation">
            <div className="result-section-label">AI Assessment</div>
            <p>{result.explanation}</p>
          </div>

          {/* Sources */}
          {result.sources.length > 0 && (
            <div className="result-sources">
              <div className="result-section-label">Supporting Data Sources</div>
              <div className="source-tags">
                {result.sources.map((s) => (
                  <span key={s} className="source-tag">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
