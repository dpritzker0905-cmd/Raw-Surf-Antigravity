/** Track runner-owned async handlers; draining observes completion, never cancels work. */
function createRouteLifecycle() {
  const pending = new Set();
  let handlerErrors = 0;
  return {
    wrap(handle) {
      return async (...args) => {
        const task = Promise.resolve().then(() => handle(...args));
        pending.add(task);
        try { return await task; }
        catch (error) { handlerErrors += 1; throw error; }
        finally { pending.delete(task); }
      };
    },
    async drain(timeoutMs = 5000) {
      let timer;
      const expired = new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); });
      try {
        let drained;
        do {
          drained = await Promise.race([
            Promise.allSettled([...pending]).then(() => true), expired,
          ]);
          if (!drained) break;
          await new Promise(resolve => setImmediate(resolve));
        } while (pending.size);
        return { complete: !!drained && pending.size === 0 && handlerErrors === 0,
          pending: pending.size, handlerErrors };
      } finally { clearTimeout(timer); }
    },
  };
}

module.exports = { createRouteLifecycle };
