/**
 * HairFilterEngine — Real-time AR hair overlay using MediaPipe Face Mesh
 * 
 * Architecture:
 * 1. Loads MediaPipe Face Mesh from CDN (lazy, cached after first load)
 * 2. Runs face detection on each video frame via requestAnimationFrame
 * 3. Extracts forehead landmarks to calculate position, scale, and rotation
 * 4. Composites the selected hair sprite onto a <canvas> overlay
 * 
 * Usage:
 *   const engine = new HairFilterEngine();
 *   await engine.init();
 *   engine.setHairStyle('blonde_flow');
 *   engine.start(videoElement, canvasElement);
 *   // ... later
 *   engine.stop();
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

// Hair style catalog
export const HAIR_STYLES = {
  // Male styles
  blonde_flow: {
    id: 'blonde_flow',
    name: 'Blonde Flow',
    category: 'male',
    emoji: '🏄‍♂️',
    description: 'Long wavy blonde surfer hair',
    src: blondeFlowImg,
    // Positioning: offsetY moves hair up/down relative to forehead, scale multiplier
    offsetY: -0.65, // How far above forehead center
    scaleMultiplier: 2.2, // How wide relative to face width
  },
  brown_dreads: {
    id: 'brown_dreads',
    name: 'Brown Dreads',
    category: 'male',
    emoji: '🌴',
    description: 'Thick brown dreadlocks',
    src: brownDreadsImg,
    offsetY: -0.6,
    scaleMultiplier: 2.4,
  },
  messy_bun: {
    id: 'messy_bun',
    name: 'Messy Bun',
    category: 'male',
    emoji: '🤙',
    description: 'Dark hair in messy top bun',
    src: messyBunImg,
    offsetY: -0.8,
    scaleMultiplier: 1.8,
  },
  salt_sand: {
    id: 'salt_sand',
    name: 'Salt & Sand',
    category: 'male',
    emoji: '☀️',
    description: 'Short bleached sandy buzz',
    src: saltSandImg,
    offsetY: -0.55,
    scaleMultiplier: 1.6,
  },
  dark_shag: {
    id: 'dark_shag',
    name: 'Dark Shag',
    category: 'male',
    emoji: '🌊',
    description: 'Medium-length dark shaggy hair',
    src: darkShagImg,
    offsetY: -0.6,
    scaleMultiplier: 2.0,
  },
  // Female styles
  beach_waves: {
    id: 'beach_waves',
    name: 'Beach Waves',
    category: 'female',
    emoji: '🧜‍♀️',
    description: 'Long golden beach waves',
    src: beachWavesImg,
    offsetY: -0.65,
    scaleMultiplier: 2.4,
  },
  braided_crown: {
    id: 'braided_crown',
    name: 'Braided Crown',
    category: 'female',
    emoji: '🌺',
    description: 'Fishtail crown braid',
    src: braidedCrownImg,
    offsetY: -0.7,
    scaleMultiplier: 2.0,
  },
  pink_tips: {
    id: 'pink_tips',
    name: 'Pink Tips',
    category: 'female',
    emoji: '🌸',
    description: 'Dark roots with pink ends',
    src: pinkTipsImg,
    offsetY: -0.6,
    scaleMultiplier: 2.2,
  },
  curly_surf: {
    id: 'curly_surf',
    name: 'Curly Surf',
    category: 'female',
    emoji: '🦱',
    description: 'Big voluminous natural curls',
    src: curlySurfImg,
    offsetY: -0.6,
    scaleMultiplier: 2.6,
  },
  platinum_bob: {
    id: 'platinum_bob',
    name: 'Platinum Bob',
    category: 'female',
    emoji: '⚡',
    description: 'Short platinum blonde bob',
    src: platinumBobImg,
    offsetY: -0.55,
    scaleMultiplier: 1.8,
  },
};

// MediaPipe Face Mesh landmark indices
// 10 = top of forehead, 234/454 = left/right temple, 1 = nose tip
const FOREHEAD_TOP = 10;
const LEFT_EYE_OUTER = 234;
const RIGHT_EYE_OUTER = 454;
const LEFT_EYE_INNER = 133;
const RIGHT_EYE_INNER = 362;

/**
 * Loads the MediaPipe Face Mesh library from CDN
 * Returns the FaceMesh class once ready
 */
