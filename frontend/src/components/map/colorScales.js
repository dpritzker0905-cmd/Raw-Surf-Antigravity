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
  },
  pressure_msl: {
    type: 'breakpoint',
    unit: 'hPa',
    breakpoints: [970, 990, 1005, 1013, 1025, 1045],
    colors: [
      [147, 51, 234, 0.7],
      [59, 130, 246, 0.6],
      [34, 211, 238, 0.4],
      [16, 185, 129, 0.3],
      [234, 179, 8, 0.5],
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
Object.keys(BASE_CUSTOM_COLOR_SCALES).forEach(function(key) {
  CUSTOM_COLOR_SCALES[key] = smoothColorScale(BASE_CUSTOM_COLOR_SCALES[key], 80);
});

export function applyThemePressureScale(theme) {
  var colors;
  if (theme === 'beach') {
    // Beach Theme: desaturated ocean indigo/teal (Lows) to warm terracotta/bronze (Highs) - boosted contrast
    colors = [
      [79, 70, 229, 0.95],   // 970 hPa (deep ocean purple-indigo)
      [14, 116, 144, 0.85],  // 990 hPa (desaturated sea blue)
      [103, 232, 249, 0.70], // 1005 hPa (light sea-mist)
      [253, 252, 248, 0.0],  // 1013 hPa (neutral transparent)
      [217, 119, 6, 0.75],   // 1025 hPa (desaturated terracotta)
      [180, 83, 9, 0.95]     // 1045 hPa (warm coastal bronze)
    ];
  } else if (theme === 'light') {
    // Light Theme: desaturated clear indigo/sky blue (Lows) to solar orange/coral (Highs) - boosted contrast
    colors = [
      [99, 102, 241, 0.95],  // 970 hPa (clear indigo)
      [59, 130, 246, 0.85],  // 990 hPa (soft sky blue)
      [191, 219, 254, 0.70], // 1005 hPa (light ice blue)
      [255, 255, 255, 0.0],  // 1013 hPa (neutral transparent)
      [245, 158, 11, 0.75],  // 1025 hPa (solar amber-gold)
      [239, 68, 68, 0.95]    // 1045 hPa (desaturated coral red)
    ];
  } else {
    // Dark Theme: desaturated neon electric violet/blue (Lows) to glowing amber/crimson (Highs) - boosted contrast
    colors = [
      [147, 51, 234, 0.95],  // 970 hPa (electric violet)
      [37, 99, 235, 0.85],   // 990 hPa (neon blue)
      [6, 182, 212, 0.70],   // 1005 hPa (vibrant cyan-blue)
      [15, 23, 42, 0.0],     // 1013 hPa (neutral transparent)
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
    // Mirror of getSurfT() in WebGLMarineShaders.js — coastal surf scale 0-26 ft (0-8 m), densest in 1-8 ft.
    if (h < 0.3) {
      t = (h / 0.3) * 0.10;
    } else if (h < 0.6) {
      t = 0.10 + ((h - 0.3) / 0.3) * 0.14;
    } else if (h < 0.9) {
      t = 0.24 + ((h - 0.6) / 0.3) * 0.14;
    } else if (h < 1.5) {
      t = 0.38 + ((h - 0.9) / 0.6) * 0.18;
    } else if (h < 2.4) {
      t = 0.56 + ((h - 1.5) / 0.9) * 0.16;
    } else if (h < 3.7) {
      t = 0.72 + ((h - 2.4) / 1.3) * 0.13;
    } else if (h < 5.5) {
      t = 0.85 + ((h - 3.7) / 1.8) * 0.10;
    } else {
      t = 0.95 + Math.min(1.0, (h - 5.5) / 2.5) * 0.05;
    }
  } else if (h < 0.5) {
    t = (h / 0.5) * 0.15;
  } else if (h < 1.5) {
    t = 0.15 + ((h - 0.5) / 1.0) * 0.35;
  } else if (h < 3.0) {
    t = 0.50 + ((h - 1.5) / 1.5) * 0.30;
  } else if (h < 5.0) {
    t = 0.80 + ((h - 3.0) / 2.0) * 0.12;
  } else {
    t = 0.92 + Math.min(1.0, (h - 5.0) / 5.0) * 0.08;
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
    c0 = [3, 5, 20];
    c1 = [0, 140, 191];
    c2 = [0, 235, 255];
    c3 = [89, 38, 255];
    c4 = [255, 26, 191];
    c5 = [255, 255, 255];
  }

  let rgb;
  if (t < 0.15) {
    let factor = t / 0.15;
    rgb = [
      c0[0] + (c1[0] - c0[0]) * factor,
      c0[1] + (c1[1] - c0[1]) * factor,
      c0[2] + (c1[2] - c0[2]) * factor
    ];
  } else if (t < 0.50) {
    let factor = (t - 0.15) / 0.35;
    rgb = [
      c1[0] + (c2[0] - c1[0]) * factor,
      c1[1] + (c2[1] - c1[1]) * factor,
      c1[2] + (c2[2] - c1[2]) * factor
    ];
  } else if (t < 0.80) {
    let factor = (t - 0.50) / 0.30;
    rgb = [
      c2[0] + (c3[0] - c2[0]) * factor,
      c2[1] + (c3[1] - c2[1]) * factor,
      c2[2] + (c3[2] - c2[2]) * factor
    ];
  } else if (t < 0.92) {
    let factor = (t - 0.80) / 0.12;
    rgb = [
      c3[0] + (c4[0] - c3[0]) * factor,
      c3[1] + (c4[1] - c3[1]) * factor,
      c3[2] + (c4[2] - c3[2]) * factor
    ];
  } else {
    let factor = (t - 0.92) / 0.08;
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

