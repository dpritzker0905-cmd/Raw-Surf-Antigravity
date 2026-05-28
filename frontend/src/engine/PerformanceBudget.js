/**
 * PerformanceBudget.js — Runtime Performance Tracking + Dynamic Throttling
 *
 * Measures hot-path execution times and provides throttle flags
 * that SimulationLoop and RenderPlanDispatcher read to self-regulate.
 *
 * BUDGETS:
 *   - SimulationLoop tick: < 8ms
 *   - RenderPlan compose:  < 5ms
 *   - GPU dispatch:        < 3ms
 *
 * THROTTLE ACTIONS (when over budget):
 *   - Increase FIELD_EVOLUTION_INTERVAL (slower evolution)
 *   - Double DISPATCH_INTERVAL (fewer GPU uploads)
 *   - Skip evolution diagnostics
 *
 * RULES:
 *   - NO simulation logic
 *   - Pure timing measurement + flag management
 */

// ========================================================================
// CONFIGURATION
// ========================================================================

const SAMPLE_SIZE = 60;          // Rolling window (1 second at 60Hz)
const SIM_BUDGET_MS = 8.0;      // SimulationLoop tick budget
const COMPOSE_BUDGET_MS = 5.0;  // RenderPlan composition budget
const DISPATCH_BUDGET_MS = 3.0; // GPU dispatch budget
const RECOVERY_FRAMES = 120;    // Frames below budget before un-throttling

// ========================================================================
// STATE
// ========================================================================

const _simSamples = new Float32Array(SAMPLE_SIZE);
const _composeSamples = new Float32Array(SAMPLE_SIZE);
const _dispatchSamples = new Float32Array(SAMPLE_SIZE);
let _sampleIndex = 0;

let _simOverBudget = false;
let _composeOverBudget = false;
let _dispatchOverBudget = false;
let _recoveryCounter = 0;

// ========================================================================
// TIMING API
// ========================================================================

/**
 * Record a simulation tick duration.
 * @param {number} ms - Duration in milliseconds
 */
export function recordSimTick(ms) {
  _simSamples[_sampleIndex % SAMPLE_SIZE] = ms;
}

/**
 * Record a RenderPlan composition duration.
 * @param {number} ms - Duration in milliseconds
 */
export function recordCompose(ms) {
  _composeSamples[_sampleIndex % SAMPLE_SIZE] = ms;
}

/**
 * Record a GPU dispatch duration.
 * @param {number} ms - Duration in milliseconds
 */
export function recordDispatch(ms) {
  _dispatchSamples[_sampleIndex % SAMPLE_SIZE] = ms;
}

/**
 * Advance the sample counter. Call once per frame.
 */
export function advanceFrame() {
  _sampleIndex++;

  // Recompute averages periodically (every 30 frames)
  if (_sampleIndex % 30 === 0) {
    updateThrottleFlags();
  }
}

// ========================================================================
// THROTTLE COMPUTATION
// ========================================================================

function computeAverage(samples) {
  const filled = Math.min(_sampleIndex, SAMPLE_SIZE);
  if (filled === 0) return 0;
  let sum = 0;
  for (let i = 0; i < filled; i++) {
    sum += samples[i];
  }
  return sum / filled;
}

function updateThrottleFlags() {
  const avgSim = computeAverage(_simSamples);
  const avgCompose = computeAverage(_composeSamples);
  const avgDispatch = computeAverage(_dispatchSamples);

  const wasThrottled = _simOverBudget || _composeOverBudget || _dispatchOverBudget;

  _simOverBudget = avgSim > SIM_BUDGET_MS;
  _composeOverBudget = avgCompose > COMPOSE_BUDGET_MS;
  _dispatchOverBudget = avgDispatch > DISPATCH_BUDGET_MS;

  const isThrottled = _simOverBudget || _composeOverBudget || _dispatchOverBudget;

  // Recovery logic: must be below budget for RECOVERY_FRAMES before un-throttling
  if (isThrottled) {
    _recoveryCounter = 0;
  } else if (wasThrottled) {
    _recoveryCounter++;
  }

  // Log state changes
  if (isThrottled && !wasThrottled) {
    console.warn('[PerfBudget] THROTTLING — sim:', avgSim.toFixed(1) + 'ms',
      'compose:', avgCompose.toFixed(1) + 'ms',
      'dispatch:', avgDispatch.toFixed(1) + 'ms');
  }
  if (!isThrottled && wasThrottled && _recoveryCounter >= RECOVERY_FRAMES) {
    console.log('[PerfBudget] Recovered — returning to full speed');
  }
}

// ========================================================================
// THROTTLE FLAG QUERIES
// ========================================================================

/**
 * Should SimulationLoop reduce evolution frequency?
 */
export function shouldThrottleEvolution() {
  return _simOverBudget;
}

/**
 * Should RenderPlanDispatcher reduce upload frequency?
 */
export function shouldThrottleDispatch() {
  return _dispatchOverBudget;
}

/**
 * Should RenderPlan skip attaching evolution diagnostics?
 */
export function shouldSkipDiagnostics() {
  return _composeOverBudget;
}

/**
 * Get the recommended evolution interval multiplier.
 * Normal = 1, Throttled = 2.
 */
export function getEvolutionMultiplier() {
  return _simOverBudget ? 2 : 1;
}

/**
 * Get the recommended dispatch interval multiplier.
 * Normal = 1, Throttled = 2.
 */
export function getDispatchMultiplier() {
  return _dispatchOverBudget ? 2 : 1;
}

/**
 * Get performance diagnostics.
 */
export function getPerfDiagnostics() {
  return {
    avgSimMs: +computeAverage(_simSamples).toFixed(2),
    avgComposeMs: +computeAverage(_composeSamples).toFixed(2),
    avgDispatchMs: +computeAverage(_dispatchSamples).toFixed(2),
    simOverBudget: _simOverBudget,
    composeOverBudget: _composeOverBudget,
    dispatchOverBudget: _dispatchOverBudget,
    throttled: _simOverBudget || _composeOverBudget || _dispatchOverBudget,
    samplesCollected: _sampleIndex,
  };
}
