/**
 * AudioUnlock — Ringtone manager using HTML Audio elements.
 * 
 * WHY HTML Audio instead of AudioContext:
 * - AudioContext requires a user gesture AND .resume() to work
 * - HTML Audio elements with data URIs work after ANY prior user gesture
 * - More reliable across Chrome, Safari, Firefox, and mobile browsers
 * - The user clicking "Call" or any UI element counts as the gesture
 * 
 * This module generates small WAV files in-memory as base64 data URIs,
 * then plays them using new Audio(). No network requests needed.
 */

// ── Generate a WAV file as a data URI from raw PCM samples ──────────
function generateWavDataUri(samples, sampleRate = 22050) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = samples.length * 2; // 16-bit = 2 bytes per sample
  const totalSize = 44 + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  // Convert to base64
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
  const duration = 2.0; // 2 seconds: ring-ring-pause
  const samples = new Float32Array(sampleRate * duration);
  
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    
    // Two bursts: 0-0.4s and 0.5-0.9s, then silence
    let amplitude = 0;
    if (t < 0.4) {
      amplitude = 0.25;
    } else if (t >= 0.5 && t < 0.9) {
      amplitude = 0.25;
    }
    
    if (amplitude > 0) {
      // Dual-tone: 440Hz + 480Hz (standard US ring)
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
  const duration = 3.0; // 3 seconds: 1s tone, 2s silence
  const samples = new Float32Array(sampleRate * duration);
  
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    
    // Ringback: 1s tone, 2s silence
    if (t < 1.0) {
      samples[i] = 0.12 * Math.sin(2 * Math.PI * 425 * t);
    }
  }
  
  return generateWavDataUri(samples, sampleRate);
}

// ── Pre-generate the WAV data URIs ──────────────────────────────────
let incomingRingUri = null;
let ringbackUri = null;

function getIncomingRingUri() {
  if (!incomingRingUri) incomingRingUri = generateIncomingRing();
  return incomingRingUri;
}

function getRingbackUri() {
  if (!ringbackUri) ringbackUri = generateRingbackTone();
  return ringbackUri;
}

/**
 * Play a ringtone. Returns a stop() function.
 * Uses HTML Audio element with generated WAV — most reliable cross-browser.
 */
export function playRingtone(type = 'incoming') {
  let stopped = false;
  let currentAudio = null;
  let intervalId = null;

  const uri = type === 'incoming' ? getIncomingRingUri() : getRingbackUri();
  const interval = type === 'incoming' ? 2500 : 3500;

  const playOnce = () => {
    if (stopped) return;
    try {
      currentAudio = new Audio(uri);
      currentAudio.volume = type === 'incoming' ? 0.7 : 0.4;
      const p = currentAudio.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {
      console.debug('[Ringtone] play error:', e);
    }
  };

  // Start immediately
  playOnce();
  intervalId = setInterval(playOnce, interval);

  // Vibration fallback on mobile
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
 * Unlock audio on user gesture. Call this from click handlers.
 * For HTML Audio approach, this creates and plays a silent audio to "warm up".
 */
export function unlockAudioNow() {
  try {
    const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=');
    a.volume = 0;
    const p = a.play();
    if (p && p.then) p.then(() => a.pause()).catch(() => {});
  } catch (e) {
    // Silent fail
  }
}

/**
 * Install global listeners to unlock audio on first user gesture.
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
