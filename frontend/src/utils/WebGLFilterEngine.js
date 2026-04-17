// src/utils/WebGLFilterEngine.js

const VERTEX_SHADER = `
  attribute vec2 position;
  attribute vec2 texcoord;
  varying vec2 v_texcoord;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
    v_texcoord = texcoord;
  }
`;

const FRAGMENT_SHADERS = {
  none: `
    precision highp float;
    varying vec2 v_texcoord;
    uniform sampler2D u_texture;
    void main() {
      vec2 uv = vec2(v_texcoord.x, 1.0 - v_texcoord.y); // Flip Y to match standard video orientation
      gl_FragColor = texture2D(u_texture, uv);
    }
  `,
  nightvision: `
    precision highp float;
    varying vec2 v_texcoord;
    uniform sampler2D u_texture;
    uniform float u_time;

    float rand(vec2 co) {
      return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vec2(v_texcoord.x, 1.0 - v_texcoord.y);
      vec4 color = texture2D(u_texture, uv);
      
      float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      lum = clamp((lum - 0.2) * 1.5, 0.0, 1.0);
      
      vec3 greenVision = vec3(0.1, 0.9, 0.2) * lum;
      float noise = (rand(uv * u_time) - 0.5) * 0.3;
      float scanline = sin(uv.y * 800.0) * 0.1;
      
      vec3 finalColor = greenVision + noise - scanline;
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `,
  pixelate: `
    precision highp float;
    varying vec2 v_texcoord;
    uniform sampler2D u_texture;
    uniform vec2 u_resolution;

    void main() {
      vec2 uv = vec2(v_texcoord.x, 1.0 - v_texcoord.y);
      float pixelSize = 15.0;
      
      float dx = pixelSize / u_resolution.x;
      float dy = pixelSize / u_resolution.y;
      
      vec2 coord = vec2(dx * floor(uv.x / dx), dy * floor(uv.y / dy));
      gl_FragColor = texture2D(u_texture, coord);
    }
  `,
  bioluminescence: `
    precision highp float;
    varying vec2 v_texcoord;
    uniform sampler2D u_texture;
    uniform vec2 u_resolution;

    void main() {
      vec2 uv = vec2(v_texcoord.x, 1.0 - v_texcoord.y);
      vec2 inc = 1.5 / u_resolution;
      
      vec4 c = texture2D(u_texture, uv);
      vec4 t = texture2D(u_texture, uv + vec2(0.0, -inc.y));
      vec4 b = texture2D(u_texture, uv + vec2(0.0, inc.y));
      vec4 l = texture2D(u_texture, uv + vec2(-inc.x, 0.0));
      vec4 r = texture2D(u_texture, uv + vec2(inc.x, 0.0));
      
      // Calculate Sobel edge intensity
      vec4 edge = abs(t - b) + abs(l - r);
      float lum = clamp(dot(edge.rgb, vec3(0.33)), 0.0, 1.0);
      
      // Map edges to extremely bright neon cyan and blue
      vec3 neon = vec3(0.0, 1.5, 2.0) * (lum * 4.0);
      
      // Keep a dark, high-contrast base for the non-edges
      vec3 finalColor = (c.rgb * 0.15) + neon;
      gl_FragColor = vec4(finalColor, c.a);
    }
  `,
  thermal: `
    precision highp float;
    varying vec2 v_texcoord;
    uniform sampler2D u_texture;

    void main() {
      vec2 uv = vec2(v_texcoord.x, 1.0 - v_texcoord.y);
      vec4 color = texture2D(u_texture, uv);
      // Grayscale luminance
      float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      
      // Map to Thermal heat signature gradient (Blue -> Red -> Yellow -> White)
      vec3 heat;
      if (lum < 0.33) {
          heat = mix(vec3(0.0, 0.0, 0.8), vec3(1.0, 0.0, 0.0), lum * 3.0);
      } else if (lum < 0.66) {
          heat = mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 1.0, 0.0), (lum - 0.33) * 3.0);
      } else {
          heat = mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 1.0, 1.0), (lum - 0.66) * 3.0);
      }
      
      gl_FragColor = vec4(heat, color.a);
    }
  `,
  cyber: `
    precision highp float;
    varying vec2 v_texcoord;
    uniform sampler2D u_texture;
    uniform float u_time;

    void main() {
      vec2 uv = vec2(v_texcoord.x, 1.0 - v_texcoord.y);
      
      // Dynamic chaotic time-based RGB split
      float glitchOffset = sin(u_time * 15.0 + uv.y * 30.0) * 0.015;
      
      float r = texture2D(u_texture, uv + vec2(glitchOffset, 0.0)).r;
      float g = texture2D(u_texture, uv).g;
      float b = texture2D(u_texture, uv - vec2(glitchOffset, 0.0)).b;
      
      // CRT Scanline matrix rendering
      float scanline = sin(uv.y * 800.0) * 0.15;
      
      // High contrast bump
      vec3 finalColor = vec3(r - scanline, g - scanline, b - scanline) * 1.2;
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `,
  gopro: `
    precision highp float;
    varying vec2 v_texcoord;
    uniform sampler2D u_texture;

    void main() {
      // Flip Y first to keep coordination mapping stable
      vec2 uv = vec2(v_texcoord.x, 1.0 - v_texcoord.y);
      vec2 p = uv - 0.5;
      
      // Aggressive radial distortion mapping
      float r2 = dot(p, p);
      float f = 1.0 + r2 * 0.6; // Barrel intensity multiplier
      
      vec2 dest = p * f + 0.5;
      
      // Crop out-of-bounds rendering natively
      if (dest.x < 0.0 || dest.x > 1.0 || dest.y < 0.0 || dest.y > 1.0) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      } else {
          gl_FragColor = texture2D(u_texture, dest);
      }
    }
  `
};

