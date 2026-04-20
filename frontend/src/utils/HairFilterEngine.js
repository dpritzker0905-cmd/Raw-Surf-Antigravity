/**
 * HairFilterEngine — Real-time AR hair overlay using MediaPipe Face Mesh
 * 
 * Positioning algorithm (per AR best practices):
 * 1. MediaPipe landmark 10 is at the GLABELLA (between eyebrows), not the skull top
 * 2. Crown position is estimated: crownY = landmark10.y - (faceHeight * 0.5)
 *    because the cranium extends ~50% of face height above the glabella
 * 3. Head width ≈ temple-to-temple * 1.3 (actual head is wider than face)
 * 4. Hair sized relative to HEAD width (not face width)
 * 5. CSS scaleX(-1) on both video and canvas handles front-camera mirroring
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

/**
 * Hair style catalog
 * 
 * scaleMultiplier: size relative to estimated HEAD width (not face width)
 *   - 1.0 = exact head width
 *   - 1.2 = 20% wider than head (typical for flowing/voluminous styles)
 * 
 * verticalAnchor: where the hair center sits relative to the crown
 *   - 0.0 = centered exactly at estimated crown
 *   - negative = higher above head, positive = lower toward forehead
 *   - Values are in multiples of faceHeight
 */
export const HAIR_STYLES = {
  // Male styles
  blonde_flow: {
    id: 'blonde_flow',
    name: 'Blonde Flow',
    category: 'male',
    emoji: '🏄‍♂️',
    description: 'Long wavy blonde surfer hair',
    src: blondeFlowImg,
    scaleMultiplier: 1.3,
    verticalAnchor: 0.0,
  },
  brown_dreads: {
    id: 'brown_dreads',
    name: 'Brown Dreads',
    category: 'male',
    emoji: '🌴',
    description: 'Thick brown dreadlocks',
    src: brownDreadsImg,
    scaleMultiplier: 1.3,
    verticalAnchor: 0.05,
  },
  messy_bun: {
    id: 'messy_bun',
    name: 'Messy Bun',
    category: 'male',
    emoji: '🤙',
    description: 'Dark hair in messy top bun',
    src: messyBunImg,
    scaleMultiplier: 1.1,
    verticalAnchor: -0.1,
  },
  salt_sand: {
    id: 'salt_sand',
    name: 'Salt & Sand',
    category: 'male',
    emoji: '☀️',
    description: 'Short bleached sandy buzz',
    src: saltSandImg,
    scaleMultiplier: 1.0,
    verticalAnchor: 0.1,
  },
  dark_shag: {
    id: 'dark_shag',
    name: 'Dark Shag',
    category: 'male',
    emoji: '🌊',
    description: 'Medium-length dark shaggy hair',
    src: darkShagImg,
    scaleMultiplier: 1.2,
    verticalAnchor: 0.0,
  },
  // Female styles
  beach_waves: {
    id: 'beach_waves',
    name: 'Beach Waves',
    category: 'female',
    emoji: '🧜‍♀️',
    description: 'Long golden beach waves',
    src: beachWavesImg,
    scaleMultiplier: 1.4,
    verticalAnchor: 0.0,
  },
  braided_crown: {
    id: 'braided_crown',
    name: 'Braided Crown',
    category: 'female',
    emoji: '🌺',
    description: 'Fishtail crown braid',
    src: braidedCrownImg,
    scaleMultiplier: 1.2,
    verticalAnchor: -0.05,
  },
  pink_tips: {
    id: 'pink_tips',
    name: 'Pink Tips',
    category: 'female',
    emoji: '🌸',
    description: 'Dark roots with pink ends',
    src: pinkTipsImg,
    scaleMultiplier: 1.3,
    verticalAnchor: 0.0,
  },
  curly_surf: {
    id: 'curly_surf',
    name: 'Curly Surf',
    category: 'female',
    emoji: '🦱',
    description: 'Big voluminous natural curls',
    src: curlySurfImg,
    scaleMultiplier: 1.5,
    verticalAnchor: 0.0,
  },
  platinum_bob: {
    id: 'platinum_bob',
    name: 'Platinum Bob',
    category: 'female',
    emoji: '⚡',
    description: 'Short platinum blonde bob',
    src: platinumBobImg,
    scaleMultiplier: 1.1,
    verticalAnchor: 0.05,
  },
};

// ── MediaPipe Face Mesh Landmark Indices ──
const LANDMARK = {
  FOREHEAD_TOP: 10,     // Glabella area (between eyebrows — NOT top of skull!)
  CHIN: 152,            // Bottom of chin
  LEFT_TEMPLE: 234,     // Left side of face
  RIGHT_TEMPLE: 454,    // Right side of face
  LEFT_EYE_INNER: 133,
  RIGHT_EYE_INNER: 362,
  NOSE_BRIDGE: 6,       // Very stable center point
};

