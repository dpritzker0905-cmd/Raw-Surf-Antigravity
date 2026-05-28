/**
 * FieldCompositionEngine.js — The FCE Core
 *
 * Takes a SimulationField and produces a RenderPlan.
 * This is the BRAIN of the rendering system.
 *
 * The FCE does NOT know about MapLibre.
 * It does NOT know about React.
 * It produces PURE DATA that renderers consume.
 *
 * KEY ARCHITECTURAL INSIGHT:
 * - Toggle = field swap, NOT layer mutation
 * - OceanMask = data computation, NOT MapLibre operation
 * - All visual conflict resolved HERE, before rendering
 *
 * RULES:
 * - NO MapLibre
 * - NO React
 * - NO DOM
 * - NO side effects
 * - Pure function: same inputs → same outputs
 */

import { isFieldPopulated } from './SimulationField';

// ========================================================================
// RENDER PLAN TYPE
// ========================================================================

/**
 * @typedef {Object} WindParticleField
 * @property {Float32Array} u       - U-component grid (row-major)
 * @property {Float32Array} v       - V-component grid (row-major)
 * @property {number}       cols    - Grid width
 * @property {number}       rows    - Grid height
 * @property {Object}       bounds  - { north, south, east, west }
 * @property {boolean}      active  - Whether wind particles should render
 */

/**
 * @typedef {Object} WaveRenderField
 * @property {Float32Array} height     - Wave height grid
 * @property {Float32Array} direction  - Wave direction grid
 * @property {Float32Array} swellHeight - Swell height grid
 * @property {Float32Array} swellDir   - Swell direction grid
 * @property {number}       cols
 * @property {number}       rows
 * @property {Object}       bounds
 * @property {boolean}      active     - Whether marine viz should render
 * @property {string|null}  marineLayer - Which marine layer is active (e.g. 'waves', 'swell')
 */

/**
 * @typedef {Object} OceanMaskField
 * @property {Uint8Array}   mask    - 1 = land, 0 = ocean
 * @property {number}       cols
 * @property {number}       rows
 * @property {Object}       bounds
 * @property {boolean}      active  - Whether ocean mask should be visible
 */

/**
 * @typedef {Object} PressureRenderField
 * @property {Float32Array} data    - Pressure grid (hPa)
 * @property {number}       cols
 * @property {number}       rows
 * @property {Object}       bounds
 * @property {boolean}      active  - Whether pressure viz should render
 */

/**
 * @typedef {Object} RenderPlan
 * @property {WindParticleField}    windParticles    - Wind particle field
 * @property {WaveRenderField}      waveField        - Wave visualization field
 * @property {OceanMaskField}       oceanMask        - Land/ocean mask
 * @property {PressureRenderField}  pressureField    - Pressure field
 * @property {string[]}             activeOverlays   - Which overlays are currently active
 * @property {string[]}             activeRasterLayers - Which raster tile layers are active
 * @property {number}               revision         - Monotonic counter
 * @property {number}               timestamp        - When this plan was generated
 * @property {string}               model            - Active forecast model
 * @property {number}               hourOffset       - Timeline offset
 */

// ========================================================================
// COMPOSITION ENGINE
// ========================================================================

let _planRevision = 0;

/**
 * Compose a RenderPlan from a SimulationField and rendering configuration.
 *
 * This is the CORE function of the FCE. It determines:
 * 1. Which fields are active (based on config.activeLayers)
 * 2. What data each renderer gets
 * 3. Whether OceanMask should be visible
 * 4. Which raster layers need tiles
 *
 * CRITICAL: This function is PURE. Same inputs → same outputs.
 * No hidden state, no mutation, no side effects.
 *
 * @param {SimulationField|null} field - The unified field data
 * @param {Object} config
 * @param {string[]} config.activeLayers - Currently active layer keys
 * @param {string|null} config.activeMarineLayer - Active marine sub-layer
 * @param {string} config.theme - 'dark' | 'light' | 'beach'
 * @param {boolean} [config.oceanMaskEnabled=true] - Whether ocean mask is enabled
 * @returns {RenderPlan}
 */
