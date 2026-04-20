/**
 * OutgoingCallModal — Full-screen overlay shown to the CALLER while ringing.
 * 
 * Uses HTML Audio with generated WAV for ringback tone.
 * User already clicked "Call", so the gesture requirement is satisfied.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { PhoneOff, Phone, Video } from 'lucide-react';
import { playRingtone } from '../../utils/audioUnlock';

export default function OutgoingCallModal({ 
  targetName, 
  targetAvatar, 
  callType = 'audio',
  onCancel,
}) {
  const [dots, setDots] = useState('');
  const stopRingRef = useRef(null);

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
      if (onCancel) onCancel();
    }, 30000);
    return () => clearTimeout(timeout);
  }, [onCancel]);

  // Play ringback tone
  useEffect(() => {
    stopRingRef.current = playRingtone('ringback');
    return () => {
      if (stopRingRef.current) {
        stopRingRef.current();
        stopRingRef.current = null;
      }
    };
  }, []);

  const handleCancel = useCallback(() => {
    if (stopRingRef.current) {
      stopRingRef.current();
      stopRingRef.current = null;
    }
    if (onCancel) onCancel();
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
