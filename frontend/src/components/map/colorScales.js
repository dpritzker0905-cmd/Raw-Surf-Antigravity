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
      [240, 240, 240, 0.45],
      [240, 240, 240, 0.35],
      [242, 245, 248, 0.20],
      [242, 245, 248, 0.10],
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
