/**
 * CanvasAnimationCoordinator.js Phase 2 Render Orchestrator
 *
 * SINGLE requestAnimationFrame loop for ALL Canvas2D particle systems.
 *
 * v3.9.7 TDZ-SAFE:
 *   - Uses `var` and function declarations ONLY (no const/let/class at module level)
 * - `var` and `function` are hoisted immune to Temporal Dead Zone
 *   - Webpack ModuleConcatenationPlugin can reorder freely without TDZ crashes
 *
 * Architecture (per system-brain/render-loop-governance.md):
 *   - ONE RAF callback globally for Canvas2D layers
 *   - WebGL rendering stays inside MapLibre's own frame (map.triggerRepaint)
 *   - Interaction throttling applied uniformly to all layers
 *   - Consumers register tick callbacks, coordinator runs them
 */

// THROTTLE STATES (hoisted via var TDZ-immune) 
// Coordinator passes these as numbers to tick callbacks.
// Consumers compare against numbers directly (no import needed).
var COORD_RUNNING = 1;
var COORD_THROTTLED = 2;
var COORD_DORMANT = 3;

var _coordInstance = null;

// COORDINATOR (function constructor hoisted, TDZ-immune) 

function CanvasAnimationCoordinator() {
  this._layers = new Map();
  this._rafId = null;
  this._lastTime = 0;
  this._frameCount = 0;
  this._state = COORD_RUNNING;
  this._interactionCount = 0;
  this._idleTimer = null;
  this._dormancyTimer = null;
  this._mapInstance = null;
  this._running = false;
  // Phase 3: Frame budget enforcement
  this._totalFrameTime = 0;
  this._maxFrameTime = 0;
  this._budgetOverruns = 0;
  this._autoThrottled = false;

  // Bind handlers once
  var self = this;
  this._animate = function(now) { self._doAnimate(now); };
  this._onDragStart = function(e) { if (!e?.originalEvent) return; self._interactionCount++; clearTimeout(self._idleTimer); self._state = COORD_THROTTLED; };
  this._onZoomStart = function(e) { if (!e?.originalEvent) return; self._interactionCount++; clearTimeout(self._idleTimer); self._state = COORD_THROTTLED; };
  this._onDragEnd = function(e) { if (!e?.originalEvent) return; self._interactionCount = Math.max(0, self._interactionCount - 1); };
  this._onZoomEnd = function(e) { if (!e?.originalEvent) return; self._interactionCount = Math.max(0, self._interactionCount - 1); };
  this._onIdle = function() {
    clearTimeout(self._idleTimer);
    self._idleTimer = setTimeout(function() {
      if (self._interactionCount === 0) self._state = COORD_RUNNING;
    }, 300);
  };
}

CanvasAnimationCoordinator.prototype.init = function(mapInstance) {
  if (this._mapInstance === mapInstance) return;
  this.dispose();
  this._mapInstance = mapInstance;
  this._lastTime = performance.now();
  mapInstance.on('dragstart', this._onDragStart);
  mapInstance.on('zoomstart', this._onZoomStart);
  mapInstance.on('dragend', this._onDragEnd);
  mapInstance.on('zoomend', this._onZoomEnd);
  mapInstance.on('moveend', this._onIdle);
 console.log('[Coordinator] Initialized single RAF for all Canvas2D layers');
};

CanvasAnimationCoordinator.prototype.register = function(id, tickFn, isActiveFn) {
  if (this._layers.has(id)) return;
  this._layers.set(id, { id: id, tick: tickFn, isActive: isActiveFn });
  console.log('[Coordinator] Registered: ' + id + ' (total: ' + this._layers.size + ')');
  if (!this._running) this.start();
};

CanvasAnimationCoordinator.prototype.unregister = function(id) {
  this._layers.delete(id);
  console.log('[Coordinator] Unregistered: ' + id + ' (remaining: ' + this._layers.size + ')');
  if (this._layers.size === 0) this.stop();
};

CanvasAnimationCoordinator.prototype.start = function() {
  if (this._running) return;
  this._running = true;
  this._lastTime = performance.now();
  this._rafId = requestAnimationFrame(this._animate);
};

