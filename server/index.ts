import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GoogleGenAI } from '@google/genai'

import { createIntelSnapshot } from './orchestrator.ts'
import { getSmsRuntimeConfig } from './notifications/sender.ts'
import {
  dispatchSmsForScenario,
  getSmsCenterState,
  runAutomaticSmsEvaluation,
  subscribeToSms,
  unsubscribeFromSms,
} from './notifications/service.ts'
import type {
  IntelSnapshot,
  SimulationScenario,
  SmsAlertType,
  SmsSubscribeInput,
  ThreatLevel,
} from '../shared/types.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const port = Number(process.env.PORT ?? 8787)

const app = express()

app.use(cors())
app.use(express.json())

let cache: { value: IntelSnapshot; fetchedAt: number } | null = null
const cacheWindowMs = 2 * 60 * 1000
const allowedScenarios: SimulationScenario[] = ['live', 'flood', 'hurricane', 'compound']
const allowedThreatLevels: ThreatLevel[] = ['low', 'guarded', 'elevated', 'high', 'severe']
const allowedAlertTypes: SmsAlertType[] = ['general', 'flood', 'storm', 'weather']

function parseScenario(value: unknown): SimulationScenario {
  if (typeof value === 'string' && allowedScenarios.includes(value as SimulationScenario)) {
    return value as SimulationScenario
  }

  return 'live'
}

function parseThreatLevel(value: unknown): ThreatLevel {
  if (typeof value === 'string' && allowedThreatLevels.includes(value as ThreatLevel)) {
    return value as ThreatLevel
  }

  return 'high'
}

function parseAlertTypes(value: unknown): SmsAlertType[] {
  if (!Array.isArray(value)) {
    return ['general', 'flood', 'storm', 'weather']
  }

  const filtered = value.filter((item): item is SmsAlertType =>
    typeof item === 'string' && allowedAlertTypes.includes(item as SmsAlertType),
  )

  return filtered.length > 0 ? filtered : ['general', 'flood', 'storm', 'weather']
}

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    mode: process.env.GEMINI_API_KEY ? 'gemini-ready' : 'fallback',
    fetchedAt: cache?.value.generatedAt ?? null,
  })
})

app.get('/api/intel', async (request, response) => {
  try {
    const forceRefresh = request.query.refresh === '1'
    const scenario = parseScenario(request.query.scenario)
    const cached = cache

    if (
      !forceRefresh &&
      cached &&
      cached.value.simulation.scenario === scenario &&
      Date.now() - cached.fetchedAt < cacheWindowMs
    ) {
      response.json(cached.value)
      return
    }

    const snapshot = await createIntelSnapshot(scenario)
    cache = {
      value: snapshot,
      fetchedAt: Date.now(),
    }

    response.json(snapshot)
  } catch (error) {
    response.status(500).json({
      message: 'Unable to refresh BayGuard intelligence right now.',
      details: error instanceof Error ? error.message : 'Unknown server error',
    })
  }
})

app.get('/api/sms', async (_request, response) => {
  try {
    response.json(await getSmsCenterState())
  } catch (error) {
    response.status(500).json({
      message: 'Unable to load the SMS control room right now.',
      details: error instanceof Error ? error.message : 'Unknown server error',
    })
  }
})

app.post('/api/sms/subscribers', async (request, response) => {
  try {
    const { name, phone, minThreatLevel, alertTypes } = request.body as Partial<SmsSubscribeInput>

    if (!phone?.trim()) {
      response.status(400).json({ message: 'Phone number is required.' })
      return
    }

    const state = await subscribeToSms({
      name,
      phone,
      minThreatLevel: parseThreatLevel(minThreatLevel),
      alertTypes: parseAlertTypes(alertTypes),
    })

    response.status(201).json(state)
  } catch (error) {
    response.status(400).json({
      message: error instanceof Error ? error.message : 'Unable to save this SMS subscriber.',
    })
  }
})

app.post('/api/sms/subscribers/:id/unsubscribe', async (request, response) => {
  try {
    const state = await unsubscribeFromSms(request.params.id)
    response.json(state)
  } catch (error) {
    response.status(404).json({
      message: error instanceof Error ? error.message : 'Subscriber not found.',
    })
  }
})

app.post('/api/sms/dispatch', async (request, response) => {
  try {
    const scenario = parseScenario(request.body?.scenario)
    const force = typeof request.body?.force === 'boolean' ? request.body.force : scenario !== 'live'
    const result = await dispatchSmsForScenario(scenario, force)
    response.json(result)
  } catch (error) {
    response.status(500).json({
      message: 'Unable to dispatch BayGuard SMS alerts right now.',
      details: error instanceof Error ? error.message : 'Unknown server error',
    })
  }
})

/* ─── POST /api/verify ─────────────────────────────────────── */