export class WebGLVideoProcessor {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: false });
    if (!this.gl) throw new Error('WebGL not natively supported on this device.');
    
    this.animationFrameId = null;
    this.videoElement = null;
    this.activeFilter = 'none';
    this.startTime = Date.now();
    this.programs = {};
    
    this._initCore();
  }

  _compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compilation crashed:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  _buildProgram(gl, vsSource, fsSource) {
    const vertexShader = this._compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this._compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program linking failed:', gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  _initCore() {
    const gl = this.gl;
    
    // Compile absolute shader programs
    for (const [key, source] of Object.entries(FRAGMENT_SHADERS)) {
      this.programs[key] = this._buildProgram(gl, VERTEX_SHADER, source);
    }
    
    // Standard screen quad geometry
    const positions = new Float32Array([
      -1.0, -1.0,   1.0, -1.0,   -1.0,  1.0,
      -1.0,  1.0,   1.0, -1.0,    1.0,  1.0
    ]);
    const texcoords = new Float32Array([
       0.0,  0.0,   1.0,  0.0,    0.0,  1.0,
       0.0,  1.0,   1.0,  0.0,    1.0,  1.0
    ]);

    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    this.texcoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STATIC_DRAW);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  setFilter(filterName) {
    if (this.programs[filterName]) {
      this.activeFilter = filterName;
    }
  }

  start(videoElement) {
    this.videoElement = videoElement;
    if (!this.animationFrameId) {
      this._renderLoop();
    }
  }

  stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  _renderLoop = () => {
    this.animationFrameId = requestAnimationFrame(this._renderLoop);
    if (!this.videoElement || this.videoElement.readyState < 2) return; // Wait for video data

    const gl = this.gl;
    const program = this.programs[this.activeFilter];
    
    gl.useProgram(program);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Update dynamically tracked video frame texture
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.videoElement);

    // Map geometry buffers
    const positionLocation = gl.getAttribLocation(program, "position");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const texcoordLocation = gl.getAttribLocation(program, "texcoord");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
    gl.enableVertexAttribArray(texcoordLocation);
    gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 0, 0);

    // Map Uniforms globally
    const uTimeLocation = gl.getUniformLocation(program, "u_time");
    if (uTimeLocation) gl.uniform1f(uTimeLocation, (Date.now() - this.startTime) / 1000.0);

    const uResLocation = gl.getUniformLocation(program, "u_resolution");
    if (uResLocation) gl.uniform2f(uResLocation, gl.canvas.width, gl.canvas.height);

    // Map the texture explicitly
    const uTextureLocation = gl.getUniformLocation(program, "u_texture");
    if (uTextureLocation) gl.uniform1i(uTextureLocation, 0);

    // Execute GPU render!
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
}
