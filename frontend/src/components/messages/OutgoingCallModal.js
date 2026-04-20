/**
 * OutgoingCallModal — Full-screen overlay shown to the CALLER while ringing.
 * Displays "Calling..." with the target's info and a Cancel button.
 * 
 * Uses a generated WAV ringback tone via HTML Audio element for maximum
 * browser compatibility (Web Audio API requires user gesture to unmute).
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { PhoneOff, Phone, Video } from 'lucide-react';

// ── Generate a ringback tone as a WAV data URI ──────────────────────
// Standard 425Hz ringback tone: 1s on, 2s off
function generateRingbackWAV() {
  const sampleRate = 44100;
  const duration = 1.0; // 1 second of tone (silence handled by loop gap)
  const numSamples = Math.floor(sampleRate * duration);
  
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  
  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(view, 8, 'WAVE');
  
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, numSamples * 2, true);
  
  // Generate 425Hz tone (softer than incoming ring)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const amplitude = 0.08 * Math.sin(2 * Math.PI * 425 * t);
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

let ringbackUrl = null;
function getRingbackUrl() {
  if (!ringbackUrl) ringbackUrl = generateRingbackWAV();
  return ringbackUrl;
}

export default function OutgoingCallModal({ 
  targetName, 
  targetAvatar, 
  callType = 'audio',
  onCancel,
}) {
  const [dots, setDots] = useState('');
  const audioRef = useRef(null);
  const intervalRef = useRef(null);

  // Animated "Calling..." dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 600);
    return () => clearInterval(interval);
  }, []);

  // Auto-cancel after 30 seconds (no answer)
  useEffect(() => {
    const timeout = setTimeout(() => {
      onCancel?.();
    }, 30000);
    return () => clearTimeout(timeout);
  }, [onCancel]);

  // Play ringback tone using HTML Audio element
  useEffect(() => {
    const url = getRingbackUrl();
    const audio = new Audio(url);
    audio.volume = 0.3;
    audioRef.current = audio;

    const playOnce = () => {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    };

    // Play immediately, then repeat every 3s (1s tone + 2s silence)
    playOnce();
    intervalRef.current = setInterval(playOnce, 3000);
    
    return () => {
      clearInterval(intervalRef.current);
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, []);

  const handleCancel = useCallback(() => {
    clearInterval(intervalRef.current);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    onCancel?.();
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{
        background: 'linear-gradient(135deg, #0a0e1a 0%, #0d1f3c 40%, #0a1628 100%)',
      }}
    >
      {/* Subtle outgoing pulse */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="absolute w-48 h-48 rounded-full border-2 border-cyan-400/15 animate-ping" 
          style={{ animationDuration: '3s' }} />
        <div className="absolute w-64 h-64 rounded-full border border-cyan-400/10 animate-ping" 
          style={{ animationDuration: '3.5s', animationDelay: '0.5s' }} />
      </div>

      {/* Call type indicator */}
      <div className="flex items-center gap-2 mb-6 px-4 py-2 bg-white/5 rounded-full backdrop-blur-sm">
        {callType === 'video' ? (
          <Video className="w-4 h-4 text-cyan-400" />
        ) : (
          <Phone className="w-4 h-4 text-cyan-400" />
        )}
        <span className="text-cyan-400 text-sm font-medium uppercase tracking-wider">
          {callType} call
        </span>
      </div>

      {/* Target avatar */}
      <div className="relative mb-6">
        <div className="w-32 h-32 rounded-full overflow-hidden ring-4 ring-cyan-400/20 shadow-[0_0_40px_rgba(6,182,212,0.1)]">
          {targetAvatar ? (
            <img src={targetAvatar} className="w-full h-full object-cover" alt={targetName} />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <span className="text-4xl text-white font-bold">
                {targetName?.charAt(0)?.toUpperCase() || '?'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Target name */}
      <h2 className="text-2xl font-semibold text-white mb-2">{targetName || 'User'}</h2>
      <p className="text-gray-400 text-sm mb-16">
        Calling{dots}<span className="invisible">...</span>
      </p>

      {/* Cancel button */}
      <button
        onClick={handleCancel}
        className="group flex flex-col items-center gap-2"
        data-testid="cancel-call-btn"
      >
        <div className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center shadow-lg shadow-red-500/30 transition-all hover:scale-110 active:scale-95">
          <PhoneOff className="w-7 h-7 text-white" />
        </div>
        <span className="text-red-400 text-xs font-medium">Cancel</span>
      </button>
    </div>
  );
}
