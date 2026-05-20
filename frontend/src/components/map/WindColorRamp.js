/**
 * WindColorRamp.js Color LUT for WebGL Wind Visualization
 *
 * Generates a 1D texture lookup table (LUT) that maps wind speed color.
 * Used by WebGLWindEngine's draw fragment shader.
 */

var DEFAULT_WIND_RAMP = [
  [0,  0.65, 0.75, 0.85, 0.05], // Calm: highly transparent light blue-white
  [2,  0.55, 0.70, 0.88, 0.10], // Light air: bright blue, very transparent
  [5,  0.38, 0.75, 0.88, 0.18], // Light breeze: cyan
  [8,  0.22, 0.80, 0.72, 0.24], // Gentle breeze: teal
  [12, 0.38, 0.82, 0.38, 0.30], // Moderate: soft green
  [16, 0.78, 0.82, 0.20, 0.35], // Fresh: yellow-green
  [20, 0.95, 0.68, 0.15, 0.40], // Strong: soft amber
  [25, 0.95, 0.45, 0.10, 0.45], // Near gale: soft orange
  [30, 0.90, 0.22, 0.15, 0.48], // Gale: soft red
  [40, 0.75, 0.10, 0.35, 0.50], // Storm: soft magenta
  [50, 0.55, 0.05, 0.50, 0.50], // Hurricane: soft purple
];

function lerpStop(a, b, t) {
  return [
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
    a[4] + (b[4] - a[4]) * t,
  ];
}

export function sampleRamp(ramp, speed) {
  if (speed <= ramp[0][0]) return [ramp[0][1], ramp[0][2], ramp[0][3], ramp[0][4]];
  for (var i = 1; i < ramp.length; i++) {
    if (speed <= ramp[i][0]) {
      var t = (speed - ramp[i - 1][0]) / (ramp[i][0] - ramp[i - 1][0]);
      return lerpStop(ramp[i - 1], ramp[i], t);
    }
  }
  var last = ramp[ramp.length - 1];
  return [last[1], last[2], last[3], last[4]];
}

export function generateRampData(maxSpeed, theme) {
  var stops = DEFAULT_WIND_RAMP;
  
  if (theme === 'dark') {
    // Dark theme ramp: blue/cyan/indigo/purple
    stops = [
      [0,  0.58, 0.20, 0.92, 0.05],
      [2,  0.50, 0.30, 0.92, 0.10],
      [5,  0.30, 0.50, 0.90, 0.18],
      [8,  0.15, 0.70, 0.85, 0.24],
      [12, 0.10, 0.80, 0.80, 0.30],
      [16, 0.10, 0.85, 0.60, 0.35],
      [20, 0.20, 0.85, 0.40, 0.40],
      [25, 0.40, 0.80, 0.20, 0.45],
      [30, 0.70, 0.70, 0.10, 0.48],
      [40, 0.85, 0.40, 0.15, 0.50],
      [50, 0.90, 0.10, 0.10, 0.50],
    ];
  } else if (theme === 'beach') {
    // Beach theme ramp: warm gold, orange, sunset pink, coral
    stops = [
      [0,  0.98, 0.45, 0.09, 0.05],
      [2,  0.98, 0.50, 0.12, 0.10],
      [5,  0.98, 0.60, 0.20, 0.18],
      [8,  0.99, 0.70, 0.30, 0.24],
      [12, 0.99, 0.80, 0.40, 0.30],
      [16, 0.95, 0.65, 0.45, 0.35],
      [20, 0.90, 0.45, 0.50, 0.40],
      [25, 0.85, 0.30, 0.55, 0.45],
      [30, 0.80, 0.15, 0.60, 0.48],
      [40, 0.75, 0.05, 0.65, 0.50],
      [50, 0.70, 0.00, 0.70, 0.50],
    ];
  } else {
    // Light mode wind colors: near white with soft ice blue tinting
    stops = [
      [0,  0.94, 0.96, 1.00, 0.08],
      [2,  0.95, 0.97, 1.00, 0.12],
      [5,  0.96, 0.97, 1.00, 0.18],
      [8,  0.97, 0.98, 1.00, 0.24],
      [12, 0.98, 0.98, 1.00, 0.30],
      [16, 0.98, 0.99, 1.00, 0.35],
      [20, 0.99, 0.99, 1.00, 0.40],
      [25, 0.99, 0.99, 1.00, 0.45],
      [30, 1.00, 1.00, 1.00, 0.48],
      [40, 1.00, 1.00, 1.00, 0.50],
      [50, 1.00, 1.00, 1.00, 0.50],
    ];
  }

  var data = new Uint8Array(256 * 4);
  for (var i = 0; i < 256; i++) {
    var speed = (i / 255) * maxSpeed;
    var color = sampleRamp(stops, speed);
    data[i * 4 + 0] = Math.round(color[0] * 255);
    data[i * 4 + 1] = Math.round(color[1] * 255);
    data[i * 4 + 2] = Math.round(color[2] * 255);
    data[i * 4 + 3] = Math.round(color[3] * 255);
  }
  return data;
}

export function createRampTexture(gl, maxSpeed, ramp) {
  var data = generateRampData(maxSpeed || 50, ramp);
  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return { texture: tex, maxSpeed: maxSpeed || 50 };
}

export function getDefaultRamp() {
  return DEFAULT_WIND_RAMP.map(function(stop) { return stop.slice(); });
}

export function sampleColorRamp(speed) {
  return sampleRamp(DEFAULT_WIND_RAMP, speed);
}
