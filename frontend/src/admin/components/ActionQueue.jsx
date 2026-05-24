import React, { useState } from 'react';
import { 
  CheckCircle, XCircle, ShieldAlert, Sparkles, DollarSign, Calendar, Edit, ChevronDown, RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';

export const ActionQueue = ({ actions, loading, onApprove, onReject, onOverride }) => {
  const [activeTab, setActiveTab] = useState('pending');
  const [rejectId, setRejectId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  
  // Custom manual override form
  const [overrideBookingId, setOverrideBookingId] = useState('');
  const [overrideCapacity, setOverrideCapacity] = useState('10');
  const [overrideReason, setOverrideReason] = useState('');

  const handleApprove = async (action) => {
    const success = await onApprove(action.decision_id, action.correlation_id);
    if (success) {
      toast.success(`Executed approved action: ${action.type}`);
    }
  };

  const handleRejectClick = (id) => {
    setRejectId(id);
    setRejectReason('');
  };

  const submitReject = async (action) => {
    if (!rejectReason) {
      toast.error('Rejection explanation is required!');
      return;
    }
    const success = await onReject(action.decision_id, rejectReason, action.correlation_id);
    if (success) {
      setRejectId(null);
      setRejectReason('');
    }
  };

  const submitOverride = async (e) => {
    e.preventDefault();
    if (!overrideBookingId) {
      toast.error('Booking ID is required!');
      return;
    }
    const success = await onOverride(overrideBookingId, overrideCapacity, overrideReason || 'Manual capacity override via Admin Control Layer');
    if (success) {
      setOverrideBookingId('');
      setOverrideCapacity('10');
      setOverrideReason('');
    }
  };

  const getRiskColor = (risk) => {
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

  const getActionIcon = (type) => {
    switch (type) {
      case 'pricing_adjustment':
        return <DollarSign className="w-5 h-5 text-emerald-400" />;
      case 'booking_override':
        return <Calendar className="w-5 h-5 text-cyan-400" />;
      default:
        return <Sparkles className="w-5 h-5 text-indigo-400" />;
    }
  };

  const filteredActions = actions.filter((act) => {
    if (activeTab === 'pending') return act.status === 'pending_approval';
    if (activeTab === 'executed') return act.status === 'executed';
    if (activeTab === 'rejected') return act.status === 'rejected';
    return true;
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Action Queue list */}
      <div className="lg:col-span-2 bg-[#0f172a]/80 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-400 animate-pulse" />
              Non-Autonomous Admin Decisions Queue
            </h2>
            <p className="text-sm text-slate-400 mt-1">Actions blocked until human authorization is received</p>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-800 pb-3 mb-6 gap-4">
          {['pending', 'executed', 'rejected'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-1 text-sm font-semibold capitalize relative transition-all ${
                activeTab === tab ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab} Decisions
              {activeTab === tab && (
                <div className="absolute bottom-[-13px] left-0 right-0 h-0.5 bg-cyan-400" />
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
          </div>
        ) : filteredActions.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            No decisions found in this queue.
          </div>
        ) : (
          <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 scrollbar-thin">
            {filteredActions.map((act) => (
              <div 
                key={act.decision_id} 
                className="bg-slate-950/40 border border-slate-900 rounded-lg p-5 hover:border-slate-800 transition-all shadow-md"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-900 border border-slate-800">
                      {getActionIcon(act.recommendation_type || act.type)}
                    </span>
                    <div>
                      <h4 className="font-bold text-sm text-slate-200 capitalize">
                        {(act.recommendation_type || act.type || '').replace('_', ' ')}
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">Spot: {act.spot_name || 'Global'}</p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getRiskColor(act.risk_level)}`}>
                      {act.risk_level || 'low'} Risk
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-indigo-500/20 text-indigo-400 bg-indigo-500/10 font-mono">
                      Conf: {act.confidence_score || 90}%
                    </span>
                  </div>
                </div>

                {/* Explanation / Recommendation Details */}
                <div className="mt-3.5 bg-slate-900/60 rounded p-3 text-xs text-slate-300 border border-slate-850">
                  <div className="font-semibold text-slate-200">Recommendation Suggestion:</div>
                  <div className="mt-1 leading-relaxed">{act.explanation || act.reasoning}</div>
                  
                  {act.expected_outcome && (
                    <div className="mt-2 text-slate-400">
                      <span className="font-semibold text-slate-300">Expected Outcome:</span> {act.expected_outcome}
                    </div>
                  )}
                </div>

                {/* Approve/Reject Controls (only if pending) */}
                {act.status === 'pending_approval' && (
                  <div className="mt-4 flex items-center justify-end gap-3 border-t border-slate-900/60 pt-4">
                    {rejectId === act.decision_id ? (
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
                            onClick={() => setRejectId(null)}
                            className="px-2.5 py-1 text-[11px] font-bold text-slate-400 hover:text-slate-200"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => submitReject(act)}
                            className="bg-red-500 hover:bg-red-600 text-slate-950 font-bold px-3 py-1 rounded text-[11px] transition-colors"
                          >
                            Confirm Rejection
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => handleRejectClick(act.decision_id)}
                          className="flex items-center gap-1 text-red-400 hover:text-red-300 border border-red-500/20 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Reject Recommendation
                        </button>
                        <button
                          onClick={() => handleApprove(act)}
                          className="flex items-center gap-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md shadow-cyan-500/20 hover:scale-[1.02]"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          Authorize Execution
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Audit execution log (if executed or rejected) */}
                {act.status !== 'pending_approval' && (
                  <div className="mt-3 flex items-center justify-between text-[11px] border-t border-slate-900/60 pt-3">
                    <span className="text-slate-500">
                      Status: <span className={`font-semibold capitalize ${act.status === 'executed' ? 'text-emerald-400' : 'text-red-400'}`}>{act.status}</span>
                    </span>
                    {act.execution_timestamp && (
                      <span className="text-slate-600 font-mono">
                        TS: {new Date(act.execution_timestamp).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manual Booking Override Widget */}
      <div className="bg-[#0f172a]/80 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl h-fit">
        <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2 mb-1">
          <Edit className="w-4 h-4 text-cyan-400" />
          Admin Booking Override Tool
        </h3>
        <p className="text-xs text-slate-500 mb-6">Manually adjust class size limitations in peak swell events</p>
        
        <form onSubmit={submitOverride} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Booking ID</label>
            <input
              type="text"
              value={overrideBookingId}
              onChange={(e) => setOverrideBookingId(e.target.value)}
              placeholder="e.g. bk_surf_88"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-200 placeholder-slate-650 focus:outline-none focus:border-cyan-500/50"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">New Spot Capacity</label>
              <span className="text-xs font-mono font-bold text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">{overrideCapacity} Students</span>
            </div>
            <input
              type="range"
              min="1"
              max="50"
              value={overrideCapacity}
              onChange={(e) => setOverrideCapacity(e.target.value)}
              className="w-full accent-cyan-400 bg-slate-900 h-1.5 rounded-lg cursor-pointer"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Justification Explanation</label>
            <textarea
              rows={3}
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="High swell crowd override request..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 placeholder-slate-650 focus:outline-none focus:border-cyan-500/50"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-2.5 rounded-lg text-xs transition-all shadow-md shadow-cyan-500/20 hover:scale-[1.01]"
          >
            Apply Manual Override Event
          </button>
        </form>
      </div>
    </div>
  );
};

export default ActionQueue;
