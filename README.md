# MTD Champaign-Urbana Live Dashboard

Static live dashboard for Champaign-Urbana MTD vehicle positions, optimized to keep live API usage low.

## What it does

- Uses the current MTD developer API at `https://api.mtd.dev`
- Uses a split local GTFS cache so the map boots from a small core payload and loads trip-stop detail lazily
- Hits the live API only for `GET /vehicles/locations`
- Preloads `GET /vehicles` once for fleet metadata used in bus detail cards
- Reads MTD GTFS-realtime vehicle positions for occupancy, stop-status, and congestion fields
- Stores your `X-ApiKey` only in local browser storage
- Renders a MapLibre-powered live tiled basemap with a minimal Mini Metro-inspired route overlay
- Click a bus to open a compact vehicle profile with live occupancy/congestion and upcoming stops
- Click a route to open a route analysis panel with active fleet and occupancy-pressure insights
- Adds a fading pink/green occupancy-change overlay keyed to stops or nearby blocks
- Includes a heatmap toggle and legend in the HUD
- Supports dark and light themes

## Local run

1. Build the local GTFS cache:

```bash
python3 scripts/build_gtfs_cache.py
```

2. Serve the folder with any static file server. For example:

```bash
python3 -m http.server 8000
```

3. Open `http://localhost:8000`.

## Notes

- Default live polling is one request every 2 minutes, and polling pauses while the tab is hidden.
- Route lines and trip-to-shape mapping come from the local GTFS cache, so there are no live trip or shape API calls at runtime.
- The startup-critical GTFS core is separated from trip-stop sequences, which reduces initial load time substantially.
- Occupancy hotspots are derived from changes between consecutive GTFS-realtime vehicle snapshots rather than from any extra analytics endpoint.
- Bus detail cards derive stop sequences from the GTFS cache and only hit the next-stop departures endpoint when a bus is selected.
- Route highlighting, route fade, and stop overlays are rendered client-side from the cached GTFS geometry.
- `scripts/build_gtfs_cache.py` also writes `data/runtime-config.json` from `.env`, so the browser automatically picks up your local API key and refresh interval.

## Env vars

- `API_KEY`: MTD developer API key
- `REFRESH_INTERVAL_MS`: live refresh interval in milliseconds
- `TILE_URL`: optional raster tile URL template
- `TILE_ATTRIBUTION`: optional tile attribution HTML
- `TILE_MAX_ZOOM`: optional tile max zoom
- `INITIAL_THEME`: `light` or `dark`

## GitHub Pages deploy

The Pages workflow now generates `data/runtime-config.json` during the GitHub Actions build, so you do not need to commit that file.

Set these in your GitHub repo before pushing:

- Secret: `API_KEY`
- Optional repository variables:
  - `REFRESH_INTERVAL_MS`
  - `TILE_URL`
  - `TILE_ATTRIBUTION`
  - `TILE_MAX_ZOOM`
  - `INITIAL_THEME`

Important:

- This still exposes the MTD key in the final deployed static site, because the browser receives `data/runtime-config.json`.
- The secret stays hidden in Actions logs and repo settings, but not in the built Pages artifact.

# I KNOW MY API KEY IS PUBLIC, IT'S THERE ON PURPOSE!!!
# I JUST NEEDED TO GET A POC OUT TO TEST THIS NEWLY RELEASED API
