/**
 * InCallView — Active call overlay with video displays and controls.
 * Shows remote video (fullscreen), local video (PIP), and call controls.
 */

import React, { useRef, useEffect, useState } from 'react';
import { 
  Mic, MicOff, Video, VideoOff, PhoneOff, 
  Volume2, Maximize2, Minimize2, Signal, SignalLow, SignalZero 
} from 'lucide-react';

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function ConnectionIndicator({ quality }) {
  const colors = {
    good: 'text-green-400',
    fair: 'text-yellow-400',
    poor: 'text-red-400',
  };
  const Icon = quality === 'poor' ? SignalZero : quality === 'fair' ? SignalLow : Signal;
  return <Icon className={`w-4 h-4 ${colors[quality] || colors.good}`} />;
}

export default function InCallView({
  callType = 'audio',
  localStream,
  remoteStream,
  isMuted = false,
  isCameraOff = false,
  callDuration = 0,
  remoteUserInfo = {},
  connectionQuality = 'good',
  onToggleMute,
  onToggleCamera,
  onEndCall,
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [isPipExpanded, setIsPipExpanded] = useState(false);

  // Attach local stream to video element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Attach remote stream to video element
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <div className="fixed inset-0 z-[9998] flex flex-col bg-black">
      {/* Remote Video / Audio Avatar */}
      <div className="flex-1 relative overflow-hidden">
        {callType === 'video' && remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          // Audio-only: show avatar + animated waveform
          <div className="w-full h-full flex flex-col items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #0a0e1a 0%, #0d1f3c 40%, #0a1628 100%)',
            }}
          >
            <div className="w-28 h-28 rounded-full overflow-hidden ring-4 ring-cyan-400/30 mb-4 shadow-[0_0_40px_rgba(6,182,212,0.15)]">
              {remoteUserInfo.avatar ? (
                <img src={remoteUserInfo.avatar} className="w-full h-full object-cover" alt="" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                  <span className="text-3xl text-white font-bold">
                    {remoteUserInfo.name?.charAt(0)?.toUpperCase() || '?'}
                  </span>
                </div>
              )}
            </div>
            <h3 className="text-white text-xl font-medium mb-1">{remoteUserInfo.name || 'User'}</h3>
            
            {/* Audio waveform animation */}
            <div className="flex items-center gap-1 mt-4">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-cyan-400 rounded-full animate-pulse"
                  style={{
                    height: `${12 + Math.random() * 20}px`,
                    animationDelay: `${i * 0.15}s`,
                    animationDuration: '0.8s',
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Top bar: duration + quality */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
          <div className="flex items-center gap-2">
            <ConnectionIndicator quality={connectionQuality} />
            <span className="text-white/80 text-xs font-mono">
              {formatDuration(callDuration)}
            </span>
          </div>
          <span className="text-white/60 text-xs">
            {callType === 'video' ? 'Video Call' : 'Audio Call'}
          </span>
        </div>

        {/* Local video PIP (video calls only) */}
        {callType === 'video' && localStream && (
          <div 
            className={`absolute transition-all duration-300 rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl cursor-pointer ${
              isPipExpanded 
                ? 'bottom-28 right-4 w-48 h-64' 
                : 'bottom-28 right-4 w-28 h-40'
            }`}
            onClick={() => setIsPipExpanded(!isPipExpanded)}
          >
            {isCameraOff ? (
              <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                <VideoOff className="w-6 h-6 text-gray-400" />
              </div>
            ) : (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover mirror"
                style={{ transform: 'scaleX(-1)' }}
              />
            )}
            <div className="absolute bottom-1 right-1">
              {isPipExpanded ? (
                <Minimize2 className="w-3 h-3 text-white/60" />
              ) : (
                <Maximize2 className="w-3 h-3 text-white/60" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Controls Bar */}
      <div className="flex items-center justify-center gap-6 py-6 px-4 bg-black/90 backdrop-blur-sm">
        {/* Mute */}
        <button
          onClick={onToggleMute}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 ${
            isMuted 
              ? 'bg-red-500/20 ring-2 ring-red-500/50' 
              : 'bg-white/10 hover:bg-white/20'
          }`}
          title={isMuted ? 'Unmute' : 'Mute'}
          data-testid="mute-toggle"
        >
          {isMuted ? (
            <MicOff className="w-6 h-6 text-red-400" />
          ) : (
            <Mic className="w-6 h-6 text-white" />
          )}
        </button>

        {/* Camera toggle (video calls only) */}
        {callType === 'video' && (
          <button
            onClick={onToggleCamera}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 ${
              isCameraOff 
                ? 'bg-red-500/20 ring-2 ring-red-500/50' 
                : 'bg-white/10 hover:bg-white/20'
            }`}
            title={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
            data-testid="camera-toggle"
          >
            {isCameraOff ? (
              <VideoOff className="w-6 h-6 text-red-400" />
            ) : (
              <Video className="w-6 h-6 text-white" />
            )}
          </button>
        )}

        {/* Speaker (placeholder) */}
        <button
          className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all hover:scale-110 active:scale-95"
          title="Speaker"
        >
          <Volume2 className="w-6 h-6 text-white" />
        </button>

        {/* End Call */}
        <button
          onClick={onEndCall}
          className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center shadow-lg shadow-red-500/30 transition-all hover:scale-110 active:scale-95"
          title="End call"
          data-testid="end-call-btn"
        >
          <PhoneOff className="w-7 h-7 text-white" />
        </button>
      </div>
    </div>
  );
}
