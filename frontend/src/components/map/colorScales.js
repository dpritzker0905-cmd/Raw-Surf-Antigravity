/**
 * Color scales and dynamic HSL palette configurations for map rendering.
 */

export function smoothColorScale(baseScale, numSteps = 80) {
  if (!baseScale || baseScale.type !== 'breakpoint') return baseScale;
  
  var originalBreakpoints = baseScale.breakpoints;
  var originalColors = baseScale.colors;
  
  var newBreakpoints = [];
  var newColors = [];
  
  var numIntervals = originalBreakpoints.length - 1;
  var stepsPerInterval = Math.max(1, Math.round(numSteps / numIntervals));
  
  for (var i = 0; i < numIntervals; i++) {
    var bStart = originalBreakpoints[i];
    var bEnd = originalBreakpoints[i + 1];
    
    var cStart = originalColors[i];
    var cEnd = originalColors[i + 1];
    
    for (var j = 0; j < stepsPerInterval; j++) {
      var t = j / stepsPerInterval;
      var val = bStart + (bEnd - bStart) * t;
      
      var r = Math.round(cStart[0] + (cEnd[0] - cStart[0]) * t);
      var g = Math.round(cStart[1] + (cEnd[1] - cStart[1]) * t);
      var b = Math.round(cStart[2] + (cEnd[2] - cStart[2]) * t);
      var a = Number((cStart[3] + (cEnd[3] - cStart[3]) * t).toFixed(3));
      
      newBreakpoints.push(Number(val.toFixed(3)));
      newColors.push([r, g, b, a]);
    }
  }
  
  newBreakpoints.push(originalBreakpoints[originalBreakpoints.length - 1]);
  newColors.push(originalColors[originalColors.length - 1]);
  
  return {
    type: 'breakpoint',
    unit: baseScale.unit,
    breakpoints: newBreakpoints,
    colors: newColors
  };
}

export var BASE_CUSTOM_COLOR_SCALES = {
  wave_height: {
    type: 'breakpoint',
    unit: 'm',
    breakpoints: [0, 0.61, 1.22, 2.44, 3.66, 6.1],
    colors: [
      [219, 234, 254, 0.0],
      [34, 211, 238, 0.45],
      [37, 99, 235, 0.65],
      [147, 51, 234, 0.75],
      [190, 24, 74, 0.85],
      [159, 18, 57, 0.95]
    ]
  },
  wave: {
    type: 'breakpoint',
    unit: 'm',
    breakpoints: [0, 0.61, 1.22, 2.44, 3.66, 6.1],
    colors: [
      [219, 234, 254, 0.0],
      [34, 211, 238, 0.45],
      [37, 99, 235, 0.65],
      [147, 51, 234, 0.75],
      [190, 24, 74, 0.85],
      [159, 18, 57, 0.95]
    ]
  },
  swell_wave_height: {
    type: 'breakpoint',
    unit: 'm',
    breakpoints: [0, 0.61, 1.22, 2.44, 3.66, 6.1],
    colors: [
      [207, 250, 254, 0.0],
      [34, 211, 238, 0.45],
      [59, 130, 246, 0.65],
      [79, 70, 229, 0.75],
      [109, 40, 217, 0.85],
      [91, 33, 182, 0.95]
    ]
  },
  secondary_swell_wave_height: {
    type: 'breakpoint',
    unit: 'm',
    breakpoints: [0, 0.3, 0.61, 1.22, 1.83, 3.05],
    colors: [
      [243, 232, 255, 0.0],
      [192, 132, 252, 0.4],
      [217, 70, 239, 0.6],
      [219, 39, 119, 0.75],
      [190, 24, 74, 0.85],
      [159, 18, 57, 0.95]
    ]
  },
  wind_wave_height: {
    type: 'breakpoint',
    unit: 'm',
    breakpoints: [0, 0.3, 0.61, 1.22, 1.83, 3.05],
    colors: [
      [209, 250, 229, 0.0],
      [52, 211, 153, 0.4],
      [20, 184, 166, 0.6],
      [8, 145, 178, 0.75],
      [29, 78, 216, 0.85],
      [30, 58, 138, 0.95]
    ]
  },
  precipitation: {
    // BOLD / UNIFORM / GLOBAL precip ramp (2026-07-08) — the "make Precip read like Windy's Rain" pass.
    // Hue-progressive light-blue -> blue -> teal -> lime -> yellow -> orange -> red so intensity reads by
    // COLOR (not just alpha), and light drizzle (0.1 mm) is VISIBLE on the dark basemap — the old ramp
    // painted it a faint 0.35a all-blue that vanished (the same low-contrast trap as the radar light-precip
    // residual). The rain raster-opacity (MapWebGL.js) multiplies these alphas, so both levers move together.
    // Kill switch: window.__RAW_PRECIP_BOLD_DISABLED__ = true -> LEGACY_PRECIP_COLOR_SCALE via applyPrecipColorScale().
    type: 'breakpoint',
    unit: 'mm',
    breakpoints: [0, 0.1, 0.5, 2.0, 6.0, 15.0, 30.0, 60.0],
    colors: [
      [150, 225, 255, 0.00],
      [105, 195, 255, 0.42],
      [48, 140, 245, 0.60],
      [40, 200, 150, 0.72],
      [140, 215, 60, 0.82],
      [250, 205, 45, 0.90],
      [245, 130, 35, 0.94],
      [225, 45, 95, 0.97]
    ]
  },
  pressure_msl: {
    type: 'breakpoint',
    unit: 'hPa',
    // 1009/1018 stops added 2026-07-16 (layer audit: the field was INVISIBLE at everyday values —
    // the old 1005→1013→1025 ramp left ±12 hPa around neutral effectively transparent, and most of
    // the planet most of the time sits inside that band; users read the layer as broken). Neutral
    // 1013 stays transparent by design; the invisible band narrows to ~±2 hPa.
    breakpoints: [970, 990, 1005, 1009, 1013, 1018, 1025, 1045],
    colors: [
      [147, 51, 234, 0.7],
      [59, 130, 246, 0.6],
      [34, 211, 238, 0.45],
      [45, 212, 191, 0.4],
      [16, 185, 129, 0.0],
      [234, 179, 8, 0.4],
      [234, 179, 8, 0.55],
      [239, 68, 68, 0.7]
    ]
  },
  visibility: {
    type: 'breakpoint',
    unit: 'm',
    breakpoints: [0, 500, 1000, 2000, 5000, 10000],
    colors: [
      [240, 240, 240, 0.85],
      [240, 240, 240, 0.70],
      [242, 245, 248, 0.45],
      [242, 245, 248, 0.20],
      [255, 255, 255, 0.0],
      [255, 255, 255, 0.0]
    ]
  }
};

