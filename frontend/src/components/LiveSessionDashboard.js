import React, { useState, useEffect } from 'react';
import { useSessionTracker } from '../hooks/useSessionTracker';
import { Waves, Navigation, Zap, Lock, Unlock, StopCircle } from 'lucide-react';

const LiveSessionDashboard = ({ userId, spotId, selectedBoard, onEndSession }) => {
  const [isLocked, setIsLocked] = useState(true);
  const [tracking, setTracking] = useState(true);
  const { metrics } = useSessionTracker(userId, spotId, tracking);
  const [elapsed, setElapsed] = useState('00:00:00');

  useEffect(() => {
    if (!metrics.startTime) return;
    const interval = setInterval(() => {
      const ms = Date.now() - new Date(metrics.startTime).getTime();
      const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
      const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
      const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
      setElapsed(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [metrics.startTime]);

  const handleEnd = () => {
    if (isLocked) return;
    setTracking(false);
    onEndSession(metrics, selectedBoard);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between overflow-hidden">
      {/* Background Pulse Effect */}
      <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
        <div className="w-[120vw] h-[120vw] rounded-full bg-cyan-500 blur-3xl animate-pulse" style={{ animationDuration: '4s' }} />
      </div>

      <div className="relative z-10 pt-16 px-6 text-center">
        <p className="text-cyan-400 font-bold uppercase tracking-widest text-sm mb-2">Live Tracking</p>
        <h1 className="text-white text-6xl font-black tracking-tighter mb-8 font-mono">{elapsed}</h1>

        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-3xl p-6">
            <Navigation className="w-6 h-6 text-cyan-400 mx-auto mb-3" />
            <p className="text-white text-4xl font-bold font-mono">{(metrics.distance / 1000).toFixed(2)}</p>
            <p className="text-zinc-500 text-sm font-semibold uppercase tracking-wider mt-1">KM</p>
          </div>
          <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-3xl p-6">
            <Waves className="w-6 h-6 text-blue-400 mx-auto mb-3" />
            <p className="text-white text-4xl font-bold font-mono">{metrics.waveCount}</p>
            <p className="text-zinc-500 text-sm font-semibold uppercase tracking-wider mt-1">Waves</p>
          </div>
        </div>

        <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-3xl p-6 flex items-center justify-center gap-4">
          <Zap className="w-6 h-6 text-yellow-400" />
          <div className="text-left">
            <p className="text-white text-3xl font-bold font-mono">{(metrics.topSpeed * 3.6).toFixed(1)} <span className="text-lg text-zinc-500">KM/H</span></p>
            <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider">Top Speed</p>
          </div>
        </div>
      </div>

      {/* Lock/Unlock controls */}
      <div className="relative z-10 pb-12 px-8">
        <div className="flex flex-col items-center gap-6">
          <button
            onClick={() => setIsLocked(!isLocked)}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${isLocked ? 'bg-zinc-800 text-zinc-400 border-2 border-zinc-700' : 'bg-cyan-500 text-white shadow-[0_0_30px_rgba(6,182,212,0.5)]'}`}
          >
            {isLocked ? <Lock className="w-6 h-6" /> : <Unlock className="w-6 h-6" />}
          </button>
          
          <button
            onClick={handleEnd}
            disabled={isLocked}
            className={`w-full py-5 rounded-2xl flex items-center justify-center gap-2 font-bold text-lg transition-all ${isLocked ? 'bg-zinc-900 text-zinc-600 border border-zinc-800' : 'bg-red-500 text-white shadow-[0_0_30px_rgba(239,68,68,0.5)]'}`}
          >
            <StopCircle className="w-6 h-6" />
            {isLocked ? 'Unlock to End' : 'End Session'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LiveSessionDashboard;
