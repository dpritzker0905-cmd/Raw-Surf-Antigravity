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
    }
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
    if (eventType === 'tile_failed' || eventType === 'render_failed' || eventType === 'particle_engine_failed') {
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

  trackWebGLContextReset() {
    this.gpuStats.contextResets++;
    this.emit('WebGL_context_reset', { resets: this.gpuStats.contextResets });
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
      recentEvents: this.logs.slice(0, 50)
    };
  }
}

// Singleton exporter
export const WeatherTelemetry = new WeatherTelemetryEngine();
window.__WEATHER_TELEMETRY__ = WeatherTelemetry;
