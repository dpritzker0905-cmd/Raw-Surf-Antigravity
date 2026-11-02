// Runner opt-in only. This code is bundled normally; the marker is not authentication.
export function registerSyntheticAppLifecycle(scope, unmount, loadClient) {
  const marker = scope.__RAW_SYNTHETIC_APP_LIFECYCLE__;
  if (marker === undefined) return false;
  if (!marker || marker.version !== 1 || Object.keys(marker).join() !== 'version'
      || typeof unmount !== 'function' || typeof loadClient !== 'function') throw new Error('Invalid synthetic app lifecycle registration');
  let operation, state = 'ready';
  function shutdown() {
    if (operation) return operation;
    let resolve, reject;
    operation = new Promise((a, b) => { resolve = a; reject = b; });
    state = 'stopping';
    let unmountFailed = false;
    try { unmount(); } catch { unmountFailed = true; }
    (async () => {
      let cleanupFailed = false, client;
      try { client = await loadClient(); } catch { cleanupFailed = true; }
      if (client !== null) {
        try {
          const statuses = await client.removeAllChannels();
          if (!Array.isArray(statuses) || statuses.some(status => status !== 'ok')) cleanupFailed = true;
        } catch { cleanupFailed = true; }
        try {
          const status = await client.realtime.disconnect();
          if (status !== 'ok' || client.realtime.connectionState() !== 'closed'
              || client.getChannels().length !== 0) cleanupFailed = true;
        } catch { cleanupFailed = true; }
      }
      if (unmountFailed || cleanupFailed) {
        state = 'failed'; throw new Error('Synthetic app shutdown incomplete');
      }
      state = 'complete';
      return { status: state, client: client === null ? 'unconfigured' : 'configured' };
    })().then(resolve, reject);
    return operation;
  }
  Object.defineProperties(marker, {
    shutdown: { value: shutdown, enumerable: true },
    state: { get: () => state, enumerable: true },
  });
  Object.freeze(marker);
  return true;
}
