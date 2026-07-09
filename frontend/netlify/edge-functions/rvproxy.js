// rvproxy — same-origin, edge-cached proxy for RainViewer radar tiles.
//
// WHY (2026-07-09): the radar advection nowcast (advect-rv:// protocol) fetch()es RainViewer tiles
// (prev + curr per advect frame, per tile) ON TOP of the observed frames — ~3x the request volume. On
// RainViewer's free CDN that bursts past the per-IP rate limit (worst zoomed out = most tiles) → HTTP
// 429; a 429 carries no `access-control-allow-origin`, so the browser reports it as a CORS block and
// the tile renders blank (vertical-column "rectangle" gaps that also took the observed radar down).
//
// RainViewer tiles are IMMUTABLE and already send `cache-control: max-age=172800` + `ACAO: *` on 200s.
// This proxy fetches them from the edge and caches them DURABLY on Netlify's CDN (shared across all
// users; on a cache hit Netlify serves the tile WITHOUT invoking this function or touching RainViewer).
// Net effect: RainViewer sees ~one request per unique tile per 2 days → the client is never rate-limited.
// Fixes 429 + CORS + slow-load in one piece, which is what makes advection viable as a default.
//
// Scoped to RainViewer radar tiles only (no open proxy / SSRF). Errors (expired-frame 404, transient
// 429/5xx) are passed through but NEVER cached, so a fresh frame self-heals on the next catalog refresh.

const RV_HOST = 'https://tilecache.rainviewer.com';
const RV_API_HOST = 'https://api.rainviewer.com';

export default async (request) => {
  const { pathname } = new URL(request.url);
  const path = pathname.replace(/^\/rv\//, '');

  // CATALOG (2026-07-09): the frame index `public/weather-maps.json`. It was the ONE RainViewer
  // request still going DIRECT from the browser, so when RainViewer rate-limited the user's IP the
  // 429 (no ACAO) CORS-blocked it → radarPastFrames=[] → the whole radar went faint ("barely visible").
  // Proxying it means Netlify's IP fetches upstream (never the user's) and the result is shared across
  // ALL users via a SHORT edge cache — the catalog rotates ~every 10 min, so 60 s keeps it fresh while
  // RainViewer sees ~1 request/min total. Same-origin → CORS can never block it.
  if (path === 'public/weather-maps.json') {
    let up;
    try {
      up = await fetch(`${RV_API_HOST}/public/weather-maps.json`);
    } catch (e) {
      return new Response('upstream error', { status: 502, headers: { 'access-control-allow-origin': '*' } });
    }
    const ch = new Headers();
    ch.set('access-control-allow-origin', '*');
    ch.set('content-type', up.headers.get('content-type') || 'application/json');
    if (up.ok) {
      ch.set('cache-control', 'public, max-age=60');
      ch.set('netlify-cdn-cache-control', 'public, max-age=60, durable');
      return new Response(up.body, { status: 200, headers: ch });
    }
    ch.set('cache-control', 'no-store');   // never cache a 429/5xx — let the next poll self-heal
    return new Response(null, { status: up.status, headers: ch });
  }

  // Only proxy RainViewer radar tiles: v2/radar/<hex-frame>/<size>/<z>/<x>/<y>/<color>/<opts>.png
  if (!/^v2\/radar\/[a-z0-9]+\/\d+\/\d+\/\d+\/\d+\/\d+\/\d+_\d+\.png$/.test(path)) {
    return new Response('not found', { status: 404 });
  }

  let upstream;
  try {
    upstream = await fetch(`${RV_HOST}/${path}`);
  } catch (e) {
    return new Response('upstream error', { status: 502, headers: { 'access-control-allow-origin': '*' } });
  }

  const headers = new Headers();
  headers.set('access-control-allow-origin', '*');
  headers.set('content-type', upstream.headers.get('content-type') || 'image/png');

  if (upstream.ok) {
    // Immutable tile → 2 days in the browser AND durably on Netlify's edge (shared; bypasses this
    // function on a hit). max-age matches RainViewer's own 172800s.
    headers.set('cache-control', 'public, max-age=172800, immutable');
    headers.set('netlify-cdn-cache-control', 'public, max-age=172800, durable');
    return new Response(upstream.body, { status: 200, headers });
  }

  // Do NOT cache errors (404 expired frame, 429, 5xx) — let the client retry a fresh frame.
  headers.set('cache-control', 'no-store');
  return new Response(null, { status: upstream.status, headers });
};

export const config = { path: '/rv/*', cache: 'manual' };
