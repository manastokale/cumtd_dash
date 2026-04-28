const DEFAULT_REFRESH_INTERVAL_MS = 120000;
const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export function onRequestGet(context) {
  const config = {
    apiKey: "",
    apiMode: readString(context.env.API_MODE, "proxy"),
    apiBase: readString(context.env.API_BASE, "/api"),
    refreshIntervalMs: readNumber(context.env.REFRESH_INTERVAL_MS, DEFAULT_REFRESH_INTERVAL_MS),
    tileUrl: readString(context.env.TILE_URL, DEFAULT_TILE_URL),
    tileAttribution: readString(context.env.TILE_ATTRIBUTION, DEFAULT_TILE_ATTRIBUTION),
    tileMaxZoom: readNumber(context.env.TILE_MAX_ZOOM, 19),
    initialTheme: readString(context.env.INITIAL_THEME, "light"),
  };

  return new Response(JSON.stringify(config), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}

function readString(value, fallback) {
  const stringValue = String(value || "").trim();
  return stringValue || fallback;
}

function readNumber(value, fallback) {
  const numericValue = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}
