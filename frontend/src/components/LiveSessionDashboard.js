import React, { useState, useEffect } from 'react';
import { useSessionTracker } from '../hooks/useSessionTracker';
import { Waves, Navigation, Zap, Lock, Unlock, Pause, Play, Square, Trash2, X, AlertTriangle } from 'lucide-react';

const LiveSessionDashboard = ({ userId, spotId, selectedBoard, onEndSession }) => {
  const [status, setStatus] = useState('LOCKED'); // 'LOCKED' | 'UNLOCKED' | 'PAUSED'
  const isTracking = status !== 'PAUSED';
  const { metrics } = useSessionTracker(userId, spotId, isTracking);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  useEffect(() => {
    let interval;
    if (status !== 'PAUSED') {
      interval = setInterval(() => {
        setActiveSeconds(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [status]);

  const h = String(Math.floor(activeSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((activeSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(activeSeconds % 60)).padStart(2, '0');
  const displayTime = `${h}:${m}:${s}`;

  const handleFinish = () => onEndSession(metrics, selectedBoard, activeSeconds);
  
  const handleDiscard = () => {
    setShowConfirmModal(true);
  };

  const confirmDiscard = () => {
    setShowConfirmModal(false);
    onEndSession(null);
  };

  return (
    <div className="fixed inset-0 w-screen h-[100dvh] z-50 bg-black flex flex-col justify-between overflow-y-auto font-sans">
      {/* Desktop Fallback Close */}
      <button 
        onClick={handleDiscard}
        className="absolute top-6 right-6 z-50 p-2 text-white/50 hover:text-white hidden md:block bg-zinc-900/50 rounded-full"
        title="Exit Dashboard"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Background Pulse Effect */}
      <div className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-1000 ${status === 'PAUSED' ? 'opacity-5' : 'opacity-20'}`}>
        <div className={`w-[120vw] h-[120vw] rounded-full blur-3xl ${status === 'PAUSED' ? 'bg-yellow-500' : 'bg-cyan-500 animate-pulse'}`} style={{ animationDuration: '4s' }} />
      </div>

      <div className="relative z-10 pt-16 px-6 text-center">
        <p className={`font-bold uppercase tracking-widest text-sm mb-2 transition-colors ${status === 'PAUSED' ? 'text-yellow-400' : 'text-cyan-400'}`}>
          {status === 'PAUSED' ? 'Session Paused' : 'Live Tracking'}
        </p>
        <h1 className="text-white text-6xl md:text-7xl font-black tracking-tighter mb-8 font-mono">{displayTime}</h1>

        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-3xl p-6">
            <Navigation className={`w-6 h-6 mx-auto mb-3 ${status === 'PAUSED' ? 'text-zinc-500' : 'text-cyan-400'}`} />
            <p className="text-white text-4xl font-bold font-mono">{(metrics.distance / 1000).toFixed(2)}</p>
            <p className="text-zinc-500 text-sm font-semibold uppercase tracking-wider mt-1">KM</p>
          </div>
          <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-3xl p-6">
            <Waves className={`w-6 h-6 mx-auto mb-3 ${status === 'PAUSED' ? 'text-zinc-500' : 'text-blue-400'}`} />
            <p className="text-white text-4xl font-bold font-mono">{metrics.waveCount}</p>
            <p className="text-zinc-500 text-sm font-semibold uppercase tracking-wider mt-1">Waves</p>
          </div>
        </div>

        <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-3xl p-6 flex items-center justify-center gap-4">
          <Zap className={`w-6 h-6 ${status === 'PAUSED' ? 'text-zinc-500' : 'text-yellow-400'}`} />
          <div className="text-left">
            <p className="text-white text-3xl font-bold font-mono">{(metrics.topSpeed * 3.6).toFixed(1)} <span className="text-lg text-zinc-500">KM/H</span></p>
            <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider">Top Speed</p>
          </div>
        </div>
      </div>

      {/* Controls Container */}
      <div className="relative z-10 pb-8 px-6 mt-auto">
        {status === 'LOCKED' && (
          <div className="flex flex-col items-center animate-in fade-in slide-in-from-bottom-4">
            <button
              onClick={() => setStatus('UNLOCKED')}
              className="w-20 h-20 bg-zinc-800 border-2 border-zinc-600 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:border-cyan-400 transition-all shadow-xl"
              aria-label="Unlock"
            >
              <Lock className="w-8 h-8" />
            </button>
            <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest mt-4">Tap to Unlock</p>
          </div>
        )}

        {status === 'UNLOCKED' && (
          <div className="flex items-center justify-center gap-6 animate-in fade-in zoom-in-95">
            <button
              onClick={() => setStatus('PAUSED')}
              className="w-24 h-24 bg-yellow-500 hover:bg-yellow-400 rounded-full flex items-center justify-center text-zinc-900 transition-all shadow-[0_0_40px_rgba(234,179,8,0.3)]"
            >
              <Pause className="w-10 h-10 fill-current" />
            </button>
            <button
              onClick={() => setStatus('LOCKED')}
              className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400 hover:text-white transition-all"
            >
              <Unlock className="w-6 h-6" />
            </button>
          </div>
        )}

        {status === 'PAUSED' && (
          <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4">
            <div className="flex gap-4">
              <button
                onClick={() => setStatus('UNLOCKED')}
                className="flex-1 py-5 bg-zinc-800 hover:bg-zinc-700 rounded-2xl flex flex-col items-center justify-center gap-2 transition-all"
              >
                <Play className="w-6 h-6 text-green-400 fill-green-400" />
                <span className="text-white font-bold text-sm">Resume</span>
              </button>
              
              <button
                onClick={handleFinish}
                className="flex-1 py-5 bg-red-500 hover:bg-red-600 rounded-2xl flex flex-col items-center justify-center gap-2 transition-all shadow-[0_0_30px_rgba(239,68,68,0.4)]"
              >
                <Square className="w-6 h-6 text-white fill-white" />
                <span className="text-white font-bold text-sm">Finish</span>
              </button>
            </div>
            
            <button
              onClick={handleDiscard}
              className="w-full py-4 bg-transparent border border-zinc-800 rounded-2xl flex items-center justify-center gap-2 text-zinc-500 hover:bg-zinc-900 transition-all"
            >
              <Trash2 className="w-4 h-4" />
              <span className="text-sm font-semibold">Discard Session</span>
            </button>
          </div>
        )}
      </div>

      {/* Discard Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl w-full max-w-sm text-center animate-in zoom-in-95 shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Discard Session?</h2>
            <p className="text-zinc-400 text-sm mb-8">This cannot be undone. All tracked metrics and data will be permanently lost.</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowConfirmModal(false)} 
                className="flex-1 py-4 rounded-2xl bg-zinc-800 text-white font-semibold hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={confirmDiscard} 
                className="flex-1 py-4 rounded-2xl bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors shadow-[0_0_20px_rgba(239,68,68,0.3)]"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveSessionDashboard;
