/**
 * IncomingCallModal — Full-screen overlay for incoming audio/video calls.
 * Shows caller info, ringing animation, and accept/decline buttons.
 * 
 * Uses a generated WAV ringtone via HTML Audio element for maximum
 * browser compatibility (Web Audio API requires user gesture to unmute).
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';

// ── Generate a simple ringtone as a WAV data URI ────────────────────
// This creates a dual-tone ring (440Hz + 480Hz) in a WAV file.
// Much more reliable than Web Audio API which requires prior user gesture.
function generateRingtoneWAV() {
  const sampleRate = 44100;
  const duration = 1.0; // 1 second total
  const numSamples = Math.floor(sampleRate * duration);
  
  // WAV file header
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  
  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(view, 8, 'WAVE');
  
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);  // block align
  view.setUint16(34, 16, true); // bits per sample
  
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, numSamples * 2, true);
  
  // Generate dual-tone signal
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Ring pattern: 0-0.4s ON, 0.4-0.5s OFF, 0.5-0.9s ON, 0.9-1.0s OFF
    let amplitude = 0;
    if (t < 0.4 || (t >= 0.5 && t < 0.9)) {
      // Dual-tone: 440Hz + 480Hz (standard phone ring)
      amplitude = 0.15 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t));
    }
    const sample = Math.max(-1, Math.min(1, amplitude));
    view.setInt16(44 + i * 2, sample * 0x7FFF, true);
  }
  
  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// Generate once at module level
let ringtoneUrl = null;
function getRingtoneUrl() {
  if (!ringtoneUrl) ringtoneUrl = generateRingtoneWAV();
  return ringtoneUrl;
}

export default function IncomingCallModal({ 
  callerName, 
  callerAvatar, 
  callType = 'audio', // 'audio' | 'video'
  onAccept, 
  onDecline 
}) {
  const audioRef = useRef(null);
  
  // Auto-decline after 30 seconds
  useEffect(() => {
    const timeout = setTimeout(() => {
      onDecline?.();
    }, 30000);
    return () => clearTimeout(timeout);
  }, [onDecline]);

  // Play ringtone using HTML Audio element (much more reliable than Web Audio API)
  useEffect(() => {
    const url = getRingtoneUrl();
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.5;
    audioRef.current = audio;
    
    // Play immediately — HTML Audio is more permissive than AudioContext
    audio.play().catch((e) => {
      console.debug('[IncomingCall] Audio play blocked, will retry on interaction:', e);
      // Fallback: try to play on any user interaction
      const unlock = () => {
        audio.play().catch(() => {});
        document.removeEventListener('click', unlock);
        document.removeEventListener('touchstart', unlock);
      };
      document.addEventListener('click', unlock, { once: true });
      document.addEventListener('touchstart', unlock, { once: true });
    });
    
    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, []);

  const handleAccept = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    onAccept?.();
  }, [onAccept]);

  const handleDecline = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    onDecline?.();
  }, [onDecline]);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{
        background: 'linear-gradient(135deg, #0a0e1a 0%, #0d1f3c 40%, #0a1628 100%)',
      }}
    >
      {/* Animated ring pulses */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="absolute w-48 h-48 rounded-full border-2 border-cyan-400/20 animate-ping" 
          style={{ animationDuration: '2s' }} />
        <div className="absolute w-64 h-64 rounded-full border border-cyan-400/10 animate-ping" 
          style={{ animationDuration: '2.5s', animationDelay: '0.5s' }} />
        <div className="absolute w-80 h-80 rounded-full border border-cyan-400/5 animate-ping" 
          style={{ animationDuration: '3s', animationDelay: '1s' }} />
      </div>

      {/* Call type indicator */}
      <div className="flex items-center gap-2 mb-6 px-4 py-2 bg-white/5 rounded-full backdrop-blur-sm">
        {callType === 'video' ? (
          <Video className="w-4 h-4 text-cyan-400" />
        ) : (
          <Phone className="w-4 h-4 text-cyan-400" />
        )}
        <span className="text-cyan-400 text-sm font-medium uppercase tracking-wider">
          Incoming {callType} call
        </span>
      </div>

      {/* Caller avatar */}
      <div className="relative mb-6">
        <div className="w-32 h-32 rounded-full overflow-hidden ring-4 ring-cyan-400/30 shadow-[0_0_60px_rgba(6,182,212,0.15)]">
          {callerAvatar ? (
            <img src={callerAvatar} className="w-full h-full object-cover" alt={callerName} />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <span className="text-4xl text-white font-bold">
                {callerName?.charAt(0)?.toUpperCase() || '?'}
              </span>
            </div>
          )}
        </div>
        {/* Animated glow ring */}
        <div className="absolute -inset-2 rounded-full border-2 border-cyan-400/30 animate-pulse" />
      </div>

      {/* Caller name */}
      <h2 className="text-white text-2xl font-bold mb-2">{callerName || 'Unknown Caller'}</h2>
      <p className="text-white/40 text-sm mb-10">Incoming {callType} call...</p>

      {/* Accept / Decline buttons */}
      <div className="flex items-center gap-10">
        {/* Decline */}
        <div className="flex flex-col items-center gap-2">
          <button 
            onClick={handleDecline}
            className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 hover:bg-red-400 transition-all active:scale-95"
          >
            <PhoneOff className="w-7 h-7 text-white" />
          </button>
          <span className="text-white/50 text-xs">Decline</span>
        </div>

        {/* Accept */}
        <div className="flex flex-col items-center gap-2">
          <button 
            onClick={handleAccept}
            className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center shadow-lg shadow-green-500/30 hover:bg-green-400 transition-all active:scale-95 animate-bounce"
            style={{ animationDuration: '1.5s' }}
          >
            {callType === 'video' ? (
              <Video className="w-7 h-7 text-white" />
            ) : (
              <Phone className="w-7 h-7 text-white" />
            )}
          </button>
          <span className="text-white/50 text-xs">Accept</span>
        </div>
      </div>
    </div>
  );
}
