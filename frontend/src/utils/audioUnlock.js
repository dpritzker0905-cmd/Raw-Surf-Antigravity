/**
 * AudioUnlock — Ringtone manager using HTML Audio elements.
 * 
 * WHY HTML Audio instead of AudioContext:
 * - AudioContext requires a user gesture AND .resume() to work
 * - HTML Audio elements with data URIs work after ANY prior user gesture
 * - More reliable across Chrome, Safari, Firefox, and mobile browsers
 * 
 * FIRST-CALL FIX:
 * - We pre-generate WAV data URIs AND pre-create Audio objects on page load
 * - On first user gesture, we call .load() on each pre-created Audio
 * - This ensures the first call plays audio without delay
 */

// ── Generate a WAV file as a data URI from raw PCM samples ──────────
function generateWavDataUri(samples, sampleRate = 22050) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = samples.length * 2;
  const totalSize = 44 + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ── Generate ringtone samples ───────────────────────────────────────
function generateIncomingRing() {
  const sampleRate = 22050;
  const duration = 2.0;
  const samples = new Float32Array(sampleRate * duration);
  
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    let amplitude = 0;
    if (t < 0.4) amplitude = 0.25;
    else if (t >= 0.5 && t < 0.9) amplitude = 0.25;
    
    if (amplitude > 0) {
      samples[i] = amplitude * (
        Math.sin(2 * Math.PI * 440 * t) * 0.5 +
        Math.sin(2 * Math.PI * 480 * t) * 0.5
      );
    }
  }
  
  return generateWavDataUri(samples, sampleRate);
}

function generateRingbackTone() {
  const sampleRate = 22050;
  const duration = 3.0;
  const samples = new Float32Array(sampleRate * duration);
  
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    if (t < 1.0) {
      samples[i] = 0.12 * Math.sin(2 * Math.PI * 425 * t);
    }
  }
  
  return generateWavDataUri(samples, sampleRate);
}

// ── PRE-GENERATE on module load (runs once at import time) ──────────
const RING_URI = generateIncomingRing();
const RINGBACK_URI = generateRingbackTone();

// Pre-create Audio objects so they're decoded and ready
let preloadedRing = null;
let preloadedRingback = null;

try {
  preloadedRing = new Audio(RING_URI);
  preloadedRing.preload = 'auto';
  preloadedRing.load();
  
  preloadedRingback = new Audio(RINGBACK_URI);
  preloadedRingback.preload = 'auto';
  preloadedRingback.load();
} catch (e) {
  // Silent fail on SSR or restricted environments
}

/**
 * Play a ringtone. Returns a stop() function.
 * Uses pre-loaded HTML Audio elements for instant playback.
 */
export function playRingtone(type = 'incoming') {
  let stopped = false;
  let currentAudio = null;
  let intervalId = null;

  const uri = type === 'incoming' ? RING_URI : RINGBACK_URI;
  const interval = type === 'incoming' ? 2500 : 3500;
  const volume = type === 'incoming' ? 0.7 : 0.4;

  const playOnce = () => {
    if (stopped) return;
    try {
      // Create a fresh Audio each loop so overlapping doesn't cut off
      currentAudio = new Audio(uri);
      currentAudio.volume = volume;
      const p = currentAudio.play();
      if (p && p.catch) p.catch(() => {
        // If play fails, try vibration as fallback
        if (type === 'incoming' && navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
        }
      });
    } catch (e) {
      console.debug('[Ringtone] play error:', e);
    }
  };

  // Start immediately
  playOnce();
  intervalId = setInterval(playOnce, interval);

  // Vibration fallback on mobile (always try for incoming)
  let vibrateId = null;
  if (type === 'incoming' && navigator.vibrate) {
    navigator.vibrate([200, 100, 200, 500]);
    vibrateId = setInterval(() => {
      if (!stopped) navigator.vibrate([200, 100, 200, 500]);
    }, 2500);
  }

  return () => {
    stopped = true;
    clearInterval(intervalId);
    if (vibrateId) clearInterval(vibrateId);
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    if (navigator.vibrate) navigator.vibrate(0);
  };
}

/**
 * Unlock audio on user gesture — plays a silent audio to warm up the pipeline.
 * Also loads our pre-created Audio objects so they're ready for instant playback.
 */
export function unlockAudioNow() {
  try {
    // Play a tiny silent WAV to unlock the audio pipeline
    const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=');
    a.volume = 0;
    const p = a.play();
    if (p && p.then) p.then(() => a.pause()).catch(() => {});
    
    // Also prime our pre-loaded ringtones
    if (preloadedRing) {
      preloadedRing.volume = 0;
      const p2 = preloadedRing.play();
      if (p2 && p2.then) p2.then(() => { preloadedRing.pause(); preloadedRing.currentTime = 0; preloadedRing.volume = 0.7; }).catch(() => {});
    }
    if (preloadedRingback) {
      preloadedRingback.volume = 0;
      const p3 = preloadedRingback.play();
      if (p3 && p3.then) p3.then(() => { preloadedRingback.pause(); preloadedRingback.currentTime = 0; preloadedRingback.volume = 0.4; }).catch(() => {});
    }
  } catch (e) {
    // Silent fail
  }
}

/**
 * Install global listeners to unlock audio on first user gesture.
 * Call this once from App.js on mount.
 */
let listenersInstalled = false;
export function ensureAudioUnlocked() {
  if (listenersInstalled) return;
  listenersInstalled = true;

  const handler = () => {
    unlockAudioNow();
    ['click', 'touchstart', 'keydown'].forEach(e =>
      document.removeEventListener(e, handler, true)
    );
  };
  ['click', 'touchstart', 'keydown'].forEach(e =>
    document.addEventListener(e, handler, { capture: true, passive: true })
  );
}
