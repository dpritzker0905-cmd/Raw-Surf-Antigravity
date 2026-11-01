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

// Coordinate only runner-requested closure; never close a borrowed context ourselves.
// The original API remains responsible for cancellation, options, result and errors.
function coordinateContextClose(context, drain) {
  const original = context.close;
  const descriptor = Object.getOwnPropertyDescriptor(context, 'close');
  if (typeof original !== 'function' || typeof drain !== 'function') {
    throw new Error('Synthetic socket close coordination requires close and drain functions');
  }
  let barrier, result;
  function coordinatedClose(...args) {
    if (this !== context) return Reflect.apply(original, this, args);
    if (!barrier) {
      barrier = Promise.resolve().then(drain).then(value => {
        const pending = Number.isInteger(value?.pending) && value.pending >= 0 ? value.pending : null;
        const handlerErrors = Number.isInteger(value?.handlerErrors) && value.handlerErrors >= 0 ? value.handlerErrors : null;
        result = { complete: value?.complete === true && pending === 0 && handlerErrors === 0,
          pending, handlerErrors, error: false };
      }, () => {
        // Still permit native cleanup; the final receipt must keep this failure red.
        result = { complete: false, pending: null, handlerErrors: null, error: true };
      });
    }
    return barrier.then(() => Reflect.apply(original, this, args));
  }
  context.close = coordinatedClose;
  if (context.close !== coordinatedClose) throw new Error('Synthetic socket close coordinator was not installed');
  return {
    snapshot: () => ({ requested: !!barrier, drain: result ? { ...result } : null }),
    restore() {
      if (context.close !== coordinatedClose) return false;
      if (descriptor) Object.defineProperty(context, 'close', descriptor);
      else delete context.close;
      return true;
    },
  };
}

module.exports = { createRouteLifecycle, coordinateContextClose };
