/**
 * CanvasAnimationCoordinator.js — Phase 2 Render Orchestrator
 *
 * SINGLE requestAnimationFrame loop for ALL Canvas2D particle systems.
 * Replaces the independent RAF loops in GPUWindLayer and GPUMarineLayer.
 *
 * Architecture (per system-brain/render-loop-governance.md):
 *   - ONE RAF callback globally for Canvas2D layers
 *   - WebGL rendering stays inside MapLibre's own frame (map.triggerRepaint)
 *   - Interaction throttling applied uniformly to all layers
 *   - Frame budget: 16ms target, degrade gracefully
 *
 * RULES:
 *   - NO import-time side effects
 *   - NO React dependency (pure JS)
 *   - NO MapLibre dependency (receives mapInstance at init)
 *   - Consumers register tick callbacks, coordinator runs them in order
 */

// ─── SINGLETON GUARD ─────────────────────────────────────────────────────────
let _instance = null;

// ─── INTERACTION STATES ──────────────────────────────────────────────────────
const STATE_RUNNING = 1;
const STATE_THROTTLED = 2;
const STATE_DORMANT = 3; // no active layers

/**
 * @typedef {Object} TickCallback
 * @property {string} id - unique layer identifier
 * @property {function(number, number, number): void} tick - (now, dt, state) => void
 * @property {function(): boolean} isActive - returns true if layer should tick
 */

class CanvasAnimationCoordinator {
  constructor() {
    /** @type {Map<string, TickCallback>} */
    this._layers = new Map();
    this._rafId = null;
    this._lastTime = 0;
    this._frameCount = 0;
    this._state = STATE_RUNNING;
    this._interactionCount = 0;
    this._idleTimer = null;
    this._mapInstance = null;
    this._running = false;

    // Bind once to avoid GC
    this._animate = this._animate.bind(this);
    this._onDragStart = this._onDragStart.bind(this);
    this._onZoomStart = this._onZoomStart.bind(this);
    this._onDragEnd = this._onDragEnd.bind(this);
    this._onZoomEnd = this._onZoomEnd.bind(this);
    this._onIdle = this._onIdle.bind(this);
  }

  /**
   * Initialize the coordinator with a MapLibre instance.
   * Attaches unified interaction throttling.
   * @param {*} mapInstance
   */
  init(mapInstance) {
    if (this._mapInstance === mapInstance) return;
    this.dispose(); // cleanup previous if re-init

    this._mapInstance = mapInstance;
    this._lastTime = performance.now();

    mapInstance.on('dragstart', this._onDragStart);
    mapInstance.on('zoomstart', this._onZoomStart);
    mapInstance.on('dragend', this._onDragEnd);
    mapInstance.on('zoomend', this._onZoomEnd);
    mapInstance.on('moveend', this._onIdle);

    console.log('[Coordinator] Initialized — single RAF for all Canvas2D layers');
  }

  /**
   * Register a layer's tick callback.
   * @param {string} id
   * @param {function} tickFn - (now, dt, state) => void
   * @param {function} isActiveFn - () => boolean
   */
  register(id, tickFn, isActiveFn) {
    if (this._layers.has(id)) {
      console.warn(`[Coordinator] Layer already registered: ${id}`);
      return;
    }
    this._layers.set(id, { id, tick: tickFn, isActive: isActiveFn });
    console.log(`[Coordinator] Registered layer: ${id} (total: ${this._layers.size})`);

    // Auto-start when first layer registers
    if (!this._running) this.start();
  }

  /** @param {string} id */
  unregister(id) {
    this._layers.delete(id);
    console.log(`[Coordinator] Unregistered layer: ${id} (remaining: ${this._layers.size})`);

    // Auto-stop when no layers left
    if (this._layers.size === 0) this.stop();
  }

  /** Start the RAF loop */
  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this._rafId = requestAnimationFrame(this._animate);
    console.log('[Coordinator] RAF loop started');
  }

  /** Stop the RAF loop */
  stop() {
    this._running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    console.log('[Coordinator] RAF loop stopped');
  }

  /** Cleanup everything */
  dispose() {
    this.stop();
    this._layers.clear();
    clearTimeout(this._idleTimer);

    if (this._mapInstance) {
      const m = this._mapInstance;
      try {
        m.off('dragstart', this._onDragStart);
        m.off('zoomstart', this._onZoomStart);
        m.off('dragend', this._onDragEnd);
        m.off('zoomend', this._onZoomEnd);
        m.off('moveend', this._onIdle);
      } catch (e) { /* map may be disposed */ }
      this._mapInstance = null;
    }
  }

  /** @returns {number} current throttle state */
  get state() { return this._state; }

  /** @returns {number} total frames rendered */
  get frameCount() { return this._frameCount; }

  // ─── INTERNAL RAF LOOP ─────────────────────────────────────────────────────

  _animate(now) {
    if (!this._running) return;

    // Check if any layer is active
    let anyActive = false;
    for (const layer of this._layers.values()) {
      if (layer.isActive()) { anyActive = true; break; }
    }

    if (!anyActive) {
      // Dormant mode: check again in 500ms instead of every frame
      this._state = STATE_DORMANT;
      setTimeout(() => {
        if (this._running) this._rafId = requestAnimationFrame(this._animate);
      }, 500);
      return;
    }

    // Compute delta
    const dt = Math.min(50, now - this._lastTime) / 1000;
    this._lastTime = now;
    this._frameCount++;

    // Tick all active layers in registration order
    for (const layer of this._layers.values()) {
      if (layer.isActive()) {
        try {
          layer.tick(now, dt, this._state);
        } catch (e) {
          console.error(`[Coordinator] Tick error in ${layer.id}:`, e.message);
        }
      }
    }

    // Schedule next frame
    this._rafId = requestAnimationFrame(this._animate);
  }

  // ─── INTERACTION THROTTLING (UNIFIED) ──────────────────────────────────────

  _onDragStart(e) {
    if (!e?.originalEvent) return;
    this._interactionCount++;
    clearTimeout(this._idleTimer);
    this._state = STATE_THROTTLED;
  }

  _onZoomStart(e) {
    if (!e?.originalEvent) return;
    this._interactionCount++;
    clearTimeout(this._idleTimer);
    this._state = STATE_THROTTLED;
  }

  _onDragEnd(e) {
    if (!e?.originalEvent) return;
    this._interactionCount = Math.max(0, this._interactionCount - 1);
  }

  _onZoomEnd(e) {
    if (!e?.originalEvent) return;
    this._interactionCount = Math.max(0, this._interactionCount - 1);
  }

  _onIdle() {
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => {
      if (this._interactionCount === 0) this._state = STATE_RUNNING;
    }, 300);
  }
}

// ─── EXPORT SINGLETON ACCESSOR ───────────────────────────────────────────────

/**
 * Get (or create) the single CanvasAnimationCoordinator instance.
 * Does NOT initialize — call .init(mapInstance) after creation.
 * @returns {CanvasAnimationCoordinator}
 */
export function getAnimationCoordinator() {
  if (!_instance) {
    _instance = new CanvasAnimationCoordinator();
  }
  return _instance;
}

/** Dispose and release the singleton. */
export function disposeAnimationCoordinator() {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}

// Export state constants for consumers
export { STATE_RUNNING, STATE_THROTTLED, STATE_DORMANT };
