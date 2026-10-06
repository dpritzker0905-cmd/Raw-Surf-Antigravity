// Timing scalars only: never retain performance entries, script attribution, URLs or window objects.
const ms = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** Observe only a low-FPS streak, starting at the END of its first window.
 * Entries crossing either boundary are excluded. Delivery can lag the trip;
 * zero means no eligible entries delivered, not proof of no main-thread stall.
 * Long-task and long-frame durations overlap and must never be added together.
 */
export function beginMarineMainThreadTiming(start, Observer) {
  let observer = null, closed = false, end = Infinity, expiry = null, deliveryIncomplete = false;
  const totals = {};
  function disconnect() {
    if (expiry !== null) clearTimeout(expiry);
    expiry = null;
    try { observer?.disconnect(); } catch (e) { deliveryIncomplete = true; }
    observer = null;
  }
  function ingest(entries) {
    for (const entry of entries) {
      try {
        const bucket = totals[entry.entryType];
        const at = ms(entry.startTime), duration = ms(entry.duration);
        if (!bucket || at === null || duration === null || at < start || at + duration > end) continue;
        bucket.count++; bucket.totalDurationMs += duration;
        bucket.maxDurationMs = Math.max(bucket.maxDurationMs, duration);
        if (entry.entryType === 'long-animation-frame') {
          let blocking = null;
          try { blocking = ms(entry.blockingDuration); }
          catch (e) { deliveryIncomplete = true; }
          if (blocking === null) bucket.blockingDurationKnown = false;
          else bucket.totalBlockingDurationMs += blocking;
        }
      } catch (e) { deliveryIncomplete = true; }
    }
  }
  try {
    const types = Observer?.supportedEntryTypes;
    for (const type of ['longtask', 'long-animation-frame']) {
      if (Array.isArray(types) && types.includes(type)) {
        totals[type] = { count: 0, totalDurationMs: 0, maxDurationMs: 0 };
        if (type === 'long-animation-frame') Object.assign(totals[type], {
          blockingDurationKnown: true, totalBlockingDurationMs: 0,
        });
      }
    }
    if (Object.keys(totals).length && ms(start) !== null) {
      observer = new Observer(list => {
        if (!closed) { try { ingest(list.getEntries()); } catch (e) { deliveryIncomplete = true; } }
      });
      observer.observe({ entryTypes: Object.keys(totals) }); // no buffered pre-streak entries
      // No more render events may arrive to reset the streak. Never leave the observer running
      // indefinitely. A normal trip's 11 remaining windows finish in <22s (2s gap resets it).
      expiry = setTimeout(() => { closed = true; disconnect(); }, 30000);
    } else Object.keys(totals).forEach(key => delete totals[key]);
  } catch (e) {
    disconnect(); Object.keys(totals).forEach(key => delete totals[key]);
  }
  return {
    finish(now) {
      if (closed) return null;
      end = ms(now) !== null && now >= start ? now : -1;
      try { if (observer) ingest(observer.takeRecords()); } catch (e) { deliveryIncomplete = true; }
      closed = true;
      disconnect();
      const copy = type => {
        const bucket = totals[type];
        if (!bucket || end < start) return null;
        const result = { ...bucket };
        if (result.blockingDurationKnown === false) result.totalBlockingDurationMs = null;
        return result;
      };
      return { deliveryMayLagTrip: true, deliveryIncomplete, overlappingMetrics: true,
        longTasks: copy('longtask'), longAnimationFrames: copy('long-animation-frame') };
    },
    dispose() {
      closed = true;
      disconnect();
    },
  };
}
