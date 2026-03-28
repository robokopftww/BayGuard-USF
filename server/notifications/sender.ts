import { randomUUID } from 'node:crypto'

import type { SmsProvider, ThreatLevel } from '../../shared/types.ts'

export interface SmsRuntimeConfig {
  provider: SmsProvider
  sendMode: 'dry-run' | 'live'
  schedulerEnabled: boolean
  evaluationIntervalMinutes: number
  cooldownMinutes: number
  triggerLevel: ThreatLevel
  note: string
  twilio?: {
    accountSid: string
    authToken: string
    messagingServiceSid?: string
    fromNumber?: string
  }
}

interface SmsSendResult {
  provider: SmsProvider
  status: 'mocked' | 'sent' | 'failed'
  providerMessageId?: string
  error?: string
}

const threatLevels: ThreatLevel[] = ['low', 'guarded', 'elevated', 'high', 'severe']

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) {
    return defaultValue
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function parseMinutes(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback
}

function parseTriggerLevel(value: string | undefined): ThreatLevel {
  if (value && threatLevels.includes(value as ThreatLevel)) {
    return value as ThreatLevel
  }

  return 'high'
}

export function getSmsRuntimeConfig(): SmsRuntimeConfig {
  const desiredProvider = process.env.SMS_PROVIDER?.toLowerCase() === 'twilio' ? 'twilio' : 'mock'
  const liveSendingEnabled = parseBoolean(process.env.SMS_SENDING_ENABLED, false)
  const schedulerEnabled = parseBoolean(process.env.SMS_AUTO_EVALUATOR_ENABLED, true)
  const evaluationIntervalMinutes = parseMinutes(process.env.SMS_EVALUATION_INTERVAL_MINUTES, 5)
  const cooldownMinutes = parseMinutes(process.env.SMS_COOLDOWN_MINUTES, 30)
  const triggerLevel = parseTriggerLevel(process.env.SMS_TRIGGER_LEVEL)

  const twilio = {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
    fromNumber: process.env.TWILIO_FROM_NUMBER,
  }

  const twilioConfigured =
    Boolean(twilio.accountSid && twilio.authToken) &&
    Boolean(twilio.messagingServiceSid || twilio.fromNumber)

  if (desiredProvider === 'twilio' && twilioConfigured && liveSendingEnabled) {
    return {
      provider: 'twilio',
      sendMode: 'live',
      schedulerEnabled,
      evaluationIntervalMinutes,
      cooldownMinutes,
      triggerLevel,
      note: 'Twilio live sending is enabled. BayGuard will text active subscribers when thresholds are crossed.',
      twilio,
    }
  }

  if (desiredProvider === 'twilio' && !twilioConfigured) {
    return {
      provider: 'mock',
      sendMode: 'dry-run',
      schedulerEnabled,
      evaluationIntervalMinutes,
      cooldownMinutes,
      triggerLevel,
      note: 'Twilio is selected but not fully configured, so BayGuard is logging dry-run SMS events only.',
    }
  }

  if (desiredProvider === 'twilio' && !liveSendingEnabled) {
    return {
      provider: 'mock',
      sendMode: 'dry-run',
      schedulerEnabled,
      evaluationIntervalMinutes,
      cooldownMinutes,
      triggerLevel,
      note: 'Twilio credentials can stay in place, but live sending is off until SMS_SENDING_ENABLED=1 is set.',
    }
  }

  return {
    provider: 'mock',
    sendMode: 'dry-run',
    schedulerEnabled,
    evaluationIntervalMinutes,
    cooldownMinutes,
    triggerLevel,
    note: 'Mock mode is active. Dispatches are stored locally so you can test drills without sending real texts.',
  }
}

export async function sendSmsMessage(
  to: string,
  body: string,
  config: SmsRuntimeConfig,
): Promise<SmsSendResult> {
  if (config.provider !== 'twilio' || !config.twilio) {
    return {
      provider: 'mock',
      status: 'mocked',
      providerMessageId: `mock-${randomUUID()}`,
    }
  }

  const formData = new URLSearchParams()
  formData.set('To', to)
  formData.set('Body', body)

  if (config.twilio.messagingServiceSid) {
    formData.set('MessagingServiceSid', config.twilio.messagingServiceSid)
  } else if (config.twilio.fromNumber) {
    formData.set('From', config.twilio.fromNumber)
  }

  const credentials = Buffer.from(
    `${config.twilio.accountSid}:${config.twilio.authToken}`,
    'utf8',
  ).toString('base64')

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      },
    )

    const payload = (await response.json()) as { sid?: string; message?: string }

    if (!response.ok) {
      return {
        provider: 'twilio',
        status: 'failed',
        error: payload.message ?? 'Twilio rejected the SMS request.',
      }
    }

    return {
      provider: 'twilio',
      status: 'sent',
      providerMessageId: payload.sid,
    }
  } catch (error) {
    return {
      provider: 'twilio',
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown SMS provider error',
    }
  }
}
