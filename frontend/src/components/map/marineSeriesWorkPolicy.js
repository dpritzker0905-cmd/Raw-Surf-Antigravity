export function marineSeriesWorkBoundsEnabled() {
  return process.env.REACT_APP_MARINE_SERIES_WORK_BOUNDS === 'true' &&
    !(typeof window !== 'undefined' && window.__RAW_DISABLE_MARINE_SERIES_WORK_BOUNDS__ === true);
}

// One regional intent, plus reusable global work. Identity comes from the series
// key: model/layer/flavor/anchor/snapped viewport, rather than raw gesture events.
export function createMarineViewportIntent() {
  const lifetime = new AbortController();
  let regional = null, regionalKey = null;
  return {
    signalFor(key) {
      if (lifetime.signal.aborted || !marineSeriesWorkBoundsEnabled()) return lifetime.signal;
      if (key.includes('_global_p')) return lifetime.signal;
      if (regionalKey !== key) {
        regional?.abort(); regional = new AbortController(); regionalKey = key;
      }
      return regional.signal;
    },
    abort() { lifetime.abort(); regional?.abort(); },
  };
}