export var CUSTOM_COLOR_SCALES = {};

/**
 * Give `surface_temperature` the sea-surface colour scale.
 *
 * ⛔ THE WATER-TEMP HEATMAP RENDERED NOTHING ON EVERY MODEL BECAUSE OF THIS. Measured on dev
 * live 2026-08-13: the layer requests `variable=surface_temperature` (LayerRegistry chose it
 * because `sea_surface_temperature` is not hosted on the tile CDN -- the library ships only a
 * colour-scale alias for it). Tiles arrived and decoded correctly -- 4,718,592 values spanning
 * -53.95 to +38.75 degC with 31.6% NaN over land -- and then colourisation looked up a scale
 * named `surface_temperature`, found none among the 49 registered, and emitted transparent
 * tiles. Every upstream signal read healthy: isSourceLoaded true, areTilesLoaded true, correct
 * z/x/y coverage at z9, z5 and z2. Nothing reported a failure, because nothing HAD failed --
 * the pipeline did exactly what it was told with a key that did not exist.
 *
 * ★ A LOOKUP MISS THAT RETURNS 'NOTHING TO DRAW' IS INDISTINGUISHABLE FROM 'NOTHING TO SHOW'.
 * The values were real; only the name was wrong. Six other explanations were investigated and
 * refuted first (model capability, ocean mask, cache-buster, cache misses, source bounds, tile
 * enumeration) because none of the healthy-looking signals pointed here.
 *
 * Aliased rather than copied: one scale, so the two can never drift apart. Guarded so it is a
 * no-op if the library ever ships its own `surface_temperature`, or renames the SST scale.
 */
export function aliasSurfaceTemperature(scales) {
  if (scales && !scales.surface_temperature && scales.sea_surface_temperature) {
    scales.surface_temperature = scales.sea_surface_temperature;
  }
  return scales;
}
Object.keys(BASE_CUSTOM_COLOR_SCALES).forEach(function(key) {
  CUSTOM_COLOR_SCALES[key] = smoothColorScale(BASE_CUSTOM_COLOR_SCALES[key], 80);
});

