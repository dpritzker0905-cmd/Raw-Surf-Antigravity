/**
 * Antigravity 2.0 — Weather System Telemetry & Diagnostics Engine
 * 
 * High-performance, self-contained event tracing, tile profiling, and WebGL metrics pipeline.
 * Designed with a circular buffer to prevent memory leaks in production.
 * Exposes real-time insights to the Admin Diagnostics Panel.
 */

class WeatherTelemetryEngine {
  constructor() {
    this.MAX_LOGS = 500;
    this.logs = [];
    this.listeners = new Set();
    this.activeModel = 'GFS';
    this.activeLayers = [];
    this.timeOffsetHours = 0;
    
    // Telemetry aggregators
    this.tileRequests = new Map(); // Correlation trackers for in-flight tiles
    this.tileStats = {
      total: 0,
      loaded: 0,
      failed: 0,
      cached: 0,
      sumDecodeMs: 0,
      history: [] // Circular trace of recent tile actions
    };
    
    this.gpuStats = {
      fps: 60,
      lastFrameTime: Date.now(),
      drawCalls: 0,
      textureCount: 0,
      contextResets: 0,
      shaderCompilations: 0,
      estimatedMemoryMb: 0
    };

    this.failureKnowledgebase = [];
    this.topologyMap = {
      sources: {
        GFS: 'https://map-tiles.open-meteo.com/data_spatial/ncep_gfs013',
        EURO: 'https://map-tiles.open-meteo.com/data_spatial/ecmwf_ifs025',
        ICON: 'https://map-tiles.open-meteo.com/data_spatial/dwd_icon',
        GFS_Wave: 'https://map-tiles.open-meteo.com/data_spatial/ncep_gfswave025',
        EURO_Wave: 'https://map-tiles.open-meteo.com/data_spatial/ecmwf_wam025',
        ICON_Wave: 'https://map-tiles.open-meteo.com/data_spatial/dwd_gwam'
      },
      layers: {
        rain: { engine: 'MapLibre Raster Layer', sync: '3-hourly Ring Buffer' },
        satellite: { engine: 'MapLibre Raster Layer', sync: '3-hourly Ring Buffer' },
        pressure: { engine: 'MapLibre Raster Layer', sync: '3-hourly Ring Buffer' },
        fog: { engine: 'MapLibre Raster Layer', sync: '3-hourly Ring Buffer' },
        wind: { engine: 'WebGL Wind Engine', sync: 'Canvas2D RAF Overlay' },
        waves: { engine: 'Canvas2D Foam Engine', sync: 'Orchestrated Local Reflow' }
      }
    };
    
    // FPS Monitor loop
    if (typeof window !== 'undefined') {
      this.initFpsMonitor();
      this.initConsoleInterceptors();
    }
  }

  initConsoleInterceptors() {
    if (typeof window === 'undefined') return;

    const targetPrefixes = [
      '[WebGLMarine',
      '[WebGLWind',
      '[Backend Weather Service]',
      '[Backend Precipitation Service]',
      '[Backend Pressure Service]',
      '[MapWebGL]',
      '[ExactPoint]',
      '[Safe Cache]',
      '[Fallback]',
      '[CopernicusGrid]',
      '[WebGLGuardrail]',
      '[TRANSITION]',
      '[WebGLOverlay]',
      '[WebGLMarine-Validate]',
      '[OceanMask]',
      '[LayerAccessResolver]',
      '[LayerRegistry]',
      '[FETCH]',
      '[extractMarineAtOffset]',
      '[Pressure]',
      '[PressureController]'
    ];

    // Cheap pre-filter: every tracked prefix begins with '[', so if the first
    // argument is not a string starting with '[' we can bail out before the
    // expensive args.join(' ') + substring scan. This runs on EVERY console call.
    const cannotMatch = (args) => typeof args[0] !== 'string' || args[0].charCodeAt(0) !== 91; // 91 === '['

    const originalWarn = console.warn;
    console.warn = (...args) => {
      originalWarn.apply(console, args);
      try {
        if (cannotMatch(args)) return;
        const msg = args.join(' ');
        if (targetPrefixes.some(prefix => msg.includes(prefix))) {
          this.emit('model_warning', {
            model: this.activeModel,
            warningType: 'console_warn',
            message: msg
          });
        }
      } catch (e) {}
    };

    const originalError = console.error;
    console.error = (...args) => {
      originalError.apply(console, args);
      try {
        if (cannotMatch(args)) return;
        const msg = args.join(' ');
        if (targetPrefixes.some(prefix => msg.includes(prefix))) {
          this.emit('model_error', {
            model: this.activeModel,
            errorType: 'console_error',
            message: msg
          });
        }
      } catch (e) {}
    };

    const originalLog = console.log;
    console.log = (...args) => {
      originalLog.apply(console, args);
      try {
        if (cannotMatch(args)) return;
        const msg = args.join(' ');
        if (typeof args[0] === 'string' && args[0].includes('[WebGLMarineEngine] setWaveData result:') && args[1] && args[1].hasData === false) {
          this.emit('texture_encoding_failed', {
            model: this.activeModel,
            layer: this.activeLayers.find(l => ['waves', 'swell_1', 'swell_2', 'wind_waves'].includes(l)) || 'waves',
            hourOffset: this.timeOffsetHours,
            error: 'Texture encoding returned null waveData'
          });
        } else if (msg.includes('[WebGLMarine-Validate]')) {
          this.emit('model_warning', {
            model: this.activeModel,
            warningType: 'validation_mismatch',
            message: msg
          });
        } else if (msg.includes('[WebGLMarineEngine] render returned early')) {
          this.emit('model_warning', {
            model: this.activeModel,
            warningType: 'render_early_return',
            message: msg
          });
        } else if (msg.includes('[WebGLWindEngine] render returned early')) {
          this.emit('model_warning', {
            model: this.activeModel,
            warningType: 'render_early_return',
            message: msg
          });
        } else if (msg.includes('[MapWebGL] WebGL context restored')) {
          this.emit('WebGL_context_restored');
        } else if (msg.includes('[Fallback]')) {
          this.emit('model_warning', {
            model: this.activeModel,
            warningType: 'fallback_active',
            message: msg
          });
        }
      } catch (e) {}
    };
  }

