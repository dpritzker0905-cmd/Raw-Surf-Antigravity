/**
 * IncomingCallModal — Full-screen overlay for incoming audio/video calls.
 * Shows caller info, ringing animation, and accept/decline buttons.
 */

import React, { useEffect, useRef } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';

export default function IncomingCallModal({ 
  callerName, 
  callerAvatar, 
  callType = 'audio', // 'audio' | 'video'
  onAccept, 
  onDecline 
}) {
  const ringIntervalRef = useRef(null);
  const audioContextRef = useRef(null);
  
  // Auto-decline after 30 seconds
  useEffect(() => {
    const timeout = setTimeout(() => {
      onDecline?.();
    }, 30000);
    return () => clearTimeout(timeout);
  }, [onDecline]);

  // Play ringtone sound using Web Audio API
  useEffect(() => {
    let intervalId = null;
    
    const startRinging = async () => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = ctx;
        
        // CRITICAL: Resume AudioContext — browsers suspend it until user gesture.
        // On first-ever call the context may be suspended. We must try to resume.
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }
        
        const playRing = async () => {
          if (ctx.state === 'closed') return;
          // Resume again in case it got re-suspended
          if (ctx.state === 'suspended') {
            await ctx.resume().catch(() => {});
          }
          // Two-tone ring: 440Hz then 480Hz
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
          // Second ring after brief pause
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
        };
        
        playRing(); // Play immediately
        intervalId = setInterval(playRing, 2500); // Ring every 2.5s
        ringIntervalRef.current = intervalId;
      } catch (e) {
        console.debug('[IncomingCall] Audio ring failed:', e);
      }
    };
    
    startRinging();
    
    return () => {
      clearInterval(intervalId);
      clearInterval(ringIntervalRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

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
        <div className="absolute inset-0 rounded-full border-2 border-cyan-400/40 animate-pulse" />
      </div>

      {/* Caller name */}
      <h2 className="text-2xl font-semibold text-white mb-2">{callerName || 'Unknown'}</h2>
      <p className="text-gray-400 text-sm mb-16 animate-pulse">Ringing...</p>

      {/* Accept / Decline buttons */}
      <div className="flex items-center gap-16">
        {/* Decline */}
        <button
          onClick={onDecline}
          className="group flex flex-col items-center gap-2"
          data-testid="decline-call-btn"
        >
          <div className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center shadow-lg shadow-red-500/30 transition-all hover:scale-110 active:scale-95">
            <PhoneOff className="w-7 h-7 text-white" />
          </div>
          <span className="text-red-400 text-xs font-medium">Decline</span>
        </button>

        {/* Accept */}
        <button
          onClick={onAccept}
          className="group flex flex-col items-center gap-2"
          data-testid="accept-call-btn"
        >
          <div className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-400 flex items-center justify-center shadow-lg shadow-green-500/30 transition-all hover:scale-110 active:scale-95 animate-bounce"
            style={{ animationDuration: '1.5s' }}
          >
            {callType === 'video' ? (
              <Video className="w-7 h-7 text-white" />
            ) : (
              <Phone className="w-7 h-7 text-white" />
            )}
          </div>
          <span className="text-green-400 text-xs font-medium">Accept</span>
        </button>
      </div>
    </div>
  );
}
