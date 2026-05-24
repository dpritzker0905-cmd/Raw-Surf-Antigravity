import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play, Pause, SkipBack, SkipForward, Clock, Cpu, ShieldAlert, CheckCircle, AlertTriangle, FastForward, Info
} from 'lucide-react';
import apiClient from '../../lib/apiClient';
import { toast } from 'sonner';

interface ReplayEvent {
  event_id: string;
  event_type: string;
  payload: string;
  timestamp: string;
  source_mcp: string;
  correlation_id: string;
}

export const EventReplayEngine: React.FC = () => {
  const [correlationId, setCorrelationId] = useState<string>('');
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1000); // ms delay
  const [mode, setMode] = useState<'view' | 'simulation'>('view'); // sandbox flag

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchTrace = useCallback(async (cId: string) => {
    if (!cId) return;
    try {
      setLoading(true);
      const res = await apiClient.get(`/admin/event-dashboard/trace/${cId}`);
      if (res.data?.success && res.data.trace?.length > 0) {
        setEvents(res.data.trace);
        setCurrentIndex(0);
        setIsPlaying(false);
      } else {
        toast.error('No events found for this correlation ID.');
        setEvents([]);
        setCurrentIndex(-1);
      }
    } catch (err) {
      toast.error('Failed to load trace for replay.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTrace(correlationId);
  };

  const handlePlayToggle = () => {
    if (events.length === 0) return;
    setIsPlaying(!isPlaying);
  };

  const stepForward = useCallback(() => {
    if (currentIndex < events.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setIsPlaying(false);
      toast.success('Replay sequence complete!');
    }
  }, [currentIndex, events.length]);

  const stepBackward = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const resetReplay = () => {
    setCurrentIndex(0);
    setIsPlaying(false);
  };

  // Playback animation effect
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setTimeout(() => {
        stepForward();
      }, playbackSpeed);
    } else if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, currentIndex, playbackSpeed, stepForward]);

  const currentEvent = currentIndex >= 0 && currentIndex < events.length ? events[currentIndex] : null;
  let parsedPayload: any = {};
  if (currentEvent) {
    try {
      parsedPayload = JSON.parse(currentEvent.payload);
    } catch (e) {}
  }

  const isAnomaly = (type: string) => {
    return type.includes('error') || type.includes('fail') || type.includes('reject');
  };

  return (
    <div className="bg-[#0f172a]/80 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-cyan-400" />
            Event Replay Engine (Read-Only + Sandbox)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Reconstruct and step-through historical event chains chronologically to diagnose past system states.
          </p>
        </div>

        {/* View / Sim mode toggle */}
        <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-900 self-start md:self-auto">
          <button
            onClick={() => setMode('view')}
            className={`text-[10px] font-bold px-3 py-1 rounded transition-all uppercase tracking-wider ${
              mode === 'view'
                ? 'bg-cyan-500 text-slate-950 font-extrabold'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            View Mode
          </button>
          <button
            onClick={() => setMode('simulation')}
            className={`text-[10px] font-bold px-3 py-1 rounded transition-all uppercase tracking-wider ${
              mode === 'simulation'
                ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 font-extrabold'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Sandbox Replay
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Playback Console Interface */}
        <div className="lg:col-span-2 space-y-4">
          {/* Main Display screen */}
          <div className="bg-slate-950 border border-slate-900 rounded-xl p-5 flex flex-col justify-between min-h-[380px] shadow-inner relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 blur-[50px] rounded-full pointer-events-none" />

            {/* Header: trace label */}
            <div className="flex justify-between items-center z-10">
              <span className="text-[9px] font-mono font-bold text-slate-500 uppercase tracking-widest block">
                {mode === 'simulation' ? 'Sandbox Simulation Screen' : 'Replay Projection Console'}
              </span>
              {mode === 'simulation' && (
                <span className="text-[8px] bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded uppercase font-bold tracking-wider">
                  Zero writes sandbox
                </span>
              )}
            </div>

            {loading ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 z-10">
                <Clock className="w-10 h-10 animate-spin text-cyan-400 mb-2" />
                <span className="text-xs text-slate-400 font-semibold font-mono">Caching event frame sequence...</span>
              </div>
            ) : events.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 z-10">
                <FastForward className="w-12 h-12 text-slate-800 mb-3" />
                <h4 className="text-slate-400 font-semibold text-xs mb-1">No Active Sequence Loaded</h4>
                <p className="text-[10px] text-slate-500 max-w-xs">
                  Enter an event trace correlation ID to initialize the chronological stepping ledger.
                </p>
                <form onSubmit={handleSearchSubmit} className="flex gap-2 mt-4 max-w-sm w-full">
                  <input
                    type="text"
                    placeholder="Enter corr_..."
                    value={correlationId}
                    onChange={(e) => setCorrelationId(e.target.value)}
                    className="bg-slate-900 border border-slate-800 text-xs px-3 py-1.5 rounded text-slate-200 focus:outline-none focus:border-cyan-500 flex-1"
                  />
                  <button
                    type="submit"
                    className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold px-3 py-1.5 rounded transition-all"
                  >
                    Load
                  </button>
                </form>
              </div>
            ) : currentEvent ? (
              <div className="flex-1 flex flex-col justify-between py-4 z-10 space-y-4">
                {/* Visual Event status card */}
                <div className={`p-4 border rounded-xl shadow-lg transition-all duration-300 ${
                  isAnomaly(currentEvent.event_type)
                    ? 'bg-red-500/5 border-red-500/30'
                    : 'bg-slate-900/40 border-slate-800/80'
                }`}>
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                        isAnomaly(currentEvent.event_type)
                          ? 'bg-red-500/10 text-red-400 border-red-500/20'
                          : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                      }`}>
                        {currentEvent.event_type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[9px] font-mono text-slate-500 block mt-1.5">ID: {currentEvent.event_id}</span>
                    </div>

                    <div className="text-right text-[10px] text-slate-500 font-mono">
                      <div>Step {currentIndex + 1} of {events.length}</div>
                      <div className="mt-1">{new Date(currentEvent.timestamp).toLocaleTimeString()}</div>
                    </div>
                  </div>

                  {/* Render Payload properties */}
                  <div className="mt-3 bg-slate-950/80 rounded-lg p-3 border border-slate-900/80 font-mono text-[9px] max-h-[140px] overflow-y-auto scrollbar-thin">
                    {Object.entries(parsedPayload).map(([key, val]) => (
                      <div key={key} className="flex justify-between py-0.5 border-b border-slate-950/50 hover:bg-slate-900/10">
                        <span className="text-slate-500 mr-4 font-bold">{key}</span>
                        <span className="text-slate-300 truncate max-w-[240px]">
                          {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Progress bar scrub indicator */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] font-mono text-slate-500">
                    <span>Sequence Progress</span>
                    <span>{Math.round(((currentIndex + 1) / events.length) * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-900 border border-slate-850 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 rounded-full ${
                        isAnomaly(currentEvent.event_type) ? 'bg-red-500' : 'bg-cyan-500'
                      }`}
                      style={{ width: `${((currentIndex + 1) / events.length) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {/* Bottom Controls Bar */}
            {events.length > 0 && (
              <div className="border-t border-slate-900/60 pt-4 flex flex-col sm:flex-row items-center justify-between gap-4 z-10">
                <div className="flex items-center gap-2">
                  <button
                    onClick={resetReplay}
                    disabled={currentIndex === 0}
                    className="p-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded disabled:opacity-40 text-slate-300 transition-all"
                    title="Reset Replay"
                  >
                    <SkipBack className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={stepBackward}
                    disabled={currentIndex <= 0}
                    className="p-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded disabled:opacity-40 text-slate-300 transition-all"
                    title="Step Backward"
                  >
                    <SkipForward className="w-3.5 h-3.5 rotate-180" />
                  </button>
                  <button
                    onClick={handlePlayToggle}
                    className="p-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-full font-bold shadow-lg shadow-cyan-500/10 transition-all"
                    title={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? <Pause className="w-4 h-4 fill-slate-950" /> : <Play className="w-4 h-4 fill-slate-950" />}
                  </button>
                  <button
                    onClick={stepForward}
                    disabled={currentIndex >= events.length - 1}
                    className="p-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded disabled:opacity-40 text-slate-300 transition-all"
                    title="Step Forward"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Speed selector */}
                <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[9px] font-bold font-mono">
                  <span className="text-slate-500">PLAY SPEED:</span>
                  <select
                    value={playbackSpeed}
                    onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                    className="bg-transparent border-none focus:outline-none text-cyan-400 font-extrabold cursor-pointer"
                  >
                    <option value={2000}>0.5x (2s)</option>
                    <option value={1000}>1.0x (1s)</option>
                    <option value={500}>2.0x (0.5s)</option>
                    <option value={200}>5.0x (0.2s)</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar: Frame Logs List */}
        <div className="space-y-4 lg:col-span-1">
          <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-4 min-h-[385px] flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-1 text-slate-400">
                <Info className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider font-mono">Stepper Trace Frame</span>
              </div>
              
              <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1 scrollbar-thin">
                {events.length === 0 ? (
                  <div className="text-center py-16 text-slate-600 text-xs font-mono">
                    No active frames indexed.
                  </div>
                ) : (
                  events.map((evt, idx) => {
                    const isPassed = idx <= currentIndex;
                    const isActive = idx === currentIndex;
                    const anomaly = isAnomaly(evt.event_type);

                    return (
                      <button
                        key={evt.event_id}
                        onClick={() => setCurrentIndex(idx)}
                        className={`w-full text-left px-2.5 py-1.5 rounded text-[10px] font-mono border transition-all flex items-center gap-2 ${
                          isActive
                            ? anomaly
                              ? 'bg-red-500/10 border-red-500/40 text-red-400 font-extrabold shadow-[0_0_15px_rgba(239,68,68,0.1)]'
                              : 'bg-cyan-500/10 border-cyan-500/40 text-cyan-400 font-extrabold shadow-[0_0_15px_rgba(6,182,212,0.1)]'
                            : isPassed
                            ? anomaly
                              ? 'bg-slate-950/20 border-red-500/10 text-red-400/60'
                              : 'bg-slate-950/20 border-emerald-500/10 text-emerald-400/60'
                            : 'bg-transparent border-transparent text-slate-500 hover:text-slate-400'
                        }`}
                      >
                        <span className="text-[8px] font-extrabold uppercase">
                          {anomaly ? '⚠️' : '✓'}
                        </span>
                        <span className="truncate uppercase tracking-tight flex-1">{evt.event_type.replace(/_/g, ' ')}</span>
                        <span className="text-[8px] opacity-60">
                          {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {events.length > 0 && (
              <div className="border-t border-slate-900 pt-3 flex justify-between items-center text-[9px] text-slate-500 font-mono">
                <span>Total Steps: {events.length}</span>
                <span>Active ID: {currentIndex + 1}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventReplayEngine;
