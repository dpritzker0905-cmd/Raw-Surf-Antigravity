/**
 * IncomingCallModal — Full-screen overlay for INCOMING calls.
 * 
 * Ringer: Uses HTML Audio with generated WAV data URI.
 * No AudioContext needed — works reliably after any prior user gesture.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { PhoneOff, Phone, Video, PhoneIncoming } from 'lucide-react';
import { playRingtone } from '../../utils/audioUnlock';

export default function IncomingCallModal({ 
  callerName,
  callerAvatar,
  callType = 'audio',
  onAccept,
  onReject,
}) {
  const [anim, setAnim] = useState(false);
  const stopRingRef = useRef(null);

  // Animated pulse timing
  useEffect(() => {
    const t = setInterval(() => setAnim(prev => !prev), 1200);
    return () => clearInterval(t);
  }, []);

  // Play ringtone
  useEffect(() => {
    stopRingRef.current = playRingtone('incoming');
    return () => {
      if (stopRingRef.current) {
        stopRingRef.current();
        stopRingRef.current = null;
      }
    };
  }, []);

  // Auto-reject after 30 seconds
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (onReject) onReject();
    }, 30000);
    return () => clearTimeout(timeout);
  }, [onReject]);

  const handleAccept = useCallback(() => {
    if (stopRingRef.current) {
      stopRingRef.current();
      stopRingRef.current = null;
    }
    if (onAccept) onAccept();
  }, [onAccept]);

  const handleReject = useCallback(() => {
    if (stopRingRef.current) {
      stopRingRef.current();
      stopRingRef.current = null;
    }
    if (onReject) onReject();
  }, [onReject]);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{
        background: 'linear-gradient(135deg, #0a0e1a 0%, #0d1f3c 40%, #0a1628 100%)',
      }}
    >
      {/* Incoming call pulses */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className={`absolute w-48 h-48 rounded-full border-2 border-green-400/20 ${anim ? 'scale-100 opacity-100' : 'scale-110 opacity-0'} transition-all duration-700`} />
        <div className={`absolute w-56 h-56 rounded-full border border-green-400/10 ${!anim ? 'scale-100 opacity-100' : 'scale-110 opacity-0'} transition-all duration-700`} />
        <div className="absolute w-40 h-40 rounded-full border border-green-400/5 animate-ping" style={{ animationDuration: '2.5s' }} />
      </div>

      {/* "Incoming call" badge */}
      <div className="flex items-center gap-2 mb-6 px-4 py-2 bg-green-500/10 rounded-full border border-green-500/20 backdrop-blur-sm">
        <PhoneIncoming className="w-4 h-4 text-green-400 animate-bounce" style={{ animationDuration: '1.5s' }} />
        <span className="text-green-400 text-sm font-medium uppercase tracking-wider">
          Incoming {callType} call
        </span>
      </div>

      {/* Caller avatar */}
      <div className="relative mb-6">
        <div className="w-32 h-32 rounded-full overflow-hidden ring-4 ring-green-400/30 shadow-[0_0_60px_rgba(34,197,94,0.15)]">
          {callerAvatar ? (
            <img src={callerAvatar} className="w-full h-full object-cover" alt={callerName} />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <span className="text-4xl text-white font-bold">
                {callerName?.charAt(0)?.toUpperCase() || '?'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Caller name */}
      <h2 className="text-2xl font-semibold text-white mb-2">{callerName || 'Unknown'}</h2>
      <p className="text-gray-400 text-sm mb-20">is calling you…</p>

      {/* Accept / Reject buttons */}
      <div className="flex items-center gap-16">
        {/* Reject */}
        <button 
          onClick={handleReject} 
          className="group flex flex-col items-center gap-2"
          data-testid="reject-call-btn"
        >
          <div className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center shadow-lg shadow-red-500/30 transition-all hover:scale-110 active:scale-95">
            <PhoneOff className="w-7 h-7 text-white" />
          </div>
          <span className="text-red-400 text-xs font-medium">Decline</span>
        </button>

        {/* Accept */}
        <button 
          onClick={handleAccept} 
          className="group flex flex-col items-center gap-2"
          data-testid="accept-call-btn"
        >
          <div className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-400 flex items-center justify-center shadow-lg shadow-green-500/30 transition-all hover:scale-110 active:scale-95 animate-pulse" style={{ animationDuration: '2s' }}>
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
