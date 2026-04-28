const API_ORIGIN = "https://api.mtd.dev";

const CACHE_TTLS = [
  { pattern: /^\/vehicles\/locations$/, ttl: 1 },
  { pattern: /^\/vehicles$/, ttl: 3600 },
  { pattern: /^\/trips\/[^/]+$/, ttl: 21600 },
  { pattern: /^\/stops\/[^/]+$/, ttl: 21600 },
  { pattern: /^\/stops\/[^/]+\/departures$/, ttl: 15 },
];

export async function onRequestGet(context) {
  const apiKey = String(context.env.API_KEY || "").trim();
  if (!apiKey) {
    return jsonError("Missing API_KEY secret in Cloudflare Pages settings.", 500);
  }

  const requestUrl = new URL(context.request.url);
  const upstreamPath = normalizePath(context.params?.path);
  const ttl = getCacheTtl(upstreamPath);
  if (!ttl) {
    return jsonError("Path not allowed.", 404);
  }

  const upstreamUrl = new URL(API_ORIGIN);
  upstreamUrl.pathname = upstreamPath;
  upstreamUrl.search = requestUrl.search;

  const cache = caches.default;
  const cacheKey = new Request(upstreamUrl.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-ApiKey": apiKey,
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  const response = new Response(upstreamResponse.body, upstreamResponse);
  response.headers.set("Cache-Control", `public, max-age=${ttl}`);
  response.headers.delete("set-cookie");

  if (upstreamResponse.ok) {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return jsonError("Method not allowed.", 405);
  }
  return onRequestGet(context);
}

function normalizePath(rawPathParam) {
  const rawPath = Array.isArray(rawPathParam)
    ? rawPathParam.join("/")
    : String(rawPathParam || "").trim();
  const segments = rawPath
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  return `/${segments.join("/")}`;
}

function getCacheTtl(pathname) {
  const matched = CACHE_TTLS.find((entry) => entry.pattern.test(pathname));
  return matched ? matched.ttl : 0;
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
