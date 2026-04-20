/**
 * AudioUnlock — Global audio context manager for ringtone playback.
 * 
 * Browsers block AudioContext until a user gesture occurs on the page.
 * This utility "unlocks" audio by creating and resuming an AudioContext
 * on the very first user interaction (click/tap/keydown), then keeps it
 * alive for the entire session so ringtones can play immediately.
 * 
 * Usage:
 *   import { getUnlockedAudioContext, ensureAudioUnlocked } from './audioUnlock';
 *   
 *   // Call once at app startup (e.g., in App.js):
 *   ensureAudioUnlocked();
 *   
 *   // Later, in any component that needs to play audio:
 *   const ctx = getUnlockedAudioContext();
 *   if (ctx) { // use oscillator, etc. }
 */

let globalAudioContext = null;
let isUnlocked = false;

/**
 * Get the global unlocked AudioContext (or null if not yet unlocked).
 */
export function getUnlockedAudioContext() {
  if (globalAudioContext && globalAudioContext.state === 'closed') {
    globalAudioContext = null;
    isUnlocked = false;
  }
  return globalAudioContext;
}

/**
 * Try to unlock audio NOW (e.g., called from a click handler).
 */
export function unlockAudioNow() {
  if (isUnlocked && globalAudioContext && globalAudioContext.state === 'running') return;
  
  try {
    if (!globalAudioContext) {
      globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    if (globalAudioContext.state === 'suspended') {
      globalAudioContext.resume().then(() => {
        isUnlocked = true;
        console.debug('[AudioUnlock] AudioContext resumed to:', globalAudioContext.state);
      }).catch(() => {});
    } else {
      isUnlocked = true;
    }
    
    // Play a silent buffer to fully activate the context
    const buffer = globalAudioContext.createBuffer(1, 1, 22050);
    const source = globalAudioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(globalAudioContext.destination);
    source.start(0);
  } catch (e) {
    console.debug('[AudioUnlock] Failed to unlock:', e);
  }
}

/**
 * Install global listeners that will unlock audio on first user interaction.
 * Safe to call multiple times — only installs once.
 */
let listenersInstalled = false;
export function ensureAudioUnlocked() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  
  const events = ['click', 'touchstart', 'keydown'];
  const handler = () => {
    unlockAudioNow();
    // Remove listeners after first unlock
    if (isUnlocked) {
      events.forEach(e => document.removeEventListener(e, handler, true));
      console.debug('[AudioUnlock] Listeners removed — audio unlocked');
    }
  };
  
  events.forEach(e => document.addEventListener(e, handler, { capture: true, passive: true }));
  console.debug('[AudioUnlock] Listeners installed — waiting for first user gesture');
}

/**
 * Play a ringtone using the unlocked AudioContext.
 * Returns a stop() function to cancel the ring.
 * Falls back to Vibration API if audio is unavailable.
 */
export function playRingtone(type = 'incoming') {
  const ctx = getUnlockedAudioContext();
  let intervalId = null;
  let stopped = false;

  const playOnce = () => {
    if (stopped || !ctx || ctx.state === 'closed') return;
    
    // Try to resume if suspended
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    
    try {
      if (type === 'incoming') {
        // Dual-tone ring: 440Hz + 480Hz
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.frequency.value = 440;
        osc2.frequency.value = 480;
        gain.gain.value = 0.15;
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc1.start(ctx.currentTime);
        osc2.start(ctx.currentTime);
        osc1.stop(ctx.currentTime + 0.4);
        osc2.stop(ctx.currentTime + 0.4);
        // Second burst
        const osc3 = ctx.createOscillator();
        const osc4 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc3.frequency.value = 440;
        osc4.frequency.value = 480;
        gain2.gain.value = 0.15;
        osc3.connect(gain2);
        osc4.connect(gain2);
        gain2.connect(ctx.destination);
        osc3.start(ctx.currentTime + 0.5);
        osc4.start(ctx.currentTime + 0.5);
        osc3.stop(ctx.currentTime + 0.9);
        osc4.stop(ctx.currentTime + 0.9);
      } else {
        // Ringback: single 425Hz tone
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 425;
        gain.gain.value = 0.08;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 1.0);
      }
    } catch (e) {
      console.debug('[AudioUnlock] Ring playback error:', e);
    }
  };

  // Start ringing
  playOnce();
  const interval = type === 'incoming' ? 2500 : 3000;
  intervalId = setInterval(playOnce, interval);

  // Vibration fallback for mobile
  if (navigator.vibrate) {
    const vibratePattern = type === 'incoming' ? [200, 100, 200, 500] : [100, 200];
    const vibrateInterval = setInterval(() => {
      if (!stopped) navigator.vibrate(vibratePattern);
    }, interval);
    
    return () => {
      stopped = true;
      clearInterval(intervalId);
      clearInterval(vibrateInterval);
      navigator.vibrate(0); // Stop vibration
    };
  }

  return () => {
    stopped = true;
    clearInterval(intervalId);
  };
}

export default { getUnlockedAudioContext, ensureAudioUnlocked, unlockAudioNow, playRingtone };
