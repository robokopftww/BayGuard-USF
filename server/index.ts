import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createIntelSnapshot } from './orchestrator.ts'
import type { IntelSnapshot, SimulationScenario } from '../shared/types.ts'

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

function parseScenario(value: unknown): SimulationScenario {
  if (typeof value === 'string' && allowedScenarios.includes(value as SimulationScenario)) {
    return value as SimulationScenario
  }

  return 'live'
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

if (existsSync(distDir)) {
  app.use(express.static(distDir))

  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(port, () => {
  console.log(`BayGuard API listening on http://localhost:${port}`)
})
