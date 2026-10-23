export function marineSeriesWorkBoundsEnabled() {
  return process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS === 'true' &&
    !(typeof window !== 'undefined' && window.__RAW_DISABLE_MARINE_SERIES_WORK_BOUNDS__ === true);
}

// One regional intent, plus reusable global work. Identity comes from the series
// key: model/layer/flavor/anchor/snapped viewport, rather than raw gesture events.
// `isEnabled` is the lane's own gate (marine: a build flag; wind: default on with its own kill
// switch), so both series lanes share ONE implementation of "the latest regional view owns the work".
export function createSeriesViewportIntent(isEnabled) {
  const lifetime = new AbortController();
  let regional = null, regionalKey = null;
  return {
    signalFor(key) {
      if (lifetime.signal.aborted || !isEnabled()) return lifetime.signal;
      if (key.includes('_global_p')) return lifetime.signal;
      if (regionalKey !== key) {
        regional?.abort(); regional = new AbortController(); regionalKey = key;
      }
      return regional.signal;
    },
    abort() { lifetime.abort(); regional?.abort(); },
  };
}

// A pan to another snapped request box supersedes the old box's series work BY DEFAULT (2026-10-23, marineSeriesPanGuard.js): with the
// build flag unset (production) a pan session queued every view's pages on the 1-CPU box. Kill: __RAW_DISABLE_SERIES_PAN_SUPERSEDE__.
export function marineSeriesSupersedeOn() {
  return marineSeriesWorkBoundsEnabled() || !(typeof window !== 'undefined' && window.__RAW_DISABLE_SERIES_PAN_SUPERSEDE__ === true);
}

export function createMarineViewportIntent() {
  return createSeriesViewportIntent(marineSeriesSupersedeOn);
}
