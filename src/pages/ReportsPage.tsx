import {
  Activity,
  BellRing,
  MessageSquareWarning,
  RefreshCcw,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import type {
  CommunityReport,
  CommunityReportType,
  CommunityReportsState,
} from '../../shared/types'

interface NoticeState {
  tone: 'success' | 'error'
  message: string
}

const reportTypeOptions: Array<{ value: CommunityReportType; label: string }> = [
  { value: 'flooding', label: 'Flooding' },
  { value: 'road-hazard', label: 'Road hazard' },
  { value: 'wind-damage', label: 'Wind damage' },
  { value: 'power-outage', label: 'Power outage' },
  { value: 'storm-impact', label: 'Storm impact' },
  { value: 'other', label: 'Other' },
]

function ReportsPage() {
  const [reportState, setReportState] = useState<CommunityReportsState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [recheckingId, setRecheckingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [form, setForm] = useState({
    reporterName: '',
    type: 'flooding' as CommunityReportType,
    zoneId: '',
    locationHint: '',
    details: '',
  })

  const loadReports = useCallback(async () => {
    const response = await fetch('/api/reports')
    if (!response.ok) {
      throw new Error('BayGuard could not load community reports right now.')
    }

    const data = (await response.json()) as CommunityReportsState
    setReportState(data)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await loadReports()
      } catch (error) {
        setNotice({
          tone: 'error',
          message:
            error instanceof Error ? error.message : 'Unable to load community reports right now.',
        })
      } finally {
        setIsLoading(false)
      }
    })()
  }, [loadReports])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setNotice(null)

    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reporterName: form.reporterName,
          type: form.type,
          zoneId: form.zoneId || undefined,
          locationHint: form.locationHint,
          details: form.details,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message ?? 'Unable to save this community report.')
      }

      setReportState(payload as CommunityReportsState)
      setForm((current) => ({
        ...current,
        locationHint: '',
        details: '',
      }))
      setNotice({
        tone: 'success',
        message: 'Report submitted. BayGuard checked it against the live signal stack.',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to submit this community report.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRecheck = async (reportId: string) => {
    setRecheckingId(reportId)
    setNotice(null)

    try {
      const response = await fetch('/api/reports/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reportId }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message ?? 'Unable to re-check this report right now.')
      }

      setReportState(payload as CommunityReportsState)
      setNotice({
        tone: 'success',
        message: 'BayGuard re-checked the report against the latest conditions.',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to re-check this report.',
      })
    } finally {
      setRecheckingId(null)
    }
  }

  const stats = reportState?.stats

  return (
    <div className="page-grid page-grid-reports">
      <section className="hero-card reports-hero">
        <div className="hero-mast">
          <p className="page-kicker">Community reports</p>
          <h3>Let people report what they see. BayGuard checks whether it lines up.</h3>
          <p>
            Residents can flag flooding, blocked roads, outages, or storm damage. BayGuard then
            cross-checks those claims against the live Tampa signal stack before surfacing a verdict.
          </p>
        </div>

        <div className="reports-summary-grid">
          <article className="hero-summary-card">
            <span>Verification mode</span>
            <strong>{reportState?.verificationMode === 'gemini' ? 'Gemini live' : 'Guardrail mode'}</strong>
            <small>{reportState?.note ?? 'Loading BayGuard verification status...'}</small>
          </article>
          <article className="hero-summary-card">
            <span>Confirmed reports</span>
            <strong>{stats?.confirmedCount ?? '--'}</strong>
            <small>Claims BayGuard can strongly support right now.</small>
          </article>
          <article className="hero-summary-card">
            <span>Total reports</span>
            <strong>{stats?.totalReports ?? '--'}</strong>
            <small>
              {reportState?.lastSubmissionAt
                ? `Latest submission ${formatTimestamp(reportState.lastSubmissionAt)}`
                : 'No public reports submitted yet.'}
            </small>
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
            <p className="page-kicker">Submit report</p>
            <h3>Send a ground-truth signal into BayGuard</h3>
          </div>
          <MessageSquareWarning size={18} />
        </div>

        <form className="report-form" onSubmit={handleSubmit}>
          <div className="field-grid">
            <label className="field">
              <span>Name</span>
              <input
                value={form.reporterName}
                onChange={(event) =>
                  setForm((current) => ({ ...current, reporterName: event.target.value }))
                }
                placeholder="Optional"
              />
            </label>

            <label className="field">
              <span>Report type</span>
              <select
                value={form.type}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    type: event.target.value as CommunityReportType,
                  }))
                }
              >
                {reportTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>Neighborhood</span>
              <select
                value={form.zoneId}
                onChange={(event) => setForm((current) => ({ ...current, zoneId: event.target.value }))}
              >
                <option value="">Use typed location only</option>
                {reportState?.zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name} · {zone.neighborhood}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Location</span>
              <input
                value={form.locationHint}
                onChange={(event) =>
                  setForm((current) => ({ ...current, locationHint: event.target.value }))
                }
                placeholder="For example: Bayshore Blvd near Bay to Bay"
                required
              />
            </label>
          </div>

          <label className="field">
            <span>What happened?</span>
            <textarea
              value={form.details}
              onChange={(event) => setForm((current) => ({ ...current, details: event.target.value }))}
              placeholder="Describe what people are seeing on the ground and why it matters."
              rows={5}
              required
            />
          </label>

          <button type="submit" className="primary-action" disabled={isSubmitting}>
            <MessageSquareWarning size={16} />
            <span>{isSubmitting ? 'Checking report' : 'Submit report'}</span>
          </button>
        </form>
      </section>

      <section className="panel-card panel-card-soft">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Verification stack</p>
            <h3>How BayGuard cross-checks each claim</h3>
          </div>
          <ShieldCheck size={18} />
        </div>

        <div className="reports-check-grid">
          <article className="report-method-card">
            <div className="metric-badge">
              <Activity size={18} />
            </div>
            <div>
              <strong>Live signal match</strong>
              <p>BayGuard compares the report against the citywide threat posture, zone scores, and current incidents.</p>
            </div>
          </article>
          <article className="report-method-card">
            <div className="metric-badge">
              <BellRing size={18} />
            </div>
            <div>
              <strong>Official feed check</strong>
              <p>Current weather alerts, rain guidance, wind, tide, and tropical conditions are used as supporting evidence.</p>
            </div>
          </article>
          <article className="report-method-card">
            <div className="metric-badge">
              <ShieldCheck size={18} />
            </div>
            <div>
              <strong>AI verdict</strong>
              <p>Gemini can refine the verdict when configured. Otherwise BayGuard falls back to deterministic guardrail verification.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="panel-card panel-span-full">
        <div className="panel-head">
          <div>
            <p className="page-kicker">Recent reports</p>
            <h3>{reportState?.reports.length ? 'What residents are seeing on the ground' : 'No reports yet'}</h3>
          </div>
          <Activity size={18} />
        </div>

        {isLoading ? (
          <div className="empty-block">
            <strong>Loading report feed</strong>
            <p>BayGuard is pulling the latest community claims and verification history.</p>
          </div>
        ) : reportState?.reports.length ? (
          <div className="report-feed-grid">
            {reportState.reports.map((report) => (
              <CommunityReportCard
                key={report.id}
                report={report}
                onRecheck={handleRecheck}
                isRechecking={recheckingId === report.id}
              />
            ))}
          </div>
        ) : (
          <div className="empty-block">
            <strong>No community reports yet</strong>
            <p>The first verified report will show up here with BayGuard’s confidence and evidence trail.</p>
          </div>
        )}
      </section>
    </div>
  )
}

