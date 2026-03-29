# BayGuard Tampa

BayGuard Tampa is a real-time multi-agent disaster intelligence app built for Tampa.

It combines live coastal, rainfall, and storm monitoring with AI-assisted verification so residents and responders can:

- see where risk is building on a Tampa map
- verify citizen reports against live sensor and alert data
- generate clearer alert language from the live signal stack
- manage SMS drills and subscriber warnings
- understand what the system is watching and why it matters locally

When no Gemini key is present, the app falls back to a deterministic judge so the dashboard still runs safely.

## Product modules

- `Live Risk Map`: neighborhood risk zones, incidents, and coastal telemetry
- `Citizen Report Verification`: resident-submitted claims checked against live signals
- `AI Alert Generator`: BayGuard summary and alert language based on current conditions
- `Emergency SMS Dispatch`: subscriber control room and drill/live dispatch flow
- `Neighborhood Watch`: Tampa-specific zone scoring across flood, weather, and storm exposure
- `Travel Impact Guidance`: driver-facing awareness for roads and exposed corridors

## End-to-end demo flow

BayGuard is strongest when judges can see the whole loop:

1. A resident reports flooding, storm damage, or another ground-truth observation.
2. BayGuard cross-checks the claim against live NWS, NOAA, NHC, and internal zone signals.
3. The matching neighborhood becomes more visible in the map room and incident desk.
4. The summary layer drafts the public-facing alert language.
5. The SMS control room can dispatch the message to subscribers or rehearse it as a drill.

## What it uses

- `NWS API` for Tampa weather alerts, hourly forecast periods, and gridpoint forecast data.
- `NOAA CO-OPS API` for coastal water levels and tide predictions around Tampa Bay.
- `NHC XML feeds` for Atlantic tropical outlook and active advisory monitoring.
- `Google Maps JavaScript API` for the operations map and incident overlays.
- Optional `Twilio` or `Textbelt` integration for resident SMS alerts.
- `React + Vite` for the frontend.
- `Express + TypeScript` for the orchestration backend.

## Why Tampa?

Tampa needs a more local signal stack than a generic weather dashboard:

- bayfront roads and low-lying neighborhoods react quickly to elevated water
- sudden afternoon rainfall can create drainage trouble long before a major warning appears
- different parts of the city, from Davis Islands to the University Area, react differently to the same storm cycle

BayGuard is tuned around those local conditions instead of treating the city as a flat weather blob.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy the example environment file:

```bash
cp .env.example .env
```

3. Add your API keys to `.env`:

```bash
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key_here
SMS_PROVIDER=mock
SMS_SENDING_ENABLED=0
```

The dashboard will still run without `GEMINI_API_KEY`, but the final judge will stay in deterministic fallback mode.
The Tampa map will show a setup message until `VITE_GOOGLE_MAPS_API_KEY` is present.
SMS runs in local dry-run mode until you explicitly switch `SMS_PROVIDER=twilio` or `SMS_PROVIDER=textbelt` and set `SMS_SENDING_ENABLED=1`.
Local development uses `BAYGUARD_STORE_MODE=file` so the SMS roster persists in `data/sms-store.json`.
If you want the same persistence on Vercel, add Redis/KV env vars and BayGuard will use them automatically.

4. Run the app in development:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:8787`

5. Open the SMS control room at `http://localhost:5173/sms`

- Add subscribers from the UI.
- Run `Flood drill`, `Hurricane drill`, or `Compound event` dispatches.
- In mock mode, sends are logged locally in `data/sms-store.json`.

## Production-style run

```bash
npm run build
npm run start
```

That serves the built frontend and the API from the Express server.

## Disaster simulation

You can switch the dashboard between:

- `Live Tampa feeds`
- `Flood drill`
- `Hurricane drill`
- `Compound event`

Use the scenario selector in the top area of the UI. The backend also accepts:

```bash
/api/intel?scenario=flood
/api/intel?scenario=hurricane
/api/intel?scenario=compound
```

## SMS alerts

BayGuard now includes an SMS roster and dispatch workflow:

- `/sms` manages subscribers and shows recent sends.
- A background evaluator checks live conditions every few minutes.
- Live sends only go out when the threat posture crosses the configured threshold or a major official alert appears.
- Repeats are deduped with a cooldown window.

