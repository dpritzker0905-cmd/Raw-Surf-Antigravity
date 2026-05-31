/**
 * WebGLMarineEngineDiagnostics.js
 * Developer tools and telemetry definitions for the GPU Marine render loop.
 */

export function populateCrestDiagnostics(engine, gl, waveBounds, z) {
  if (typeof window === 'undefined') return;

  if (!engine._diagLogCount) engine._diagLogCount = 0;
  engine._diagLogCount++;
  
  var dprDiag = window.devicePixelRatio || 1.0;
  var zoomScale53 = (Math.min(1, Math.max(0, (z - 2) / 10)) * 0.6 + 0.4);
  var numParts = engine.particleRes * engine.particleRes;

  // Actual CSS pixel sizes at key wave heights (post-zoom, pre-variation)
  var cssLen = function(h) {
    var e = Math.min(1, Math.max(0, (h - 0.1) / 3.9));
    var sb = Math.max(0, 1 - Math.min(1, Math.max(0, (h - 0.5) / 1.0)));
    var hl = (18 + 22 * e + sb * 6) * zoomScale53;
    return Math.max(hl, 16) * 2;
  };
  
  var cssTh = function(h) {
    var e = Math.min(1, Math.max(0, (h - 0.1) / 3.9));
    var sb = Math.max(0, 1 - Math.min(1, Math.max(0, (h - 0.5) / 1.0)));
    var ht = (3 + 5 * e + sb * 2) * zoomScale53;
    return Math.max(ht, 2.5) * 2;
  };

  // v5.8 density survival calculation
  var densityAtZoom = function(zVal) {
    var t = Math.min(1, Math.max(0, (zVal - 2) / 8));
    return (0.12 + t * (0.90 - 0.12)) * 100;
  };

  window.__CREST_DIAG__ = {
    rendererMode: 'quad_ribbon_v5.8_wave_polish',
    drawPrimitive: 'gl.TRIANGLES',
    particleCount: numParts,
    vertexCount: numParts * 6,
    particleRes: engine.particleRes,
    devicePixelRatio: dprDiag,
    viewport: { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight },
    zoom: z,
    waveTextureBounds: waveBounds,
    frameCount: engine._diagLogCount,
    motionScale: engine.motionScale || 1.0,
    effectivePhaseSpeed: ((engine.motionScale || 1.0) * 1.0).toFixed(2) + 'x',
    period: 'dynamic',
    densityCurve_v58: {
      zoom: z,
      survivalPercent: densityAtZoom(z).toFixed(1) + '%',
      lowZoomTarget: '~12% at zoom 2',
      heightBoost: 'smoothstep(1.0,4.0,h) * mix(0.02,0.10, smoothstep(5,10,zoom))',
      estimatedVisibleParticles: Math.round(numParts * densityAtZoom(z) / 100),
      worldOffsetPasses: 3,
      byZoom: {
        zoom2: densityAtZoom(2).toFixed(0) + '%',
        zoom4: densityAtZoom(4).toFixed(0) + '%',
        zoom6: densityAtZoom(6).toFixed(0) + '%',
        zoom8: densityAtZoom(8).toFixed(0) + '%',
        zoom10: densityAtZoom(10).toFixed(0) + '%'
      }
    },
    periodTrain_v58: {
      periodValSample: 'modelPeriod > 0.5 ? modelPeriod : (6 + h*2)',
      spatialFreq: '800 / max(36, T²), clamped [3,25]',
      trainEnvelopeEnabled: true,
      phaseJitterRemoved: true,
      spacingMode: 'period_band_envelope',
      envelope: 'crestBand = 1 - smoothstep(0.08, 0.30, abs(train-0.5)); mix(0.25, 1.0, crestBand)',
      at_6s: { spatialFreq: (800/36).toFixed(1), bandSpacing: 'tight/choppy' },
      at_10s: { spatialFreq: (800/100).toFixed(1), bandSpacing: 'medium' },
      at_14s: { spatialFreq: (800/196).toFixed(1), bandSpacing: 'wide/organized' },
      at_18s: { spatialFreq: Math.max(3, 800/324).toFixed(1), bandSpacing: 'very wide swell sets' }
    },
    rollDirection_v58: {
      waveDirMeaning: 'forecast travel direction (screen-space pixel delta)',
      crestDirMeaning: 'perpendicular crest axis (vec2(-waveDir.y, waveDir.x))',
      foamRollAxis: 'v_local_uv.y / wave axis (cornerUV.y * halfThickness along waveDir)',
      capeCanaveralExpected: 'E/ESE FROM -> W/WNW travel toward shore',
      rollFront: 'fract(v_phase) sweeps waveLocal 0→1 along travel direction',
      sign: 'waveVec.y negated for Mercator; foam sign = waveLocal - rollFront'
    },
    alphaFormula_v58: {
      base: 'mix(0.50, 0.85, smoothstep(0,4,h))',
      zoomScale: 'mix(0.45, 1.0, smoothstep(3,9,zoom))',
      trainEnvelope: 'mix(0.25, 1.0, crestBand)',
      particleVariation: '0.9 + hash*0.2 (brightness only, NOT phase speed)'
    },
    crestLength_CSS: {
      formula: '(mix(18,40,smoothstep(0.1,4,h))+smallBoost*6)*zoomScale → min 32px',
      at_0_3m: cssLen(0.3).toFixed(0) + 'px',
      at_1m: cssLen(1.0).toFixed(0) + 'px',
      at_3m: cssLen(3.0).toFixed(0) + 'px',
      at_5m: cssLen(5.0).toFixed(0) + 'px',
      minGuaranteed: '32px'
    },
    crestThickness_CSS: {
      formula: '(mix(3,8,smoothstep(0.1,4,h))+smallBoost*2)*zoomScale → min 5px',
      at_0_3m: cssTh(0.3).toFixed(0) + 'px',
      at_1m: cssTh(1.0).toFixed(0) + 'px',
      at_3m: cssTh(3.0).toFixed(0) + 'px',
      at_5m: cssTh(5.0).toFixed(0) + 'px',
      minGuaranteed: '5px'
    },
    waveMotionVsWhitecap: {
      baseRippleMinShape: 0.5,
      whitecapOnset: '0.5m',
      whitecapFull: '3.0m',
      whitecapBlend: 0.45
    },
    rollingWhitewater: {
      enabled: true,
      gaussianWidth: 20,
      trailingWashDecay: 3.5,
      foamNoiseOctaves: 2,
      foamNoiseScrollSpeed: 0.3
    },
    directionFix_v55: {
      fix: 'waveVec.y = -waveVec.y after texture decode',
      reason: 'Geographic +v=north but Mercator +y=south (y=0=NorthPole)',
      affectsShaders: ['ADVECT_FS', 'DRAW_VS'],
      cacheInvalidated: 'rawsurf_marine_cache_v2 → v3'
    },
    gpuPointSizeRange: { min: engine._minPointSize, max: engine._maxPointSize },
    activeMarineLayer: (window.__DATA_DIAG__ && window.__DATA_DIAG__.activeMarineLayer) || 'unknown'
  };

  window.__MARINE_DIRECTION_DIAG__ = {
    convention: {
      openMeteo: 'FROM direction (meteorological), 0°=N, 90°=E, 180°=S, 270°=W',
      getUV: 'u=-h*sin(dir), v=-h*cos(dir) → geographic travel vector (TOWARD)',
      texture: 'RG = unit(u,v)*0.5+0.5 → geographic convention preserved',
      shader_v55: 'waveVec.y negated after decode → Mercator convention (TOWARD)',
      infobox: 'atan2(-u,-v) → reconstructs FROM direction (meteorological)'
    },
    fix_applied: 'v5.5: waveVec.y = -waveVec.y in ADVECT_FS + DRAW_VS',
    cache_version: 'v3 (bumped from v2 to invalidate stale data)',
    howToVerify: 'Open console: window.__MARINE_DIRECTION_DIAG__; then check Florida coast swell travels WSW (FROM ENE)'
  };
}