// Legacy (pre-2026-07-08) precipitation ramp — retained so the bold pass has a runtime kill switch.
// Set window.__RAW_PRECIP_BOLD_DISABLED__ = true, then re-toggle the Precip layer (or change theme) to
// force applyPrecipColorScale() to restore this fainter blue->violet ramp on the live om:// protocol.
export var LEGACY_PRECIP_COLOR_SCALE = {
  type: 'breakpoint',
  unit: 'mm',
  breakpoints: [0, 0.1, 0.5, 2.0, 10.0, 50.0],
  colors: [
    [224, 242, 254, 0.0],
    [56, 189, 248, 0.35],
    [14, 165, 233, 0.55],
    [37, 99, 235, 0.70],
    [124, 58, 237, 0.85],
    [219, 39, 119, 0.95]
  ]
};

// Select the bold (default) or legacy precip ramp per the kill switch, re-smooth, and push it to the
// live om:// protocol so a runtime flip takes effect on the next tile decode (cache-bust / layer re-toggle).
// Mirrors applyThemePressureScale / applyThemeWaveScale; precip is not theme-varied (yet), so no theme arg.
export function applyPrecipColorScale() {
  var disabled = typeof window !== 'undefined' && window.__RAW_PRECIP_BOLD_DISABLED__ === true;
  var base = disabled ? LEGACY_PRECIP_COLOR_SCALE : BASE_CUSTOM_COLOR_SCALES.precipitation;
  CUSTOM_COLOR_SCALES.precipitation = smoothColorScale(base, 80);
  if (typeof window !== 'undefined' && window.__OM_PROTOCOL_SETTINGS__ && window.__OM_PROTOCOL_SETTINGS__.colorScales) {
    window.__OM_PROTOCOL_SETTINGS__.colorScales.precipitation = CUSTOM_COLOR_SCALES.precipitation;
  }
}

export function applyThemePressureScale(theme) {
  var colors;
  if (theme === 'beach') {
    // Beach Theme: desaturated ocean indigo/teal (Lows) to warm terracotta/bronze (Highs) - boosted contrast
    colors = [
      [79, 70, 229, 0.95],   // 970 hPa (deep ocean purple-indigo)
      [14, 116, 144, 0.85],  // 990 hPa (desaturated sea blue)
      [103, 232, 249, 0.70], // 1005 hPa (light sea-mist)
      [45, 212, 191, 0.45],  // 1009 hPa (teal — everyday lows now read; 2026-07-16 audit)
      [253, 252, 248, 0.0],  // 1013 hPa (neutral transparent)
      [245, 158, 11, 0.45],  // 1018 hPa (amber — everyday highs now read)
      [217, 119, 6, 0.75],   // 1025 hPa (desaturated terracotta)
      [180, 83, 9, 0.95]     // 1045 hPa (warm coastal bronze)
    ];
  } else if (theme === 'light') {
    // Light Theme: desaturated clear indigo/sky blue (Lows) to solar orange/coral (Highs) - boosted contrast
    colors = [
      [99, 102, 241, 0.95],  // 970 hPa (clear indigo)
      [59, 130, 246, 0.85],  // 990 hPa (soft sky blue)
      [147, 197, 253, 0.70], // 1005 hPa (readable sky blue — was near-white ice, invisible on the light basemap)
      [96, 165, 250, 0.45],  // 1009 hPa (mid blue — everyday lows now read; 2026-07-16 audit)
      [255, 255, 255, 0.0],  // 1013 hPa (neutral transparent)
      [252, 211, 77, 0.45],  // 1018 hPa (soft amber — everyday highs now read)
      [245, 158, 11, 0.75],  // 1025 hPa (solar amber-gold)
      [239, 68, 68, 0.95]    // 1045 hPa (desaturated coral red)
    ];
  } else {
    // Dark Theme: desaturated neon electric violet/blue (Lows) to glowing amber/crimson (Highs) - boosted contrast
    colors = [
      [147, 51, 234, 0.95],  // 970 hPa (electric violet)
      [37, 99, 235, 0.85],   // 990 hPa (neon blue)
      [6, 182, 212, 0.70],   // 1005 hPa (vibrant cyan-blue)
      [34, 211, 238, 0.45],  // 1009 hPa (cyan — everyday lows now read; 2026-07-16 audit)
      [15, 23, 42, 0.0],     // 1013 hPa (neutral transparent)
      [251, 191, 36, 0.45],  // 1018 hPa (amber — everyday highs now read)
      [245, 158, 11, 0.75],  // 1025 hPa (glowing amber-gold)
      [220, 38, 38, 0.95]    // 1045 hPa (neon crimson)
    ];
  }

  if (BASE_CUSTOM_COLOR_SCALES.pressure_msl) {
    BASE_CUSTOM_COLOR_SCALES.pressure_msl.colors = colors;
  }
  
  // Re-smooth scale in memory
  CUSTOM_COLOR_SCALES.pressure_msl = smoothColorScale(BASE_CUSTOM_COLOR_SCALES.pressure_msl, 80);
  
  // Push changes to protocol if active
  if (typeof window !== 'undefined' && window.__OM_PROTOCOL_SETTINGS__) {
    window.__OM_PROTOCOL_SETTINGS__.colorScales.pressure_msl = CUSTOM_COLOR_SCALES.pressure_msl;
  }
}

