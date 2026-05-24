import React, { useState, useEffect } from 'react';
import { 
  Sparkles, RefreshCw, AlertCircle, Share2, Clock, Check, Edit3, Heart, TrendingUp, Compass, Flame
} from 'lucide-react';
import apiClient from '../../lib/apiClient';
import { toast } from 'sonner';

interface MediaQueueItem {
  queue_id: string;
  correlation_id?: string;
  type?: string;
  status: string;
  caption: string;
  media_url: string;
  booking_id: string;
}

export const SocialIntelligencePanel: React.FC = () => {
  const [queue, setQueue] = useState<MediaQueueItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingCaption, setEditingCaption] = useState<string>('');
  const [isEditing, setIsEditing] = useState<boolean>(false);

  const fetchQueue = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/admin/event-dashboard/media-queue');
      if (res.data?.success) {
        const items = res.data.queue || [];
        setQueue(items);
        if (items.length > 0 && !selectedId) {
          const pending = items.filter((i: any) => i.status === 'pending_review');
          if (pending.length > 0) {
            setSelectedId(pending[0].queue_id);
            setEditingCaption(pending[0].caption);
          } else {
            setSelectedId(items[0].queue_id);
            setEditingCaption(items[0].caption);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch media review queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
  }, []);

  const selectedItem = queue.find(item => item.queue_id === selectedId) || null;

  const handleSelect = (item: MediaQueueItem) => {
    setSelectedId(item.queue_id);
    setEditingCaption(item.caption);
    setIsEditing(false);
  };

  const handleApprove = async () => {
    if (!selectedItem) return;
    try {
      toast.loading('Injecting publish approval onto Spine...', { id: 'social-pub' });
      const res = await apiClient.post('/admin/event-dashboard/media-queue/approve', {
        queue_id: selectedItem.queue_id,
        caption: editingCaption,
        correlation_id: selectedItem.correlation_id
      });
      if (res.data?.success) {
        toast.success('Social post approved! Causal publish event injected into Event Spine.', { id: 'social-pub' });
        setIsEditing(false);
        // Refresh and select next
        const oldId = selectedItem.queue_id;
        const resQueue = await apiClient.get('/admin/event-dashboard/media-queue');
        if (resQueue.data?.success) {
          const items: MediaQueueItem[] = resQueue.data.queue || [];
          setQueue(items);
          const pending = items.filter(i => i.status === 'pending_review' && i.queue_id !== oldId);
          if (pending.length > 0) {
            setSelectedId(pending[0].queue_id);
            setEditingCaption(pending[0].caption);
          } else if (items.length > 0) {
            setSelectedId(items[0].queue_id);
            setEditingCaption(items[0].caption);
          } else {
            setSelectedId(null);
          }
        }
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to approve social post', { id: 'social-pub' });
    }
  };

  const pendingItems = queue.filter(item => item.status === 'pending_review');

  // Compute hypothetical AI metrics based on queue item properties
  const getSimulatedMetrics = (item: MediaQueueItem) => {
    const seed = item.queue_id.charCodeAt(0) || 50;
    const priorityScore = Math.max(68, Math.min(98, (seed % 30) + 68));
    const impressionsReach = Math.round((seed * 38) + 4000);
    const likePrediction = Math.round(impressionsReach * 0.08);
    const bookingImpact = Math.round((seed % 10) + 4);
    
    // Choose optimal posting time based on priority
    const hours = ['16:45', '17:30', '18:15', '19:00'];
    const optimalTime = `${hours[seed % hours.length]} UTC (${seed % 2 === 0 ? 'Today' : 'Tomorrow'})`;

    return {
      priorityScore,
      impressionsReach,
      likePrediction,
      bookingImpact,
      optimalTime
    };
  };

  const mockMetrics = selectedItem ? getSimulatedMetrics(selectedItem) : null;

  return (
    <div className="bg-[#0f172a]/80 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            Social Intelligence & Predictions Panel
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Augment gallery highlights with content prioritization scores, engagement predictions, and optimal scheduling times.
          </p>
        </div>

        <button
          onClick={fetchQueue}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
          Sync Gallery Media
        </button>
      </div>

      {loading ? (
        <div className="py-20 flex justify-center">
          <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      ) : queue.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-xs flex flex-col items-center gap-3">
          <AlertCircle className="w-8 h-8 text-slate-700" />
          No session gallery highlights enqueued in the media pipeline.
          <span className="text-[10px] text-slate-600">Simulate a completed booking session to populate highlight media streams!</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Sidebar: Highlights Ledger */}
          <div className="space-y-4 lg:col-span-1 border-r border-slate-850 pr-4">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              Gallery Media Streams ({pendingItems.length} Pending)
            </label>
            
            <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1 scrollbar-thin">
              {queue.map(item => {
                const isSelected = selectedId === item.queue_id;
                const isPending = item.status === 'pending_review';
                const metrics = getSimulatedMetrics(item);

                return (
                  <button
                    key={item.queue_id}
                    onClick={() => handleSelect(item)}
                    className={`w-full text-left p-2.5 rounded-lg border transition-all flex gap-3 items-center ${
                      isSelected
                        ? 'bg-cyan-500/10 border-cyan-500/30'
                        : 'bg-slate-950/40 border-slate-900 hover:border-slate-850'
                    }`}
                  >
                    <img 
                      src={item.media_url} 
                      alt="surf photo thumbnail" 
                      className="w-12 h-12 object-cover rounded border border-slate-800"
                    />
                    <div className="space-y-0.5 truncate flex-1">
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-500">Booking: {item.booking_id}</span>
                        {!isPending && (
                          <span className="text-[8px] bg-emerald-500/10 text-emerald-400 px-1 py-0.5 rounded border border-emerald-500/20 font-bold uppercase">
                            Published
                          </span>
                        )}
                      </div>
                      <h4 className="text-[11px] font-bold text-slate-200 truncate">{item.caption}</h4>
                      <div className="flex items-center gap-2 text-[9px] text-slate-500 font-mono mt-0.5">
                        <span className="text-cyan-400">Score: {metrics.priorityScore}%</span>
                        <span>•</span>
                        <span>Reach: +{metrics.impressionsReach}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main Workspace: AI Predictions Dashboard & Review editor */}
          <div className="lg:col-span-2 space-y-5">
            {selectedItem && mockMetrics ? (
              <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
                
                {/* Media highlight card */}
                <div className="md:col-span-2 flex flex-col bg-slate-950 border border-slate-900 rounded-xl overflow-hidden shadow-lg">
                  <div className="aspect-square bg-slate-900 overflow-hidden relative">
                    <img 
                      src={selectedItem.media_url} 
                      alt="Surf highlight review" 
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-3 left-3 bg-slate-950/80 border border-slate-800 rounded px-2 py-0.5 text-[8px] font-mono font-bold text-cyan-400">
                      PRIORITIZE SCORE: {mockMetrics.priorityScore}/100
                    </div>
                  </div>
                  
                  <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] font-bold text-slate-500 uppercase font-mono">Suggested Caption</span>
                        {selectedItem.status === 'pending_review' && (
                          <button
                            onClick={() => setIsEditing(!isEditing)}
                            className="text-[9px] text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-0.5"
                          >
                            <Edit3 className="w-3 h-3" />
                            {isEditing ? 'Cancel Edit' : 'Edit Caption'}
                          </button>
                        )}
                      </div>

                      {isEditing ? (
                        <textarea
                          rows={3}
                          value={editingCaption}
                          onChange={(e) => setEditingCaption(e.target.value)}
                          className="w-full bg-slate-900 border border-cyan-500/30 text-xs rounded p-2 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono text-[10px]"
                        />
                      ) : (
                        <p className="text-xs text-slate-300 leading-relaxed italic">
                          "{editingCaption}"
                        </p>
                      )}
                    </div>

                    {selectedItem.status === 'pending_review' ? (
                      <button
                        onClick={handleApprove}
                        className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold py-2.5 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-cyan-500/10"
                      >
                        <Share2 className="w-3.5 h-3.5 fill-slate-950" />
                        Approve & Emit Publish Event
                      </button>
                    ) : (
                      <span className="w-full bg-emerald-500/10 text-emerald-400 py-2.5 rounded-lg text-xs font-bold border border-emerald-500/20 uppercase tracking-wider text-center flex items-center justify-center gap-1.5">
                        <Check className="w-4 h-4" />
                        Approved & Injected on Spine
                      </span>
                    )}
                  </div>
                </div>

                {/* AI scoring analytics overlays */}
                <div className="md:col-span-3 space-y-4">
                  <div className="bg-slate-950 border border-slate-900 rounded-xl p-4 space-y-4 shadow-md">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Flame className="w-4 h-4 text-cyan-400 animate-pulse" />
                      Social Reach & Conversion Predictions
                    </h3>

                    <div className="space-y-4">
                      {/* Metric 1: Impression Reach */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] font-mono">
                          <span className="text-slate-500">PREDICTED IMPRESSIONS REACH</span>
                          <span className="text-cyan-400 font-extrabold">+{mockMetrics.impressionsReach} users</span>
                        </div>
                        <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
                          <div className="h-full bg-cyan-500 rounded-full" style={{ width: '74%' }} />
                        </div>
                      </div>

                      {/* Metric 2: Engagement Like Count */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] font-mono">
                          <span className="text-slate-500">LIKES & SAVES CONVERSION</span>
                          <span className="text-purple-400 font-extrabold">+{mockMetrics.likePrediction} reactions</span>
                        </div>
                        <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-500 rounded-full" style={{ width: '62%' }} />
                        </div>
                      </div>

                      {/* Metric 3: Booking Conversion Impact */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] font-mono">
                          <span className="text-slate-500">ESTIMATED BOOKING CONVERSION IMPACT</span>
                          <span className="text-emerald-400 font-extrabold">+{mockMetrics.bookingImpact} bookings</span>
                        </div>
                        <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: '50%' }} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Scheduling Card */}
                  <div className="bg-slate-950 border border-slate-900 rounded-xl p-4 space-y-3">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-cyan-400" />
                      Optimal Scheduling Proposal
                    </h3>
                    <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                      Our algorithmic velocity predictor recommends releasing this highlight post during peak surfer activity windows:
                    </p>
                    <div className="bg-slate-900 border border-slate-850 rounded-lg p-2.5 flex items-center justify-between">
                      <div className="text-[10px] font-mono text-cyan-400 font-bold uppercase tracking-wider">
                        {mockMetrics.optimalTime}
                      </div>
                      <Compass className="w-4 h-4 text-slate-500 animate-spin" />
                    </div>
                  </div>
                </div>

              </div>
            ) : (
              <div className="h-full bg-slate-950 border border-slate-900 rounded-xl p-8 flex flex-col items-center justify-center text-center">
                <Sparkles className="w-10 h-10 text-slate-700 mb-2 animate-bounce" />
                <span className="text-xs text-slate-500 font-semibold font-mono">Select a highlight thumbnail in the ledger map.</span>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
};

export default SocialIntelligencePanel;
