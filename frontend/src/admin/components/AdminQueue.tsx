import React, { useState } from 'react';
import { 
  ShieldAlert, Edit, RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { AdminAction } from '../hooks/useAdminActions';
import ActionCard from './ActionCard';

interface AdminQueueProps {
  actions: AdminAction[];
  loading: boolean;
  onApprove: (action: AdminAction) => void;
  onReject: (id: string, explanation: string, correlationId?: string) => void;
  onOverride: (bookingId: string, newCapacity: number, explanation: string, correlationId?: string) => void;
}

export const AdminQueue: React.FC<AdminQueueProps> = ({
  actions,
  loading,
  onApprove,
  onReject,
  onOverride
}) => {
  const [activeTab, setActiveTab] = useState<string>('pending');
  
  // Custom manual override form
  const [overrideBookingId, setOverrideBookingId] = useState<string>('');
  const [overrideCapacity, setOverrideCapacity] = useState<string>('10');
  const [overrideReason, setOverrideReason] = useState<string>('');

  const submitOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideBookingId.trim()) {
      toast.error('Booking ID is required!');
      return;
    }
    const cap = parseInt(overrideCapacity);
    const success = await onOverride(
      overrideBookingId, 
      cap, 
      overrideReason || 'Manual capacity override via Admin Control Layer'
    );
    if (success) {
      setOverrideBookingId('');
      setOverrideCapacity('10');
      setOverrideReason('');
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
      {/* Decisions Queue list */}
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
              <ActionCard 
                key={act.decision_id} 
                action={act} 
                onApprove={onApprove} 
                onReject={onReject} 
              />
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
              <span className="text-xs font-mono font-bold text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">{overrideCapacity} Surfers</span>
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

export default AdminQueue;
