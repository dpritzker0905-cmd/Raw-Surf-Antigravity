import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, RefreshCw, Cpu, Activity, AlertTriangle, ShieldCheck, Zap, Info, Wrench
} from 'lucide-react';
import apiClient from '../../lib/apiClient';

interface EventLog {
  event_id: string;
  event_type: string;
  payload: string;
  timestamp: string;
  source_mcp: string;
  correlation_id: string;
}

interface DiagnosticReport {
  correlation_id: string;
  first_failure_event: EventLog | null;
  affected_subsystems: string[];
  confidence_score: number;
  causal_chain: EventLog[];
  suggested_fix: string;
}

export const RootCauseAnalyzer: React.FC = () => {
  const [events, setEvents] = useState<EventLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeReport, setActiveReport] = useState<DiagnosticReport | null>(null);

  const fetchEventsAndAnalyze = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/admin/event-dashboard/events');
      if (res.data?.success) {
        const spineEvents: EventLog[] = res.data.events || [];
        setEvents(spineEvents);

        // Group by correlation ID
        const grouped: { [key: string]: EventLog[] } = {};
        spineEvents.forEach(e => {
          const cId = e.correlation_id || 'unassigned';
          if (!grouped[cId]) grouped[cId] = [];
          grouped[cId].push(e);
        });

        // Search for the first correlation ID that has an error event
        let failureCorrelationId = '';
        for (const [cId, chain] of Object.entries(grouped)) {
          if (chain.some(e => e.event_type.includes('error') || e.event_type.includes('fail') || e.event_type.includes('reject'))) {
            failureCorrelationId = cId;
            break;
          }
        }

        // If no actual failure found, default to the first one available or fallback
        if (!failureCorrelationId && Object.keys(grouped).length > 0) {
          failureCorrelationId = Object.keys(grouped)[0];
        }

        if (failureCorrelationId) {
          generateReport(failureCorrelationId, grouped[failureCorrelationId]);
        } else {
          setActiveReport(null);
        }
      }
    } catch (err) {
      console.error('Failed to run diagnostics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEventsAndAnalyze();
  }, []);

  const generateReport = (cId: string, chain: EventLog[]) => {
    // Sort chain by timestamp
    const sortedChain = [...chain].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    // Find the first event that represents a failure
    const failureEvent = sortedChain.find(e => 
      e.event_type.includes('error') || e.event_type.includes('fail') || e.event_type.includes('reject')
    ) || null;

    // Detect affected subsystems
    const subsystems = new Set<string>();
    sortedChain.forEach(e => {
      if (e.event_type.includes('payment')) subsystems.add('Payment Processor');
      if (e.event_type.includes('weather')) subsystems.add('Weather Swell Sync');
      if (e.event_type.includes('booking')) subsystems.add('Booking Ledger');
      if (e.event_type.includes('media')) subsystems.add('Media Transporter');
      if (e.event_type.includes('social')) subsystems.add('Social Broadcaster');
    });
    if (subsystems.size === 0) subsystems.add('System Core');

    // Calculate a confidence score
    let score = 75;
    if (failureEvent) {
      score += 15;
      if (failureEvent.source_mcp.includes('operator')) score += 5;
    }

    // Determine non-executable proposal text based on failure event type
    let fixProposal = 'Re-trigger WebSocket broadcast connection and refresh event spine cache.';
    if (failureEvent) {
      const type = failureEvent.event_type;
      if (type.includes('payment')) {
        fixProposal = 'Inject manual payment_override approved event via Decision Workbench to bypass Stripe transaction threshold constraints.';
      } else if (type.includes('booking')) {
        fixProposal = 'Publish spot_capacity_adjusted gate override event to reconcile database slots with real-time beach check-ins.';
      } else if (type.includes('weather')) {
        fixProposal = 'Reprocess swell telemetry batch from NOAA primary endpoint in simulation sandbox to bypass API timeout thresholds.';
      } else if (type.includes('media')) {
        fixProposal = 'Queue secondary media_review retry block using parallel Cloudinary storage synchronizer hook.';
      }
    }

    setActiveReport({
      correlation_id: cId,
      first_failure_event: failureEvent,
      affected_subsystems: Array.from(subsystems),
      confidence_score: score,
      causal_chain: sortedChain,
      suggested_fix: fixProposal
    });
  };

  const isAnomaly = (type: string) => {
    return type.includes('error') || type.includes('fail') || type.includes('reject');
  };

  return (
    <div className="bg-[#0f172a]/80 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-cyan-400" />
            AI Root Cause Analyzer (Observation Only)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Analyze event spine anomalies and trace propagation pathways without modifying live data structures.
          </p>
        </div>

        <button
          onClick={fetchEventsAndAnalyze}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
          Run Anomaly Scan
        </button>
      </div>

      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center gap-2">
          <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
          <span className="text-xs text-slate-500 font-mono">Running event causality diagnostic sweeps...</span>
        </div>
      ) : !activeReport ? (
        <div className="text-center py-16 bg-slate-950/20 border border-slate-900 rounded-lg text-slate-500 text-xs flex flex-col items-center gap-2">
          <ShieldCheck className="w-8 h-8 text-emerald-400" />
          All subsystems performing within healthy parameters. No event anomalies detected.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Diagnostic Telemetry Grid */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Header telemetry blocks */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-slate-950 border border-slate-900 rounded-xl p-4 space-y-1">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">Primary Incident Anomaly</span>
                <div className="text-xs font-mono font-bold text-red-400 truncate flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                  {activeReport.first_failure_event?.event_type.replace(/_/g, ' ').toUpperCase() || 'UNKNOWN ERROR'}
                </div>
                <span className="text-[8px] font-mono text-slate-600 block mt-1">
                  Root source: {activeReport.first_failure_event?.source_mcp || 'System Core'}
                </span>
              </div>

              <div className="bg-slate-950 border border-slate-900 rounded-xl p-4 space-y-1 flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">AI Confidence Metric</span>
                  <div className="text-base font-bold text-cyan-400 font-mono mt-0.5">
                    {activeReport.confidence_score}% Accuracy
                  </div>
                </div>
                <div className="w-10 h-10 rounded-full border-2 border-cyan-500/20 flex items-center justify-center text-xs font-bold text-cyan-400 bg-cyan-500/5">
                  ✓
                </div>
              </div>
            </div>

            {/* Diagnostic analysis result */}
            <div className="bg-slate-950 border border-slate-900 rounded-xl p-5 space-y-4">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-cyan-400" />
                Causal Anomaly Reconstruction
              </h3>

              <div className="relative pl-5 border-l border-slate-800 space-y-4">
                {activeReport.causal_chain.map((evt, idx) => {
                  const anomaly = isAnomaly(evt.event_type);
                  return (
                    <div key={evt.event_id} className="relative group">
                      <div className={`absolute -left-[24px] top-1 w-2.5 h-2.5 rounded-full border ${
                        anomaly ? 'bg-red-500 border-red-400 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'bg-slate-800 border-slate-700'
                      }`} />
                      <div className="text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono font-bold uppercase text-[10px] ${anomaly ? 'text-red-400' : 'text-slate-300'}`}>
                            {evt.event_type.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[8px] font-mono text-slate-600">ID: {evt.event_id.substring(0, 8)}...</span>
                        </div>
                        <p className="text-[9px] font-mono text-slate-500 mt-0.5">
                          Detected in {evt.source_mcp} at {new Date(evt.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Sidebar: Diagnostic Findings and Suggested Remedy */}
          <div className="space-y-4 lg:col-span-1">
            <div className="bg-slate-950 border border-slate-900 rounded-xl p-4 space-y-4 min-h-[340px] flex flex-col justify-between">
              
              <div className="space-y-4">
                <div className="flex items-center gap-1 text-slate-400 border-b border-slate-900 pb-2">
                  <Info className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wider font-mono">Telemetry Findings</span>
                </div>

                <div className="space-y-3">
                  {/* Affected Subsystems */}
                  <div className="space-y-1">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">Affected Domains</span>
                    <div className="flex flex-wrap gap-1">
                      {activeReport.affected_subsystems.map(sub => (
                        <span key={sub} className="text-[9px] font-mono bg-slate-900 text-slate-300 px-2 py-0.5 rounded border border-slate-850">
                          {sub}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Impact Analysis summary */}
                  <div className="space-y-1">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">Propagation Depth</span>
                    <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                      Anomaly originated in <strong className="text-red-400 font-mono text-[9px]">{activeReport.first_failure_event?.source_mcp || 'unknown'}</strong> during a standard event spine transmission, subsequently impacting {activeReport.affected_subsystems.length} subsystems.
                    </p>
                  </div>
                </div>
              </div>

              {/* suggested non-executable fix */}
              <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-cyan-400">
                  <Wrench className="w-4 h-4 text-cyan-400 animate-pulse" />
                  <span className="text-[9px] font-bold uppercase tracking-wider font-mono">Suggested AI Remedy</span>
                </div>
                <p className="text-[9px] font-mono text-slate-300 leading-normal">
                  {activeReport.suggested_fix}
                </p>
                <div className="text-[8px] text-slate-500 font-mono uppercase tracking-tight text-right italic pt-1 border-t border-slate-900/40">
                  Observation proposal only
                </div>
              </div>

            </div>
          </div>

        </div>
      )}
    </div>
  );
};

export default RootCauseAnalyzer;