const loadMediaPipe = () => {
  return new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.FaceMesh) {
      resolve(window.FaceMesh);
      return;
    }

    // Load vision bundle
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js';
    script.crossOrigin = 'anonymous';
    
    script.onload = () => {
      // Also need camera utils for processing
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


export class HairFilterEngine {
  constructor() {
    this.faceMesh = null;
    this.activeStyle = null;  // Current HAIR_STYLES entry
    this.hairImages = {};     // Preloaded Image objects keyed by style id
    this.isRunning = false;
    this.animFrameId = null;
    this.lastLandmarks = null;
    this.videoEl = null;
    this.canvasEl = null;
    this.ctx = null;
    this._initialized = false;
    this._initPromise = null;
    
    // Smoothing buffer for landmark positions (reduces jitter)
    this._smoothBuffer = [];
    this._smoothSize = 3;
  }

  /**
   * Initialize MediaPipe and preload all hair images
   */
  async init() {
    if (this._initialized) return;
    if (this._initPromise) return this._initPromise;
    
    this._initPromise = this._doInit();
    return this._initPromise;
  }
  
  async _doInit() {
    try {
      // Load MediaPipe
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
      
      // Set up results callback
      this.faceMesh.onResults((results) => {
        this._onFaceResults(results);
      });
      
      // Preload all hair images
      await this._preloadImages();
      
      this._initialized = true;
      logger.info('[HairFilterEngine] Initialized successfully');
    } catch (err) {
      logger.error('[HairFilterEngine] Initialization failed:', err);
      // Don't block the app — hair filters simply won't work
      this._initialized = false;
    }
  }
  
  /**
   * Preload all hair sprite images into Image objects
   */
  async _preloadImages() {
    const loadImage = (src) => new Promise((resolve) => {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => {
        logger.warn('[HairFilterEngine] Failed to load hair image:', src);
        resolve(null);
      };
      img.src = src;
    });
    
    const entries = Object.entries(HAIR_STYLES);
    const results = await Promise.all(entries.map(([id, style]) => loadImage(style.src)));
    
    entries.forEach(([id], idx) => {
      if (results[idx]) {
        this.hairImages[id] = results[idx];
      }
    });
    
    logger.info(`[HairFilterEngine] Preloaded ${Object.keys(this.hairImages).length}/${entries.length} hair images`);
  }
  
  /**
   * Set the active hair style (or null to disable)
   */
  setHairStyle(styleId) {
    if (styleId === null || styleId === 'none') {
      this.activeStyle = null;
      // Clear canvas if not running detection
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
   * Start the hair filter engine
   * @param {HTMLVideoElement} videoEl - The video source
   * @param {HTMLCanvasElement} canvasEl - Canvas overlay for drawing hair
   */
  start(videoEl, canvasEl) {
    if (!this._initialized || !this.faceMesh) {
      logger.warn('[HairFilterEngine] Not initialized, cannot start');
      return;
    }
    
    this.videoEl = videoEl;
    this.canvasEl = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.isRunning = true;
    
    // Match canvas size to video
    this._syncCanvasSize();
    
    // Start the render loop
    this._tick();
  }
  
  /**
   * Stop the engine and clean up
   */
  stop() {
    this.isRunning = false;
    
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    
    // Clear canvas
    if (this.ctx && this.canvasEl) {
      this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
    }
    
    this.lastLandmarks = null;
    this._smoothBuffer = [];
  }
  
  /**
   * Fully dispose the engine (call on unmount)
   */
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
  
  _syncCanvasSize() {
    if (!this.videoEl || !this.canvasEl) return;
    
    const vw = this.videoEl.videoWidth || this.videoEl.clientWidth;
    const vh = this.videoEl.videoHeight || this.videoEl.clientHeight;
    
    if (this.canvasEl.width !== vw || this.canvasEl.height !== vh) {
      this.canvasEl.width = vw;
      this.canvasEl.height = vh;
    }
  }
  
  async _tick() {
    if (!this.isRunning) return;
    
    try {
      this._syncCanvasSize();
      
      // Only run face detection when a hair style is active
      if (this.activeStyle && this.videoEl && this.videoEl.readyState >= 2) {
        await this.faceMesh.send({ image: this.videoEl });
      } else {
        // Clear canvas when no style active
        if (this.ctx && this.canvasEl) {
          this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
        }
      }
    } catch (err) {
      // Silent fail on individual frames
    }
    
    this.animFrameId = requestAnimationFrame(() => this._tick());
  }
  
  _onFaceResults(results) {
    if (!this.ctx || !this.canvasEl || !this.activeStyle) return;
    
    const { width, height } = this.canvasEl;
    this.ctx.clearRect(0, 0, width, height);
    
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      this.lastLandmarks = null;
      this._smoothBuffer = [];
      return;
    }
    
    const landmarks = results.multiFaceLandmarks[0];
    
    // Key landmark points (normalized 0-1 coordinates)
    const forehead = landmarks[FOREHEAD_TOP];
    const leftTemple = landmarks[LEFT_EYE_OUTER];
    const rightTemple = landmarks[RIGHT_EYE_OUTER];
    const leftEye = landmarks[LEFT_EYE_INNER];
    const rightEye = landmarks[RIGHT_EYE_INNER];
    
    if (!forehead || !leftTemple || !rightTemple) return;
    
    // Calculate face width from temples (in pixels)
    const faceWidth = Math.sqrt(
      Math.pow((rightTemple.x - leftTemple.x) * width, 2) +
      Math.pow((rightTemple.y - leftTemple.y) * height, 2)
    );
    
    // Calculate center of forehead (in pixels)
    const foreheadX = forehead.x * width;
    const foreheadY = forehead.y * height;
    
    // Calculate head tilt angle (from eye line)
    const angle = Math.atan2(
      (rightEye.y - leftEye.y) * height,
      (rightEye.x - leftEye.x) * width
    );
    
    // Smooth the values to reduce jitter
    const current = { foreheadX, foreheadY, faceWidth, angle };
    this._smoothBuffer.push(current);
    if (this._smoothBuffer.length > this._smoothSize) {
      this._smoothBuffer.shift();
    }
    
    const smoothed = this._getSmoothedValues();
    
    // Draw hair
    this._drawHair(smoothed);
  }
  
  _getSmoothedValues() {
    const buf = this._smoothBuffer;
    if (buf.length === 0) return { foreheadX: 0, foreheadY: 0, faceWidth: 100, angle: 0 };
    
    const sum = buf.reduce((acc, v) => ({
      foreheadX: acc.foreheadX + v.foreheadX,
      foreheadY: acc.foreheadY + v.foreheadY,
      faceWidth: acc.faceWidth + v.faceWidth,
      angle: acc.angle + v.angle,
    }), { foreheadX: 0, foreheadY: 0, faceWidth: 0, angle: 0 });
    
    return {
      foreheadX: sum.foreheadX / buf.length,
      foreheadY: sum.foreheadY / buf.length,
      faceWidth: sum.faceWidth / buf.length,
      angle: sum.angle / buf.length,
    };
  }
  
  _drawHair({ foreheadX, foreheadY, faceWidth, angle }) {
    const style = this.activeStyle;
    const img = this.hairImages[style.id];
    if (!img || !this.ctx) return;
    
    const ctx = this.ctx;
    
    // Calculate hair sprite dimensions
    const hairWidth = faceWidth * style.scaleMultiplier;
    const hairHeight = hairWidth * (img.height / img.width); // Maintain aspect ratio
    
    // Position: center on forehead, offset upward
    const drawX = foreheadX;
    const drawY = foreheadY + (faceWidth * style.offsetY);
    
    // Draw with rotation
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
