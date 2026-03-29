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
import { startTransition, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { IntelMap } from './components/IntelMap'
import ReportsPage from './pages/ReportsPage'
import SmsPage from './pages/SmsPage'
import './App.css'
import type {
  CommunityReportsState,
  EvacuationPlan,
  IntelSnapshot,
  SimulationScenario,
  ThreatLevel,
} from '../shared/types'

type MapHazard = 'all' | 'flood' | 'weather' | 'storm'

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
  const activePage = pageMeta[location.pathname] ?? pageMeta['/map']
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
              end
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
          <Route path="/" element={<Navigate to="/map" replace />} />
          <Route
            path="/overview"
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
          <Route path="*" element={<Navigate to="/map" replace />} />
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
    : 'Tampa right now'
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
          ? `${reportState.stats.likelyCount} more need review`
          : totalReports > 0
            ? `${totalReports} checked so far`
            : 'No confirmed reports',
    },
    {
      label: 'High-risk zones',
      value: `${highRiskZoneCount}`,
      detail: `${activeWatchCount} areas being watched`,
    },
    {
      label: 'Alerts generated',
      value: `${generatedAlertCount}`,
      detail:
        generatedAlertCount > 0
          ? 'Warnings and updates are live'
          : 'No active warnings',
    },
    {
      label: 'Live feeds connected',
      value: `${connectedSourceCount}`,
      detail: 'NWS, NOAA, NHC, and local reports',
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
              <p className="page-kicker">Live Tampa updates</p>
              <h3>See flood and storm risk across Tampa.</h3>
              <p>Rain, tides, wind, and resident reports in one quick view.</p>
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
                  <span>Open map</span>
                </NavLink>
                <NavLink to="/about" className="hero-secondary-link">
                  <Sparkles size={18} />
                  <span>How it works</span>
                </NavLink>
                <NavLink to="/reports" className="hero-secondary-link">
                  <MessageSquareWarning size={18} />
                  <span>View reports</span>
                </NavLink>
                <button
                  type="button"
                  className="hero-secondary-link"
                  onClick={() => onLaunchScenario('flood')}
                >
                  <Workflow size={18} />
                  <span>Run flood demo</span>
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
                <span>Zones watched</span>
                <strong>{activeWatchCount}</strong>
              </article>
            </div>

            <div className="snapshot-stat-grid snapshot-stat-grid-tight">
              <article className="snapshot-stat-card snapshot-stat-card-compact">
                <span>Peak tide</span>
                <strong>{coastal ? `${coastal.maxPredictedFtNext24h.toFixed(2)} ft` : '--'}</strong>
                <small>Next 24 hours</small>
              </article>
              <article className="snapshot-stat-card snapshot-stat-card-compact">
                <span>Peak gust</span>
                <strong>{weather ? `${weather.maxWindGustMphNext12h.toFixed(1)} mph` : '--'}</strong>
                <small>Next 12 hours</small>
              </article>
            </div>

            <article className="overview-focus-card">
              <span className="page-kicker">Focus area</span>
              <strong>{leadZone?.name ?? 'Tampa Bay region'}</strong>
              <p>{compactText(leadZone?.reason ?? 'No standout hotspot right now.', 108)}</p>
              <small>
                {formatCount(officialAlertCount, 'warning')} · {formatCount(incidents.length, 'update')} · {overviewConfidence} confidence
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
            <h3>Areas to watch</h3>
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
            <h3>What to know</h3>
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
            <h3>{incidents.length ? 'Latest alerts' : 'Nothing urgent'}</h3>
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
            <h3>Next steps</h3>
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
              <h3>How BayGuard helps Tampa.</h3>
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
              <h4>What BayGuard tracks</h4>
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
            <h3>What BayGuard does</h3>
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
            <h3>How one report moves</h3>
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
            <h3>How BayGuard checks risk</h3>
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
            <h3>Tampa data sources</h3>
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
            <h3>Why Tampa needs BayGuard</h3>
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

function tideStatusLabel(maxPredictedFtNext24h: number): 'High' | 'Low' {
  return maxPredictedFtNext24h >= 2.3 ? 'High' : 'Low'
}

function MapPage({ coastal, incidents, snapshot, zones }: MapPageProps) {
  const [mapFilter, setMapFilter] = useState<MapHazard>('all')
  const [addressInput, setAddressInput] = useState('')
  const [isCheckingAddress, setIsCheckingAddress] = useState(false)
  const [addressCheck, setAddressCheck] = useState<EvacuationPlan | null>(null)
  const [addressCheckError, setAddressCheckError] = useState<string | null>(null)
  const watchedZones = zones.filter((zone) => zone.threatLevel !== 'low')
  const filteredZones = watchedZones.filter((zone) =>
    mapFilter === 'all' ? true : zoneHazardType(zone) === mapFilter,
  )
  const filteredIncidents = incidents.filter((incident) =>
    mapFilter === 'all' ? true : incident.category === mapFilter,
  )
  const topZones = [...filteredZones].sort((left, right) => right.score - left.score).slice(0, 4)
  const tropicalSystemCount = snapshot?.signals.tropical.activeSystems.length ?? 0
  const hazardCards = [
    {
      type: 'flood' as const,
      icon: <Waves size={16} />,
      note: 'Tides, low roads, and drainage pressure',
    },
    {
      type: 'weather' as const,
      icon: <CircleAlert size={16} />,
      note: 'Rain, lightning, and weather changes',
    },
    {
      type: 'storm' as const,
      icon: <Wind size={16} />,
      note:
        tropicalSystemCount > 0
          ? `${tropicalSystemCount} tropical system${tropicalSystemCount === 1 ? '' : 's'} in view`
          : 'Wind and tropical risk',
    },
  ].map((card) => {
    const matchingZones = watchedZones.filter((zone) => zoneHazardType(zone) === card.type)
    const matchingIncidents = incidents.filter((incident) => incident.category === card.type)
    const level = highestThreat([
      ...matchingZones.map((zone) => zone.threatLevel),
      ...matchingIncidents.map((incident) => incident.severity),
    ])

    return {
      ...card,
      level,
      areaCount: matchingZones.length,
      incidentCount: matchingIncidents.length,
    }
  })

  const focusSummary =
    mapFilter === 'all'
      ? `Showing ${formatCount(filteredZones.length, 'watched area')} and ${formatCount(filteredIncidents.length, 'active issue')}. Low-risk areas are hidden to keep the map clear.`
      : `Showing ${hazardLabel(mapFilter).toLowerCase()} only: ${formatCount(filteredZones.length, 'watched area')} and ${formatCount(filteredIncidents.length, 'active issue')}.`

  const geocodeAddress = async (address: string) => {
    const geocoder = globalThis.google?.maps?.Geocoder ? new globalThis.google.maps.Geocoder() : null
    if (!geocoder) {
      return null
    }

    try {
      const result = await geocoder.geocode({ address })
      const location = result.results[0]?.geometry.location
      if (!location) {
        return null
      }

      return {
        lat: location.lat(),
        lon: location.lng(),
      }
    } catch {
      return null
    }
  }

  const handleAddressCheck = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!addressInput.trim()) {
      setAddressCheckError('Enter a Tampa-area address to check.')
      return
    }

    setIsCheckingAddress(true)
    setAddressCheckError(null)

    try {
      const geocoded = await geocodeAddress(addressInput.trim())
      const response = await fetch('/api/evacuate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: addressInput.trim(),
          ...(geocoded ?? {}),
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error ?? 'BayGuard could not check this address right now.')
      }

      setAddressCheck(payload as EvacuationPlan)
    } catch (error) {
      setAddressCheck(null)
      setAddressCheckError(
        error instanceof Error ? error.message : 'BayGuard could not check this address right now.',
      )
    } finally {
      setIsCheckingAddress(false)
    }
  }

  return (
    <div className="page-grid page-grid-map">
      <section className="map-stage panel-span-full">
        <div className="panel-head">
          <div>
            <p className="page-kicker">City map</p>
            <h3>Tampa risk map</h3>
          </div>
        </div>

        <div className="map-signal-grid">
          {hazardCards.map((card) => (
            <button
              key={card.type}
              type="button"
              className={`map-hazard-card${mapFilter === card.type ? ' active' : ''}`}
              onClick={() => setMapFilter((current) => (current === card.type ? 'all' : card.type))}
            >
              <div className="map-hazard-top">
                <div className={`map-hazard-icon map-hazard-icon-${card.type}`}>{card.icon}</div>
                <span className={`severity-chip ${severityClass(card.level)}`}>{formatThreat(card.level)}</span>
              </div>
              <strong>{hazardLabel(card.type)}</strong>
              <p>{card.note}</p>
              <small>
                {formatCount(card.areaCount, 'watched area')} · {formatCount(card.incidentCount, 'active issue')}
              </small>
            </button>
          ))}
        </div>

        <div className="map-key">
          <div className="map-explainer">
            <span className="map-explainer-pill">
              <i className="legend-swatch legend-zone" /> Outlined circles = watched areas
            </span>
            <span className="map-explainer-pill">
              <i className="legend-swatch legend-incident" /> Filled dots = active issues
            </span>
            <span className="map-explainer-pill">Bigger circles need more attention</span>
          </div>

          <div className="legend-strip legend-strip-type">
            <span><i className="legend-badge legend-badge-flood">F</i> Flood</span>
            <span><i className="legend-badge legend-badge-weather">W</i> Weather</span>
            <span><i className="legend-badge legend-badge-storm">S</i> Storm / hurricane</span>
          </div>

          <div className="legend-strip legend-strip-threat">
            <span><i className="legend-swatch legend-low" /> Low</span>
            <span><i className="legend-swatch legend-guarded" /> Guarded</span>
            <span><i className="legend-swatch legend-elevated" /> Elevated</span>
            <span><i className="legend-swatch legend-high" /> High</span>
            <span><i className="legend-swatch legend-severe" /> Severe</span>
          </div>
        </div>

        <p className="map-focus-note">{focusSummary}</p>

        <div className="map-panel">
          {snapshot ? (
            <IntelMap
              center={[snapshot.location.lat, snapshot.location.lon]}
              incidents={filteredIncidents}
              zones={filteredZones}
            />
          ) : (
            <div className="map-loading">Loading Tampa map layers...</div>
          )}
        </div>
      </section>

      <section className="panel-card panel-card-soft panel-span-full">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Address check</p>
            <h3>Check your address</h3>
          </div>
          <House size={18} />
        </div>

        <div className="address-check-layout">
          <form className="address-check-form" onSubmit={handleAddressCheck}>
            <p className="map-focus-note">
              Enter a Tampa-area address and BayGuard will check whether it falls in an evacuation
              zone and whether conditions are normal, under watch, or evacuation-level.
            </p>

            <label className="field">
              <span>Address</span>
              <input
                value={addressInput}
                onChange={(event) => setAddressInput(event.target.value)}
                placeholder="For example: 401 W Kennedy Blvd, Tampa, FL"
                required
              />
            </label>

            <button type="submit" className="primary-action" disabled={isCheckingAddress}>
              <Compass size={16} />
              <span>{isCheckingAddress ? 'Checking address' : 'Check address'}</span>
            </button>
          </form>

          <div className="address-check-result">
            {addressCheck ? (
              <>
                <div className="address-check-result-top">
                  <div>
                    <p className="page-kicker">Address result</p>
                    <h4>{evacuationHeadline(addressCheck)}</h4>
                  </div>
                  <div className="zone-chip-stack">
                    <span className={`severity-chip ${evacuationSeverityClass(addressCheck)}`}>
                      {evacuationStatusLabel(addressCheck)}
                    </span>
                    <span className="hazard-type-pill hazard-type-storm">
                      {addressCheck.floodZone === 'Unknown'
                        ? 'Zone not matched'
                        : `Zone ${addressCheck.floodZone}`}
                    </span>
                  </div>
                </div>

                <p className="lead-copy">{addressCheck.reason}</p>

                <div className="snapshot-stat-grid snapshot-stat-grid-tight address-check-stats">
                  <article className="snapshot-stat-card snapshot-stat-card-compact">
                    <span>Evacuation zone</span>
                    <strong>
                      {addressCheck.floodZone === 'Unknown'
                        ? 'Not matched yet'
                        : `Zone ${addressCheck.floodZone}`}
                    </strong>
                    <small>{compactText(addressCheck.address, 46)}</small>
                  </article>
                  <article className="snapshot-stat-card snapshot-stat-card-compact">
                    <span>Current status</span>
                    <strong>{evacuationStatusCopy(addressCheck)}</strong>
                    <small>{addressCheck.shelter?.name ?? 'No shelter action needed right now.'}</small>
                  </article>
                </div>

                <div className="address-check-guidance">
                  <strong>Next steps</strong>
                  <ul className="address-check-list">
                    {addressCheck.steps.slice(0, 4).map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                  <small>
                    {addressCheck.mode === 'gemini'
                      ? 'AI-assisted evacuation check'
                      : 'Local BayGuard fallback check'}
                  </small>
                </div>
              </>
            ) : (
              <EmptyBlock
                title={addressCheckError ? 'Address check unavailable' : 'No address checked yet'}
                body={
                  addressCheckError ??
                  'Enter a Tampa-area address to see if it sits in an evacuation zone and whether current conditions are normal or evacuation-level.'
                }
              />
            )}
          </div>
        </div>
      </section>

      <section className="panel-card panel-span-full">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Water levels</p>
            <h3>Bay and tide readings</h3>
          </div>
          <Waves size={18} />
        </div>

        {coastal?.stations.length ? (
          <div className="station-stack station-stack-grid">
            {coastal.stations.map((station) => {
              const tideStatus = tideStatusLabel(station.maxPredictedFtNext24h)

              return (
                <article key={station.stationId} className="station-card-modern">
                  <div className="station-card-top">
                    <div>
                      <strong>{station.name}</strong>
                    </div>
                    <span className={`severity-chip ${tideStatus === 'High' ? 'severity-high' : 'severity-low'}`}>
                      {tideStatus}
                    </span>
                  </div>
                  <p>{station.latestObservedFt.toFixed(2)} ft observed</p>
                  <small>Peak next 24h: {station.maxPredictedFtNext24h.toFixed(2)} ft</small>
                </article>
              )
            })}
          </div>
        ) : (
          <EmptyBlock title="Waiting on tide readings" body="The latest coastal station data has not loaded yet." />
        )}
      </section>

      <section className="panel-card panel-span-full">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Priority zones</p>
            <h3>Most exposed areas</h3>
          </div>
          <Activity size={18} />
        </div>

        <div className="priority-zone-grid">
          {topZones.length ? (
            topZones.map((zone) => (
              <article key={zone.id} className="zone-spotlight">
                <div className="zone-row-top">
                  <div>
                    <strong>{zone.name}</strong>
                    <p>{zone.neighborhood}</p>
                  </div>
                  <div className="zone-chip-stack">
                    <span className={`hazard-type-pill hazard-type-${zoneHazardType(zone)}`}>
                      {hazardLabel(zoneHazardType(zone), true)}
                    </span>
                    <span className={`severity-chip ${severityClass(zone.threatLevel)}`}>
                      {formatThreat(zone.threatLevel)}
                    </span>
                  </div>
                </div>
                <small>{zone.reason}</small>
              </article>
            ))
          ) : (
            <EmptyBlock
              title="No watched areas in this view"
              body="Try another map filter to see a different set of watched areas."
            />
          )}
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
            <h3>{incidents.length ? 'What needs attention' : 'No active alerts'}</h3>
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
            <h3>{alerts.length ? 'Official weather alerts' : 'No official alerts'}</h3>
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

function zoneHazardType(zone: IntelSnapshot['zones'][number]): Exclude<MapHazard, 'all'> {
  const reason = zone.reason.toLowerCase()

  if (zone.kind === 'coastal' || zone.kind === 'river') {
    return 'flood'
  }

  if (zone.kind === 'evacuation') {
    return 'storm'
  }

  if (/(flood|tide|coastal|shore|shoreline|waterfront|bayfront|surge|seawall|drain|pond|low-lying|creek|river|water level)/.test(reason)) {
    return 'flood'
  }

  if (/(hurricane|tropical|storm|wind|gust|evacuat|cyclone|squall)/.test(reason)) {
    return 'storm'
  }

  return 'weather'
}

function hazardLabel(type: Exclude<MapHazard, 'all'>, compact = false): string {
  switch (type) {
    case 'flood':
      return 'Flood'
    case 'storm':
      return compact ? 'Storm' : 'Storm / hurricane'
    default:
      return 'Weather'
  }
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

function highestThreat(levels: ThreatLevel[]): ThreatLevel {
  if (!levels.length) {
    return 'low'
  }

  return levels.reduce<ThreatLevel>((currentHighest, level) =>
    threatRank(level) > threatRank(currentHighest) ? level : currentHighest,
  'low')
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
      return 'Dangerous conditions are active. Check alerts and follow official guidance now.'
    case 'high':
      return 'Conditions are building. Stay alert and review local warnings.'
    case 'elevated':
      return 'Some signals are rising. Keep an eye on exposed areas and new alerts.'
    case 'guarded':
      return 'No major hazard right now, but conditions are being watched.'
    default:
      return 'No major hazards are active right now.'
  }
}

function residentGuidance(level: ThreatLevel): string {
  switch (level) {
    case 'severe':
      return 'Follow emergency guidance and stay off risky streets.'
    case 'high':
      return 'Avoid low areas and be ready for quick changes.'
    case 'elevated':
      return 'Check alerts before heading out.'
    case 'guarded':
      return 'Nothing urgent right now, but stay aware.'
    default:
      return 'A calm day across Tampa.'
  }
}

function driverGuidance(level: ThreatLevel): string {
  switch (level) {
    case 'severe':
      return 'Avoid extra travel and never drive into standing water.'
    case 'high':
      return 'Avoid flood-prone roads and underpasses.'
    case 'elevated':
      return 'Give yourself extra time and watch the map.'
    case 'guarded':
      return 'Road impacts are unlikely, but check usual ponding spots.'
    default:
      return 'Travel conditions look normal.'
  }
}

function waterfrontGuidance(level: ThreatLevel, peakWaterFt?: number): string {
  const waterNote =
    peakWaterFt !== undefined
      ? `BayGuard is currently watching for a peak water level near ${peakWaterFt.toFixed(2)} ft.`
      : 'BayGuard is still waiting on the latest coastal guidance.'

  switch (level) {
    case 'severe':
      return `${waterNote} Avoid exposed shoreline areas.`
    case 'high':
      return `${waterNote} Be ready for quick shoreline changes.`
    case 'elevated':
      return `${waterNote} Check waterfront areas before heading out.`
    case 'guarded':
      return `${waterNote} Conditions are steady for now.`
    default:
      return `${waterNote} No major coastal concern right now.`
  }
}

function evacuationHeadline(plan: EvacuationPlan): string {
  switch (plan.status) {
    case 'evacuate':
      return 'Evacuation is recommended'
    case 'watch':
      return plan.floodZone === 'Unknown' ? 'Address under watch' : `Zone ${plan.floodZone} is under watch`
    default:
      return plan.floodZone === 'Unknown' ? 'Normal right now' : `Zone ${plan.floodZone}, normal right now`
  }
}

function evacuationSeverityClass(plan: EvacuationPlan): string {
  switch (plan.status) {
    case 'evacuate':
      return 'severity-high'
    case 'watch':
      return 'severity-elevated'
    default:
      return 'severity-low'
  }
}

function evacuationStatusLabel(plan: EvacuationPlan): string {
  switch (plan.status) {
    case 'evacuate':
      return 'Evacuate now'
    case 'watch':
      return 'Watch'
    default:
      return 'Normal'
  }
}

function evacuationStatusCopy(plan: EvacuationPlan): string {
  switch (plan.status) {
    case 'evacuate':
      return 'Leave for a safer inland area.'
    case 'watch':
      return 'No evacuation yet. Stay ready.'
    default:
      return 'No evacuation needed right now.'
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
  { value: 'compound', label: 'Combined event' },
]

const navItems = [
  { to: '/map', label: 'Map', caption: 'Neighborhood view', icon: Map },
  { to: '/overview', label: 'Overview', caption: 'Citywide update', icon: Compass },
  { to: '/reports', label: 'Reports', caption: 'Resident updates', icon: MessageSquareWarning },
  { to: '/alerts', label: 'Alerts', caption: 'Incidents and notices', icon: BellRing },
  { to: '/sms', label: 'SMS', caption: 'Text alerts', icon: Smartphone },
  { to: '/about', label: 'About', caption: 'How it works', icon: Sparkles },
]

const pageMeta: Record<string, { kicker: string; title: string; description: string }> = {
  '/overview': {
    kicker: 'Overview',
    title: 'Live Tampa flood and storm updates.',
    description:
      'Weather, water, and resident updates in one quick city view.',
  },
  '/about': {
    kicker: 'About',
    title: 'How BayGuard works.',
    description:
      'Use this page to see what BayGuard does, how reports are checked, and why Tampa needs close monitoring.',
  },
  '/map': {
    kicker: 'Map',
    title: 'Live Tampa risk map.',
    description:
      'Use the map to see where conditions are building, not just how severe they are.',
  },
  '/reports': {
    kicker: 'Reports',
    title: 'Resident reports, checked live.',
    description:
      'Residents can share what they are seeing on the ground while BayGuard compares those reports with current Tampa conditions.',
  },
  '/alerts': {
    kicker: 'Alerts',
    title: 'Alerts and next steps.',
    description:
      'Use this page to see what happened, how serious it is, and which steps make sense next.',
  },
  '/sms': {
    kicker: 'SMS',
    title: 'Text alerts.',
    description:
      'Add subscribers, try practice message runs, and switch to live text alerts when your message service is ready.',
  },
}

export default App
