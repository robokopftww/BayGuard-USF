import { MapPin, Navigation, RefreshCcw, Share2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

interface EvacuatePlan {
  floodZone: string
  mustEvacuate: boolean
  reason: string
  shelter: { name: string; address: string }
  steps: string[]
  supplies: string[]
}

function EvacuatePage() {
  const [address, setAddress] = useState('')
  const [category, setCategory] = useState<number | null>(null)
  const [plan, setPlan] = useState<EvacuatePlan | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleGeolocate = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser.')
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string
        try {
          const response = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${apiKey}`,
          )
          const data = (await response.json()) as { results?: Array<{ formatted_address: string }> }
          setAddress(data.results?.[0]?.formatted_address ?? '')
        } catch {
          setError('Could not reverse geocode your location.')
        }
      },
      () => {
        setError('Location access was denied.')
      },
    )
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!address.trim() || category === null) return

    setIsLoading(true)
    setError(null)
    setPlan(null)

    try {
      const response = await fetch('/api/evacuate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, category }),
      })

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string }
        throw new Error(payload.error ?? 'Could not generate an evacuation plan.')
      }

      setPlan((await response.json()) as EvacuatePlan)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reach the BayGuard backend.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleShare = async () => {
    if (!plan) return

    const text = [
      'BayGuard Evacuation Plan',
      `Address: ${address}`,
      `Hurricane Category: ${category}`,
      `Flood Zone: ${plan.floodZone}`,
      plan.mustEvacuate ? 'Status: EVACUATE NOW' : 'Status: MONITOR SITUATION',
      `Reason: ${plan.reason}`,
      '',
      `Shelter: ${plan.shelter.name}`,
      plan.shelter.address,
      '',
      'Steps:',
      ...plan.steps.map((step, i) => `${i + 1}. ${step}`),
      '',
      'Supplies:',
      ...plan.supplies.map((item) => `• ${item}`),
    ].join('\n')

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy to clipboard.')
    }
  }

  return (
    <div className="page-grid page-grid-evacuate">
      <section className="panel-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Evacuation Planner</p>
            <h3>Your personal escape plan</h3>
          </div>
          <Navigation size={18} />
        </div>

        <form className="sms-form" onSubmit={(event) => void handleSubmit(event)}>
          <p className="lead-copy">
            Enter your address, pick a hurricane category, and get a custom AI route, shelter, and
            checklist built for your exact location.
          </p>

          <label className="field">
            <span>Tampa address</span>
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="123 Bayshore Blvd, Tampa FL 33606"
              required
            />
          </label>

          <div className="field">
            <span>Hurricane category</span>
            <div className="choice-grid">
              {[1, 2, 3, 4, 5].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`choice-chip${category === cat ? ' active' : ''}`}
                  onClick={() => setCategory(cat)}
                >
                  CAT {cat}
                </button>
              ))}
            </div>
          </div>

          <button type="button" className="ghost-action" onClick={handleGeolocate}>
            <MapPin size={16} />
            <span>Use My Current Location</span>
          </button>

          <button
            type="submit"
            className="primary-action"
            disabled={isLoading || !address.trim() || category === null}
          >
            <RefreshCcw size={16} className={isLoading ? 'spin' : ''} />
            <span>{isLoading ? 'Generating plan...' : 'Generate My Evacuation Plan'}</span>
          </button>
        </form>

        {error ? <div className="alert-banner">{error}</div> : null}
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Your Plan</p>
            <h3>{plan ? 'Personalized evacuation plan' : 'Awaiting your details'}</h3>
          </div>
          <Navigation size={18} />
        </div>

        {!plan ? (
          <div className="empty-block">
            <strong>Your plan will appear here</strong>
            <p>
              Fill in your address and hurricane category on the left, then click Generate.
            </p>
          </div>
        ) : (
          <div className="stack-list">
            <div
              className={`severity-chip ${plan.mustEvacuate ? 'severity-high' : 'severity-guarded'}`}
            >
              {plan.mustEvacuate
                ? `EVACUATE NOW — Zone ${plan.floodZone}`
                : `MONITOR SITUATION — Zone ${plan.floodZone}`}
            </div>

            <p>{plan.reason}</p>

            <article className="signal-metric">
              <div className="metric-badge">
                <MapPin size={18} />
              </div>
              <div>
                <span>Nearest shelter</span>
                <strong>{plan.shelter.name}</strong>
                <small>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(plan.shelter.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="directions-link"
                  >
                    {plan.shelter.address} — Get directions
                  </a>
                </small>
              </div>
            </article>

            <div>
              <p className="page-kicker">Action steps</p>
              <div className="takeaway-list">
                {plan.steps.map((step, index) => (
                  <article key={index} className="takeaway-card">
                    <span className="takeaway-index">0{index + 1}</span>
                    <p>{step}</p>
                  </article>
                ))}
              </div>
            </div>

            <div>
              <p className="page-kicker">Supplies checklist</p>
              <div className="field-grid">
                {plan.supplies.map((item) => (
                  <label key={item} className="supply-item">
                    <input type="checkbox" />
                    <span>{item}</span>
                  </label>
                ))}
              </div>
            </div>

            <button type="button" className="ghost-action" onClick={() => void handleShare()}>
              <Share2 size={16} />
              <span>{copied ? 'Copied to clipboard!' : 'Share plan'}</span>
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

export default EvacuatePage