app.post('/api/verify', async (request, response) => {
  try {
    const { report, issueType } = request.body as { report: string; issueType: string }

    if (!report?.trim()) {
      response.status(400).json({ error: 'report is required' })
      return
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      response.status(500).json({ error: 'Gemini API key not configured on server' })
      return
    }

    // Fetch 3 live data sources in parallel
    const [alertsResult, usgsResult, forecastResult] = await Promise.allSettled([
      fetch('https://api.weather.gov/alerts/active?area=FL', {
        headers: { 'User-Agent': 'BayGuard/1.0 (hackathon)' },
      }).then((r) => r.json()),
      fetch(
        'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=02303000&parameterCd=00065',
      ).then((r) => r.json()),
      fetch('https://api.weather.gov/points/27.9506,-82.4572/forecast', {
        headers: { 'User-Agent': 'BayGuard/1.0 (hackathon)' },
      }).then((r) => r.json()),
    ])

    const sensorData = {
      nwsAlerts: alertsResult.status === 'fulfilled' ? alertsResult.value : null,
      usgsWaterLevel: usgsResult.status === 'fulfilled' ? usgsResult.value : null,
      nwsForecast: forecastResult.status === 'fulfilled' ? forecastResult.value : null,
    }

    const prompt = [
      'You are a Tampa Bay emergency verification AI.',
      `A citizen reported: "${report}". Issue type: ${issueType}.`,
      `Here is real sensor data from NOAA and USGS: ${JSON.stringify(sensorData).slice(0, 6000)}.`,
      'Verify this report against the sensor data.',
      'Respond ONLY in this JSON format:',
      '{',
      '  "status": "CONFIRMED" | "LIKELY" | "UNVERIFIED",',
      '  "confidence": <integer 0-100>,',
      '  "sources": ["which APIs supported the claim"],',
      '  "explanation": "<2-3 sentences plain English>"',
      '}',
    ].join('\n')

    const ai = new GoogleGenAI({ apiKey })
    const geminiResponse = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL ?? 'gemini-1.5-flash',
      contents: [{ text: prompt }],
      config: { responseMimeType: 'application/json', temperature: 0.3 },
    })

    const parsed = JSON.parse(geminiResponse.text ?? '{}')
    response.json(parsed)
  } catch (error) {
    response.status(500).json({
      error: 'Verification failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/* ─── POST /api/evacuate ────────────────────────────────────── */

app.post('/api/evacuate', async (request, response) => {
  try {
    const { address, category } = request.body as { address: string; category: number }

    if (!address?.trim() || !category) {
      response.status(400).json({ error: 'address and category are required' })
      return
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      response.status(500).json({ error: 'Gemini API key not configured on server' })
      return
    }

    const prompt = [
      'You are a Tampa Bay emergency management AI.',
      `Someone lives at: ${address}.`,
      `A Category ${category} hurricane is approaching Tampa Bay.`,
      '',
      'Tampa Flood Zones:',
      '- Zone A: Evacuate for Cat 1+. Lowest elevation, storm surge risk. Areas: Davis Islands, Apollo Beach, Gandy area, Ballast Point waterfront.',
      '- Zone B: Evacuate for Cat 2+. Areas: South Tampa, Harbour Island, Palmetto Beach, parts of St. Pete.',
      '- Zone C: Evacuate for Cat 3+. Areas: New Tampa, Carrollwood, Temple Terrace, Brandon.',
      '',
      'Real Tampa Shelters:',
      '1. Hillsborough Community College - Dale Mabry, 4001 W Tampa Bay Blvd, Tampa FL 33614',
      '2. Jefferson High School, 4401 W Cypress St, Tampa FL 33607',
      '3. Blake High School, 1701 N Boulevard, Tampa FL 33607',
      '4. Freedom High School, 7154 Forest Grove Dr, Tampa FL 33620',
      '5. Armwood High School, 12000 US-92, Seffner FL 33584',
      '',
      'Generate a specific, realistic evacuation plan for this address and hurricane category.',
      'Respond ONLY in this JSON format:',
      '{',
      '  "floodZone": "A" | "B" | "C" | "Unknown",',
      '  "mustEvacuate": true | false,',
      '  "reason": "<one sentence explaining why or why not>",',
      '  "shelter": { "name": "<shelter name>", "address": "<full address>" },',
      '  "steps": ["<5-7 specific action steps in order>"],',
      '  "supplies": ["<8-10 items to bring>"]',
      '}',
    ].join('\n')

    const ai = new GoogleGenAI({ apiKey })
    const geminiResponse = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL ?? 'gemini-1.5-flash',
      contents: [{ text: prompt }],
      config: { responseMimeType: 'application/json', temperature: 0.4 },
    })

    const parsed = JSON.parse(geminiResponse.text ?? '{}')
    response.json(parsed)
  } catch (error) {
    response.status(500).json({
      error: 'Could not generate evacuation plan',
      details: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

if (existsSync(distDir)) {
  app.use(express.static(distDir))

  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(path.join(distDir, 'index.html'))
  })
}

let smsEvaluationInFlight = false

async function evaluateSmsScheduler(): Promise<void> {
  if (smsEvaluationInFlight) {
    return
  }

  smsEvaluationInFlight = true

  try {
    const result = await runAutomaticSmsEvaluation()
    if (result && result.outcome !== 'skipped') {
      console.log(`[sms] ${result.reason}`)
    }
  } catch (error) {
    console.error('[sms] automatic evaluation failed', error)
  } finally {
    smsEvaluationInFlight = false
  }
}

app.listen(port, () => {
  console.log(`BayGuard API listening on http://localhost:${port}`)

  const smsRuntime = getSmsRuntimeConfig()
  if (smsRuntime.schedulerEnabled) {
    const intervalMs = smsRuntime.evaluationIntervalMinutes * 60 * 1000
    console.log(
      `[sms] evaluator active in ${smsRuntime.sendMode} mode every ${smsRuntime.evaluationIntervalMinutes} minute(s)`,
    )
    setTimeout(() => {
      void evaluateSmsScheduler()
    }, 4000)
    setInterval(() => {
      void evaluateSmsScheduler()
    }, intervalMs)
  } else {
    console.log('[sms] evaluator disabled')
  }
})
