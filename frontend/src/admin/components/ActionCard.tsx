import React, { useState } from 'react';
import { 
  CheckCircle, XCircle, Sparkles, DollarSign, Calendar
} from 'lucide-react';
import { AdminAction } from '../hooks/useAdminActions';

interface ActionCardProps {
  action: AdminAction;
  onApprove: (action: AdminAction) => void;
  onReject: (id: string, explanation: string, correlationId?: string) => void;
}

export const ActionCard: React.FC<ActionCardProps> = ({ action, onApprove, onReject }) => {
  const [rejectMode, setRejectMode] = useState<boolean>(false);
  const [rejectReason, setRejectReason] = useState<string>('');

  const getRiskColor = (risk?: string) => {
    switch (risk?.toLowerCase()) {
      case 'high':
        return 'text-red-400 bg-red-500/10 border-red-500/20';
      case 'medium':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'low':
      default:
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    }
  };

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'pricing_adjustment':
        return <DollarSign className="w-5 h-5 text-emerald-400" />;
      case 'booking_override':
        return <Calendar className="w-5 h-5 text-cyan-400" />;
      default:
        return <Sparkles className="w-5 h-5 text-indigo-400" />;
    }
  };

  const handleConfirmReject = () => {
    if (!rejectReason.trim()) return;
    onReject(action.decision_id, rejectReason, action.correlation_id);
    setRejectMode(false);
  };

  return (
    <div className="bg-slate-950/40 border border-slate-900 rounded-lg p-5 hover:border-slate-800 transition-all shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-900 border border-slate-800">
            {getActionIcon(action.recommendation_type || action.type)}
          </span>
          <div>
            <h4 className="font-bold text-sm text-slate-200 capitalize">
              {(action.recommendation_type || action.type || '').replace('_', ' ')}
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">Spot: {action.spot_name || 'Global'}</p>
          </div>
        </div>

        <div className="flex gap-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getRiskColor(action.risk_level)}`}>
            {action.risk_level || 'low'} Risk
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-indigo-500/20 text-indigo-400 bg-indigo-500/10 font-mono">
            Conf: {action.confidence_score || 90}%
          </span>
        </div>
      </div>

      {/* Explanation Details */}
      <div className="mt-3.5 bg-slate-900/60 rounded p-3 text-xs text-slate-300 border border-slate-850">
        <div className="font-semibold text-slate-200">Recommendation Details:</div>
        <div className="mt-1 leading-relaxed">
          {(action.explanation || action.reasoning || '').replace(/students/gi, 'surfers')}
        </div>
        
        {action.expected_outcome && (
          <div className="mt-2 text-slate-400">
            <span className="font-semibold text-slate-300">Expected Outcome:</span>{' '}
            {action.expected_outcome.replace(/students/gi, 'surfers')}
          </div>
        )}
      </div>

      {/* Controls */}
      {action.status === 'pending_approval' && (
        <div className="mt-4 flex items-center justify-end gap-3 border-t border-slate-900/60 pt-4">
          {rejectMode ? (
            <div className="w-full space-y-3">
              <textarea
                rows={2}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Why are you rejecting this decision? (User protection safety log)"
                className="w-full bg-slate-900 border border-red-500/30 text-xs rounded p-2 text-slate-200 focus:outline-none focus:border-red-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setRejectMode(false)}
                  className="px-2.5 py-1 text-[11px] font-bold text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmReject}
                  disabled={!rejectReason.trim()}
                  className="bg-red-500 hover:bg-red-600 text-slate-950 font-bold px-3 py-1 rounded text-[11px] transition-colors disabled:opacity-50"
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={() => setRejectMode(true)}
                className="flex items-center gap-1 text-red-400 hover:text-red-300 border border-red-500/20 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
                Reject
              </button>
              <button
                onClick={() => onApprove(action)}
                className="flex items-center gap-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md shadow-cyan-500/20 hover:scale-[1.02]"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Authorize
              </button>
            </>
          )}
        </div>
      )}

      {action.status !== 'pending_approval' && (
        <div className="mt-3 flex items-center justify-between text-[11px] border-t border-slate-900/60 pt-3">
          <span className="text-slate-500">
            Status:{' '}
            <span className={`font-semibold capitalize ${action.status === 'executed' ? 'text-emerald-400' : 'text-red-400'}`}>
              {action.status}
            </span>
          </span>
          {action.execution_timestamp && (
            <span className="text-slate-600 font-mono">
              TS: {new Date(action.execution_timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default ActionCard;
