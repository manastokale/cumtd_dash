# MTD Champaign-Urbana Live Dashboard

Mini Metro-inspired live dashboard for CU-MTD, built to help riders make better boarding and deboarding decisions instead of only answering “what route exists?”

The planner is aimed at a campus rider problem:
- where should I get on?
- where should I get off?
- should I walk to a different stop for an easier ride?
- is the more direct option actually worse if the bus is already crowded?

It approximates those choices with two rider modes:
- `Comfort`: favors easier boarding, lower crowding, and smoother exits
- `Convenience`: favors directness, fewer transfers, and faster movement

![Map feature](./assets/approximate_comfort_directions.png)

## Features

- Live map of CU-MTD routes and vehicles
- Focus views for buses, routes, and stops
- Region-to-region trip planning from approximate `From` / `To` map selections
- Occupancy, congestion, and stop-status overlays from GTFS-Realtime
- Pink/green pressure zones based on occupancy changes over time
- Clickable route legend, route analysis, and stop analysis
- MapLibre basemap with a Mini Metro-inspired overlay style

## Runtime Data Model

The app uses a hybrid of static GTFS, public GTFS-Realtime, and optional proxied MTD REST data.

Loaded locally:
- `data/gtfs-map.json`
- `data/gtfs-trip-stops.json`
- `gtfs-realtime-vehicle.proto`

Public realtime feed:
- `https://gtfs-rt.mtd.org/vehicle-positions`

Optional REST endpoints used by the bus/route detail views:
- `GET /vehicles/locations`
- `GET /vehicles`
- `GET /trips/{tripId}`
- `GET /stops/{stopId}`
- `GET /stops/{stopId}/departures?time=90`

Default live cadence:
- `GET /vehicles/locations`: once per `REFRESH_INTERVAL_MS`
- `GET /vehicle-positions`: once per `REFRESH_INTERVAL_MS`
- `GET /vehicles`: once at startup
- `GET /trips/{tripId}`, `GET /stops/{stopId}`, `GET /stops/{stopId}/departures?time=90`: on focused bus open

## Cloudflare Deployment

Recommended deployment target: **Cloudflare Pages + Pages Functions**.

This repo now supports a same-origin `/api/*` proxy through Cloudflare Pages Functions so the browser does **not** send `X-ApiKey` directly.

### What stays private

- `API_KEY` lives only in Cloudflare Pages **Secrets**
- the browser calls `/api/...` on your deployment
- the Pages Function adds `X-ApiKey` server-side
- the deployed frontend never includes the raw key

### Files added for Cloudflare

- `functions/api/[[path]].js`: allowlisted MTD proxy
- `functions/data/runtime-config.json.js`: runtime config from Pages env vars
- `_routes.json`: limits Functions to `/api/*` and `/data/runtime-config.json`
- `wrangler.toml`: Pages-compatible Wrangler config

### Cloudflare setup

1. Push this repo to GitHub.
2. Create a Cloudflare Pages project connected to the repo.
3. Use the repo root as the build output directory.
4. In Cloudflare Pages, set this secret:
   - `API_KEY`
5. Optional Pages variables:
   - `REFRESH_INTERVAL_MS`
   - `TILE_URL`
   - `TILE_ATTRIBUTION`
   - `TILE_MAX_ZOOM`
   - `INITIAL_THEME`
   - `API_MODE`
   - `API_BASE`

Recommended Cloudflare runtime config:
- `API_MODE=proxy`
- `API_BASE=/api`

The proxy allowlists only these REST paths:
- `/vehicles/locations`
- `/vehicles`
- `/trips/:id`
- `/stops/:id`
- `/stops/:id/departures`

The proxy also adds short cache windows to reduce upstream pressure:
- `/vehicles/locations`: 15s
- `/stops/*/departures`: 15s
- `/vehicles`: 1h
- `/trips/*`: 6h
- `/stops/*`: 6h

## Local Development

### Proxy-like mode

The app defaults to:
- `apiMode: "proxy"`
- `apiBase: "/api"`

If `data/runtime-config.json` is missing, the frontend falls back to those defaults automatically.

### Direct local mode

For local testing against `api.mtd.dev`, create a `.env` file:

```env
API_MODE=direct
API_KEY=your_key_here
REFRESH_INTERVAL_MS=120000
TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
TILE_ATTRIBUTION=&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
TILE_MAX_ZOOM=19
INITIAL_THEME=light
```

Then build the local cache:

```bash
python3 scripts/build_gtfs_cache.py
```

Serve the folder:

```bash
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000
```

## Notes

- Polling pauses while the tab is hidden.
- Route geometry and trip-stop sequencing come from the local GTFS cache, so there are no live shape fetches.
- The GTFS cache is split so the map can render before the full trip-stop payload is needed.
- Occupancy hotspots are derived from changes between consecutive GTFS-Realtime snapshots.
- Cloudflare proxy mode is the safe path for public deployment.
- Direct mode is only for local development or deliberate public-key testing.