function CommunityReportCard({
  report,
  onRecheck,
  isRechecking,
}: {
  report: CommunityReport
  onRecheck: (reportId: string) => void
  isRechecking: boolean
}) {
  return (
    <article className="community-report-card">
      <div className="community-report-top">
        <div className="community-report-headline">
          <span className={`verification-chip verification-${report.verification.status}`}>
            {formatVerificationStatus(report.verification.status)}
          </span>
          <span className="report-type-pill">{formatReportType(report.type)}</span>
        </div>
        <button
          type="button"
          className="ghost-action"
          onClick={() => onRecheck(report.id)}
          disabled={isRechecking}
        >
          <RefreshCcw size={16} className={isRechecking ? 'spin' : ''} />
          <span>{isRechecking ? 'Checking' : 'Re-check'}</span>
        </button>
      </div>

      <div className="community-report-meta">
        <strong>{report.zoneName ?? report.locationHint}</strong>
        <span>{report.zoneName ? report.locationHint : 'Community-submitted location'}</span>
      </div>

      <p className="community-report-body">{report.details}</p>

      <div className="community-report-verdict">
        <div>
          <span className="page-kicker">BayGuard verdict</span>
          <h4>{report.verification.confidence}% confidence</h4>
        </div>
        <small>
          {report.verification.mode === 'gemini' ? 'Gemini-assisted cross-check' : 'Fallback signal cross-check'} · Checked{' '}
          {formatTimestamp(report.verification.checkedAt)}
        </small>
      </div>

      <p className="community-report-summary">{report.verification.summary}</p>

      <ul className="report-evidence-list">
        {report.verification.supportingSignals.map((signal) => (
          <li key={signal}>{signal}</li>
        ))}
      </ul>

      <div className="report-source-row">
        {report.verification.sourceLabels.map((label) => (
          <span key={label} className="report-source-pill">
            {label}
          </span>
        ))}
      </div>

      <div className="community-report-footer">
        <small>Reported by {report.reporterName}</small>
        <small>{formatTimestamp(report.createdAt)}</small>
      </div>
    </article>
  )
}

function formatReportType(type: CommunityReportType): string {
  return reportTypeOptions.find((option) => option.value === type)?.label ?? 'Other'
}

function formatVerificationStatus(value: CommunityReport['verification']['status']): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export default ReportsPage
