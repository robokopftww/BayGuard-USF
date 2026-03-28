import { createHash, randomUUID } from 'node:crypto'

import { createIntelSnapshot } from '../orchestrator.js'
import type {
  IntelSnapshot,
  SimulationScenario,
  SmsAlertType,
  SmsCenterState,
  SmsDispatchRecord,
  SmsDispatchResult,
  SmsSubscribeInput,
  ThreatLevel,
} from '../../shared/types.js'
import { getSmsRuntimeConfig, sendSmsMessage } from './sender.js'
import {
  buildSmsCenterState,
  deactivateSubscriber,
  readNotificationStore,
  saveSubscriber,
  updateNotificationStore,
  type StoredDispatch,
  type StoredSubscriber,
} from './store.js'

const threatLevels: ThreatLevel[] = ['low', 'guarded', 'elevated', 'high', 'severe']
const significantAlertPattern =
  /(flood|flash flood|hurricane|tropical storm|storm surge|severe thunderstorm|tornado)/i

function threatRank(level: ThreatLevel): number {
  return threatLevels.indexOf(level)
}

function formatThreat(level: ThreatLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1)
}

function compactText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength).trimEnd()}...`
}

function buildDispatchDedupeKey(snapshot: IntelSnapshot, categories: SmsAlertType[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        scenario: snapshot.simulation.scenario,
        headline: snapshot.overview.headline,
        threatLevel: snapshot.overview.threatLevel,
        categories,
        alerts: snapshot.signals.weather.alerts.map((alert) => alert.id).sort(),
        incidents: snapshot.incidents.map((incident) => `${incident.id}:${incident.severity}`).sort(),
      }),
    )
    .digest('hex')
    .slice(0, 24)
}

function deriveCategories(snapshot: IntelSnapshot): SmsAlertType[] {
  const categories = new Set<SmsAlertType>()

  for (const incident of snapshot.incidents) {
    categories.add(incident.category)
  }

  for (const alert of snapshot.signals.weather.alerts) {
    if (/flood|surge|coastal/i.test(alert.event)) {
      categories.add('flood')
    } else if (/hurricane|tropical|storm/i.test(alert.event)) {
      categories.add('storm')
    } else {
      categories.add('weather')
    }
  }

  if (categories.size === 0) {
    categories.add('general')
  } else {
    categories.add('general')
  }

  return [...categories]
}

function buildMessage(snapshot: IntelSnapshot): string {
  const prefix = snapshot.simulation.isSimulated ? `[DRILL] ${snapshot.simulation.label}: ` : ''
  const action = snapshot.recommendations[0] ?? 'Open BayGuard for live map and alert guidance.'
  const summary = compactText(snapshot.overview.summary, 110)
  const recommendation = compactText(action, 86)

  return compactText(
    `${prefix}BayGuard Tampa ${formatThreat(snapshot.overview.threatLevel)} alert. ${snapshot.overview.headline}. ${summary} ${recommendation}`,
    320,
  )
}

function findDispatchReason(
  snapshot: IntelSnapshot,
  triggerLevel: ThreatLevel,
  force: boolean,
): string | null {
  if (force) {
    return snapshot.simulation.isSimulated
      ? `${snapshot.simulation.label} was manually pushed to subscribers.`
      : 'A manual BayGuard SMS dispatch was requested.'
  }

  const officialAlert = snapshot.signals.weather.alerts.find((alert) =>
    significantAlertPattern.test(alert.event),
  )

  if (officialAlert) {
    return `Official alert detected: ${officialAlert.event}.`
  }

  if (threatRank(snapshot.overview.threatLevel) >= threatRank(triggerLevel)) {
    return `BayGuard posture reached ${formatThreat(snapshot.overview.threatLevel)}.`
  }

  return null
}

function subscriberMatches(
  subscriber: StoredSubscriber,
  threatLevel: ThreatLevel,
  categories: SmsAlertType[],
): boolean {
  if (!subscriber.isActive) {
    return false
  }

  if (threatRank(threatLevel) < threatRank(subscriber.minThreatLevel)) {
    return false
  }

  if (subscriber.alertTypes.includes('general')) {
    return true
  }

  return categories.some((category) => subscriber.alertTypes.includes(category))
}

function toPublicDispatch(dispatch: StoredDispatch): SmsDispatchRecord {
  return {
    id: dispatch.id,
    scenario: dispatch.scenario,
    headline: dispatch.headline,
    threatLevel: dispatch.threatLevel,
    categories: dispatch.categories,
    createdAt: dispatch.createdAt,
    recipientCount: dispatch.recipientCount,
    deliveredCount: dispatch.deliveredCount,
    failedCount: dispatch.failedCount,
    provider: dispatch.provider,
    status: dispatch.status,
    messagePreview: dispatch.messagePreview,
    reason: dispatch.reason,
  }
}

export async function getSmsCenterState(): Promise<SmsCenterState> {
  const runtime = getSmsRuntimeConfig()
  const store = await readNotificationStore()
  return buildSmsCenterState(store, runtime)
}

export async function subscribeToSms(input: SmsSubscribeInput): Promise<SmsCenterState> {
  await saveSubscriber(input)
  return getSmsCenterState()
}

export async function unsubscribeFromSms(id: string): Promise<SmsCenterState> {
  const subscriber = await deactivateSubscriber(id)

  if (!subscriber) {
    throw new Error('Subscriber not found.')
  }

  return getSmsCenterState()
}

export async function dispatchSmsForScenario(
  scenario: SimulationScenario,
  force = scenario !== 'live',
): Promise<SmsDispatchResult> {
  const snapshot = await createIntelSnapshot(scenario)
  return dispatchSmsAlert(snapshot, force)
}

export async function dispatchSmsAlert(
  snapshot: IntelSnapshot,
  force = false,
): Promise<SmsDispatchResult> {
  const runtime = getSmsRuntimeConfig()
  const now = new Date().toISOString()
  const categories = deriveCategories(snapshot)
  const reason = findDispatchReason(snapshot, runtime.triggerLevel, force)
  const messagePreview = buildMessage(snapshot)
  const dedupeKey = buildDispatchDedupeKey(snapshot, categories)

  return updateNotificationStore(async (store) => {
    store.meta.lastEvaluationAt = now

    if (!reason) {
      return {
        outcome: 'skipped',
        reason: `No SMS event crossed the ${formatThreat(runtime.triggerLevel)} threshold.`,
        provider: runtime.provider,
        recipients: 0,
        deliveredCount: 0,
        failedCount: 0,
      }
    }

    const recentDuplicate = store.dispatches.find((dispatch) => {
      const ageMs = Date.now() - new Date(dispatch.createdAt).getTime()
      return dispatch.dedupeKey === dedupeKey && ageMs < runtime.cooldownMinutes * 60 * 1000
    })

    if (recentDuplicate && !force) {
      return {
        outcome: 'skipped',
        reason: `BayGuard already sent this event within the ${runtime.cooldownMinutes}-minute cooldown window.`,
        provider: runtime.provider,
        recipients: recentDuplicate.recipientCount,
        deliveredCount: recentDuplicate.deliveredCount,
        failedCount: recentDuplicate.failedCount,
        event: toPublicDispatch(recentDuplicate),
      }
    }

    const eligibleSubscribers = store.subscribers.filter((subscriber) =>
      subscriberMatches(subscriber, snapshot.overview.threatLevel, categories),
    )

    if (eligibleSubscribers.length === 0) {
      const skippedEvent: StoredDispatch = {
        id: randomUUID(),
        dedupeKey,
        scenario: snapshot.simulation.scenario,
        headline: snapshot.overview.headline,
        threatLevel: snapshot.overview.threatLevel,
        categories,
        createdAt: now,
        recipientCount: 0,
        deliveredCount: 0,
        failedCount: 0,
        provider: runtime.provider,
        status: 'skipped',
        messagePreview,
        reason: 'No active subscribers matched this alert threshold.',
      }

      store.dispatches.unshift(skippedEvent)
      store.dispatches = store.dispatches.slice(0, 25)

      return {
        outcome: 'skipped',
        reason: skippedEvent.reason,
        provider: runtime.provider,
        recipients: 0,
        deliveredCount: 0,
        failedCount: 0,
        event: toPublicDispatch(skippedEvent),
      }
    }

    let deliveredCount = 0
    let failedCount = 0

    for (const subscriber of eligibleSubscribers) {
      const sendResult = await sendSmsMessage(subscriber.phone, messagePreview, runtime)

      if (sendResult.status === 'sent' || sendResult.status === 'mocked') {
        deliveredCount += 1
        subscriber.lastAlertAt = now
        subscriber.updatedAt = now
      } else {
        failedCount += 1
      }
    }

    const status =
      runtime.provider === 'mock' ? 'mocked' : deliveredCount > 0 ? 'sent' : 'failed'

    const event: StoredDispatch = {
      id: randomUUID(),
      dedupeKey,
      scenario: snapshot.simulation.scenario,
      headline: snapshot.overview.headline,
      threatLevel: snapshot.overview.threatLevel,
      categories,
      createdAt: now,
      recipientCount: eligibleSubscribers.length,
      deliveredCount,
      failedCount,
      provider: runtime.provider,
      status,
      messagePreview,
      reason:
        status === 'mocked'
          ? `Dry-run SMS logged for ${eligibleSubscribers.length} subscriber${eligibleSubscribers.length === 1 ? '' : 's'}.`
          : deliveredCount > 0
            ? `SMS sent to ${deliveredCount} subscriber${deliveredCount === 1 ? '' : 's'}.`
            : 'SMS delivery failed for every targeted subscriber.',
    }

    store.dispatches.unshift(event)
    store.dispatches = store.dispatches.slice(0, 25)

    if (deliveredCount > 0) {
      store.meta.lastSuccessfulSendAt = now
    }

    return {
      outcome: status,
      reason: `${reason} ${event.reason}`.trim(),
      provider: runtime.provider,
      recipients: eligibleSubscribers.length,
      deliveredCount,
      failedCount,
      event: toPublicDispatch(event),
    }
  })
}

export async function runAutomaticSmsEvaluation(): Promise<SmsDispatchResult | null> {
  const runtime = getSmsRuntimeConfig()

  if (!runtime.schedulerEnabled) {
    return null
  }

  const snapshot = await createIntelSnapshot('live')
  return dispatchSmsAlert(snapshot, false)
}
