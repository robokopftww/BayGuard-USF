import {
  Activity,
  ArrowUpRight,
  BellRing,
  Bot,
  CarFront,
  CircleAlert,
  Compass,
  DatabaseZap,
  House,
  Map,
  MessageSquareWarning,
  RefreshCcw,
  ShieldAlert,
  Siren,
  Smartphone,
  Sparkles,
  Waves,
  Workflow,
  Wind,
} from 'lucide-react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { startTransition, useCallback, useEffect, useState, type ReactNode } from 'react'

import { IntelMap } from './components/IntelMap'
import ReportsPage from './pages/ReportsPage'
import SmsPage from './pages/SmsPage'
import './App.css'
import type { CommunityReportsState, IntelSnapshot, SimulationScenario, ThreatLevel } from '../shared/types'

function App() {
  const location = useLocation()
  const [snapshot, setSnapshot] = useState<IntelSnapshot | null>(null)
  const [scenario, setScenario] = useState<SimulationScenario>('live')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyScenario = useCallback((nextScenario: SimulationScenario) => {
    setIsLoading(true)
    setScenario(nextScenario)
  }, [])

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
  const liveContextLabel = snapshot ? scenarioLabel(scenario) : 'Connecting'

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
            <h1>Tampa Watch</h1>
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
          <p className="rail-label">Current status</p>
          <div className={`severity-band ${severityClass(overview?.threatLevel ?? 'low')}`}>
            <span className="band-dot" />
            <span>{overview ? formatThreat(overview.threatLevel) : 'Booting'}</span>
          </div>
          <p className="rail-note">
            {snapshot?.simulation.isSimulated
              ? `${scenarioLabel(scenario)} is active so you can preview how BayGuard responds.`
              : 'Live Tampa updates are powering the page right now.'}
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
                onChange={(event) => applyScenario(event.target.value as SimulationScenario)}
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
                currentScenario={scenario}
                incidents={incidents}
                onLaunchScenario={applyScenario}
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
            path="/about"
            element={
              <AboutPage
                currentScenario={scenario}
                incidents={incidents}
                onLaunchScenario={applyScenario}
                overview={overview}
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
          <Route path="/reports" element={<ReportsPage />} />
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
  currentScenario: SimulationScenario
  incidents: IntelSnapshot['incidents']
  onLaunchScenario: (scenario: SimulationScenario) => void
  overview: IntelSnapshot['overview'] | undefined
  snapshot: IntelSnapshot | null
  tropical: IntelSnapshot['signals']['tropical'] | undefined
  weather: IntelSnapshot['signals']['weather'] | undefined
  zones: IntelSnapshot['zones']
}

function useCommunityReportsState() {
  const [reportState, setReportState] = useState<CommunityReportsState | null>(null)

  useEffect(() => {
    let isMounted = true

    void (async () => {
      try {
        const response = await fetch('/api/reports')
        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as CommunityReportsState
        if (isMounted) {
          setReportState(payload)
        }
      } catch {
        // Pages can still render if the reports feed is unavailable.
      }
    })()

    return () => {
      isMounted = false
    }
  }, [])

  return reportState
}

function OverviewPage({
  coastal,
  currentScenario,
  incidents,
  onLaunchScenario,
  overview,
  snapshot,
  tropical,
  weather,
  zones,
}: OverviewPageProps) {
  const reportState = useCommunityReportsState()

  const topActions = snapshot?.recommendations.slice(0, 3) ?? fallbackActions
  const priorityZones = [...zones].sort((left, right) => right.score - left.score).slice(0, 3)
  const leadZone = priorityZones[0]
  const officialAlertCount = weather?.alerts.length ?? 0
  const activeWatchCount = zones.filter((zone) => zone.threatLevel !== 'low').length
  const highRiskZoneCount = zones.filter((zone) => threatRank(zone.threatLevel) >= threatRank('elevated')).length
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
  const verifiedReports = reportState?.stats.confirmedCount ?? 0
  const totalReports = reportState?.stats.totalReports ?? 0
  const connectedSourceCount = (snapshot?.sources.length ?? 0) + 1
  const generatedAlertCount = officialAlertCount + incidents.length
  const heroMetrics = [
    {
      label: 'Verified reports',
      value: `${verifiedReports}`,
      detail:
        reportState?.stats.likelyCount && reportState.stats.likelyCount > 0
          ? `${reportState.stats.likelyCount} more are likely`
          : totalReports > 0
            ? `${totalReports} report${totalReports === 1 ? '' : 's'} reviewed`
            : 'No community claims yet',
    },
    {
      label: 'High-risk zones',
      value: `${highRiskZoneCount}`,
      detail: `${activeWatchCount} neighborhoods under active monitoring`,
    },
    {
      label: 'Alerts generated',
      value: `${generatedAlertCount}`,
      detail:
        generatedAlertCount > 0
          ? 'Warnings and recent updates are visible'
          : 'No active warning package right now',
    },
    {
      label: 'Live feeds connected',
      value: `${connectedSourceCount}`,
      detail: 'NWS, NOAA, NHC, plus community intelligence',
    },
  ] as const

  return (
    <div className="page-grid page-grid-overview">
      <section className="hero-card overview-hero">
        <div className="overview-hero-grid">
          <div className="hero-mast-shell">
            <div className="hero-mast">
              <div className="hero-badge-row">
                <span className={`overview-status-pill ${severityClass(currentThreat)}`}>{statusLabel}</span>
                <span className="overview-meta-pill">
                    {snapshot ? `Updated ${formatTimestamp(snapshot.generatedAt)}` : 'Loading live updates'}
                </span>
                <span className="overview-meta-pill">{scenarioLabel(currentScenario)}</span>
              </div>
              <p className="page-kicker">Real-time Tampa safety updates</p>
              <h3>BayGuard gives Tampa a clear view of changing flood and storm conditions.</h3>
              <p>
                BayGuard follows rainfall, tides, wind, and resident updates so people can quickly
                see what matters now, where it matters most, and what to do next.
              </p>
            </div>

            <div className="hero-mast-bottom">
              <div className="hero-summary-grid">
                {heroMetrics.map((metric) => (
                  <article key={metric.label} className="hero-summary-card">
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <small>{metric.detail}</small>
                  </article>
                ))}
              </div>

              <div className="hero-cta-row">
                <NavLink to="/map" className="hero-primary-link">
                  <Map size={18} />
                  <span>Open live risk map</span>
                </NavLink>
                <NavLink to="/about" className="hero-secondary-link">
                  <Sparkles size={18} />
                  <span>How BayGuard works</span>
                </NavLink>
                <NavLink to="/reports" className="hero-secondary-link">
                  <MessageSquareWarning size={18} />
                  <span>Check resident reports</span>
                </NavLink>
                <button
                  type="button"
                  className="hero-secondary-link"
                  onClick={() => onLaunchScenario('flood')}
                >
                  <Workflow size={18} />
                  <span>Preview flood scenario</span>
                </button>
              </div>
            </div>
          </div>

          <aside className="overview-command-card">
            <div className="overview-command-intro">
              <p className="page-kicker">Right now</p>
              <h4>{monitoringLabel}</h4>
              <p>{threatNarrative}</p>
            </div>

            <div className="overview-pulse-row">
              <article className="overview-pulse-card">
                <span>Threat level</span>
                <strong>{formatThreat(currentThreat)}</strong>
              </article>
              <article className="overview-pulse-card">
                <span>Areas watched</span>
                <strong>{activeWatchCount}</strong>
              </article>
            </div>

            <div className="snapshot-stat-grid snapshot-stat-grid-tight">
              <article className="snapshot-stat-card snapshot-stat-card-compact">
                <span>Peak tide</span>
                <strong>{coastal ? `${coastal.maxPredictedFtNext24h.toFixed(2)} ft` : '--'}</strong>
                <small>Highest predicted coastal level in the next 24 hours.</small>
              </article>
              <article className="snapshot-stat-card snapshot-stat-card-compact">
                <span>Peak gust</span>
                <strong>{weather ? `${weather.maxWindGustMphNext12h.toFixed(1)} mph` : '--'}</strong>
                <small>Strongest forecast wind in the next 12 hours.</small>
              </article>
            </div>

            <article className="overview-focus-card">
              <span className="page-kicker">Why it matters</span>
              <strong>{leadZone?.name ?? 'Tampa Bay region'}</strong>
              <p>{compactText(leadZone?.reason ?? 'No standout hotspot at the moment.', 160)}</p>
              <small>
                {formatCount(officialAlertCount, 'official warning')}, {formatCount(incidents.length, 'recent update')}, and BayGuard&apos;s confidence is {overviewConfidence}.
              </small>
            </article>
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
            label="Atlantic outlook"
            value={
              tropical
                ? tropical.activeSystems.length > 0
                  ? `${tropical.activeSystems.length} active system`
                  : 'Quiet basin'
                : '--'
            }
            detail={tropical ? tropical.basin : 'Waiting for hurricane outlook'}
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
            <p className="page-kicker">Recent updates</p>
            <h3>{incidents.length ? 'Current alerts and reports' : 'Nothing urgent right now'}</h3>
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
              body="BayGuard is still watching conditions, but nothing has risen to an active alert yet."
            />
          )}
      </section>

      <section className="panel-card panel-span-full">
        <div className="panel-head">
          <div>
            <p className="page-kicker">What to do next</p>
            <h3>Helpful next steps if conditions start changing</h3>
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

interface AboutPageProps {
  currentScenario: SimulationScenario
  incidents: IntelSnapshot['incidents']
  onLaunchScenario: (scenario: SimulationScenario) => void
  overview: IntelSnapshot['overview'] | undefined
  snapshot: IntelSnapshot | null
  zones: IntelSnapshot['zones']
}

function AboutPage({
  currentScenario,
  incidents,
  onLaunchScenario,
  overview,
  snapshot,
  zones,
}: AboutPageProps) {
  const reportState = useCommunityReportsState()
  const currentThreat = overview?.threatLevel ?? 'low'
  const activeWatchCount = zones.filter((zone) => zone.threatLevel !== 'low').length
  const highRiskZoneCount = zones.filter((zone) => threatRank(zone.threatLevel) >= threatRank('elevated')).length
  const officialAlertCount = snapshot?.signals.weather.alerts.length ?? 0
  const verifiedReports = reportState?.stats.confirmedCount ?? 0
  const connectedSourceCount = (snapshot?.sources.length ?? 0) + 1
  const moduleCards = [
    {
      title: 'Live Risk Map',
      caption: 'See exposed neighborhoods, recent alerts, and water levels on one Tampa map.',
      proof: 'Live neighborhood map',
      icon: <Map size={18} />,
      to: '/map',
    },
    {
      title: 'Resident Reports',
      caption: 'Residents can report what they see while BayGuard checks it against current conditions.',
      proof: 'Checked against current conditions',
      icon: <MessageSquareWarning size={18} />,
      to: '/reports',
    },
    {
      title: 'Clear Alerts',
      caption: 'Turns changing conditions into easy-to-read updates and guidance.',
      proof: 'Clear summaries and alerts',
      icon: <BellRing size={18} />,
      to: '/alerts',
    },
    {
      title: 'Text Alerts',
      caption: 'Send important updates to subscribers during practice runs now and live events later.',
      proof: 'Subscriber text updates',
      icon: <Smartphone size={18} />,
      to: '/sms',
    },
    {
      title: 'Neighborhood Watch',
      caption: 'Keeps a close eye on Tampa areas using tide, rain, wind, and local risk patterns.',
      proof: 'Tampa-focused area scoring',
      icon: <Activity size={18} />,
      to: '/map',
    },
    {
      title: 'Travel Guidance',
      caption: 'Highlights streets and neighborhoods where travel may become harder or less safe.',
      proof: 'Street and route awareness',
      icon: <CarFront size={18} />,
      to: '/alerts',
    },
  ] as const
  const agentCards = [
    {
      title: 'Weather Watch',
      summary: 'Watches rain, wind, and weather warnings to spot when conditions are starting to change.',
      proof: 'Weather forecasts and warnings',
      icon: <Wind size={18} />,
    },
    {
      title: 'Flood Watch',
      summary: 'Looks at water levels, rainfall, and flood-prone neighborhoods to catch trouble early.',
      proof: 'Water levels and flood-prone areas',
      icon: <Waves size={18} />,
    },
    {
      title: 'Storm Watch',
      summary: 'Tracks tropical updates and stronger storm signals that could quickly raise risk across Tampa.',
      proof: 'Storm outlooks and local weather changes',
      icon: <Siren size={18} />,
    },
    {
      title: 'Report Checker',
      summary: 'Compares resident reports with current conditions before BayGuard treats them as likely or confirmed.',
      proof:
        reportState?.verificationMode === 'gemini'
          ? 'AI-supported review'
          : 'Automatic report review',
      icon: <ShieldAlert size={18} />,
    },
    {
      title: 'Alert Writer',
      summary: 'Turns fast-changing conditions into short, clear updates people can understand quickly.',
      proof: 'Plain-language updates',
      icon: <Sparkles size={18} />,
    },
  ] as const
  const demoFlow = [
    'A resident reports flooding on a Tampa street or waterfront block.',
    'BayGuard checks that claim against weather warnings, rainfall, water levels, and nearby risk.',
    'If the claim lines up, the map and alerts page highlight the exposed area.',
    'BayGuard drafts a short update in plain language.',
    'The text alerts page can send the update to subscribers or preview it as a practice run.',
  ] as const
  const credibilitySources = [
    ...(snapshot?.sources ?? []),
    {
      name: 'Community reports',
      url: '/reports',
      updatedAt: reportState?.lastSubmissionAt,
    },
  ]
  const whyTampaPoints = [
    'Tampa combines bayfront exposure, low-lying roads, and fast afternoon rain in one metro area.',
    'Neighborhoods like Davis Islands, Hyde Park, Rocky Point, and the University Area each react differently to the same storm.',
    'BayGuard is tuned for Tampa-specific conditions instead of treating the city like a generic weather dashboard.',
  ] as const

  return (
    <div className="page-grid page-grid-about">
      <section className="hero-card overview-hero">
        <div className="overview-hero-grid">
          <div className="hero-mast-shell">
            <div className="hero-mast">
              <div className="hero-badge-row">
                <span className={`overview-status-pill ${severityClass(currentThreat)}`}>
                  {formatThreat(currentThreat)}
                </span>
                <span className="overview-meta-pill">{scenarioLabel(currentScenario)}</span>
                <span className="overview-meta-pill">
                  {snapshot ? `Updated ${formatTimestamp(snapshot.generatedAt)}` : 'Loading live updates'}
                </span>
              </div>
              <p className="page-kicker">About BayGuard</p>
              <h3>BayGuard helps Tampa understand flood and storm risk in plain language.</h3>
              <p>
                It brings together weather updates, water levels, resident reports, and alerts in
                one place so people can quickly understand what is happening and what to do next.
              </p>
            </div>

            <div className="hero-mast-bottom">
              <div className="hero-summary-grid">
                <article className="hero-summary-card">
                  <span>Current risk</span>
                  <strong>{formatThreat(currentThreat)}</strong>
                  <small>{overview?.headline ?? 'Citywide monitoring is active.'}</small>
                </article>
                <article className="hero-summary-card">
                  <span>Live sources</span>
                  <strong>{connectedSourceCount}</strong>
                  <small>Weather, water, storm, and resident updates</small>
                </article>
                <article className="hero-summary-card">
                  <span>Verified reports</span>
                  <strong>{verifiedReports}</strong>
                  <small>Reports BayGuard can strongly support</small>
                </article>
                <article className="hero-summary-card">
                  <span>Watched areas</span>
                  <strong>{highRiskZoneCount}</strong>
                  <small>{activeWatchCount} neighborhoods currently being watched</small>
                </article>
              </div>

              <div className="hero-cta-row">
                <button type="button" className="hero-primary-link" onClick={() => onLaunchScenario('compound')}>
                  <Workflow size={18} />
                  <span>Run the full BayGuard demo</span>
                </button>
                <NavLink to="/map" className="hero-secondary-link">
                  <Map size={18} />
                  <span>Open the live map</span>
                </NavLink>
                <NavLink to="/reports" className="hero-secondary-link">
                  <MessageSquareWarning size={18} />
                  <span>Open resident reports</span>
                </NavLink>
              </div>
            </div>
          </div>

          <aside className="overview-command-card">
            <div className="overview-command-intro">
              <p className="page-kicker">At a glance</p>
              <h4>What BayGuard is tracking right now</h4>
              <p>
                BayGuard brings together local weather, water, resident reports, and alerts in one
                place so changes are easier to understand.
              </p>
            </div>

            <div className="overview-pulse-row">
              <article className="overview-pulse-card">
                <span>Official alerts</span>
                <strong>{officialAlertCount}</strong>
              </article>
              <article className="overview-pulse-card">
                <span>Recent updates</span>
                <strong>{incidents.length}</strong>
              </article>
            </div>

            <article className="overview-focus-card">
              <span className="page-kicker">Why it helps</span>
              <strong>Make fast-changing conditions easier to understand</strong>
              <p>
                BayGuard helps people understand what is happening nearby, which reports seem
                trustworthy, and what to do next.
              </p>
            </article>
          </aside>
        </div>
      </section>

      <section className="panel-card panel-span-full panel-card-soft">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Main features</p>
            <h3>What BayGuard actually does</h3>
          </div>
          <DatabaseZap size={18} />
        </div>

        <div className="module-grid">
          {moduleCards.map((module) => (
            <QuickActionCard
              key={module.title}
              to={module.to}
              title={module.title}
              caption={module.caption}
              detail={module.proof}
              icon={module.icon}
            />
          ))}
        </div>
      </section>

      <section className="panel-card panel-span-full demo-flow-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">End-to-end demo flow</p>
            <h3>How one report moves through BayGuard</h3>
          </div>
          <Workflow size={18} />
        </div>

        <div className="demo-flow-grid">
          {demoFlow.map((step, index) => (
            <article key={step} className="demo-step-card">
              <span className="takeaway-index">0{index + 1}</span>
              <p>{step}</p>
            </article>
          ))}
        </div>

        <div className="demo-flow-actions">
          <button type="button" className="primary-action" onClick={() => onLaunchScenario('flood')}>
            <Workflow size={16} />
            <span>Run flood scenario</span>
          </button>
          <button type="button" className="ghost-action" onClick={() => onLaunchScenario('hurricane')}>
            <Workflow size={16} />
            <span>Run hurricane scenario</span>
          </button>
          <NavLink to="/reports" className="hero-secondary-link hero-secondary-link-inline">
            <MessageSquareWarning size={16} />
            <span>Open resident reports</span>
          </NavLink>
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">How BayGuard checks things</p>
            <h3>How BayGuard checks different kinds of risk</h3>
          </div>
          <Bot size={18} />
        </div>

        <div className="agent-story-grid">
          {agentCards.map((agent) => (
            <article key={agent.title} className="agent-story-card">
              <div className="agent-story-icon">{agent.icon}</div>
              <div>
                <strong>{agent.title}</strong>
                <p>{agent.summary}</p>
                <small>{agent.proof}</small>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Live sources</p>
            <h3>Connected Tampa updates</h3>
          </div>
          <DatabaseZap size={18} />
        </div>

        <div className="source-status-grid">
          {credibilitySources.map((source) => (
            <article key={source.name} className="source-status-card">
              <div className="source-status-top">
                <strong>{source.name}</strong>
                <span className="source-live-pill">Connected</span>
              </div>
              <p>
                {source.name === 'Community reports'
                  ? 'Resident updates are compared with current weather and water conditions.'
                  : 'A live source BayGuard checks while watching Tampa conditions.'}
              </p>
              <small>
                {source.updatedAt ? `Updated ${formatTimestamp(source.updatedAt)}` : 'Watching live'}
              </small>
            </article>
          ))}
        </div>
      </section>

      <section className="panel-card panel-span-full">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Why Tampa?</p>
            <h3>Why Tampa needs closer watching</h3>
          </div>
          <Compass size={18} />
        </div>

        <div className="why-tampa-list">
          {whyTampaPoints.map((point, index) => (
            <div key={point} className="recommendation-item">
              <span className="takeaway-index">0{index + 1}</span>
              <p>{point}</p>
            </div>
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
            <p className="page-kicker">City map</p>
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
            <p className="page-kicker">Water levels</p>
            <h3>Bay and tide readings</h3>
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
            <p className="page-kicker">Current alert level</p>
            <h3>{overview?.headline ?? 'Waiting for new updates'}</h3>
          </div>
          <BellRing size={18} />
        </div>
        <p className="lead-copy">
          {overview?.summary ??
            'This page will fill with warnings and important updates as conditions change.'}
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
            <p className="page-kicker">Recent alerts</p>
            <h3>{incidents.length ? 'What needs attention right now' : 'No active alerts yet'}</h3>
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
            title="Nothing urgent right now"
            body="No local issue has turned into an active alert. Try a practice scenario to preview how this page changes."
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
            title="No official weather notices"
            body="The weather warning list is clear right now. Local alerts can still appear here if conditions worsen."
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
  detail,
  icon,
}: {
  to: string
  title: string
  caption: string
  detail?: string
  icon: ReactNode
}) {
  return (
    <NavLink to={to} className="quick-action-card">
      <div className="quick-action-icon">{icon}</div>
      <div>
        <strong>{title}</strong>
        <span>{caption}</span>
        {detail ? <small>{detail}</small> : null}
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

function threatRank(level: ThreatLevel): number {
  return ['low', 'guarded', 'elevated', 'high', 'severe'].indexOf(level)
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

function scenarioLabel(scenario: SimulationScenario): string {
  return scenarioOptions.find((option) => option.value === scenario)?.label ?? 'Live Tampa feeds'
}

const fallbackActions = [
  'BayGuard will keep checking Tampa conditions every few minutes while no major alert is active.',
  'Use the scenario selector to preview flood, hurricane, and combined-weather scenarios.',
  'Use the text alerts page to manage subscribers and test practice messages before live texting is turned on.',
]

const scenarioOptions: Array<{ value: SimulationScenario; label: string }> = [
  { value: 'live', label: 'Live Tampa updates' },
  { value: 'flood', label: 'Flood practice' },
  { value: 'hurricane', label: 'Hurricane practice' },
  { value: 'compound', label: 'Combined weather event' },
]

const navItems = [
  { to: '/', label: 'Overview', caption: 'Citywide update', icon: Compass },
  { to: '/map', label: 'Map', caption: 'Neighborhood view', icon: Map },
  { to: '/reports', label: 'Reports', caption: 'Resident updates', icon: MessageSquareWarning },
  { to: '/alerts', label: 'Alerts', caption: 'Incidents and notices', icon: BellRing },
  { to: '/sms', label: 'SMS', caption: 'Text alerts', icon: Smartphone },
  { to: '/about', label: 'About', caption: 'How it works', icon: Sparkles },
]

const pageMeta: Record<string, { kicker: string; title: string; description: string }> = {
  '/': {
    kicker: 'Overview',
    title: 'A real-time Tampa safety hub for flood, storm, and resident updates.',
    description:
      'BayGuard brings together weather, water, and resident updates so people can quickly see what is changing across Tampa.',
  },
  '/about': {
    kicker: 'About',
    title: 'How BayGuard works across the city.',
    description:
      'Use this page to see what BayGuard does, how reports are checked, and why Tampa needs close monitoring.',
  },
  '/map': {
    kicker: 'Map',
    title: 'A live city map for neighborhoods, alerts, and water levels.',
    description:
      'Use the map to see where conditions are building, not just how severe they are.',
  },
  '/reports': {
    kicker: 'Reports',
    title: 'Resident reports checked against current conditions.',
    description:
      'Residents can share what they are seeing on the ground while BayGuard compares those reports with current Tampa conditions.',
  },
  '/alerts': {
    kicker: 'Alerts',
    title: 'Warnings, local updates, and what to do next.',
    description:
      'Use this page to see what happened, how serious it is, and which steps make sense next.',
  },
  '/sms': {
    kicker: 'SMS',
    title: 'A simple place to manage text alerts.',
    description:
      'Add subscribers, try practice message runs, and switch to live text alerts when your message service is ready.',
  },
}

export default App
