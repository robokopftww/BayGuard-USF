import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ApiError,
  createSmsSubscriberPayload,
  dispatchSmsPayload,
  evacuatePayload,
  evaluateSmsPayload,
  getHealthPayload,
  getIntelPayload,
  getSmsPayload,
  unsubscribeSmsSubscriberPayload,
  verifyPayload,
} from './api.ts'
import { getSmsRuntimeConfig } from './notifications/sender.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const port = Number(process.env.PORT ?? 8787)

const app = express()

app.use(cors())
app.use(express.json())

app.get('/api/health', (_request, response) => {
  response.json(getHealthPayload())
})

app.get('/api/intel', async (request, response) => {
  try {
    response.json(
      await getIntelPayload({
        refresh: request.query.refresh,
        scenario: request.query.scenario,
      }),
    )
  } catch (error) {
    response.status(500).json({
      message: 'Unable to refresh BayGuard intelligence right now.',
      details: error instanceof Error ? error.message : 'Unknown server error',
    })
  }
})

app.get('/api/sms', async (_request, response) => {
  try {
    response.json(await getSmsPayload())
  } catch (error) {
    response.status(500).json({
      message: 'Unable to load the SMS control room right now.',
      details: error instanceof Error ? error.message : 'Unknown server error',
    })
  }
})

app.post('/api/sms/subscribers', async (request, response) => {
  try {
    response.status(201).json(await createSmsSubscriberPayload(request.body))
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 400
    response.status(status).json(
      error instanceof ApiError
        ? error.payload
        : { message: 'Unable to save this SMS subscriber.' },
    )
  }
})

app.post('/api/sms/subscribers/:id/unsubscribe', async (request, response) => {
  try {
    response.json(await unsubscribeSmsSubscriberPayload(request.params.id))
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 404
    response.status(status).json(
      error instanceof ApiError ? error.payload : { message: 'Subscriber not found.' },
    )
  }
})

app.post('/api/sms/unsubscribe', async (request, response) => {
  try {
    response.json(await unsubscribeSmsSubscriberPayload(request.body?.id))
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 404
    response.status(status).json(
      error instanceof ApiError ? error.payload : { message: 'Subscriber not found.' },
    )
  }
})

app.post('/api/sms/dispatch', async (request, response) => {
  try {
    response.json(await dispatchSmsPayload(request.body ?? {}))
  } catch (error) {
    response.status(500).json({
      message: 'Unable to dispatch BayGuard SMS alerts right now.',
      details: error instanceof Error ? error.message : 'Unknown server error',
    })
  }
})

app.post('/api/sms/evaluate', async (_request, response) => {
  try {
    response.json(await evaluateSmsPayload())
  } catch (error) {
    response.status(500).json({
      message: 'Unable to evaluate BayGuard SMS alerts right now.',
      details: error instanceof Error ? error.message : 'Unknown server error',
    })
  }
})

app.post('/api/verify', async (request, response) => {
  try {
    response.json(await verifyPayload(request.body ?? {}))
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500
    response.status(status).json(
      error instanceof ApiError
        ? error.payload
        : {
            error: 'Verification failed',
            details: error instanceof Error ? error.message : 'Unknown error',
          },
    )
  }
})

app.post('/api/evacuate', async (request, response) => {
  try {
    response.json(await evacuatePayload(request.body ?? {}))
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500
    response.status(status).json(
      error instanceof ApiError
        ? error.payload
        : {
            error: 'Could not generate evacuation plan',
            details: error instanceof Error ? error.message : 'Unknown error',
          },
    )
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
    const result = await evaluateSmsPayload()
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
