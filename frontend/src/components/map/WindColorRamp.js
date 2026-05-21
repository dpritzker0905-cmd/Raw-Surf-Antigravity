/**
 * WindColorRamp.js Color LUT for WebGL Wind Visualization
 *
 * Generates a 1D texture lookup table (LUT) that maps wind speed color.
 * Used by WebGLWindEngine's draw fragment shader.
 */

var DEFAULT_WIND_RAMP = [
  [0,  0.55, 0.82, 0.95, 0.55], // Calm: sky blue
  [2,  0.30, 0.75, 0.92, 0.60], // Light air: cyan
  [5,  0.10, 0.72, 0.82, 0.65], // Light breeze: teal-cyan
  [8,  0.05, 0.65, 0.65, 0.68], // Gentle breeze: teal
  [12, 0.15, 0.75, 0.35, 0.70], // Moderate: green
  [16, 0.70, 0.85, 0.10, 0.72], // Fresh: yellow-green
  [20, 0.98, 0.72, 0.05, 0.75], // Strong: amber
  [25, 0.98, 0.45, 0.05, 0.78], // Near gale: orange
  [30, 0.92, 0.18, 0.10, 0.80], // Gale: red
  [40, 0.78, 0.05, 0.30, 0.82], // Storm: deep red/magenta
  [50, 0.60, 0.00, 0.50, 0.85], // Hurricane: purple
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
    stops = [
      [0,  0.45, 0.55, 0.95, 0.55],
      [2,  0.30, 0.60, 0.95, 0.60],
      [5,  0.15, 0.70, 0.90, 0.65],
      [8,  0.05, 0.80, 0.85, 0.68],
      [12, 0.05, 0.90, 0.75, 0.70],
      [16, 0.10, 0.90, 0.50, 0.72],
      [20, 0.25, 0.88, 0.30, 0.75],
      [25, 0.55, 0.82, 0.10, 0.78],
      [30, 0.85, 0.70, 0.05, 0.80],
      [40, 0.95, 0.40, 0.10, 0.82],
      [50, 0.98, 0.10, 0.10, 0.85],
    ];
  } else if (theme === 'beach') {
    stops = [
      [0,  0.98, 0.60, 0.10, 0.55],
      [2,  0.99, 0.68, 0.18, 0.60],
      [5,  0.99, 0.75, 0.25, 0.65],
      [8,  0.99, 0.82, 0.35, 0.68],
      [12, 0.98, 0.88, 0.45, 0.70],
      [16, 0.95, 0.68, 0.50, 0.72],
      [20, 0.90, 0.48, 0.55, 0.75],
      [25, 0.85, 0.32, 0.58, 0.78],
      [30, 0.80, 0.18, 0.62, 0.80],
      [40, 0.75, 0.06, 0.68, 0.82],
      [50, 0.70, 0.00, 0.72, 0.85],
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
