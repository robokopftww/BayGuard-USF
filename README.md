# BayGuard Tampa

BayGuard Tampa is a disaster-alert web app for Tampa that combines:

- A live operations map focused on flood, rain, and hurricane exposure.
- A multi-agent backend with `Weather Bot`, `Flood Bot`, `Storm Bot`, and a final judge.
- Optional Gemini orchestration for the final decision layer.

When no Gemini key is present, the app falls back to a deterministic judge so the dashboard still runs safely.

## What it uses

- `NWS API` for Tampa weather alerts, hourly forecast periods, and gridpoint forecast data.
- `NOAA CO-OPS API` for coastal water levels and tide predictions around Tampa Bay.
- `NHC XML feeds` for Atlantic tropical outlook and active advisory monitoring.
- `Google Maps JavaScript API` for the operations map and incident overlays.
- `React + Vite` for the frontend.
- `Express + TypeScript` for the orchestration backend.

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
```

The dashboard will still run without `GEMINI_API_KEY`, but the final judge will stay in deterministic fallback mode.
The Tampa map will show a setup message until `VITE_GOOGLE_MAPS_API_KEY` is present.

4. Run the app in development:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:8787`

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

## Architecture

### Agents

- `Weather Bot`: reads NWS alerts, rainfall probability, forecast periods, and wind gust guidance.
- `Flood Bot`: reads NOAA coastal stations and looks for tide-plus-rain coupling risk.
- `Storm Bot`: reads National Hurricane Center Atlantic outlook and advisory feeds.
- `Final Judge`: combines the specialist bot outputs into one Tampa posture.

### Gemini role

If `GEMINI_API_KEY` is configured, Gemini can act as the final synthesis judge. The app still keeps deterministic guardrails around the verdict so the final posture cannot jump wildly away from the measured sensor evidence.

## Project structure

```text
server/
  data-sources.ts   # NWS, NOAA, and NHC adapters
  orchestrator.ts   # bot scoring + final judge logic
  index.ts          # Express API server
shared/
  types.ts          # shared contracts between API and UI
src/
  App.tsx           # dashboard shell
  components/
    IntelMap.tsx    # Google Maps Tampa operations map
```

## Verification

These checks should pass:

```bash
npm run lint
npm run build
```
