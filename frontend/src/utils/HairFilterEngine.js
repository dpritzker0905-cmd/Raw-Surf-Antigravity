/**
 * HairFilterEngine — Real-time AR hair overlay using MediaPipe Face Mesh
 * 
 * Best practices followed (per Google/MediaPipe docs):
 * 1. Video + overlay canvas both get CSS scaleX(-1) for front camera mirroring
 * 2. MediaPipe processes raw (unmirrored) frames
 * 3. Drawing uses raw coordinates — CSS flip handles visual mirroring
 * 4. Canvas sized to CSS display dimensions (not video native resolution)
 * 5. requestAnimationFrame for render loop
 * 6. Landmark smoothing buffer to reduce jitter
 */

import logger from './logger';

// Hair style definitions with asset imports
import blondeFlowImg from '../assets/hair/blonde_flow.png';
import brownDreadsImg from '../assets/hair/brown_dreads.png';
import messyBunImg from '../assets/hair/messy_bun.png';
import saltSandImg from '../assets/hair/salt_sand.png';
import darkShagImg from '../assets/hair/dark_shag.png';
import beachWavesImg from '../assets/hair/beach_waves.png';
import braidedCrownImg from '../assets/hair/braided_crown.png';
import pinkTipsImg from '../assets/hair/pink_tips.png';
import curlySurfImg from '../assets/hair/curly_surf.png';
import platinumBobImg from '../assets/hair/platinum_bob.png';

// Hair style catalog — scale/offset tuned for mobile (face fills ~50-60% of frame)
export const HAIR_STYLES = {
  // Male styles
  blonde_flow: {
    id: 'blonde_flow',
    name: 'Blonde Flow',
    category: 'male',
    emoji: '🏄‍♂️',
    description: 'Long wavy blonde surfer hair',
    src: blondeFlowImg,
    offsetY: -0.45,
    scaleMultiplier: 2.0,
  },
  brown_dreads: {
    id: 'brown_dreads',
    name: 'Brown Dreads',
    category: 'male',
    emoji: '🌴',
    description: 'Thick brown dreadlocks',
    src: brownDreadsImg,
    offsetY: -0.40,
    scaleMultiplier: 2.2,
  },
  messy_bun: {
    id: 'messy_bun',
    name: 'Messy Bun',
    category: 'male',
    emoji: '🤙',
    description: 'Dark hair in messy top bun',
    src: messyBunImg,
    offsetY: -0.55,
    scaleMultiplier: 1.8,
  },
  salt_sand: {
    id: 'salt_sand',
    name: 'Salt & Sand',
    category: 'male',
    emoji: '☀️',
    description: 'Short bleached sandy buzz',
    src: saltSandImg,
    offsetY: -0.35,
    scaleMultiplier: 1.5,
  },
  dark_shag: {
    id: 'dark_shag',
    name: 'Dark Shag',
    category: 'male',
    emoji: '🌊',
    description: 'Medium-length dark shaggy hair',
    src: darkShagImg,
    offsetY: -0.40,
    scaleMultiplier: 1.8,
  },
  // Female styles
  beach_waves: {
    id: 'beach_waves',
    name: 'Beach Waves',
    category: 'female',
    emoji: '🧜‍♀️',
    description: 'Long golden beach waves',
    src: beachWavesImg,
    offsetY: -0.45,
    scaleMultiplier: 2.2,
  },
  braided_crown: {
    id: 'braided_crown',
    name: 'Braided Crown',
    category: 'female',
    emoji: '🌺',
    description: 'Fishtail crown braid',
    src: braidedCrownImg,
    offsetY: -0.50,
    scaleMultiplier: 1.8,
  },
  pink_tips: {
    id: 'pink_tips',
    name: 'Pink Tips',
    category: 'female',
    emoji: '🌸',
    description: 'Dark roots with pink ends',
    src: pinkTipsImg,
    offsetY: -0.40,
    scaleMultiplier: 2.0,
  },
  curly_surf: {
    id: 'curly_surf',
    name: 'Curly Surf',
    category: 'female',
    emoji: '🦱',
    description: 'Big voluminous natural curls',
    src: curlySurfImg,
    offsetY: -0.40,
    scaleMultiplier: 2.4,
  },
  platinum_bob: {
    id: 'platinum_bob',
    name: 'Platinum Bob',
    category: 'female',
    emoji: '⚡',
    description: 'Short platinum blonde bob',
    src: platinumBobImg,
    offsetY: -0.30,
    scaleMultiplier: 1.5,
  },
};

