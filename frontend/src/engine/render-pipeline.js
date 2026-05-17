/*
====================================================
 Raw Surf OS — Render Pipeline
 DATA -> SIMULATION -> RENDER TRANSFORM LAYER
====================================================

RULES:
- NO RAF loop
- NO WebGL direct calls
- NO React
- NO engine init
- PURE transformation layer ONLY
- var/function only (TDZ-immune)
====================================================
*/

import { computeWaveHeight } from '../engine-brain/wave-propagation-model';

/**
 * Build a render-safe frame from raw simulation state.
 * This is the bridge between engine-brain (pure math) and
 * the GPU/canvas renderers (WebGLWindEngine, GPUWindLayer, etc.).
 *
 * The render pipeline does NOT own a loop — it is CALLED by
 * the render-orchestrator or CanvasAnimationCoordinator.
 *
 * @param {{
 *   windField: { data: Array, width: number, height: number },
 *   waveEnergy?: number[][],
 *   time: number
 * }} params
 * @returns {{ timestamp: number, wind: Array, waves: Array, metadata: Object }}
 */
function buildRenderFrame(params) {
  var windField = params.windField;
  var waveEnergy = params.waveEnergy || [];
  var time = params.time;

  // Transform wind vectors into render-ready format with intensity
  var wind = [];
  for (var y = 0; y < windField.data.length; y++) {
    var row = windField.data[y];
    var renderRow = [];
    for (var x = 0; x < row.length; x++) {
      var v = row[x];
      renderRow.push({
        u: v.u,
        v: v.v,
        intensity: Math.sqrt(v.u * v.u + v.v * v.v),
      });
    }
    wind.push(renderRow);
  }

  // Transform wave energy grid into height + direction
  var waves = [];
  for (var wy = 0; wy < waveEnergy.length; wy++) {
    var wRow = waveEnergy[wy];
    var waveRenderRow = [];
    for (var wx = 0; wx < wRow.length; wx++) {
      waveRenderRow.push({
        height: computeWaveHeight(wRow[wx]),
        direction: (wx + wy) % 360, // placeholder deterministic mapping
      });
    }
    waves.push(waveRenderRow);
  }

  return {
    timestamp: time,
    wind: wind,
    waves: waves,
    metadata: {
      domain: waveEnergy.length > 0 ? 'multi' : 'wind',
    },
  };
}

/**
 * Extract peak intensity from a render frame.
 * Useful for adaptive quality decisions in the coordinator.
 *
 * @param {{ wind: Array }} frame
 * @returns {number}
 */
function getPeakIntensity(frame) {
  var peak = 0;
  for (var y = 0; y < frame.wind.length; y++) {
    for (var x = 0; x < frame.wind[y].length; x++) {
      if (frame.wind[y][x].intensity > peak) {
        peak = frame.wind[y][x].intensity;
      }
    }
  }
  return peak;
}

/**
 * Extract average wave height from a render frame.
 * @param {{ waves: Array }} frame
 * @returns {number}
 */
function getAverageWaveHeight(frame) {
  if (!frame.waves.length) return 0;
  var sum = 0;
  var count = 0;
  for (var y = 0; y < frame.waves.length; y++) {
    for (var x = 0; x < frame.waves[y].length; x++) {
      sum += frame.waves[y][x].height;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

export { buildRenderFrame, getPeakIntensity, getAverageWaveHeight };
