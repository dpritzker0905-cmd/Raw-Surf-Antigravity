import React, { useState, useEffect } from 'react';
import {
  ShieldAlert, CheckCircle, XCircle, Play, Sparkles, TrendingUp, AlertTriangle, Cpu, Terminal
} from 'lucide-react';
import apiClient from '../../lib/apiClient';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeTokens } from '../../utils/themeTokens';
import { toast } from 'sonner';

export interface DecisionItem {
  decision_id: string;
  type: string;
  spot_name: string;
  proposed_value: string;
  status: string;
  explanation: string;
  timestamp: string;
  correlation_id: string;
  recommendation_type: string;
  reasoning: string;
  supporting_event_trace: string;
  expected_outcome: string;
  risk_level: 'low' | 'medium' | 'high';
  confidence_score: number;
}

export const DecisionWorkbench: React.FC = () => {
  const [decisions, setDecisions] = useState<DecisionItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [executingId, setExecutingId] = useState<string | null>(null);

  const fetchDecisions = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/admin/event-dashboard/actions');
      if (res.data?.success) {
        setDecisions(res.data.actions || []);
      }
    } catch (err) {
      console.error('Failed to fetch Decisions Queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDecisions();
  }, []);

  const handleApprove = async (item: DecisionItem) => {
    try {
      setExecutingId(item.decision_id);
      toast.loading(`Injecting approval event on Spine...`, { id: 'op-approve' });
      
      const res = await apiClient.post('/admin/event-dashboard/actions/approve', {
        decision_id: item.decision_id,
        correlation_id: item.correlation_id
      });

      if (res.data?.success) {
        toast.success(`Action successfully executed and published to Spine!`, { id: 'op-approve' });
        fetchDecisions();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to approve action', { id: 'op-approve' });
    } finally {
      setExecutingId(null);
    }
  };

  const handleReject = async (item: DecisionItem) => {
    const explanation = prompt('Provide rejection reasoning:', 'Out of boundary parameters');
    if (!explanation) return;

    try {
      setExecutingId(item.decision_id);
      toast.loading(`Injecting rejection event...`, { id: 'op-reject' });

      const res = await apiClient.post('/admin/event-dashboard/actions/reject', {
        decision_id: item.decision_id,
        explanation,
        correlation_id: item.correlation_id
      });

      if (res.data?.success) {
        toast.success(`Action rejected and logged on Spine.`, { id: 'op-reject' });
        fetchDecisions();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to reject action', { id: 'op-reject' });
    } finally {
      setExecutingId(null);
    }
  };

  const pending = decisions.filter(d => d.status === 'pending_approval');
  const past = decisions.filter(d => d.status !== 'pending_approval');

  const { theme } = useTheme();
  const t = getThemeTokens(theme);
  const dim = t.isLight || t.isBeach;
  const accent = dim ? 'text-cyan-600' : 'text-cyan-400';
  const accentBg = dim ? 'bg-cyan-600/10' : 'bg-cyan-500/10';
  const accentBorder = dim ? 'border-cyan-600/30' : 'border-cyan-500/20';
  const successText = dim ? 'text-emerald-600' : 'text-emerald-400';
  const dangerText = dim ? 'text-red-600' : 'text-red-400';
  const warnText = dim ? 'text-amber-600' : 'text-amber-400';

  return (
    <div className={`${t.glassBg} backdrop-blur-md rounded-xl border p-6 shadow-2xl space-y-6`}>
      <div>
        <h2 className={`text-xl font-bold ${t.textPrimary} flex items-center gap-2`}>
          <Cpu className={`w-5 h-5 ${accent}`} />
          Decision Workbench & Controlled Execution Gate
        </h2>
        <p className={`text-xs ${t.textSecondary} mt-1`}>
          Cryptographically gated workbench. AI actions never execute autonomously; they strictly require admin signature injection.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Terminal className={`w-6 h-6 animate-spin ${accent}`} />
        </div>
      ) : decisions.length === 0 ? (
        <div className={`text-center py-12 ${t.textMuted} text-xs`}>
          No pending decision actions enqueued on the Event Spine.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pending Gated Queue */}
          <div className="space-y-4">
            <h3 className={`text-xs font-bold ${t.textSecondary} uppercase tracking-wider`}>
              Pending Authorization ({pending.length})
            </h3>
            {pending.map((item) => (
              <div
                key={item.decision_id}
                className={`${t.rowBg} border ${t.border} rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:${accentBorder} transition-all shadow-lg`}
              >
                <div className="space-y-2 max-w-xl">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-mono ${accentBg} ${accent} px-2 py-0.5 rounded border ${accentBorder} uppercase tracking-wider`}>
                      {item.type}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border ${
                      item.risk_level === 'high' ? `${dim ? 'bg-red-600/10' : 'bg-red-500/10'} ${dangerText} border-red-500/20` :
                      item.risk_level === 'medium' ? `${dim ? 'bg-amber-600/10' : 'bg-amber-500/10'} ${warnText} border-amber-500/20` :
                      `${dim ? 'bg-emerald-600/10' : 'bg-emerald-500/10'} ${successText} border-emerald-500/20`
                    }`}>
                      {item.risk_level} Risk
                    </span>
                    <span className={`text-[10px] font-mono ${t.textMuted}`}>
                      Trace: {item.correlation_id?.substring(0, 12)}...
                    </span>
                  </div>

                  <h4 className={`${t.textPrimary} font-semibold text-sm leading-snug`}>{item.explanation}</h4>
                  <p className={`text-xs ${t.textSecondary}`}>{item.reasoning}</p>

                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className={`${t.cellBg} p-2 rounded border ${t.border} text-[10px]`}>
                      <span className={`${t.textMuted} block font-bold uppercase`}>Expected Outcome</span>
                      <span className={`${t.textSecondary} font-medium`}>{item.expected_outcome || 'N/A'}</span>
                    </div>
                    <div className={`${t.cellBg} p-2 rounded border ${t.border} text-[10px] flex items-center justify-between`}>
                      <div>
                        <span className={`${t.textMuted} block font-bold uppercase`}>Confidence Score</span>
                        <span className={`${t.textSecondary} font-medium`}>{item.confidence_score}%</span>
                      </div>
                      <Sparkles className={`w-3.5 h-3.5 ${dim ? 'text-yellow-600' : 'text-yellow-400'}`} />
                    </div>
                  </div>
                </div>

                <div className="flex md:flex-col items-stretch gap-2 min-w-[150px]">
                  <button
                    disabled={executingId !== null}
                    onClick={() => handleApprove(item)}
                    className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-3 py-2 rounded text-xs flex items-center justify-center gap-1 transition-all"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Approve & Inject
                  </button>
                  <button
                    disabled={executingId !== null}
                    onClick={() => handleReject(item)}
                    className={`${t.cardBg} ${t.hoverBg} ${t.textSecondary} font-medium px-3 py-2 rounded text-xs border ${t.border} transition-all`}
                  >
                    Reject Gated Action
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Historical Log */}
          {past.length > 0 && (
            <div className={`border-t ${t.borderLight} pt-6 space-y-3`}>
              <h3 className={`text-xs font-bold ${t.textMuted} uppercase tracking-wider`}>
                Execution History ({past.length})
              </h3>
              <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2 scrollbar-thin">
                {past.map((item) => (
                  <div
                    key={item.decision_id}
                    className={`${t.cellBgFaded} border ${t.borderLight} rounded p-3 flex justify-between items-center text-xs`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${t.textSecondary}`}>{item.explanation}</span>
                        <span className={`text-[9px] font-mono ${t.textMuted}`}>Trace: {item.correlation_id?.substring(0, 8)}...</span>
                      </div>
                      <p className={`text-[10px] ${t.textMuted}`}>{item.reasoning}</p>
                    </div>

                    <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px]">
                      {item.status === 'approved' || item.status === 'executed' ? (
                        <span className={`flex items-center gap-1 ${successText} ${dim ? 'bg-emerald-600/10' : 'bg-emerald-500/10'} px-2 py-0.5 rounded border border-emerald-500/20`}>
                          <CheckCircle className="w-3 h-3" />
                          Approved
                        </span>
                      ) : (
                        <span className={`flex items-center gap-1 ${dangerText} ${dim ? 'bg-red-600/10' : 'bg-red-500/10'} px-2 py-0.5 rounded border border-red-500/20`}>
                          <XCircle className="w-3 h-3" />
                          Rejected
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
