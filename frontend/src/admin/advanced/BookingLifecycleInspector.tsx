import React, { useState, useEffect, useCallback } from 'react';
import { 
  GitCommit, Clock, CheckCircle, AlertTriangle, ShieldCheck, CreditCard, CloudSun, Image, Share2
} from 'lucide-react';
import apiClient from '../../lib/apiClient';

interface TraceEvent {
  event_id: string;
  event_type: string;
  payload: string; // JSON string
  timestamp: string;
  user_id: string;
  source_mcp: string;
  correlation_id: string;
}

interface BookingLifecycleInspectorProps {
  initialCorrelationId?: string;
}

export const BookingLifecycleInspector: React.FC<BookingLifecycleInspectorProps> = ({ 
  initialCorrelationId = '' 
}) => {
  const [correlationId, setCorrelationId] = useState<string>(initialCorrelationId);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialCorrelationId) {
      setCorrelationId(initialCorrelationId);
    }
  }, [initialCorrelationId]);

  const fetchTrace = useCallback(async (cId: string) => {
    if (!cId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get(`/admin/event-dashboard/trace/${cId}`);
      if (res.data?.success) {
        setEvents(res.data.trace || []);
      } else {
        setError('No active lifecycle events found for this correlation ID.');
        setEvents([]);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to fetch chronological trace.');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (correlationId) {
      fetchTrace(correlationId);
    }
  }, [correlationId, fetchTrace]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTrace(correlationId);
  };

  const getEventIcon = (type: string) => {
    if (type.includes('payment') || type.includes('checkout')) return <CreditCard className="w-4 h-4 text-emerald-400" />;
    if (type.includes('weather') || type.includes('swell')) return <CloudSun className="w-4 h-4 text-amber-400" />;
    if (type.includes('media') || type.includes('gallery')) return <Image className="w-4 h-4 text-purple-400" />;
    if (type.includes('social') || type.includes('publish')) return <Share2 className="w-4 h-4 text-cyan-400" />;
    if (type.includes('admin') || type.includes('approve') || type.includes('decision')) return <ShieldCheck className="w-4 h-4 text-red-400" />;
    return <GitCommit className="w-4 h-4 text-slate-400" />;
  };

  const getEventColor = (type: string) => {
    if (type.includes('payment') || type.includes('checkout')) return 'border-emerald-500/30 bg-emerald-500/5';
    if (type.includes('weather') || type.includes('swell')) return 'border-amber-500/30 bg-amber-500/5';
    if (type.includes('media') || type.includes('gallery')) return 'border-purple-500/30 bg-purple-500/5';
    if (type.includes('social') || type.includes('publish')) return 'border-cyan-500/30 bg-cyan-500/5';
    if (type.includes('admin') || type.includes('approve') || type.includes('decision')) return 'border-red-500/30 bg-red-500/5';
    return 'border-slate-800 bg-slate-900/40';
  };

  return (
    <div className="bg-[#0f172a]/80 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Clock className="w-5 h-5 text-cyan-400" />
            Booking Lifecycle Inspector
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Read-only chronological trace layer. Reconstructs booking timeline, payment paths, and weather contexts from event logs.
          </p>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <input
            type="text"
            placeholder="Enter Correlation ID (e.g. corr_...)"
            value={correlationId}
            onChange={(e) => setCorrelationId(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-xs px-3 py-2 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-500 min-w-[280px]"
          />
          <button
            type="submit"
            className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold px-4 py-2 rounded-lg transition-all"
          >
            Trace Lifecycle
          </button>
        </form>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <GitCommit className="w-6 h-6 animate-spin text-cyan-400" />
        </div>
      ) : error ? (
        <div className="text-center py-12 bg-slate-950/20 border border-slate-900 rounded-lg text-slate-500 text-xs flex flex-col items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          {error}
          <span className="text-[10px] text-slate-600">Simulate a session completion or pricing update to populate logs!</span>
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-xs">
          No correlation trace loaded. Enter an active token above to inspect its lifecycle timeline.
        </div>
      ) : (
        <div className="relative pl-6 border-l-2 border-slate-850 space-y-6 max-w-4xl mx-auto py-2">
          {events.map((evt, idx) => {
            let parsedPayload: any = {};
            try {
              parsedPayload = JSON.parse(evt.payload);
            } catch (e) {}

            return (
              <div key={evt.event_id} className="relative group">
                {/* Timeline node */}
                <div className="absolute -left-[35px] top-1 bg-slate-950 border border-slate-800 p-1.5 rounded-full group-hover:border-cyan-500/50 transition-all z-10 shadow-lg">
                  {getEventIcon(evt.event_type)}
                </div>

                {/* Event Card */}
                <div className={`border rounded-lg p-4 space-y-2 hover:border-slate-700 transition-all shadow-md ${getEventColor(evt.event_type)}`}>
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider block">
                        {evt.event_type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[9px] font-mono text-slate-500">ID: {evt.event_id}</span>
                    </div>

                    <div className="text-right text-[10px] text-slate-500">
                      <div>{new Date(evt.timestamp).toLocaleDateString()}</div>
                      <div>{new Date(evt.timestamp).toLocaleTimeString()}</div>
                    </div>
                  </div>

                  {/* Render Payload Key-Values nicely */}
                  <div className="bg-slate-950/80 rounded p-3 font-mono text-[10px] text-slate-300 border border-slate-900/60 overflow-x-auto max-h-[120px] scrollbar-thin">
                    <div className="flex justify-between border-b border-slate-900 pb-1 mb-1 font-bold text-slate-400">
                      <span>Property</span>
                      <span>Value</span>
                    </div>
                    {Object.entries(parsedPayload).map(([key, val]) => (
                      <div key={key} className="flex justify-between py-0.5 border-b border-slate-950/50 hover:bg-slate-900/20">
                        <span className="text-slate-500 mr-4">{key}</span>
                        <span className="text-slate-300 truncate max-w-[280px]">
                          {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-between items-center text-[9px] text-slate-500 pt-1 border-t border-slate-900/40">
                    <span>Source: {evt.source_mcp}</span>
                    {evt.user_id && <span>User: {evt.user_id}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