### Safe default

These defaults keep texting safe in local development:

```bash
SMS_PROVIDER=mock
SMS_SENDING_ENABLED=0
```

### Twilio live sending

To enable real texts, set:

```bash
SMS_PROVIDER=twilio
SMS_SENDING_ENABLED=1
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SERVICE_SID=...
```

You can use `TWILIO_FROM_NUMBER` instead of `TWILIO_MESSAGING_SERVICE_SID` if needed.

### Textbelt live sending

If you already bought Textbelt credits, set:

```bash
SMS_PROVIDER=textbelt
SMS_SENDING_ENABLED=1
TEXTBELT_API_KEY=...
TEXTBELT_SENDER=BayGuard
```

`TEXTBELT_SENDER` is optional, but it gives your messages a cleaner sender label when supported.

## Vercel deployment

BayGuard is now Vercel-ready:

- The frontend builds to `dist/`
- API routes live in root `api/` Vercel Functions
- `vercel.json` rewrites non-API routes back to `index.html` so `/map`, `/alerts`, and `/sms` all load directly

Deploy steps:

1. Import the GitHub repo into Vercel.
2. Keep the root directory as `./`.
3. Vercel can use the checked-in `vercel.json`; the important environment variables are:

```bash
VITE_GOOGLE_MAPS_API_KEY=...
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
SMS_PROVIDER=twilio
SMS_SENDING_ENABLED=1
SMS_AUTO_EVALUATOR_ENABLED=1
SMS_EVALUATION_INTERVAL_MINUTES=5
SMS_COOLDOWN_MINUTES=30
SMS_TRIGGER_LEVEL=high
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SERVICE_SID=...
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
REDIS_URL=...
```

### Important SMS note on Vercel

Because Vercel Functions are serverless, BayGuard cannot rely on local files there.

If Vercel KV is configured, BayGuard stores both SMS state and community reports in KV automatically.

If KV is not configured, BayGuard falls back to an in-memory store. That means:

- the app deploys cleanly on Vercel
- manual SMS dispatch drills work
- subscriber, dispatch, and report history are not durable across cold starts

BayGuard supports either Vercel KV env names (`KV_REST_API_URL`, `KV_REST_API_TOKEN`), the raw Upstash REST names (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`), or a standard `REDIS_URL` from the Redis integration.

### SMS evaluation on Vercel

The local Express server runs the SMS evaluator on an interval. Vercel Functions do not keep that long-running process alive, so use:

- manual dispatches from `/sms`, or
- a scheduled hit to `/api/sms/evaluate` from Vercel Cron or another scheduler

## Architecture

### Agents

- `Weather Bot`: reads NWS alerts, rainfall probability, forecast periods, and wind gust guidance.
- `Flood Bot`: reads NOAA coastal stations and looks for tide-plus-rain coupling risk.
- `Storm Bot`: reads National Hurricane Center Atlantic outlook and advisory feeds.
- `Verification Agent`: checks resident reports against BayGuard’s live signal stack.
- `Final Judge`: combines the specialist bot outputs into one Tampa posture.

### Gemini role

If `GEMINI_API_KEY` is configured, Gemini can:

- refine the final synthesis judge
- assist with citizen-report verification
- support more natural emergency-language generation

The app still keeps deterministic guardrails around the verdict so the final posture cannot jump wildly away from the measured sensor evidence.

## What we built

BayGuard’s core technical work is in:

- Tampa-specific zone modeling and incident scoring
- live source ingestion from NWS, NOAA, and NHC
- the multi-agent orchestration layer
- community report verification
- Google Maps operations view
- SMS roster and dispatch workflow

External services are used as inputs and infrastructure, but the product logic, UI, orchestration, verification flow, and Tampa-specific modeling are implemented in this repo.

## Project structure

```text
server/
  data-sources.ts   # NWS, NOAA, and NHC adapters
  orchestrator.ts   # bot scoring + final judge logic
  index.ts          # Express API server
  reports/          # community report verification + storage
shared/
  types.ts          # shared contracts between API and UI
src/
  App.tsx           # dashboard shell
  pages/
    ReportsPage.tsx # community reporting + verification
  components/
    IntelMap.tsx    # Google Maps Tampa operations map
```

## Verification

These checks should pass:

```bash
npm run lint
npm run build
```