export function composeRenderPlan(field, config) {
  const {
    activeLayers = [],
    activeMarineLayer = null,
    theme = 'dark',
    oceanMaskEnabled = true,
  } = config;

  const revision = ++_planRevision;
  const hasField = isFieldPopulated(field);

  // --- Wind Particles ---
  const windActive = activeLayers.includes('wind') && hasField && field?.sources?.wind;
  const windParticles = {
    u: windActive ? field.grid.windU : null,
    v: windActive ? field.grid.windV : null,
    cols: field?.cols || 0,
    rows: field?.rows || 0,
    bounds: field?.bounds || { north: 85, south: -85, east: 180, west: -180 },
    active: windActive,
  };

  // --- Wave Field ---
  const marineActive = !!activeMarineLayer && hasField && field?.sources?.marine;
  const waveField = {
    height: marineActive ? field.grid.waveHeight : null,
    direction: marineActive ? field.grid.waveDir : null,
    swellHeight: marineActive ? field.grid.swellHeight : null,
    swellDir: marineActive ? field.grid.swellDir : null,
    cols: field?.cols || 0,
    rows: field?.rows || 0,
    bounds: field?.bounds || { north: 85, south: -85, east: 180, west: -180 },
    active: marineActive,
    marineLayer: activeMarineLayer,
  };

  // --- Ocean Mask ---
  // OceanMask is active when ANY marine-related layer is active
  const hasMarine = !!activeMarineLayer;
  const hasMarineRaster = activeLayers.some(l =>
    ['waves', 'swell', 'wind_waves', 'secondary_swell'].includes(l)
  );
  const oceanMaskActive = oceanMaskEnabled && (hasMarine || hasMarineRaster);
  const oceanMask = {
    mask: hasField && field?.sources?.landMask ? field.grid.landMask : null,
    cols: field?.cols || 0,
    rows: field?.rows || 0,
    bounds: field?.bounds || { north: 85, south: -85, east: 180, west: -180 },
    active: oceanMaskActive,
  };

  // --- Pressure Field ---
  const pressureActive = activeLayers.includes('pressure') && hasField && field?.sources?.pressure;
  const pressureField = {
    data: pressureActive ? field.grid.pressure : null,
    cols: field?.cols || 0,
    rows: field?.rows || 0,
    bounds: field?.bounds || { north: 85, south: -85, east: 180, west: -180 },
    active: pressureActive,
  };

  // --- Active Overlays (for diagnostics) ---
  const activeOverlays = [];
  if (windActive) activeOverlays.push('wind-particles');
  if (marineActive) activeOverlays.push(`marine-${activeMarineLayer}`);
  if (oceanMaskActive) activeOverlays.push('ocean-mask');
  if (pressureActive) activeOverlays.push('pressure');

  // --- Raster layers (pass-through — these are still server-rendered tiles) ---
  const RASTER_LAYER_KEYS = [
    'rain', 'fog', 'satellite', 'cloud_cover', 'visibility',
    'waves', 'swell', 'wind_waves', 'secondary_swell', 'wind',
    'pressure',
  ];
  const activeRasterLayers = activeLayers.filter(l => RASTER_LAYER_KEYS.includes(l));

  return {
    windParticles,
    waveField,
    oceanMask,
    pressureField,
    activeOverlays,
    activeRasterLayers,
    revision,
    timestamp: Date.now(),
    model: field?.model || 'GFS',
    hourOffset: field?.hourOffset || 0,
  };
}

/**
 * Compare two RenderPlans and return what changed.
 * Used by renderers to avoid unnecessary re-renders.
 *
 * @param {RenderPlan} prev
 * @param {RenderPlan} next
 * @returns {Object} Diff summary
 */
export function diffRenderPlans(prev, next) {
  if (!prev || !next) return { fullRefresh: true };

  return {
    fullRefresh: false,
    windChanged: prev.windParticles.active !== next.windParticles.active ||
                 prev.windParticles.u !== next.windParticles.u,
    waveChanged: prev.waveField.active !== next.waveField.active ||
                 prev.waveField.height !== next.waveField.height ||
                 prev.waveField.marineLayer !== next.waveField.marineLayer,
    maskChanged: prev.oceanMask.active !== next.oceanMask.active,
    pressureChanged: prev.pressureField.active !== next.pressureField.active ||
                     prev.pressureField.data !== next.pressureField.data,
    rasterChanged: prev.activeRasterLayers.join(',') !== next.activeRasterLayers.join(','),
    modelChanged: prev.model !== next.model,
    timeChanged: prev.hourOffset !== next.hourOffset,
  };
}

/**
 * Get diagnostic info about a RenderPlan.
 *
 * @param {RenderPlan} plan
 * @returns {Object}
 */
export function getRenderPlanDiagnostics(plan) {
  if (!plan) return { valid: false };
  return {
    valid: true,
    revision: plan.revision,
    model: plan.model,
    hourOffset: plan.hourOffset,
    activeOverlays: plan.activeOverlays,
    activeRasterLayers: plan.activeRasterLayers,
    wind: plan.windParticles.active ? `${plan.windParticles.cols}×${plan.windParticles.rows}` : 'OFF',
    wave: plan.waveField.active ? `${plan.waveField.marineLayer} ${plan.waveField.cols}×${plan.waveField.rows}` : 'OFF',
    mask: plan.oceanMask.active ? 'ON' : 'OFF',
    pressure: plan.pressureField.active ? `${plan.pressureField.cols}×${plan.pressureField.rows}` : 'OFF',
  };
}
