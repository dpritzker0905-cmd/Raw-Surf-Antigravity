// Read existing counters only. No GL queries, pixels, payloads, location or device identity.
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const delta = (before, after) => before !== null && after !== null && after >= before ? after - before : null;

function snapshot(gpu) {
  const histogram = gpu?.frameTimeHistogram;
  return {
    nativeCallbacks: count(gpu?.layer?.n),
    textureUploads: count(gpu?.textureUploadCount),
    slowCpuCalls: count(gpu?.droppedFrameCounter),
    cpuCallHistogram: Array.isArray(histogram) && histogram.length === 5 && Array.from(histogram).every(v => count(v) !== null)
      ? histogram.slice() : null,
  };
}

/** One sample per completed low-FPS window, retaining two fixed-size snapshots.
 * The measured interval starts at the END of the first window; it excludes that
 * first window's work. These CPU-call counters include possible driver waiting,
 * shared-context activity and failed renders; they do not measure GPU completion.
 */
export function sampleMarineFallback(previous, { now, fps, gpu, engine }) {
  try {
    const latest = snapshot(gpu);
    // A new engine/counter object or decreasing cumulative counter invalidates interval deltas.
    const same = previous && previous.gpu === gpu && previous.engine === engine;
    const valid = !previous || (same && now >= previous.lastAt
      && Object.keys(latest).every(key => {
        const before = previous.latest[key], after = latest[key];
        if (key === 'cpuCallHistogram') return (!before && !after)
          || (before && after && before.every((v, i) => after[i] >= v));
        return (before === null && after === null) || (before !== null && after !== null && after >= before);
      }));
    return {
      gpu, engine, first: previous ? previous.first : latest, latest,
      firstAt: previous ? previous.firstAt : now, lastAt: now,
      windows: (previous?.windows || 0) + 1,
      firstFps: previous ? previous.firstFps : fps, lastFps: fps,
      minFps: Math.min(previous?.minFps ?? fps, fps), maxFps: Math.max(previous?.maxFps ?? fps, fps),
      intervalValid: (previous?.intervalValid ?? true) && !!valid,
    };
  } catch (e) { return null; } // Diagnostics must never interrupt the guard.
}

export function marineFallbackReceipt(sample) {
  if (!sample) return null;
  const first = sample.first, last = sample.latest;
  const valid = sample.intervalValid;
  return {
    version: 1,
    lowFpsWindows: sample.windows,
    observedIntervalMs: sample.lastAt >= sample.firstAt ? sample.lastAt - sample.firstAt : null,
    intervalCountersContinuous: valid,
    fps: { first: sample.firstFps, last: sample.lastFps, min: sample.minFps, max: sample.maxFps },
    timingKind: 'cpu_call_duration_including_driver_wait',
    gpuCompletionMeasured: false,
    cpuCallHistogramUpperBoundsMs: [8, 16.6, 33.3, 66.6, null],
    // Null means absent/reset/unusable. A measured zero remains zero.
    deltas: {
      nativeCallbacks: valid ? delta(first.nativeCallbacks, last.nativeCallbacks) : null,
      textureUploads: valid ? delta(first.textureUploads, last.textureUploads) : null,
      slowCpuCalls: valid ? delta(first.slowCpuCalls, last.slowCpuCalls) : null,
      cpuCallHistogram: valid && first.cpuCallHistogram && last.cpuCallHistogram
        ? first.cpuCallHistogram.map((v, i) => delta(v, last.cpuCallHistogram[i])) : null,
    },
  };
}