export function getThemedWaveColorJS(h, theme, surfMode = false) {
  // JS mirror of the HEATMAP_FS color ramp (keep in sync with WebGLMarineShaders.js). surfMode rescales the
  // height->color mapping to the nearshore surf range (~0-4 m / 0-13 ft) so the coastal band differentiates,
  // matching getSurfT() in the shader.
  let t = 0;
  if (surfMode) {
    // Mirror of getSurfT() in WebGLMarineShaders.js — surf-focused scale 0-16 ft (0-5 m), densest 2-8 ft.
    if (h < 0.3) {
      t = (h / 0.3) * 0.08;
    } else if (h < 0.6) {
      t = 0.08 + ((h - 0.3) / 0.3) * 0.14;
    } else if (h < 0.9) {
      t = 0.22 + ((h - 0.6) / 0.3) * 0.16;
    } else if (h < 1.5) {
      t = 0.38 + ((h - 0.9) / 0.6) * 0.22;
    } else if (h < 2.4) {
      t = 0.60 + ((h - 1.5) / 0.9) * 0.20;
    } else if (h < 3.7) {
      t = 0.80 + ((h - 2.4) / 1.3) * 0.12;
    } else {
      t = 0.92 + Math.min(1.0, (h - 3.7) / 1.3) * 0.08;
    }
  } else if (h < 0.6) {
    // v5 mirror (2026-07-04): anchors re-seated on the legend ticks (0.6/1.2/2.4/5m = 2/4/8/16 ft)
    // — keep in sync with getNonlinearT in WebGLMarineShaders.js (0.20/0.46/0.72/0.94 splits;
    // surf branch above unchanged).
    t = (h / 0.6) * 0.20;
  } else if (h < 1.2) {
    t = 0.20 + ((h - 0.6) / 0.6) * 0.26;
  } else if (h < 2.4) {
    t = 0.46 + ((h - 1.2) / 1.2) * 0.26;
  } else if (h < 5.0) {
    t = 0.72 + ((h - 2.4) / 2.6) * 0.22;
  } else {
    t = 0.94 + Math.min(1.0, (h - 5.0) / 5.0) * 0.06;
  }

  let c0, c1, c2, c3, c4, c5;
  if (theme === 'beach') {
    c0 = [5, 97, 89];
    c1 = [13, 166, 148];
    c2 = [242, 153, 102];
    c3 = [255, 102, 38];
    c4 = [217, 64, 13];
    c5 = [255, 242, 230];
  } else if (theme === 'light') {
    c0 = [199, 222, 240];
    c1 = [77, 179, 230];
    c2 = [31, 107, 217];
    c3 = [107, 51, 209];
    c4 = [217, 46, 128];
    c5 = [255, 255, 255];
  } else {
    c0 = [3, 5, 20];      // surf mode keeps this near-black; non-surf lifts it below
    c1 = [0, 140, 191];
    c2 = [0, 235, 255];
    c3 = [89, 38, 255];
    c4 = [255, 26, 191];
    c5 = [255, 255, 255];
  }

  // v5 (2026-07-04): non-surf low-band hue rotation — c1 (the 2 ft anchor) moves to the green
  // family so 0/2/4 ft carry distinct HUES, not just lightness (mirror of getThemedWaveColor in
  // WebGLMarineShaders.js). Beach already rotates turquoise->coral here — unchanged. Surf mode
  // keeps the original anchors + splits so the tuned surf colormap stays byte-identical.
  if (!surfMode) {
    if (theme === 'light') {
      c1 = [26, 166, 138];  // 2ft/0.6m - Sea Green (was sky-cyan)
    } else if (theme !== 'beach') {
      c1 = [0, 209, 130];   // 2ft/0.6m - Neon Spring Green (was teal)
      // c0 LIFTED 2026-07-04 (low-wave legibility, NON-SURF DARK only — surf byte-identical): near-black
      // [3,5,20] made calm water (0.1-0.3m sheltered bays / light-swell days: Kvarner 0.14m) invisible on
      // the dark basemap = "heatmap cleared". Deep ocean blue keeps the calm read, small waves legible.
      c0 = [13, 48, 92];    // mirror of WebGLMarineShaders.js dark non-surf c0 vec3(0.05,0.19,0.36)
    }
  }
  // Band splits follow the mode's t-curve — non-surf v5 0.20/0.46/0.72/0.94, surf unchanged.
  const b1 = surfMode ? 0.15 : 0.20;
  const b2 = surfMode ? 0.50 : 0.46;
  const b3 = surfMode ? 0.80 : 0.72;
  const b4 = surfMode ? 0.92 : 0.94;
  let rgb;
  if (t < b1) {
    let factor = t / b1;
    rgb = [
      c0[0] + (c1[0] - c0[0]) * factor,
      c0[1] + (c1[1] - c0[1]) * factor,
      c0[2] + (c1[2] - c0[2]) * factor
    ];
  } else if (t < b2) {
    let factor = (t - b1) / (b2 - b1);
    rgb = [
      c1[0] + (c2[0] - c1[0]) * factor,
      c1[1] + (c2[1] - c1[1]) * factor,
      c1[2] + (c2[2] - c1[2]) * factor
    ];
  } else if (t < b3) {
    let factor = (t - b2) / (b3 - b2);
    rgb = [
      c2[0] + (c3[0] - c2[0]) * factor,
      c2[1] + (c3[1] - c2[1]) * factor,
      c2[2] + (c3[2] - c2[2]) * factor
    ];
  } else if (t < b4) {
    let factor = (t - b3) / (b4 - b3);
    rgb = [
      c3[0] + (c4[0] - c3[0]) * factor,
      c3[1] + (c4[1] - c3[1]) * factor,
      c3[2] + (c4[2] - c3[2]) * factor
    ];
  } else {
    let factor = (t - b4) / (1.0 - b4);
    rgb = [
      c4[0] + (c5[0] - c4[0]) * factor,
      c4[1] + (c5[1] - c4[1]) * factor,
      c4[2] + (c5[2] - c4[2]) * factor
    ];
  }

  return [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])];
}