  // Event dispatching system
  emit(eventType, payload = {}) {
    const timestamp = Date.now();
    const correlationId = payload.correlationId || this.generateCorrelationId();
    
    const event = {
      id: Math.random().toString(36).substring(2, 9),
      type: eventType,
      timestamp,
      correlationId,
      model: this.activeModel,
      layers: [...this.activeLayers],
      timeOffset: this.timeOffsetHours,
      fps: this.gpuStats.fps,
      memory: this.gpuStats.estimatedMemoryMb,
      payload
    };

    // Keep within circular buffer
    this.logs.unshift(event);
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.pop();
    }

    // Trigger listeners
    this.listeners.forEach(cb => {
      try { cb(event); } catch(e) {}
    });

    // Special handlers for specific events
    if (
      eventType === 'tile_failed' || 
      eventType === 'render_failed' || 
      eventType === 'particle_engine_failed' ||
      eventType === 'model_warning' ||
      eventType === 'model_error' ||
      eventType === 'texture_encoding_failed'
    ) {
      this.archiveFailure(event);
    }
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  generateCorrelationId() {
    return `cor-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  updateState(model, layers, offset) {
    let changed = false;
    if (model && model !== this.activeModel) {
      this.activeModel = model;
      changed = true;
    }
    if (layers && JSON.stringify(layers) !== JSON.stringify(this.activeLayers)) {
      this.activeLayers = layers;
      changed = true;
    }
    if (offset !== undefined && offset !== this.timeOffsetHours) {
      this.timeOffsetHours = offset;
      changed = true;
    }
    if (changed) {
      this.emit('weather_picker_changed', { model: this.activeModel, layers: this.activeLayers, offset: this.timeOffsetHours });
    }
  }

  // Tile loading performance tracing
  trackTileRequest(tileKey, url) {
    this.tileRequests.set(tileKey, {
      start: Date.now(),
      url
    });
    this.tileStats.total++;
    this.emit('tile_requested', { tileKey, url });
  }

  trackTileLoaded(tileKey, success, cacheStatus = 'MISS') {
    const req = this.tileRequests.get(tileKey);
    if (!req) return;
    
    const duration = Date.now() - req.start;
    this.tileRequests.delete(tileKey);

    if (success) {
      this.tileStats.loaded++;
      if (cacheStatus === 'HIT') this.tileStats.cached++;
      
      this.tileStats.history.unshift({ tileKey, success: true, duration, cacheStatus, timestamp: Date.now() });
      this.emit('tile_loaded', { tileKey, duration, cacheStatus, url: req.url });
    } else {
      this.tileStats.failed++;
      this.tileStats.history.unshift({ tileKey, success: false, duration, cacheStatus, timestamp: Date.now() });
      this.emit('tile_failed', { tileKey, duration, url: req.url, error: 'Network failure or 404 GRIB time run mismatch' });
    }

    if (this.tileStats.history.length > 100) {
      this.tileStats.history.pop();
    }
  }

  trackRasterDecoded(tileKey, decodeMs) {
    this.tileStats.sumDecodeMs += decodeMs;
    this.emit('raster_decoded', { tileKey, decodeMs });
  }

  // WebGL Context & Render loop observability
  initFpsMonitor() {
    let frameCount = 0;
    let lastTime = performance.now();

    const loop = () => {
      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        this.gpuStats.fps = Math.round((frameCount * 1000) / (now - lastTime));
        frameCount = 0;
        lastTime = now;
        
        // Trigger low FPS event
        if (this.gpuStats.fps < 24 && this.activeLayers.length > 0) {
          this.emit('FPS_drop_detected', { currentFps: this.gpuStats.fps });
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  trackRenderCall(durationMs) {
    this.emit('render_completed', { durationMs });
  }

  trackGpuCompile(shaderId, durationMs) {
    this.gpuStats.shaderCompilations++;
    this.emit('projection_transform_applied', { shaderId, durationMs });
  }

  // Event list: weather_picker_changed, model_switch, layer_attach, layer_detach, tile_requested, tile_loaded, tile_failed, tile_response, tile_error, raster_decode_start, raster_decode_end, render_start, render_completed, render_failed, WebGL_context_lost, WebGL_context_restored, map_error_event, cache_hit, cache_miss, animation_scrub_event, timeline_seek_event

  trackModelSwitch(modelName) {
    this.emit('model_switch', { model: modelName });
  }

  trackModelWarning(modelName, warningType, details) {
    this.emit('model_warning', { model: modelName, warningType, details });
  }

  trackModelError(modelName, errorType, details) {
    this.emit('model_error', { model: modelName, errorType, details });
  }

  trackTextureGeneration(modelName, layerId, hourOffset, stats) {
    this.emit('texture_generated', { model: modelName, layer: layerId, hourOffset, ...stats });
  }

  trackTextureEncodingError(modelName, layerId, hourOffset, error) {
    this.emit('texture_encoding_failed', { model: modelName, layer: layerId, hourOffset, error });
  }

  trackLayerAttach(layerId) {
    this.emit('layer_attach', { layerId });
  }

  trackLayerDetach(layerId) {
    this.emit('layer_detach', { layerId });
  }

  trackTileResponse(tileKey, duration, cacheStatus, url) {
    this.emit('tile_response', { tileKey, duration, cacheStatus, url });
  }

  trackTileError(tileKey, duration, url, error) {
    this.emit('tile_error', { tileKey, duration, url, error });
  }

  trackRasterDecodeStart(tileKey) {
    this.emit('raster_decode_start', { tileKey });
  }

  trackRasterDecodeEnd(tileKey, duration) {
    this.emit('raster_decode_end', { tileKey, duration });
  }

  trackRenderStart() {
    this.emit('render_start');
  }

  trackRenderEnd(durationMs) {
    this.emit('render_completed', { durationMs });
  }

  trackRenderFail(layerId, error) {
    this.emit('render_failed', { layerId, error });
  }

  trackAnimationScrub(frameIndex) {
    this.emit('animation_scrub_event', { frameIndex });
  }

  trackTimelineSeek(offsetHours) {
    this.emit('timeline_seek_event', { offsetHours });
  }

  trackWebGLContextLost() {
    this.gpuStats.contextResets++;
    this.emit('WebGL_context_lost', { resets: this.gpuStats.contextResets });
  }

  trackWebGLContextRestored() {
    this.emit('WebGL_context_restored');
  }

  trackMapError(errorType, message) {
    this.emit('map_error_event', { errorType, message });
  }

  trackCacheHit(key, source) {
    this.emit('cache_hit', { key, source });
  }

  trackCacheMiss(key, source) {
    this.emit('cache_miss', { key, source });
  }

  // Failure Archiving and Replay Sandbox helper
  archiveFailure(event) {
    const failureLog = {
      id: `fail-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: event.timestamp,
      type: event.type,
      correlationId: event.correlationId,
      model: event.model,
      layers: [...event.layers],
      fps: event.fps,
      memory: event.memory,
      details: event.payload,
      // MapLibre active styles dump if available
      mapStyleSnapshot: typeof window !== 'undefined' && window.__MAP_INSTANCE__ ? {
        sources: Object.keys(window.__MAP_INSTANCE__.getStyle()?.sources || {}),
        layersCount: window.__MAP_INSTANCE__.getStyle()?.layers?.length || 0,
        loaded: window.__MAP_INSTANCE__.isStyleLoaded(),
        tilesLoaded: window.__MAP_INSTANCE__.areTilesLoaded()
      } : null
    };
    this.failureKnowledgebase.unshift(failureLog);
    if (this.failureKnowledgebase.length > 100) {
      this.failureKnowledgebase.pop();
    }
  }

  getDiagnosticReport() {
    return {
      activeModel: this.activeModel,
      activeLayers: this.activeLayers,
      timeOffsetHours: this.timeOffsetHours,
      tileStats: { ...this.tileStats },
      gpuStats: { ...this.gpuStats },
      topology: this.topologyMap,
      recentFailures: [...this.failureKnowledgebase],
      recentEvents: this.logs.slice(0, 50),
      // Granular status overlays from global states
      heatmapStatus: typeof window !== 'undefined' ? window.__MARINE_HEATMAP_STATUS__ : null,
      coverageStatus: typeof window !== 'undefined' ? window.__MARINE_COVERAGE_STATUS__ : null,
      windCoverageStatus: typeof window !== 'undefined' ? window.__WIND_COVERAGE_STATUS__ : null,
      marineLayerDiag: typeof window !== 'undefined' ? window.__WebGLMarineLayer_DIAG__ : null,
      crestDiag: typeof window !== 'undefined' ? window.__CREST_DIAG__ : null,
      directionDiag: typeof window !== 'undefined' ? window.__MARINE_DIRECTION_DIAG__ : null
    };
  }
}

// Singleton exporter
export const WeatherTelemetry = new WeatherTelemetryEngine();
window.__WEATHER_TELEMETRY__ = WeatherTelemetry;
