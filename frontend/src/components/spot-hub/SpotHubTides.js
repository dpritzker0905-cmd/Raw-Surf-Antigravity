/**
 * SpotHubTides: the full hub's (/spot-hub/:id) tide card, phase 1 (2026-11-03). The full hub showed
 * no tide at all while the pinned drawer did. It reads the SAME endpoint the drawer reads
 * (`/tides/{spotId}`, select: an `error` body is "no tide here") and renders the SAME block
 * (SpotTideBlock), so the two hubs cannot disagree about the tide. Absent data renders nothing.
 * Kill switch: window.__RAW_DISABLE_SPOT_HUB_P1__ = true (no request, no card).
 */
import React, { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';
import SpotTideBlock from './SpotTideBlock';
import { spotHubP1Enabled } from './spotHubP1Format';

export default function SpotHubTides({ spotId, t, cardBg }) {
  const enabled = spotHubP1Enabled() && !!spotId;
  const [state, setState] = useState({ spotId: null, tideData: null });

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    apiClient.get(`/tides/${spotId}`, { signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) setState({ spotId, tideData: res?.data?.error ? null : res?.data || null });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          logger.debug('Spot hub tide read unavailable');
          setState({ spotId, tideData: null });
        }
      });
    return () => controller.abort();
  }, [enabled, spotId]);

  // Never show the previous spot's tides on the render before the new answer lands.
  const tideData = enabled && state.spotId === spotId ? state.tideData : null;
  if (!tideData) return null;
  return (
    <section aria-label="Tides" className={`mx-4 mt-3 rounded-xl border backdrop-blur-md overflow-hidden ${cardBg}`}
      data-testid="spothub-tides">
      <SpotTideBlock tideData={tideData} t={t} containerBorder="border-transparent" testId="spothub-tide-block" />
    </section>
  );
}
