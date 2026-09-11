// The pinned decoder and our cache/model guards use legacy virtual identities.
// Rewrite only actual HTTP resource requests: the provider retired that CDN.
// https://github.com/open-meteo/weather-map-layer/commit/37136ba4efa2abb332222b5079ce29a951b2588f
export function legacyOpenMeteoUrl(input) {
  const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== 'https://map-tiles.open-meteo.com' || url.username || url.password ||
      !/^\/data_spatial\/[a-z0-9_]+\/(?:latest\.json|[0-9TZ/.-]+\.om)$/.test(url.pathname)) {
    return null;
  }
  return url;
}

export function openMeteoFetchInput(input) {
  const url = legacyOpenMeteoUrl(input);
  if (!url) return input;
  url.hostname = 'openmeteo.s3.amazonaws.com';
  if (typeof Request !== 'undefined' && input instanceof Request) return new Request(url.href, input);
  return input instanceof URL ? url : url.href;
}
