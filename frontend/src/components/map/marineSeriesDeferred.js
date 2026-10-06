// Deferred series work belongs to its caller until it runs or is canceled.
const pending = new Set();

function guardEnabled() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_SERIES_ABORT_GUARD__ === true);
}

export function marineSeriesCallerAborted(signal) {
  return !!(signal && signal.aborted && guardEnabled());
}

export function deferMarineSeries(fn, delay, signal, idle = false) {
  if (marineSeriesCallerAborted(signal)) return;
  const useIdle = idle && typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function';
  const listen = signal && guardEnabled();
  let active = true;
  let id;
  const cleanup = () => {
    pending.delete(cancel);
    if (listen) signal.removeEventListener('abort', onAbort);
  };
  const cancel = () => {
    if (!active) return;
    active = false;
    if (useIdle) {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(id);
    } else clearTimeout(id);
    cleanup();
  };
  const onAbort = () => { if (guardEnabled()) cancel(); };
  const run = () => {
    if (!active) return; // A callback already queued before cancellation still owns no work.
    active = false;
    cleanup();
    if (!marineSeriesCallerAborted(signal)) fn();
  };
  id = useIdle ? window.requestIdleCallback(run, { timeout: 2500 }) : setTimeout(run, delay);
  pending.add(cancel);
  if (listen) signal.addEventListener('abort', onAbort, { once: true });
  if (marineSeriesCallerAborted(signal)) cancel();
  return id;
}

export function resetMarineSeriesDeferred() {
  for (const cancel of pending) cancel();
}
