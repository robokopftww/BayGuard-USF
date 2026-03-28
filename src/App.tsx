import {
  RefreshCcw,
  ShieldAlert,
  Siren,
  Waves,
  Wind,
  Workflow,
} from 'lucide-react'
import { startTransition, useCallback, useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'

import { IntelMap } from './components/IntelMap'
import MapPage from './pages/Map'
import ReportsPage from './pages/Reports'
import EvacuatePage from './pages/Evacuate'
import './App.css'
import './pages/pages.css'
import type { IntelSnapshot, SimulationScenario, ThreatLevel } from '../shared/types.ts'

/* ─────────────────────────────────────────────
   Navbar
───────────────────────────────────────────── */

function Navbar() {
  return (
    <nav className="top-nav">
      <NavLink to="/" className="nav-logo">
        <ShieldAlert size={20} />
        BayGuard
      </NavLink>

      <div className="nav-links">
        <NavLink
          to="/map"
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        >
          Map
        </NavLink>
        <NavLink
          to="/reports"
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        >
          Report Issue
        </NavLink>
        <NavLink
          to="/evacuate"
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        >
          Evacuate
        </NavLink>
      </div>
    </nav>
  )
}

/* ─────────────────────────────────────────────
   Dashboard (original app content)
───────────────────────────────────────────── */

function Dashboard() {
  const [snapshot, setSnapshot] = useState<IntelSnapshot | null>(null)
  const [scenario, setScenario] = useState<SimulationScenario>('live')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchIntel = useCallback(
    async (forceRefresh = false, selectedScenario: SimulationScenario) => {
      try {
        if (forceRefresh) {
          setIsRefreshing(true)
        }

        setError(null)
        const params = new URLSearchParams()
        if (forceRefresh) {
          params.set('refresh', '1')
        }
        if (selectedScenario !== 'live') {
          params.set('scenario', selectedScenario)
        }

        const response = await fetch(
          `/api/intel${params.size ? `?${params.toString()}` : ''}`,
        )
        if (!response.ok) {
          throw new Error(
            'The BayGuard backend could not return a live intelligence snapshot.',
          )
        }

        const data = (await response.json()) as IntelSnapshot
        startTransition(() => {
          setSnapshot(data)
        })
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Unable to reach the BayGuard backend.',
        )
      } finally {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    },
    [],
  )

  useEffect(() => {
    setIsLoading(true)
    void fetchIntel(false, scenario)

    const intervalId = window.setInterval(() => {
      void fetchIntel(false, scenario)
    }, 120000)

    return () => window.clearInterval(intervalId)
  }, [fetchIntel, scenario])

  const overview = snapshot?.overview
  const weather = snapshot?.signals.weather
  const coastal = snapshot?.signals.coastal
  const tropical = snapshot?.signals.tropical

  return (
    <div className="app-shell">
      <div className="background-wash" aria-hidden="true" />

      <header className="hero-panel">
        <div className="hero-copy">
          <div className="eyebrow">
            <ShieldAlert size={16} />
            <span>BayGuard Tampa</span>
          </div>
          <h1>Multi-agent disaster alerts for flood, rain, and hurricane risk.</h1>
          <p>
            A Tampa operations dashboard that fuses live NWS, NOAA, and NHC feeds with a
            Google Maps operations layer, then routes them through weather, flood, storm,
            and final-judge agents. Gemini can take the final orchestration role whenever
            an API key is configured.
          </p>

          <div className="hero-actions">
            <div className={`level-pill ${severityClass(overview?.threatLevel ?? 'low')}`}>
              <span className="dot" />
              {overview ? formatThreat(overview.threatLevel) : 'Booting watch desk'}
            </div>
            <div className="mode-pill">
              <Workflow size={15} />
              <span>
                {snapshot
                  ? snapshot.orchestrator.mode === 'gemini'
                    ? `Gemini orchestrator: ${snapshot.orchestrator.model}`
                    : 'Guardrail fallback mode'
                  : 'Connecting to orchestrator'}
              </span>
            </div>
            <label className="scenario-control" htmlFor="scenario-select">
              <span>Scenario</span>
              <select
                id="scenario-select"
                value={scenario}
                onChange={(event) =>
                  setScenario(event.target.value as SimulationScenario)
                }
              >
                {scenarioOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="refresh-button"
              onClick={() => void fetchIntel(true, scenario)}
              disabled={isRefreshing}
            >
              <RefreshCcw size={16} className={isRefreshing ? 'spin' : ''} />
              <span>{isRefreshing ? 'Refreshing' : 'Refresh now'}</span>
            </button>
          </div>
        </div>

        <div className="hero-summary card">
          <p className="card-kicker">Operations posture</p>
          <h2>{overview?.headline ?? 'Preparing Tampa watch floor'}</h2>
          <p>
            {overview?.summary ??
              'Loading signal adapters and initializing the agent council.'}
          </p>
          {snapshot?.simulation.isSimulated ? (
            <div className="simulation-note">
              <strong>{snapshot.simulation.label}</strong>
              <span>{snapshot.simulation.description}</span>
            </div>
          ) : null}

          <dl className="summary-grid">
            <div>
              <dt>Confidence</dt>
              <dd>{overview ? `${Math.round(overview.confidence * 100)}%` : '...'}</dd>
            </div>
            <div>
              <dt>Official alerts</dt>
              <dd>{weather?.alerts.length ?? '...'}</dd>
            </div>
            <div>
              <dt>Zones watched</dt>
              <dd>{snapshot?.zones.length ?? '...'}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{snapshot ? formatTimestamp(snapshot.generatedAt) : '...'}</dd>
            </div>
          </dl>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="metrics-strip">
        <MetricCard
          icon={<Waves size={18} />}
          label="Peak tide in 24h"
          value={coastal ? `${coastal.maxPredictedFtNext24h.toFixed(2)} ft` : '--'}
          detail={
            coastal ? `${coastal.stations.length} NOAA coastal stations` : 'Waiting for NOAA'
          }
        />
        <MetricCard
          icon={<Wind size={18} />}
          label="Peak wind gust"
          value={weather ? `${weather.maxWindGustMphNext12h.toFixed(1)} mph` : '--'}
          detail={
            weather ? `NWS ${weather.office} next 12 hours` : 'Waiting for NWS'
          }
        />
        <MetricCard
          icon={<Siren size={18} />}
          label="Rain chance"
          value={weather ? `${weather.maxPrecipChanceNext12h}%` : '--'}
          detail={
            weather
              ? `${weather.maxPrecipMmNext12h.toFixed(1)} mm max QPF window`
              : 'No forecast yet'
          }
        />
        <MetricCard
          icon={<ShieldAlert size={18} />}
          label="Atlantic desk"
          value={
            tropical
              ? tropical.activeSystems.length > 0
                ? `${tropical.activeSystems.length} active systems`
                : 'Quiet basin'
              : '--'
          }
          detail={tropical ? tropical.basin : 'Waiting for NHC'}
        />
      </section>

      <main className="dashboard-grid">
        <section className="card map-card">
          <div className="section-head">
            <div>
              <p className="card-kicker">Tampa operations map</p>
              <h2>Google Maps risk zones, bayfront exposure, and active incidents</h2>
            </div>
            <div className="legend">
              <span>
                <i className="legend-dot flood" />
                Flood
              </span>
              <span>
                <i className="legend-dot weather" />
                Weather
              </span>
              <span>
                <i className="legend-dot storm" />
                Storm
              </span>
            </div>
          </div>

          <div className="map-wrap">
            {snapshot ? (
              <IntelMap
                center={[snapshot.location.lat, snapshot.location.lon]}
                incidents={snapshot.incidents}
                zones={snapshot.zones}
              />
            ) : (
              <div className="map-loading">Loading Tampa map layers...</div>
            )}
          </div>

          <div className="station-row">
            {coastal?.stations.map((station) => (
              <article key={station.stationId} className="station-chip">
                <p>{station.name}</p>
                <strong>{station.latestObservedFt.toFixed(2)} ft</strong>
                <span>Peak next 24h: {station.maxPredictedFtNext24h.toFixed(2)} ft</span>
              </article>
            ))}
          </div>
        </section>

        <aside className="side-column">
          <section className="card">
            <div className="section-head">
              <div>
                <p className="card-kicker">Agent council</p>
                <h2>How the bots are calling it</h2>
              </div>
            </div>

            <div className="agent-stack">
              {snapshot?.agents.map((agent) => (
                <article key={agent.id} className="agent-card">
                  <div className="agent-topline">
                    <div>
                      <h3>{agent.name}</h3>
                      <p>{agent.headline}</p>
                    </div>
                    <span className={`status-pill status-${agent.status}`}>
                      {agent.status}
                    </span>
                  </div>
                  <p className="agent-role">{agent.role}</p>
                  <p className="agent-summary">{agent.summary}</p>
                  <div className="agent-meter">
                    <div style={{ width: `${Math.round(agent.score * 100)}%` }} />
                  </div>
                  <ul className="evidence-list">
                    {agent.evidence.slice(0, 3).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section className="card">
            <p className="card-kicker">Recommended moves</p>
            <h2>Operational guidance</h2>
            <ul className="action-list">
              {(snapshot?.recommendations.length
                ? snapshot.recommendations
                : fallbackActions
              ).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </aside>
      </main>

      <section className="secondary-grid">
        <section className="card">
          <div className="section-head">
            <div>
              <p className="card-kicker">Incident queue</p>
              <h2>
                {snapshot?.incidents.length ? 'Active intelligence' : 'No active incidents'}
              </h2>
            </div>
          </div>

          {snapshot?.incidents.length ? (
            <div className="incident-list">
              {snapshot.incidents.map((incident) => (
                <article key={incident.id} className="incident-card">
                  <div className="incident-topline">
                    <strong>{incident.title}</strong>
                    <span className={`level-chip ${severityClass(incident.severity)}`}>
                      {formatThreat(incident.severity)}
                    </span>
                  </div>
                  <p>{incident.description}</p>
                  <small>
                    {incident.source} • {incident.recommendation}
                  </small>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">
              Tampa is quiet right now. The system is still watching coastal levels,
              rainfall, and Atlantic outlook feeds for the next shift.
            </p>
          )}
        </section>

        <section className="card">
          <p className="card-kicker">Priority neighborhoods</p>
          <h2>Watched zones</h2>
          <div className="zone-list">
            {snapshot?.zones.map((zone) => (
              <article key={zone.id} className="zone-card">
                <div className="zone-topline">
                  <strong>{zone.name}</strong>
                  <span className={`level-chip ${severityClass(zone.threatLevel)}`}>
                    {formatThreat(zone.threatLevel)}
                  </span>
                </div>
                <p>{zone.neighborhood}</p>
                <small>{zone.reason}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="card">
          <p className="card-kicker">Source adapters</p>
          <h2>
            {snapshot?.simulation.isSimulated
              ? 'Simulation-adjusted feeds'
              : 'Live data feeds'}
          </h2>
          <div className="sources-list">
            {snapshot?.sources.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="source-card"
              >
                <strong>{source.name}</strong>
                <span>
                  {source.updatedAt ? formatTimestamp(source.updatedAt) : 'Live feed'}
                </span>
              </a>
            ))}
          </div>
        </section>

        <section className="card architecture-card">
          <p className="card-kicker">Decision flow</p>
          <h2>Gemini-led orchestration path</h2>
          <div className="flow-strip">
            <span>Public feeds</span>
            <span>Weather Bot</span>
            <span>Flood Bot</span>
            <span>Storm Bot</span>
            <span>Final judge</span>
          </div>
          <p>
            The backend ingests NWS forecasts and alerts, NOAA water levels, and NHC
            outlooks. The specialist bots score their domain, then the judge resolves a
            single Tampa posture for the dashboard and alert queue.
          </p>
          <p className="small-note">
            {snapshot?.overview.monitoringMode ??
              'Once a Gemini key is present, the judge can become the primary synthesis layer.'}
          </p>
        </section>
      </section>

      {isLoading ? <div className="loading-bar" aria-hidden="true" /> : null}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Root App with Router
───────────────────────────────────────────── */

function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/evacuate" element={<EvacuatePage />} />
      </Routes>
    </BrowserRouter>
  )
}

/* ─────────────────────────────────────────────
   Shared sub-components & helpers
───────────────────────────────────────────── */

interface MetricCardProps {
  icon: ReactNode
  label: string
  value: string
  detail: string
}

function MetricCard({ icon, label, value, detail }: MetricCardProps) {
  return (
    <article className="metric-card card">
      <div className="metric-icon">{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  )
}

function severityClass(level: ThreatLevel): string {
  return `severity-${level}`
}

function formatThreat(level: ThreatLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1)
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

const fallbackActions = [
  'Maintain passive monitoring until the first full intel snapshot arrives.',
  'Verify that the backend can reach NWS, NOAA, and NHC adapters.',
  'Use the scenario selector to switch from live data into flood or hurricane drills.',
  'Add a Gemini API key to activate the AI final-judge path.',
]

const scenarioOptions: Array<{ value: SimulationScenario; label: string }> = [
  { value: 'live', label: 'Live Tampa feeds' },
  { value: 'flood', label: 'Flood drill' },
  { value: 'hurricane', label: 'Hurricane drill' },
  { value: 'compound', label: 'Compound event' },
]

export default App
