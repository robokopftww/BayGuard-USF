import {
  Activity,
  ArrowUpRight,
  BellRing,
  CarFront,
  CircleAlert,
  Compass,
  House,
  Map,
  RefreshCcw,
  ShieldAlert,
  Siren,
  Smartphone,
  Waves,
  Wind,
} from 'lucide-react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { startTransition, useCallback, useEffect, useState, type ReactNode } from 'react'

import { IntelMap } from './components/IntelMap'
import SmsPage from './pages/SmsPage'
import './App.css'
import type { IntelSnapshot, SimulationScenario, ThreatLevel } from '../shared/types'

function App() {
  const location = useLocation()
  const [snapshot, setSnapshot] = useState<IntelSnapshot | null>(null)
  const [scenario, setScenario] = useState<SimulationScenario>('live')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchIntel = useCallback(async (forceRefresh = false, selectedScenario: SimulationScenario) => {
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

      const response = await fetch(`/api/intel${params.size ? `?${params.toString()}` : ''}`)
      if (!response.ok) {
        throw new Error('BayGuard could not return a fresh intelligence snapshot.')
      }

      const data = (await response.json()) as IntelSnapshot
      startTransition(() => {
        setSnapshot(data)
      })
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Unable to reach the BayGuard backend.',
      )
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

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
  const alerts = weather?.alerts ?? []
  const incidents = snapshot?.incidents ?? []
  const zones = snapshot?.zones ?? []
  const activePage = pageMeta[location.pathname] ?? pageMeta['/']
  const liveContextLabel = snapshot
    ? snapshot.simulation.isSimulated
      ? snapshot.simulation.label
      : 'Live Tampa feeds'
    : 'Connecting'

  return (
    <div className="shell">
      <div className="shell-glow shell-glow-left" aria-hidden="true" />
      <div className="shell-glow shell-glow-right" aria-hidden="true" />

      <aside className="side-rail">
        <div className="brand-block">
          <div className="brand-mark">
            <ShieldAlert size={18} />
          </div>
          <div>
            <p className="rail-label">BayGuard</p>
            <h1>Tampa Ops</h1>
          </div>
        </div>

        <nav className="nav-stack" aria-label="Primary">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <item.icon size={18} />
              <div>
                <strong>{item.label}</strong>
                <span>{item.caption}</span>
              </div>
            </NavLink>
          ))}
        </nav>

        <div className="rail-status">
          <p className="rail-label">Current posture</p>
          <div className={`severity-band ${severityClass(overview?.threatLevel ?? 'low')}`}>
            <span className="band-dot" />
            <span>{overview ? formatThreat(overview.threatLevel) : 'Booting'}</span>
          </div>
          <p className="rail-note">
            {snapshot?.simulation.isSimulated
              ? `${snapshot.simulation.label}: ${snapshot.simulation.description}`
              : 'Live Tampa feeds are driving the dashboard right now.'}
          </p>
        </div>

        <div className="rail-footer">
          <div>
            <span className="rail-key">Updated</span>
            <strong>{snapshot ? formatTimestamp(snapshot.generatedAt) : 'Loading...'}</strong>
          </div>
          <div>
            <span className="rail-key">Alerts</span>
            <strong>{alerts.length}</strong>
          </div>
        </div>
      </aside>

      <main className="page-column">
        <header className="topbar">
          <div className="page-intro">
            <p className="page-kicker">{activePage.kicker}</p>
            <h2>{activePage.title}</h2>
            <p>{activePage.description}</p>
          </div>

          <div className="topbar-controls">
            <div className="control-pill">
              <Activity size={16} />
              <span>{liveContextLabel}</span>
            </div>

            <label className="control-pill control-select" htmlFor="scenario-select">
              <span>Scenario</span>
              <select
                id="scenario-select"
                value={scenario}
                onChange={(event) => setScenario(event.target.value as SimulationScenario)}
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
              className="refresh-action"
              onClick={() => void fetchIntel(true, scenario)}
              disabled={isRefreshing}
            >
              <RefreshCcw size={16} className={isRefreshing ? 'spin' : ''} />
              <span>{isRefreshing ? 'Refreshing' : 'Refresh'}</span>
            </button>
          </div>
        </header>

        {error ? <div className="alert-banner">{error}</div> : null}

        <Routes>
          <Route
            path="/"
            element={
              <OverviewPage
                coastal={coastal}
                incidents={incidents}
                overview={overview}
                snapshot={snapshot}
                tropical={tropical}
                weather={weather}
                zones={zones}
              />
            }
          />
          <Route
            path="/map"
            element={
              <MapPage
                coastal={coastal}
                incidents={incidents}
                snapshot={snapshot}
                zones={zones}
              />
            }
          />
          <Route
            path="/alerts"
            element={
              <AlertsPage
                alerts={alerts}
                incidents={incidents}
                overview={overview}
                snapshot={snapshot}
              />
            }
          />
          <Route path="/sms" element={<SmsPage activeScenario={scenario} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        {isLoading ? <div className="loading-line" aria-hidden="true" /> : null}
      </main>
    </div>
  )
}