CanvasAnimationCoordinator.prototype.stop = function() {
  this._running = false;
  if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  if (this._dormancyTimer) { clearTimeout(this._dormancyTimer); this._dormancyTimer = null; }
};

CanvasAnimationCoordinator.prototype.dispose = function() {
  this.stop();
  this._layers.clear();
  clearTimeout(this._idleTimer);
  if (this._dormancyTimer) { clearTimeout(this._dormancyTimer); this._dormancyTimer = null; }
  if (this._mapInstance) {
    var m = this._mapInstance;
    try {
      m.off('dragstart', this._onDragStart);
      m.off('zoomstart', this._onZoomStart);
      m.off('dragend', this._onDragEnd);
      m.off('zoomend', this._onZoomEnd);
      m.off('moveend', this._onIdle);
    } catch (e) { /* map may be disposed */ }
    this._mapInstance = null;
  }
};

CanvasAnimationCoordinator.prototype._doAnimate = function(now) {
  if (!this._running) return;

  // Check if any layer is active
  var anyActive = false;
  var iter = this._layers.values();
  var entry = iter.next();
  while (!entry.done) {
    if (entry.value.isActive()) { anyActive = true; break; }
    entry = iter.next();
  }

  if (!anyActive) {
    this._state = COORD_DORMANT;
    var self = this;
    clearTimeout(this._dormancyTimer);
    this._dormancyTimer = setTimeout(function() {
      if (self._running) self._rafId = requestAnimationFrame(self._animate);
    }, 500);
    return;
  }

  // Compute delta
  var dt = Math.min(50, now - this._lastTime) / 1000;
  this._lastTime = now;
  this._frameCount++;

 // FRAME BUDGET ENFORCEMENT (Phase 3) 
  var frameStart = performance.now();

  // Tick all active layers
  var layerIter = this._layers.values();
  var layerEntry = layerIter.next();
  while (!layerEntry.done) {
    var layer = layerEntry.value;
    if (layer.isActive()) {
      try { layer.tick(now, dt, this._state); }
      catch (e) { console.error('[Coordinator] Tick error in ' + layer.id + ':', e.message); }
    }
    layerEntry = layerIter.next();
  }

  // Frame budget metrics
  var frameTime = performance.now() - frameStart;
  this._totalFrameTime += frameTime;
  if (frameTime > this._maxFrameTime) this._maxFrameTime = frameTime;

  // Track budget overruns (> 16ms = missed 60fps target)
  if (frameTime > 16) {
    this._budgetOverruns++;
    // If consistently over budget (>25% of frames), auto-throttle
    if (this._frameCount > 60 && this._budgetOverruns / this._frameCount > 0.25) {
      if (this._state === COORD_RUNNING) {
        this._state = COORD_THROTTLED;
        this._autoThrottled = true;
      }
    }
  } else if (this._autoThrottled && this._frameCount % 120 === 0) {
    // Recovery: check every 2 seconds if we can resume full quality
    this._autoThrottled = false;
    this._state = COORD_RUNNING;
    this._budgetOverruns = 0;
  }

  // Periodic metrics log
  if (this._frameCount % 1800 === 0) {
    var avgFrame = this._totalFrameTime / Math.max(1, this._frameCount);
    console.log('[Coordinator] Metrics: avg=' + avgFrame.toFixed(2) + 'ms, ' +
      'max=' + this._maxFrameTime.toFixed(2) + 'ms, ' +
      'overruns=' + this._budgetOverruns + '/' + this._frameCount + ', ' +
      'layers=' + this._layers.size);
    this._totalFrameTime = 0;
    this._maxFrameTime = 0;
    this._budgetOverruns = 0;
    this._frameCount = 0;
  }

  this._rafId = requestAnimationFrame(this._animate);
};

// SINGLETON ACCESSOR (function declaration hoisted) 

export function getAnimationCoordinator() {
  if (!_coordInstance) _coordInstance = new CanvasAnimationCoordinator();
  return _coordInstance;
}

export function disposeAnimationCoordinator() {
  if (_coordInstance) { _coordInstance.dispose(); _coordInstance = null; }
}

// Export throttle state as numbers consumers compare directly, no import needed
// Tick callbacks receive state as 3rd argument: tick(now, dt, state)
// state === 1 running, state === 2 throttled, state === 3 dormant
