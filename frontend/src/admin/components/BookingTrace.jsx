import React, { useState, useEffect } from 'react';
import { 
  GitCommit, Activity, Search, Clock, ShieldCheck, CheckCircle2, ChevronRight, HelpCircle
} from 'lucide-react';
import apiClient from '../../lib/apiClient';

export const BookingTrace = ({ initialCorrelationId }) => {
  const [correlationId, setCorrelationId] = useState(initialCorrelationId || '');
  const [trace, setTrace] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchTrace = async (idToFetch) => {
    const cId = idToFetch || correlationId;
    if (!cId) return;
    
    setLoading(true);
    setError(null);
    setTrace(null);
    try {
      const res = await apiClient.get(`/admin/event-dashboard/trace/${cId}`);
      if (res.data?.success) {
        setTrace(res.data.trace || []);
      } else {
        setError('No events matched this correlation token.');
      }
    } catch (err) {
      console.error('Failed to reconstruct trace:', err);
      setError(err.response?.data?.detail || 'Correlation trace not found.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialCorrelationId) {
      setCorrelationId(initialCorrelationId);
      fetchTrace(initialCorrelationId);
    }
  }, [initialCorrelationId]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchTrace();
  };

  const getStepStatusClass = (idx, total) => {
    if (idx === total - 1) return 'text-cyan-400 border-cyan-400 font-bold';
    return 'text-emerald-400 border-emerald-400';
  };

  return (
    <div className="bg-[#0f172a]/80 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <GitCommit className="w-5 h-5 text-cyan-400 rotate-90" />
          End-to-End Event Traceability & Chain Correlation
        </h2>
        <p className="text-sm text-slate-400 mt-1">Reconstruct system lifecycles using correlation tokens</p>
      </div>

      {/* Trace Search input */}
      <form onSubmit={handleSearchSubmit} className="flex gap-3 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={correlationId}
            onChange={(e) => setCorrelationId(e.target.value)}
            placeholder="Input correlation_id (e.g., corr_e2e_flow_...) to trace transaction..."
            className="w-full bg-slate-900/60 border border-slate-800 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !correlationId}
          className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 px-6 py-2.5 rounded-lg text-sm font-bold transition-all shadow-md shadow-cyan-500/20 disabled:opacity-50"
        >
          Reconstruct Flow
        </button>
      </form>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
          <span className="text-xs text-slate-500">Querying Event Spine...</span>
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg p-4 text-sm flex items-center gap-2">
          <HelpCircle className="w-4 h-4" />
          {error}
        </div>
      ) : !trace ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          Please input a correlation ID to reconstruct a transaction's lifecycle.
        </div>
      ) : trace.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          No events recorded for this correlation ID.
        </div>
      ) : (
        <div>
          {/* Timeline chart */}
          <div className="relative pl-8 space-y-8 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-800">
            {trace.map((evt, idx) => {
              const eventDate = new Date(evt.timestamp);
              const formattedTime = eventDate.toLocaleTimeString() + `.${String(eventDate.getMilliseconds()).padStart(3, '0')}`;
              const isLast = idx === trace.length - 1;

              return (
                <div key={evt.event_id} className="relative group">
                  {/* Bullet */}
                  <span className={`absolute left-[-29px] top-1 flex items-center justify-center w-[24px] h-[24px] rounded-full bg-slate-950 border-2 transition-all ${getStepStatusClass(idx, trace.length)}`}>
                    {isLast ? (
                      <Activity className="w-3 h-3 text-cyan-400 animate-pulse" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                  </span>

                  {/* Body card */}
                  <div className="bg-slate-950/30 border border-slate-900 hover:border-slate-800 rounded-xl p-4 transition-all">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-2">
                      <div className="flex items-center gap-2.5">
                        <span className="font-bold text-sm text-slate-200">{evt.event_type}</span>
                        <span className="text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-slate-900 border border-slate-850 text-slate-400">
                          {evt.source_service || evt.source_mcp || 'spine'}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {formattedTime}
                      </span>
                    </div>

                    {/* Payload inspector */}
                    <div className="bg-slate-900/40 border border-slate-850 rounded p-2.5 text-[11px] font-mono text-slate-400 max-h-[120px] overflow-y-auto pr-2 scrollbar-thin">
                      {JSON.stringify(evt.payload, null, 2)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-8 pt-6 border-t border-slate-850 flex justify-between items-center text-xs text-slate-500">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
              Trace Verified & Spine Synchronized
            </span>
            <span>Total Steps: {trace.length}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookingTrace;