interface OverviewPageProps {
  coastal: IntelSnapshot['signals']['coastal'] | undefined
  incidents: IntelSnapshot['incidents']
  overview: IntelSnapshot['overview'] | undefined
  snapshot: IntelSnapshot | null
  tropical: IntelSnapshot['signals']['tropical'] | undefined
  weather: IntelSnapshot['signals']['weather'] | undefined
  zones: IntelSnapshot['zones']
}

function OverviewPage({
  coastal,
  incidents,
  overview,
  snapshot,
  tropical,
  weather,
  zones,
}: OverviewPageProps) {
  const topActions = snapshot?.recommendations.slice(0, 3) ?? fallbackActions
  const priorityZones = [...zones].sort((left, right) => right.score - left.score).slice(0, 3)
  const leadZone = priorityZones[0]
  const officialAlertCount = weather?.alerts.length ?? 0
  const activeWatchCount = zones.filter((zone) => zone.threatLevel !== 'low').length
  const currentThreat = overview?.threatLevel ?? 'low'
  const statusLabel = friendlyThreatLabel(currentThreat)
  const threatNarrative = friendlyThreatNarrative(currentThreat)
  const monitoringLabel = snapshot?.simulation.isSimulated
    ? snapshot.simulation.label
    : 'Live community monitoring'
  const guidanceCards = [
    {
      title: 'Residents',
      tone: 'residents',
      icon: <House size={18} />,
      body: residentGuidance(currentThreat),
    },
    {
      title: 'Drivers',
      tone: 'drivers',
      icon: <CarFront size={18} />,
      body: driverGuidance(currentThreat),
    },
    {
      title: 'Bayfront',
      tone: 'waterfront',
      icon: <Waves size={18} />,
      body: waterfrontGuidance(currentThreat, coastal?.maxPredictedFtNext24h),
    },
  ] as const
  const overviewConfidence = overview ? `${Math.round(overview.confidence * 100)}%` : '--'

  return (
    <div className="page-grid page-grid-overview">
      <section className="hero-card overview-hero">
        <div className="overview-hero-grid">
          <div className="hero-mast">
            <div className="hero-badge-row">
              <span className={`overview-status-pill ${severityClass(currentThreat)}`}>{statusLabel}</span>
              <span className="overview-meta-pill">
                {snapshot ? `Updated ${formatTimestamp(snapshot.generatedAt)}` : 'Loading live updates'}
              </span>
            </div>
            <p className="page-kicker">For Tampa residents</p>
            <h3>{overview?.headline ?? 'Tampa is in quiet watch mode'}</h3>
            <p>
              {compactText(
                overview?.summary ??
                  'BayGuard is watching Tampa weather, flood, and tropical conditions so residents can quickly understand what matters right now.',
                170,
              )}
            </p>

            <div className="hero-summary-grid">
              <article className="hero-summary-card">
                <span>Most exposed area</span>
                <strong>{leadZone?.name ?? 'Tampa Bay region'}</strong>
                <small>{leadZone?.neighborhood ?? 'Citywide monitoring is active.'}</small>
              </article>
              <article className="hero-summary-card">
                <span>Official alerts</span>
                <strong>{officialAlertCount}</strong>
                <small>{officialAlertCount ? 'Weather Service notices are active now.' : 'No official notices are active right now.'}</small>
              </article>
              <article className="hero-summary-card">
                <span>BayGuard confidence</span>
                <strong>{overviewConfidence}</strong>
                <small>{overview?.monitoringMode ?? 'Citywide posture is being monitored live.'}</small>
              </article>
            </div>

            <div className="hero-actions-grid">
              <QuickActionCard
                to="/map"
                title="Map room"
                caption="See which neighborhoods and bayfront zones need attention."
                icon={<Map size={18} />}
              />
              <QuickActionCard
                to="/alerts"
                title="Alerts desk"
                caption="Review active incidents, official notices, and response language."
                icon={<BellRing size={18} />}
              />
              <QuickActionCard
                to="/sms"
                title="SMS alerts"
                caption="Manage subscribers and test live or drill dispatches."
                icon={<Smartphone size={18} />}
              />
            </div>
          </div>

          <aside className="overview-command-card">
            <div className="overview-command-intro">
              <p className="page-kicker">At a glance</p>
              <h4>{monitoringLabel}</h4>
              <p>{threatNarrative}</p>
            </div>

            <div className="snapshot-stat-grid snapshot-stat-grid-tight">
              <article className="snapshot-stat-card">
                <span>Threat level</span>
                <strong>{formatThreat(currentThreat)}</strong>
                <small>Current citywide posture.</small>
              </article>
              <article className="snapshot-stat-card">
                <span>Areas watched</span>
                <strong>{activeWatchCount}</strong>
                <small>Neighborhoods with elevated monitoring.</small>
              </article>
              <article className="snapshot-stat-card">
                <span>Peak tide</span>
                <strong>{coastal ? `${coastal.maxPredictedFtNext24h.toFixed(2)} ft` : '--'}</strong>
                <small>Highest predicted coastal level in the next 24 hours.</small>
              </article>
              <article className="snapshot-stat-card">
                <span>Peak gust</span>
                <strong>{weather ? `${weather.maxWindGustMphNext12h.toFixed(1)} mph` : '--'}</strong>
                <small>Strongest forecast wind in the next 12 hours.</small>
              </article>
            </div>

            <div className="overview-side-list">
              <div className="overview-side-item">
                <strong>{formatCount(officialAlertCount, 'official alert')}</strong>
                <span>National Weather Service notices active now.</span>
              </div>
              <div className="overview-side-item">
                <strong>{formatCount(incidents.length, 'incident card')}</strong>
                <span>Live BayGuard incidents currently visible in the alert desk.</span>
              </div>
              <div className="overview-side-item">
                <strong>{leadZone?.name ?? 'Tampa Bay region'}</strong>
                <span>{leadZone?.reason ?? 'No standout hotspot at the moment.'}</span>
              </div>
            </div>
          </aside>
        </div>

        <div className="metrics-grid">
          <SignalMetric
            icon={<Waves size={18} />}
            label="Peak tide window"
            value={coastal ? `${coastal.maxPredictedFtNext24h.toFixed(2)} ft` : '--'}
            detail={coastal ? `${coastal.stations.length} monitored stations` : 'Waiting for NOAA'}
          />
          <SignalMetric
            icon={<Wind size={18} />}
            label="Peak gust"
            value={weather ? `${weather.maxWindGustMphNext12h.toFixed(1)} mph` : '--'}
            detail={weather ? `NWS ${weather.office}` : 'Waiting for NWS'}
          />
          <SignalMetric
            icon={<Siren size={18} />}
            label="Rain load"
            value={weather ? `${weather.maxPrecipMmNext12h.toFixed(1)} mm` : '--'}
            detail={weather ? `${weather.maxPrecipChanceNext12h}% precipitation chance` : 'Forecast pending'}
          />
          <SignalMetric
            icon={<Compass size={18} />}
            label="Atlantic desk"
            value={
              tropical
                ? tropical.activeSystems.length > 0
                  ? `${tropical.activeSystems.length} active system`
                  : 'Quiet basin'
                : '--'
            }
            detail={tropical ? tropical.basin : 'Waiting for NHC'}
          />
        </div>
      </section>

      <section className="panel-card panel-span-full panel-card-soft">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Neighborhood watch</p>
            <h3>Where attention is building across Tampa</h3>
          </div>
          <Map size={18} />
        </div>

        {priorityZones.length ? (
          <div className="priority-zone-grid">
            {priorityZones.map((zone) => (
              <article key={zone.id} className="zone-spotlight">
                <div className="zone-row-top">
                  <strong>{zone.name}</strong>
                  <span className={`severity-chip ${severityClass(zone.threatLevel)}`}>
                    {formatThreat(zone.threatLevel)}
                  </span>
                </div>
                <p>{zone.neighborhood}</p>
                <small>{zone.reason}</small>
              </article>
            ))}
          </div>
        ) : (
          <EmptyBlock
            title="No priority zones yet"
            body="BayGuard has not identified a neighborhood that needs extra attention right now."
          />
        )}
      </section>

      <section className="panel-card guidance-panel">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Everyday guidance</p>
            <h3>What people in Tampa should keep in mind</h3>
          </div>
          <House size={18} />
        </div>

        <div className="guidance-grid guidance-grid-stack">
          {guidanceCards.map((card) => (
            <article key={card.title} className={`guidance-card guidance-card-${card.tone}`}>
              <div className="guidance-icon">{card.icon}</div>
              <div>
                <span className="guidance-label">{card.title}</span>
                <p>{card.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Incident queue</p>
            <h3>{incidents.length ? 'Current incidents' : 'Quiet watchlist'}</h3>
          </div>
          <CircleAlert size={18} />
        </div>

        {incidents.length ? (
          <div className="stack-list">
            {incidents.slice(0, 3).map((incident) => (
              <AlertCard key={incident.id} incident={incident} />
            ))}
          </div>
        ) : (
          <EmptyBlock
            title="No active incidents"
            body="The watch floor is monitoring conditions, but no alert card has crossed the operational threshold."
          />
        )}
      </section>

      <section className="panel-card panel-span-full">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Recommended next</p>
            <h3>Best next moves if conditions start changing</h3>
          </div>
          <Compass size={18} />
        </div>

        <div className="takeaway-list takeaway-list-inline">
          {topActions.map((item, index) => (
            <article key={item} className="takeaway-card">
              <span className="takeaway-index">0{index + 1}</span>
              <p>{compactText(item, 140)}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

interface MapPageProps {
  coastal: IntelSnapshot['signals']['coastal'] | undefined
  incidents: IntelSnapshot['incidents']
  snapshot: IntelSnapshot | null
  zones: IntelSnapshot['zones']
}

function MapPage({ coastal, incidents, snapshot, zones }: MapPageProps) {
  const topZones = [...zones].sort((left, right) => right.score - left.score).slice(0, 4)

  return (
    <div className="page-grid page-grid-map">
      <section className="map-stage">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Map room</p>
            <h3>Spatial watch over Tampa Bay</h3>
          </div>
          <div className="legend-strip">
            <span><i className="legend-swatch legend-flood" /> Flood</span>
            <span><i className="legend-swatch legend-weather" /> Weather</span>
            <span><i className="legend-swatch legend-storm" /> Storm</span>
          </div>
        </div>

        <div className="map-panel">
          {snapshot ? (
            <IntelMap
              center={[snapshot.location.lat, snapshot.location.lon]}
              incidents={incidents}
              zones={zones}
            />
          ) : (
            <div className="map-loading">Loading Tampa map layers...</div>
          )}
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Priority zones</p>
            <h3>Most exposed areas</h3>
          </div>
          <Activity size={18} />
        </div>

        <div className="stack-list">
          {topZones.map((zone) => (
            <article key={zone.id} className="zone-row">
              <div className="zone-row-top">
                <strong>{zone.name}</strong>
                <span className={`severity-chip ${severityClass(zone.threatLevel)}`}>
                  {formatThreat(zone.threatLevel)}
                </span>
              </div>
              <p>{zone.neighborhood}</p>
              <small>{zone.reason}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Water stations</p>
            <h3>Coastal telemetry</h3>
          </div>
          <Waves size={18} />
        </div>

        <div className="station-stack">
          {coastal?.stations.map((station) => (
            <article key={station.stationId} className="station-card-modern">
              <div>
                <strong>{station.name}</strong>
                <span>{station.stationId}</span>
              </div>
              <p>{station.latestObservedFt.toFixed(2)} ft observed</p>
              <small>Peak next 24h: {station.maxPredictedFtNext24h.toFixed(2)} ft</small>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

interface AlertsPageProps {
  alerts: IntelSnapshot['signals']['weather']['alerts']
  incidents: IntelSnapshot['incidents']
  overview: IntelSnapshot['overview'] | undefined
  snapshot: IntelSnapshot | null
}

function AlertsPage({ alerts, incidents, overview, snapshot }: AlertsPageProps) {
  return (
    <div className="page-grid page-grid-alerts">
      <section className="panel-card emphasis-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Alert posture</p>
            <h3>{overview?.headline ?? 'Waiting for alert intelligence'}</h3>
          </div>
          <BellRing size={18} />
        </div>
        <p className="lead-copy">
          {overview?.summary ??
            'The alert desk will light up here when official warnings or elevated incident signals arrive.'}
        </p>
        <div className="recommendation-list">
          {(snapshot?.recommendations.length ? snapshot.recommendations : fallbackActions).map((item) => (
            <div key={item} className="recommendation-item">
              <span className="recommendation-mark" />
              <p>{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Incident cards</p>
            <h3>{incidents.length ? 'Operational incidents' : 'No incidents yet'}</h3>
          </div>
          <Siren size={18} />
        </div>

        {incidents.length ? (
          <div className="stack-list">
            {incidents.map((incident) => (
              <AlertCard key={incident.id} incident={incident} />
            ))}
          </div>
        ) : (
          <EmptyBlock
            title="Quiet incident board"
            body="No event has crossed the internal send threshold. Try the disaster scenarios to preview how alerts will appear."
          />
        )}
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Official notices</p>
            <h3>{alerts.length ? 'Weather service alerts' : 'No official alerts'}</h3>
          </div>
          <CircleAlert size={18} />
        </div>

        {alerts.length ? (
          <div className="stack-list">
            {alerts.map((alert) => (
              <article key={alert.id} className="official-alert-row">
                <div className="official-alert-top">
                  <strong>{alert.event}</strong>
                  <span>{alert.severity}</span>
                </div>
                <p>{alert.headline}</p>
                <small>{alert.urgency}</small>
              </article>
            ))}
          </div>
        ) : (
          <EmptyBlock
            title="No NWS-issued notices"
            body="The official-weather panel is clear. Internal incidents can still appear when local thresholds are exceeded."
          />
        )}
      </section>
    </div>
  )
}

function AlertCard({ incident }: { incident: IntelSnapshot['incidents'][number] }) {
  return (
    <article className="alert-card-modern">
      <div className="alert-card-top">
        <strong>{incident.title}</strong>
        <span className={`severity-chip ${severityClass(incident.severity)}`}>
          {formatThreat(incident.severity)}
        </span>
      </div>
      <p>{incident.description}</p>
      <small>
        {incident.source} • {incident.recommendation}
      </small>
    </article>
  )
}

function SignalMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode
  label: string
  value: string
  detail: string
}) {
  return (
    <article className="signal-metric">
      <div className="metric-badge">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  )
}

function QuickActionCard({
  to,
  title,
  caption,
  icon,
}: {
  to: string
  title: string
  caption: string
  icon: ReactNode
}) {
  return (
    <NavLink to={to} className="quick-action-card">
      <div className="quick-action-icon">{icon}</div>
      <div>
        <strong>{title}</strong>
        <span>{caption}</span>
      </div>
      <div className="quick-action-foot">
        <small className="quick-action-link">Open page</small>
        <ArrowUpRight size={16} />
      </div>
    </NavLink>
  )
}

function EmptyBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-block">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
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

function compactText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength).trimEnd()}...`
}

function formatCount(value: number, label: string): string {
  return `${value} ${label}${value === 1 ? '' : 's'}`
}

function friendlyThreatLabel(level: ThreatLevel): string {
  switch (level) {
    case 'severe':
      return 'Take action now'
    case 'high':
      return 'Stay ready'
    case 'elevated':
      return 'Heads up'
    case 'guarded':
      return 'Watching closely'
    default:
      return 'Quiet watch'
  }
}

function friendlyThreatNarrative(level: ThreatLevel): string {
  switch (level) {
    case 'severe':
      return 'Serious conditions are active or expected soon. Use the map and alerts pages first, then follow official safety guidance.'
    case 'high':
      return 'Conditions are building enough that residents should stay alert, review local alerts, and be ready to adjust plans.'
    case 'elevated':
      return 'Some signals are starting to rise. It is a good time to check exposed neighborhoods and keep an eye on new alerts.'
    case 'guarded':
      return 'Tampa is under a light watch. There is no major hazard right now, but BayGuard is tracking changing conditions.'
    default:
      return 'No major hazards are active right now. This page gives a quick read on the city while BayGuard keeps monitoring in the background.'
  }
}

function residentGuidance(level: ThreatLevel): string {
  switch (level) {
    case 'severe':
      return 'Follow official emergency guidance now, stay off risky streets, and check in with family or neighbors who may need help.'
    case 'high':
      return 'Keep plans flexible today, avoid low-lying areas, and be ready for quick changes if local warnings increase.'
    case 'elevated':
      return 'Conditions are starting to build. Check alerts before heading out and keep your phone notifications on.'
    case 'guarded':
      return 'Nothing urgent is happening now, but BayGuard is watching closely so you can react early if that changes.'
    default:
      return 'A calm day across Tampa. This is a good time to get familiar with the map and alerts pages before you need them.'
  }
}

function driverGuidance(level: ThreatLevel): string {
  switch (level) {
    case 'severe':
      return 'Avoid unnecessary travel and never drive into standing water. Use alternate routes if any streets start closing.'
    case 'high':
      return 'Skip flood-prone shortcuts, underpasses, and bayfront roads if conditions worsen later today.'
    case 'elevated':
      return 'Give yourself extra time and watch the map for any pockets of heavy rain or drainage trouble.'
    case 'guarded':
      return 'Road impacts are unlikely right now, but common ponding spots are worth checking before peak traffic.'
    default:
      return 'Travel conditions look normal, with BayGuard standing by in case weather or water levels start changing.'
  }
}

function waterfrontGuidance(level: ThreatLevel, peakWaterFt?: number): string {
  const waterNote =
    peakWaterFt !== undefined
      ? `BayGuard is currently watching for a peak water level near ${peakWaterFt.toFixed(2)} ft.`
      : 'BayGuard is still waiting on the latest coastal guidance.'

  switch (level) {
    case 'severe':
      return `${waterNote} Stay away from exposed shoreline areas and follow official instructions near the coast.`
    case 'high':
      return `${waterNote} People near the bay should be ready for quick changes in shoreline or street conditions.`
    case 'elevated':
      return `${waterNote} It is a good time to watch waterfront neighborhoods and check the map before heading out.`
    case 'guarded':
      return `${waterNote} Conditions are steady for now, but the bayfront is still being monitored.`
    default:
      return `${waterNote} No major coastal concern is active at the moment.`
  }
}

const fallbackActions = [
  'Keep the watch floor polling every few minutes while no major alert is active.',
  'Use the scenario selector to preview flood, hurricane, and compound-event workflows.',
  'Use the SMS page to manage subscribers and rehearse dry-run drills before live texting is enabled.',
]

const scenarioOptions: Array<{ value: SimulationScenario; label: string }> = [
  { value: 'live', label: 'Live Tampa feeds' },
  { value: 'flood', label: 'Flood drill' },
  { value: 'hurricane', label: 'Hurricane drill' },
  { value: 'compound', label: 'Compound event' },
]

const navItems = [
  { to: '/', label: 'Overview', caption: 'Citywide posture', icon: Compass },
  { to: '/map', label: 'Map Room', caption: 'Spatial signal view', icon: Map },
  { to: '/alerts', label: 'Alerts', caption: 'Incidents and notices', icon: BellRing },
  { to: '/sms', label: 'SMS', caption: 'Subscribers and dispatch', icon: Smartphone },
]

const pageMeta: Record<string, { kicker: string; title: string; description: string }> = {
  '/': {
    kicker: 'Overview',
    title: 'Know what Tampa needs right now.',
    description:
      'BayGuard turns weather, flood, and storm monitoring into a clear front page that people can understand in seconds.',
  },
  '/map': {
    kicker: 'Map',
    title: 'A dedicated spatial view for neighborhoods, incidents, and coastal telemetry.',
    description:
      'Use the map room when you need to understand where conditions are building instead of just how severe they are.',
  },
  '/alerts': {
    kicker: 'Alerts',
    title: 'A focused page for incidents, official notices, and action language.',
    description:
      'This alert desk is built for escalation: what happened, how serious it is, and what the operations team should say next.',
  },
  '/sms': {
    kicker: 'SMS',
    title: 'A simple control room for who gets texted and when.',
    description:
      'Manage the BayGuard SMS roster, keep drills in dry-run mode, and switch to live sending only after Twilio is configured.',
  },
}

export default App
