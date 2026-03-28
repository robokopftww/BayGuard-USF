import {
  BellRing,
  MessageSquareWarning,
  Send,
  ShieldCheck,
  Smartphone,
  UserRoundPlus,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import type {
  SimulationScenario,
  SmsAlertType,
  SmsCenterState,
  SmsDispatchResult,
  ThreatLevel,
} from '../../shared/types'

interface SmsPageProps {
  activeScenario: SimulationScenario
}

interface NoticeState {
  tone: 'success' | 'error'
  message: string
}

const threatOptions: ThreatLevel[] = ['guarded', 'elevated', 'high', 'severe']
const alertTypeOptions: Array<{ value: SmsAlertType; label: string }> = [
  { value: 'general', label: 'All alerts' },
  { value: 'flood', label: 'Flooding' },
  { value: 'storm', label: 'Storms' },
  { value: 'weather', label: 'Weather' },
]
const dispatchOptions: Array<{ value: SimulationScenario; label: string }> = [
  { value: 'live', label: 'Live Tampa feeds' },
  { value: 'flood', label: 'Flood drill' },
  { value: 'hurricane', label: 'Hurricane drill' },
  { value: 'compound', label: 'Compound event' },
]

function SmsPage({ activeScenario }: SmsPageProps) {
  const [centerState, setCenterState] = useState<SmsCenterState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDispatching, setIsDispatching] = useState(false)
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [dispatchScenario, setDispatchScenario] = useState<SimulationScenario>(activeScenario)
  const [form, setForm] = useState({
    name: '',
    phone: '',
    minThreatLevel: 'high' as ThreatLevel,
    alertTypes: ['general'] as SmsAlertType[],
  })

  const loadSmsState = useCallback(async () => {
    const response = await fetch('/api/sms')
    if (!response.ok) {
      throw new Error('BayGuard could not load the SMS control room.')
    }

    const data = (await response.json()) as SmsCenterState
    setCenterState(data)
  }, [])

  useEffect(() => {
    setDispatchScenario(activeScenario)
  }, [activeScenario])

  useEffect(() => {
    void (async () => {
      try {
        await loadSmsState()
      } catch (error) {
        setNotice({
          tone: 'error',
          message: error instanceof Error ? error.message : 'Unable to load SMS status.',
        })
      } finally {
        setIsLoading(false)
      }
    })()
  }, [loadSmsState])

  const toggleAlertType = (value: SmsAlertType) => {
    setForm((current) => {
      const nextTypes = current.alertTypes.includes(value)
        ? current.alertTypes.filter((item) => item !== value)
        : [...current.alertTypes, value]

      return {
        ...current,
        alertTypes: nextTypes.length > 0 ? nextTypes : ['general'],
      }
    })
  }

  const handleSubscribe = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSaving(true)
    setNotice(null)

    try {
      const response = await fetch('/api/sms/subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message ?? 'Unable to save this subscriber.')
      }

      setCenterState(payload as SmsCenterState)
      setForm((current) => ({
        ...current,
        phone: '',
      }))
      setNotice({
        tone: 'success',
        message: 'Subscriber saved. BayGuard will now include them in matching SMS events.',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to save this subscriber.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleUnsubscribe = async (subscriberId: string) => {
    setNotice(null)

    try {
      const response = await fetch('/api/sms/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: subscriberId }),
      })
      
      if (response.status === 404) {
        const fallbackResponse = await fetch(`/api/sms/subscribers/${subscriberId}/unsubscribe`, {
          method: 'POST',
        })

        const fallbackPayload = await fallbackResponse.json()
        if (!fallbackResponse.ok) {
          throw new Error(fallbackPayload.message ?? 'Unable to unsubscribe this phone number.')
        }

        setCenterState(fallbackPayload as SmsCenterState)
        setNotice({
          tone: 'success',
          message: 'Subscriber removed from active BayGuard SMS sends.',
        })
        return
      }

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message ?? 'Unable to unsubscribe this phone number.')
      }

      setCenterState(payload as SmsCenterState)
      setNotice({
        tone: 'success',
        message: 'Subscriber removed from active BayGuard SMS sends.',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to unsubscribe right now.',
      })
    }
  }

  const handleDispatch = async () => {
    setIsDispatching(true)
    setNotice(null)

    try {
      const response = await fetch('/api/sms/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: dispatchScenario,
          force: dispatchScenario !== 'live',
        }),
      })

      const payload = (await response.json()) as SmsDispatchResult & { details?: string }
      if (!response.ok) {
        throw new Error(payload.details ?? payload.reason ?? 'Dispatch failed.')
      }

      await loadSmsState()
      setNotice({
        tone: payload.outcome === 'failed' ? 'error' : 'success',
        message: payload.reason,
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to dispatch BayGuard SMS alerts.',
      })
    } finally {
      setIsDispatching(false)
    }
  }

  return (
    <div className="page-grid page-grid-sms">
      <section className="hero-card sms-hero">
        <div className="hero-mast">
          <p className="page-kicker">SMS control room</p>
          <h3>Text residents when Tampa conditions escalate</h3>
          <p>
            Add subscribers, keep drills in dry-run mode, and switch to live sending only when
            Twilio plus `SMS_SENDING_ENABLED=1` are in place.
          </p>
        </div>

        <div className="sms-status-grid">
          <article className="signal-metric">
            <div className="metric-badge">
              <Smartphone size={18} />
            </div>
            <div>
              <span>Provider</span>
              <strong>{centerState ? `${centerState.provider} ${centerState.sendMode}` : '--'}</strong>
              <small>{centerState?.note ?? 'Loading SMS transport status...'}</small>
            </div>
          </article>

          <article className="signal-metric">
            <div className="metric-badge">
              <Users size={18} />
            </div>
            <div>
              <span>Active subscribers</span>
              <strong>
                {centerState?.subscribers.filter((subscriber) => subscriber.isActive).length ?? '--'}
              </strong>
              <small>
                Threshold-based sends with a {centerState?.cooldownMinutes ?? '--'} minute cooldown
              </small>
            </div>
          </article>

          <article className="signal-metric">
            <div className="metric-badge">
              <ShieldCheck size={18} />
            </div>
            <div>
              <span>Scheduler</span>
              <strong>
                {centerState?.schedulerEnabled
                  ? `Every ${centerState.evaluationIntervalMinutes} min`
                  : 'Manual only'}
              </strong>
              <small>
                Last evaluation:{' '}
                {centerState?.lastEvaluationAt
                  ? formatTimestamp(centerState.lastEvaluationAt)
                  : 'Not yet recorded'}
              </small>
            </div>
          </article>
        </div>

        {notice ? (
          <div className={`sms-banner sms-banner-${notice.tone}`}>
            <span className="recommendation-mark" />
            <p>{notice.message}</p>
          </div>
        ) : null}
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Subscribers</p>
            <h3>Opt people into BayGuard texts</h3>
          </div>
          <UserRoundPlus size={18} />
        </div>

        <form className="sms-form" onSubmit={handleSubscribe}>
          <div className="field-grid">
            <label className="field">
              <span>Name</span>
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Operations lead"
              />
            </label>

            <label className="field">
              <span>Phone number</span>
              <input
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="813-555-0100"
                required
              />
            </label>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>Minimum threat</span>
              <select
                value={form.minThreatLevel}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    minThreatLevel: event.target.value as ThreatLevel,
                  }))
                }
              >
                {threatOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatThreat(option)}
                  </option>
                ))}
              </select>
            </label>

            <div className="field">
              <span>Alert types</span>
              <div className="choice-grid">
                {alertTypeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`choice-chip${form.alertTypes.includes(option.value) ? ' active' : ''}`}
                    onClick={() => toggleAlertType(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button type="submit" className="primary-action" disabled={isSaving}>
            <UserRoundPlus size={16} />
            <span>{isSaving ? 'Saving subscriber' : 'Save subscriber'}</span>
          </button>
        </form>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Dispatch</p>
            <h3>Trigger live or drill SMS runs</h3>
          </div>
          <Send size={18} />
        </div>

        <div className="dispatch-console">
          <label className="field">
            <span>Dispatch source</span>
            <select
              value={dispatchScenario}
              onChange={(event) => setDispatchScenario(event.target.value as SimulationScenario)}
            >
              {dispatchOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="empty-block">
            <strong>How it works</strong>
            <p>
              Live sends respect the normal threshold and cooldown. Drill scenarios are forced so
              you can test message flows without waiting for a real event.
            </p>
          </div>

          <button type="button" className="primary-action" onClick={handleDispatch} disabled={isDispatching}>
            <BellRing size={16} />
            <span>{isDispatching ? 'Running dispatch' : 'Run dispatch now'}</span>
          </button>
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Current roster</p>
            <h3>
              {centerState?.subscribers.length
                ? 'Who will receive BayGuard texts'
                : 'No subscribers added yet'}
            </h3>
          </div>
          <Users size={18} />
        </div>

        {isLoading ? (
          <div className="empty-block">
            <strong>Loading subscribers</strong>
            <p>BayGuard is reading the SMS roster.</p>
          </div>
        ) : centerState?.subscribers.length ? (
          <div className="stack-list">
            {centerState.subscribers.map((subscriber) => (
              <article key={subscriber.id} className="subscriber-row">
                <div className="subscriber-row-top">
                  <div>
                    <strong>{subscriber.name}</strong>
                    <span>{subscriber.phoneMasked}</span>
                  </div>
                  <span
                    className={`status-tag ${
                      subscriber.isActive ? 'status-watch' : 'status-nominal'
                    }`}
                  >
                    {subscriber.isActive ? 'active' : 'paused'}
                  </span>
                </div>
                <p>
                  Sends at {formatThreat(subscriber.minThreatLevel)} and above for{' '}
                  {subscriber.alertTypes.join(', ')}.
                </p>
                <div className="subscriber-row-foot">
                  <small>
                    Last alert:{' '}
                    {subscriber.lastAlertAt ? formatTimestamp(subscriber.lastAlertAt) : 'No sends yet'}
                  </small>
                  {subscriber.isActive ? (
                    <button
                      type="button"
                      className="ghost-action"
                      onClick={() => void handleUnsubscribe(subscriber.id)}
                    >
                      Unsubscribe
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-block">
            <strong>No one is subscribed yet</strong>
            <p>Add at least one phone number before you run a flood or hurricane drill.</p>
          </div>
        )}
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Dispatch log</p>
            <h3>
              {centerState?.recentDispatches.length
                ? 'Most recent SMS events'
                : 'No SMS events logged yet'}
            </h3>
          </div>
          <MessageSquareWarning size={18} />
        </div>

        {centerState?.recentDispatches.length ? (
          <div className="stack-list">
            {centerState.recentDispatches.map((dispatch) => (
              <article key={dispatch.id} className="dispatch-row">
                <div className="dispatch-row-top">
                  <div>
                    <strong>{dispatch.headline}</strong>
                    <span>
                      {dispatch.scenario === 'live'
                        ? 'Live evaluation'
                        : `${formatScenario(dispatch.scenario)} drill`}
                    </span>
                  </div>
                  <span className={`severity-chip severity-${dispatch.threatLevel}`}>
                    {formatThreat(dispatch.threatLevel)}
                  </span>
                </div>
                <p>{dispatch.reason}</p>
                <small>
                  {formatTimestamp(dispatch.createdAt)} • {dispatch.provider} •{' '}
                  {dispatch.deliveredCount}/{dispatch.recipientCount} delivered • {dispatch.status}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-block">
            <strong>No sends yet</strong>
            <p>Your next live threshold crossing or drill run will appear here.</p>
          </div>
        )}
      </section>
    </div>
  )
}

function formatThreat(level: ThreatLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1)
}

function formatScenario(scenario: SimulationScenario): string {
  switch (scenario) {
    case 'flood':
      return 'Flood'
    case 'hurricane':
      return 'Hurricane'
    case 'compound':
      return 'Compound event'
    default:
      return 'Live'
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

export default SmsPage