// Anthropometric constants
const HEAD_WIDTH_RATIO = 1.3;    // Head is ~30% wider than temple-to-temple
const CROWN_OFFSET_RATIO = 0.5;  // Crown is ~50% of face-height above landmark 10

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
    
    const avg = (r + g + b) / 3;
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const colorRange = maxChannel - minChannel;
    
    // Aggressive: bright pixels with low color saturation = background
    if (avg > 145 && colorRange < 45) {
      data[i + 3] = 0; // fully transparent
    } else if (avg > 125 && colorRange < 35) {
      // Feathered edge
      const fade = Math.max(0, (avg - 125) / 20);
      data[i + 3] = Math.round(255 * (1 - fade));
    } else if (avg > 115 && colorRange < 25) {
      data[i + 3] = Math.round(255 * 0.6);
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  
  const processedImg = new window.Image();
  processedImg.src = canvas.toDataURL('image/png');
  return new Promise((resolve) => {
    processedImg.onload = () => resolve(processedImg);
    processedImg.onerror = () => resolve(img);
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
    
    // Smoothing buffer (reduces landmark jitter)
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
      
      this.faceMesh.onResults((results) => this._onFaceResults(results));
      
      await this._preloadImages();
      
      this._initialized = true;
      logger.info('[HairFilterEngine] Initialized successfully');
    } catch (err) {
      logger.error('[HairFilterEngine] Initialization failed:', err);
      this._initialized = false;
    }
  }
  
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
   * Size canvas to CSS display dimensions (not video native resolution).
   * MediaPipe returns normalized 0-1 coords so any canvas size works.
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
      // Silent fail per frame
    }
    
    this.animFrameId = requestAnimationFrame(() => this._tick());
  }
  
  /**
   * Process face detection results and draw hair overlay.
   * 
   * Key insight: Landmark 10 is at the GLABELLA (between eyebrows),
   * NOT the top of the skull. We must extrapolate upward to find the crown.
   */
  _onFaceResults(results) {
    if (!this.ctx || !this.canvasEl || !this.activeStyle) return;
    
    const { width, height } = this.canvasEl;
    this.ctx.clearRect(0, 0, width, height);
    
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      this._smoothBuffer = [];
      return;
    }
    
    const lm = results.multiFaceLandmarks[0];
    
    const glabella = lm[LANDMARK.FOREHEAD_TOP]; // landmark 10 — between eyebrows
    const chin = lm[LANDMARK.CHIN];
    const leftTemple = lm[LANDMARK.LEFT_TEMPLE];
    const rightTemple = lm[LANDMARK.RIGHT_TEMPLE];
    const leftEye = lm[LANDMARK.LEFT_EYE_INNER];
    const rightEye = lm[LANDMARK.RIGHT_EYE_INNER];
    
    if (!glabella || !chin || !leftTemple || !rightTemple) return;
    
    // ── Step 1: Measure face dimensions in canvas pixels ──
    const faceWidth = Math.sqrt(
      Math.pow((rightTemple.x - leftTemple.x) * width, 2) +
      Math.pow((rightTemple.y - leftTemple.y) * height, 2)
    );
    
    const faceHeight = Math.sqrt(
      Math.pow((chin.x - glabella.x) * width, 2) +
      Math.pow((chin.y - glabella.y) * height, 2)
    );
    
    // ── Step 2: Estimate HEAD dimensions (larger than face) ──
    const headWidth = faceWidth * HEAD_WIDTH_RATIO;
    
    // ── Step 3: Estimate CROWN position ──
    // Crown is above landmark 10 by ~50% of the face height
    const crownOffsetPx = faceHeight * CROWN_OFFSET_RATIO;
    
    // Midpoint X from temples (more stable than single landmark)
    const centerX = ((leftTemple.x + rightTemple.x) / 2) * width;
    
    // Crown Y: glabella position minus the cranium offset
    const glabellaY = glabella.y * height;
    const crownY = glabellaY - crownOffsetPx;
    
    // ── Step 4: Head rotation angle ──
    const angle = Math.atan2(
      (rightEye.y - leftEye.y) * height,
      (rightEye.x - leftEye.x) * width
    );
    
    // ── Step 5: Smooth values ──
    const current = { centerX, crownY, headWidth, faceHeight, angle };
    this._smoothBuffer.push(current);
    if (this._smoothBuffer.length > this._smoothSize) {
      this._smoothBuffer.shift();
    }
    
    this._drawHair(this._getSmoothedValues());
  }
  
  _getSmoothedValues() {
    const buf = this._smoothBuffer;
    if (buf.length === 0) return { centerX: 0, crownY: 0, headWidth: 100, faceHeight: 150, angle: 0 };
    
    const sum = buf.reduce((acc, v) => ({
      centerX: acc.centerX + v.centerX,
      crownY: acc.crownY + v.crownY,
      headWidth: acc.headWidth + v.headWidth,
      faceHeight: acc.faceHeight + v.faceHeight,
      angle: acc.angle + v.angle,
    }), { centerX: 0, crownY: 0, headWidth: 0, faceHeight: 0, angle: 0 });
    
    const n = buf.length;
    return {
      centerX: sum.centerX / n,
      crownY: sum.crownY / n,
      headWidth: sum.headWidth / n,
      faceHeight: sum.faceHeight / n,
      angle: sum.angle / n,
    };
  }
  
  _drawHair({ centerX, crownY, headWidth, faceHeight, angle }) {
    const style = this.activeStyle;
    const img = this.hairImages[style.id];
    if (!img || !this.ctx) return;
    
    const ctx = this.ctx;
    
    // Hair width is relative to estimated HEAD width
    const hairWidth = headWidth * style.scaleMultiplier;
    const hairHeight = hairWidth * (img.naturalHeight / img.naturalWidth);
    
    // Anchor: center of hair at estimated crown, with per-style fine-tuning
    const drawX = centerX;
    const drawY = crownY + (faceHeight * style.verticalAnchor);
    
    // Draw centered at anchor point, rotated with head tilt
    ctx.save();
    ctx.translate(drawX, drawY);
    ctx.rotate(angle);
    ctx.drawImage(
      img,
      -hairWidth / 2,    // center horizontally
      -hairHeight * 0.3, // anchor point is ~30% from top of sprite (hair cap area)
      hairWidth,
      hairHeight
    );
    ctx.restore();
  }
}

export default HairFilterEngine;