// MediaPipe Face Mesh landmark indices
const FOREHEAD_TOP = 10;
const LEFT_EYE_OUTER = 234;
const RIGHT_EYE_OUTER = 454;
const LEFT_EYE_INNER = 133;
const RIGHT_EYE_INNER = 362;
const CHIN_BOTTOM = 152; // Used for head height measurement

/**
 * Loads the MediaPipe Face Mesh library from CDN
 */
const loadMediaPipe = () => {
  return new Promise((resolve, reject) => {
    if (window.FaceMesh) {
      resolve(window.FaceMesh);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js';
    script.crossOrigin = 'anonymous';
    
    script.onload = () => {
      const script2 = document.createElement('script');
      script2.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';
      script2.crossOrigin = 'anonymous';
      script2.onload = () => {
        if (window.FaceMesh) {
          resolve(window.FaceMesh);
        } else {
          reject(new Error('FaceMesh not found after loading'));
        }
      };
      script2.onerror = () => reject(new Error('Failed to load MediaPipe camera utils'));
      document.head.appendChild(script2);
    };
    
    script.onerror = () => reject(new Error('Failed to load MediaPipe Face Mesh'));
    document.head.appendChild(script);
  });
};

/**
 * Process a loaded image to remove checkered/white/gray backgrounds
 * and create real alpha transparency.
 * 
 * AI-generated "transparent" PNGs bake a visible checkerboard into the RGB data.
 * This function detects near-white and near-gray pixels (low color saturation, 
 * high brightness) and zeroes out their alpha channel.
 */
function processImageAlpha(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // Calculate brightness and color saturation
    const avg = (r + g + b) / 3;
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const colorRange = maxChannel - minChannel; // low = gray/white, high = colorful
    
    // Aggressive removal: any pixel that is bright AND has low color saturation
    // is likely part of the checkered background
    if (avg > 150 && colorRange < 40) {
      // Fully transparent for clearly white/gray pixels
      data[i + 3] = 0;
    } else if (avg > 130 && colorRange < 35) {
      // Feathered transparency for edge pixels (smooth blend)
      const fade = Math.max(0, (avg - 130) / 20);
      data[i + 3] = Math.round(255 * (1 - fade));
    } else if (avg > 120 && colorRange < 25) {
      // Very light fade for borderline pixels
      data[i + 3] = Math.round(255 * 0.7);
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  
  // Convert back to an Image
  const processedImg = new window.Image();
  processedImg.src = canvas.toDataURL('image/png');
  return new Promise((resolve) => {
    processedImg.onload = () => resolve(processedImg);
    processedImg.onerror = () => resolve(img); // fallback to original
  });
}


export class HairFilterEngine {
  constructor() {
    this.faceMesh = null;
    this.activeStyle = null;
    this.hairImages = {};
    this.isRunning = false;
    this.animFrameId = null;
    this.videoEl = null;
    this.canvasEl = null;
    this.ctx = null;
    this._initialized = false;
    this._initPromise = null;
    
    // Smoothing buffer (4 frames reduces jitter while staying responsive)
    this._smoothBuffer = [];
    this._smoothSize = 4;
  }

  async init() {
    if (this._initialized) return;
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._doInit();
    return this._initPromise;
  }
  
  async _doInit() {
    try {
      const FaceMeshClass = await loadMediaPipe();
      
      this.faceMesh = new FaceMeshClass({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      });
      
      this.faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      
      this.faceMesh.onResults((results) => {
        this._onFaceResults(results);
      });
      
      await this._preloadImages();
      
      this._initialized = true;
      logger.info('[HairFilterEngine] Initialized successfully');
    } catch (err) {
      logger.error('[HairFilterEngine] Initialization failed:', err);
      this._initialized = false;
    }
  }
  
  /**
   * Preload all hair sprite images and process them for real alpha transparency
   */
  async _preloadImages() {
    const loadAndProcess = async (src) => {
      return new Promise((resolve) => {
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.onload = async () => {
          try {
            const processed = await processImageAlpha(img);
            resolve(processed);
          } catch {
            resolve(img);
          }
        };
        img.onerror = () => {
          logger.warn('[HairFilterEngine] Failed to load hair image:', src);
          resolve(null);
        };
        img.src = src;
      });
    };
    
    const entries = Object.entries(HAIR_STYLES);
    const results = await Promise.all(entries.map(([, style]) => loadAndProcess(style.src)));
    
    entries.forEach(([id], idx) => {
      if (results[idx]) {
        this.hairImages[id] = results[idx];
      }
    });
    
    logger.info(`[HairFilterEngine] Preloaded ${Object.keys(this.hairImages).length}/${entries.length} hair images`);
  }
  
  setHairStyle(styleId) {
    if (styleId === null || styleId === 'none') {
      this.activeStyle = null;
      if (this.ctx && this.canvasEl) {
        this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
      }
      return;
    }
    
    const style = HAIR_STYLES[styleId];
    if (!style) {
      logger.warn(`[HairFilterEngine] Unknown hair style: ${styleId}`);
      return;
    }
    this.activeStyle = style;
  }
  
  /**
   * Start the hair filter engine.
   * Will wait for init if still loading.
   */
  async start(videoEl, canvasEl) {
    if (!this._initialized && this._initPromise) {
      try {
        await this._initPromise;
      } catch {
        return;
      }
    }
    
    if (!this._initialized || !this.faceMesh) {
      logger.warn('[HairFilterEngine] Not initialized, cannot start');
      return;
    }
    
    // Stop any existing loop
    if (this.isRunning) this.stop();
    
    this.videoEl = videoEl;
    this.canvasEl = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.isRunning = true;
    
    this._syncCanvasSize();
    this._tick();
    logger.info('[HairFilterEngine] Started rendering');
  }
  
  stop() {
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.ctx && this.canvasEl) {
      this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
    }
    this._smoothBuffer = [];
  }
  
  dispose() {
    this.stop();
    if (this.faceMesh) {
      this.faceMesh.close();
      this.faceMesh = null;
    }
    this.hairImages = {};
    this._initialized = false;
    this._initPromise = null;
  }
  
  // ─── Internal Methods ───────────────────────────────────────────
  
  /**
   * Sync canvas internal resolution to its CSS display size.
   * This ensures 1:1 pixel mapping with the on-screen display.
   * MediaPipe returns normalized 0-1 coords, so any canvas size works.
   */
  _syncCanvasSize() {
    if (!this.canvasEl) return;
    
    const displayW = this.canvasEl.clientWidth || this.canvasEl.offsetWidth;
    const displayH = this.canvasEl.clientHeight || this.canvasEl.offsetHeight;
    
    if (displayW === 0 || displayH === 0) return;
    
    if (this.canvasEl.width !== displayW || this.canvasEl.height !== displayH) {
      this.canvasEl.width = displayW;
      this.canvasEl.height = displayH;
    }
  }
  
  async _tick() {
    if (!this.isRunning) return;
    
    try {
      this._syncCanvasSize();
      
      if (this.activeStyle && this.videoEl && this.videoEl.readyState >= 2) {
        await this.faceMesh.send({ image: this.videoEl });
      } else {
        if (this.ctx && this.canvasEl) {
          this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
        }
      }
    } catch (err) {
      // Silent fail on individual frames — don't break the render loop
    }
    
    this.animFrameId = requestAnimationFrame(() => this._tick());
  }
  
  _onFaceResults(results) {
    if (!this.ctx || !this.canvasEl || !this.activeStyle) return;
    
    const { width, height } = this.canvasEl;
    this.ctx.clearRect(0, 0, width, height);
    
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      this._smoothBuffer = [];
      return;
    }
    
    const landmarks = results.multiFaceLandmarks[0];
    
    const forehead = landmarks[FOREHEAD_TOP];
    const leftTemple = landmarks[LEFT_EYE_OUTER];
    const rightTemple = landmarks[RIGHT_EYE_OUTER];
    const leftEye = landmarks[LEFT_EYE_INNER];
    const rightEye = landmarks[RIGHT_EYE_INNER];
    const chin = landmarks[CHIN_BOTTOM];
    
    if (!forehead || !leftTemple || !rightTemple || !chin) return;
    
    // Face width from temples (in canvas pixel space)
    const faceWidth = Math.sqrt(
      Math.pow((rightTemple.x - leftTemple.x) * width, 2) +
      Math.pow((rightTemple.y - leftTemple.y) * height, 2)
    );
    
    // Face height from forehead to chin (used for better scaling)
    const faceHeight = Math.sqrt(
      Math.pow((chin.x - forehead.x) * width, 2) +
      Math.pow((chin.y - forehead.y) * height, 2)
    );
    
    // Use raw MediaPipe coordinates directly.
    // The CSS scaleX(-1) on the canvas handles mirroring to match the video.
    const foreheadX = forehead.x * width;
    const foreheadY = forehead.y * height;
    
    // Head tilt angle from eye line
    const angle = Math.atan2(
      (rightEye.y - leftEye.y) * height,
      (rightEye.x - leftEye.x) * width
    );
    
    // Push to smoothing buffer
    const current = { foreheadX, foreheadY, faceWidth, faceHeight, angle };
    this._smoothBuffer.push(current);
    if (this._smoothBuffer.length > this._smoothSize) {
      this._smoothBuffer.shift();
    }
    
    this._drawHair(this._getSmoothedValues());
  }
  
  _getSmoothedValues() {
    const buf = this._smoothBuffer;
    if (buf.length === 0) return { foreheadX: 0, foreheadY: 0, faceWidth: 100, faceHeight: 150, angle: 0 };
    
    const sum = buf.reduce((acc, v) => ({
      foreheadX: acc.foreheadX + v.foreheadX,
      foreheadY: acc.foreheadY + v.foreheadY,
      faceWidth: acc.faceWidth + v.faceWidth,
      faceHeight: acc.faceHeight + v.faceHeight,
      angle: acc.angle + v.angle,
    }), { foreheadX: 0, foreheadY: 0, faceWidth: 0, faceHeight: 0, angle: 0 });
    
    return {
      foreheadX: sum.foreheadX / buf.length,
      foreheadY: sum.foreheadY / buf.length,
      faceWidth: sum.faceWidth / buf.length,
      faceHeight: sum.faceHeight / buf.length,
      angle: sum.angle / buf.length,
    };
  }
  
  _drawHair({ foreheadX, foreheadY, faceWidth, faceHeight, angle }) {
    const style = this.activeStyle;
    const img = this.hairImages[style.id];
    if (!img || !this.ctx) return;
    
    const ctx = this.ctx;
    
    // Scale hair width from face width
    const hairWidth = faceWidth * style.scaleMultiplier;
    const hairHeight = hairWidth * (img.naturalHeight / img.naturalWidth);
    
    // Position: centered on forehead, offset upward by a fraction of faceWidth
    const drawX = foreheadX;
    const drawY = foreheadY + (faceWidth * style.offsetY);
    
    // Draw with rotation matching head tilt
    ctx.save();
    ctx.translate(drawX, drawY);
    ctx.rotate(angle);
    ctx.drawImage(
      img,
      -hairWidth / 2,
      -hairHeight / 2,
      hairWidth,
      hairHeight
    );
    ctx.restore();
  }
}

export default HairFilterEngine;
