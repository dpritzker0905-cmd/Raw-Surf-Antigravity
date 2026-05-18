/*
====================================================
 Raw Surf OS Color Ramp Physics System
 LUT-BASED SHADER COLOR MAPPING
====================================================

Extends existing wave-height-ramp.js with additional
ramp science for all visualization layers.

ALL color output uses LUT-based mapping.
NEVER raw RGB interpolation.

var/function only (TDZ-immune)
====================================================
*/

// CORE LUT INTERPOLATION 

/**
 * Sample a LUT at a normalized position [0-1].
 * Uses linear interpolation between stops.
 * @param {Array<{t: number, r: number, g: number, b: number, a?: number}>} lut
 * @param {number} t - normalized value [0, 1]
 * @returns {{r: number, g: number, b: number, a: number}}
 */
function sampleLUT(lut, t) {
  if (!lut || lut.length === 0) return { r: 0, g: 0, b: 0, a: 1 };
  var clamped = Math.max(0, Math.min(1, t));

  // Find surrounding stops
  var lower = lut[0];
  var upper = lut[lut.length - 1];

  for (var i = 0; i < lut.length - 1; i++) {
    if (clamped >= lut[i].t && clamped <= lut[i + 1].t) {
      lower = lut[i];
      upper = lut[i + 1];
      break;
    }
  }

  var range = upper.t - lower.t;
  var frac = range > 0 ? (clamped - lower.t) / range : 0;

  return {
    r: Math.round(lower.r + (upper.r - lower.r) * frac),
    g: Math.round(lower.g + (upper.g - lower.g) * frac),
    b: Math.round(lower.b + (upper.b - lower.b) * frac),
    a: (lower.a !== undefined ? lower.a : 1) +
       ((upper.a !== undefined ? upper.a : 1) - (lower.a !== undefined ? lower.a : 1)) * frac,
  };
}

/**
 * Generate a Float32Array texture from a LUT (for GPU upload).
 * @param {Array} lut
 * @param {number} [size=256] - texture width
 * @returns {Float32Array} RGBA float data (size * 4)
 */
function lutToTexture(lut, size) {
  if (size === undefined) size = 256;
  var data = new Float32Array(size * 4);
  for (var i = 0; i < size; i++) {
    var t = i / (size - 1);
    var c = sampleLUT(lut, t);
    data[i * 4] = c.r / 255;
    data[i * 4 + 1] = c.g / 255;
    data[i * 4 + 2] = c.b / 255;
    data[i * 4 + 3] = c.a;
  }
  return data;
}

// PRESSURE RAMP 

/**
 * Atmospheric pressure color ramp (hPa).
 * Low pressure = purple/blue, High pressure = red/orange.
 * Range: 960-1050 hPa
 */
var PRESSURE_LUT = [
 { t: 0.00, r: 100, g: 0, b: 180, a: 0.85 }, // 960 hPa deep low
  { t: 0.15, r: 40,  g: 60,  b: 200, a: 0.80 },   // 973.5
  { t: 0.30, r: 20,  g: 140, b: 200, a: 0.75 },   // 987
  { t: 0.45, r: 40,  g: 180, b: 140, a: 0.70 },   // 1000.5
 { t: 0.55, r: 100, g: 200, b: 80, a: 0.70 }, // 1009.5 neutral
  { t: 0.70, r: 220, g: 200, b: 40,  a: 0.75 },   // 1023
  { t: 0.85, r: 240, g: 140, b: 20,  a: 0.80 },   // 1036.5
 { t: 1.00, r: 220, g: 40, b: 20, a: 0.85 }, // 1050 strong high
];

function samplePressureRamp(hPa) {
  var t = (hPa - 960) / 90;
  return sampleLUT(PRESSURE_LUT, t);
}

// RAIN / PRECIPITATION RAMP 

/**
 * Precipitation intensity ramp (mm/hr).
 * Range: 0-50+ mm/hr
 */