export function applyThemeWaveScale(theme) {
  var ORIGINAL_WAVE_ALPHAS = {
    wave_height: [0.0, 0.45, 0.65, 0.75, 0.85, 0.95],
    wave: [0.0, 0.45, 0.65, 0.75, 0.85, 0.95],
    swell_wave_height: [0.0, 0.45, 0.65, 0.75, 0.85, 0.95],
    secondary_swell_wave_height: [0.0, 0.4, 0.6, 0.75, 0.85, 0.95],
    wind_wave_height: [0.0, 0.4, 0.6, 0.75, 0.85, 0.95]
  };

  var keys = ['wave_height', 'wave', 'swell_wave_height', 'secondary_swell_wave_height', 'wind_wave_height'];
  keys.forEach(function(key) {
    var baseScale = BASE_CUSTOM_COLOR_SCALES[key];
    if (baseScale && baseScale.breakpoints) {
      baseScale.colors = baseScale.breakpoints.map(function(bp, idx) {
        var rgb = getThemedWaveColorJS(bp, theme);
        var originalAlpha = ORIGINAL_WAVE_ALPHAS[key][idx] !== undefined ? ORIGINAL_WAVE_ALPHAS[key][idx] : 0.5;
        return [rgb[0], rgb[1], rgb[2], originalAlpha];
      });
      // Re-smooth scale in memory
      CUSTOM_COLOR_SCALES[key] = smoothColorScale(baseScale, 80);
      
      // Push changes to protocol if active
      if (typeof window !== 'undefined' && window.__OM_PROTOCOL_SETTINGS__) {
        window.__OM_PROTOCOL_SETTINGS__.colorScales[key] = CUSTOM_COLOR_SCALES[key];
      }
    }
  });
}

