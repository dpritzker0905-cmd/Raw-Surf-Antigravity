/**
 * useSpotSeries.js: spot-hub phase 4. Fetches one spot's CI-rated series from the backend proxy
 * (/api/weather/spot-series/{id}); the private bucket is never read from the browser.
 *
 * One request per (spot, model, tier) per 5 minutes per page, shared by every surface that asks (the
 * drawer, the infobox and the full hub can be open on one spot at once). A 404 says why
 * (`disabled`, `unpublished`, `model_unavailable`, `spot_not_found`) and the caller falls back to
 * the hub's previous daily rows. Kill switch: window.__RAW_DISABLE_SPOT_HUB_CHARTS__ (no request at all).
 */
import { useEffect, useState } from 'react';
import apiClient from '../../../lib/apiClient';
import { hubForecastWindow } from '../spotHubP1';
import { spotHubChartsEnabled } from './spotSeriesModel';

const TTL_MS = 5 * 60 * 1000;
const cache = new Map();

export function _resetSpotSeriesCacheForTests() {
  cache.clear();
}

export function fetchSpotSeries(spotId, model, tier, nowMs = Date.now()) {
  const key = `${spotId}|${model}|${tier}`;
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < TTL_MS) return hit.promise;
  const promise = apiClient
    .get(`/weather/spot-series/${encodeURIComponent(spotId)}`, { params: { model, subscription_tier: tier } })
    .then((r) => r.data)
    .catch((e) => {
      const body = e && e.response && e.response.data;
      if (body && body.status) return body;
      cache.delete(key);       // a network error is retried by the next view, not remembered
      return { status: 'error' };
    });
  cache.set(key, { at: nowMs, promise });
  return promise;
}

/** { status: 'off' | 'loading' | 'ok' | <a 404 reason> | 'error', body, window } */
export function useSpotSeries(spotId, userOrTier, model) {
  const enabled = spotHubChartsEnabled() && spotId != null && spotId !== '';
  const win = hubForecastWindow(userOrTier, model);
  const [state, setState] = useState({ status: enabled ? 'loading' : 'off', body: null });
  useEffect(() => {
    if (!enabled) {
      setState({ status: 'off', body: null });
      return undefined;
    }
    let live = true;
    setState({ status: 'loading', body: null });
    fetchSpotSeries(spotId, win.model, win.tier).then((body) => {
      if (live) setState({ status: (body && body.status) || 'error', body });
    });
    return () => { live = false; };
  }, [enabled, spotId, win.model, win.tier]);
  return { ...state, window: win };
}