var RAIN_LUT = [
 { t: 0.00, r: 0, g: 0, b: 0, a: 0.0 }, // 0 mm invisible
 { t: 0.04, r: 120, g: 200, b: 240, a: 0.30 }, // 2 mm light drizzle
 { t: 0.10, r: 60, g: 140, b: 220, a: 0.50 }, // 5 mm light rain
 { t: 0.20, r: 30, g: 80, b: 200, a: 0.65 }, // 10 mm moderate
 { t: 0.40, r: 20, g: 200, b: 60, a: 0.75 }, // 20 mm heavy
 { t: 0.60, r: 240, g: 220, b: 20, a: 0.80 }, // 30 mm very heavy
 { t: 0.80, r: 240, g: 100, b: 20, a: 0.85 }, // 40 mm extreme
 { t: 1.00, r: 200, g: 20, b: 40, a: 0.90 }, // 50+ mm torrential
];

function sampleRainRamp(mmPerHour) {
  var t = mmPerHour / 50;
  return sampleLUT(RAIN_LUT, t);
}

// CLOUD COVER RAMP 

/**
 * Cloud cover percentage ramp.
 * Range: 0-100%
 */
var CLOUD_LUT = [
  { t: 0.00, r: 0,   g: 0,   b: 0,   a: 0.0 },   // clear
  { t: 0.20, r: 200, g: 210, b: 220, a: 0.15 },   // thin cirrus
  { t: 0.40, r: 180, g: 190, b: 200, a: 0.30 },   // scattered
  { t: 0.60, r: 160, g: 170, b: 180, a: 0.50 },   // broken
  { t: 0.80, r: 140, g: 150, b: 160, a: 0.70 },   // overcast
  { t: 1.00, r: 120, g: 130, b: 140, a: 0.85 },   // heavy overcast
];

function sampleCloudRamp(percent) {
  var t = percent / 100;
  return sampleLUT(CLOUD_LUT, t);
}

// SWELL ENERGY RAMP 

/**
 * Swell energy density ramp (kJ/m).
 * Derived from H * T (height squared times period).
 * Range: 0-200+ kJ/m
 */
var SWELL_ENERGY_LUT = [
  { t: 0.00, r: 20,  g: 20,  b: 60,  a: 0.40 },   // calm
 { t: 0.10, r: 30, g: 60, b: 120, a: 0.55 }, // 20 kJ light swell
 { t: 0.25, r: 20, g: 120, b: 180, a: 0.65 }, // 50 kJ moderate
 { t: 0.40, r: 0, g: 180, b: 160, a: 0.72 }, // 80 kJ good swell
 { t: 0.55, r: 40, g: 200, b: 60, a: 0.78 }, // 110 kJ solid
 { t: 0.70, r: 200, g: 200, b: 0, a: 0.82 }, // 140 kJ heavy
 { t: 0.85, r: 240, g: 120, b: 0, a: 0.88 }, // 170 kJ very heavy
 { t: 1.00, r: 220, g: 20, b: 40, a: 0.92 }, // 200+ kJ massive
];

function sampleSwellEnergyRamp(kJPerM2) {
  var t = kJPerM2 / 200;
  return sampleLUT(SWELL_ENERGY_LUT, t);
}

/**
 * Compute swell energy from height (m) and period (s).
 */
function computeSwellEnergy(height, period) {
 // E H * T (simplified ocean energy formula)
  return height * height * period;
}

// FOG / VISIBILITY RAMP 

/**
 * Fog density / visibility ramp.
 * Range: 0 (clear) to 1 (dense fog)
 */
var FOG_LUT = [
  { t: 0.00, r: 0,   g: 0,   b: 0,   a: 0.0 },   // clear
  { t: 0.20, r: 200, g: 210, b: 220, a: 0.10 },   // light haze
  { t: 0.40, r: 190, g: 200, b: 210, a: 0.25 },   // moderate haze
  { t: 0.60, r: 180, g: 190, b: 200, a: 0.45 },   // light fog
  { t: 0.80, r: 170, g: 180, b: 190, a: 0.65 },   // moderate fog
  { t: 1.00, r: 160, g: 170, b: 180, a: 0.80 },   // dense fog
];

function sampleFogRamp(density) {
  return sampleLUT(FOG_LUT, density);
}

export {
  sampleLUT,
  lutToTexture,
  PRESSURE_LUT, samplePressureRamp,
  RAIN_LUT, sampleRainRamp,
  CLOUD_LUT, sampleCloudRamp,
  SWELL_ENERGY_LUT, sampleSwellEnergyRamp, computeSwellEnergy,
  FOG_LUT, sampleFogRamp,
};
