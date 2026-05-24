import React, { useState, useEffect } from 'react';
import { 
  Image as ImageIcon, Share2, Check, Clock, AlertCircle, RefreshCw, Edit3
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

export const MediaReview: React.FC = () => {
  const [queue, setQueue] = useState<MediaQueueItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCaption, setEditingCaption] = useState<string>('');

  const fetchQueue = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/admin/event-dashboard/media-queue');
      if (res.data?.success) {
        setQueue(res.data.queue || []);
      }
    } catch (err) {
      console.error('Failed to fetch media queue:', err);
      toast.error('Failed to load media review queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
  }, []);

  const handleApprove = async (item: MediaQueueItem) => {
    try {
      toast.loading('Publishing social gallery post...', { id: 'media-post' });
      const captionToUse = editingId === item.queue_id ? editingCaption : item.caption;
      
      const res = await apiClient.post('/admin/event-dashboard/media-queue/approve', {
        queue_id: item.queue_id,
        caption: captionToUse,
        correlation_id: item.correlation_id
      });
      
      if (res.data?.success) {
        toast.success('Social post published successfully!', { id: 'media-post' });
        setEditingId(null);
        fetchQueue(); // refresh queue
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to approve media post', { id: 'media-post' });
    }
  };

  const handleStartEdit = (item: MediaQueueItem) => {
    setEditingId(item.queue_id);
    setEditingCaption(item.caption);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingCaption('');
  };

  const pendingItems = queue.filter(item => item.status === 'pending_review');
  const historicalItems = queue.filter(item => item.status !== 'pending_review');

  return (
    <div className="bg-[#0f172a]/80 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-cyan-400" />
            Media & Social Feed Review Panel
          </h2>
          <p className="text-sm text-slate-400 mt-1">Review photo gallery posts prior to public feed publishing</p>
        </div>
        <button 
          onClick={fetchQueue}
          className="text-slate-500 hover:text-slate-300 p-2 hover:bg-slate-800 rounded-lg transition-all"
          aria-label="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      ) : queue.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm flex flex-col items-center gap-3">
          <AlertCircle className="w-8 h-8 text-slate-650" />
          No items currently enqueued in the media review queue.
          <span className="text-xs text-slate-600">Simulate a completed session to auto-enqueue gallery review posts!</span>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Pending Reviews */}
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Pending Approvals ({pendingItems.length})</h3>
            {pendingItems.length === 0 ? (
              <div className="text-center py-8 bg-slate-900/20 rounded-lg border border-dashed border-slate-850 text-slate-500 text-xs">
                All media queue items have been approved!
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {pendingItems.map((item) => (
                  <div 
                    key={item.queue_id}
                    className="bg-slate-950/40 border border-slate-900 rounded-xl overflow-hidden shadow-lg group hover:border-slate-850 transition-all flex flex-col"
                  >
                    {/* Media Image */}
                    <div className="relative aspect-video bg-slate-900 overflow-hidden">
                      <img 
                        src={item.media_url} 
                        alt="Surf session snap"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <span className="absolute bottom-3 left-3 bg-slate-950/80 backdrop-blur-sm border border-slate-800 text-[10px] font-mono text-cyan-400 px-2 py-0.5 rounded flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Booking: {item.booking_id}
                      </span>
                    </div>

                    {/* Content / Editing */}
                    <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                      {editingId === item.queue_id ? (
                        <div className="space-y-2">
                          <textarea
                            rows={3}
                            value={editingCaption}
                            onChange={(e) => setEditingCaption(e.target.value)}
                            className="w-full bg-slate-900 border border-cyan-500/30 text-xs rounded p-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                          />
                          <div className="flex justify-end gap-1.5">
                            <button 
                              onClick={handleCancelEdit}
                              className="text-[10px] text-slate-400 hover:text-slate-200 px-2 py-1"
                            >
                              Cancel
                            </button>
                            <button 
                              onClick={() => setEditingId(null)}
                              className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded text-[10px]"
                            >
                              Save Preview
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex justify-between items-start">
                            <span className="text-[10px] font-bold text-slate-500 uppercase">Caption</span>
                            <button 
                              onClick={() => handleStartEdit(item)}
                              className="text-slate-500 hover:text-cyan-400 flex items-center gap-0.5 text-[10px]"
                            >
                              <Edit3 className="w-3 h-3" />
                              Edit Caption
                            </button>
                          </div>
                          <p className="text-xs text-slate-300 leading-relaxed italic">
                            "{item.caption}"
                          </p>
                        </div>
                      )}

                      {/* Approve / Decline buttons */}
                      <div className="flex gap-2 border-t border-slate-900/60 pt-3">
                        <button
                          onClick={() => handleApprove(item)}
                          className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-2 rounded-lg text-xs flex items-center justify-center gap-1 transition-all"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          Publish to Social Feed
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Historical Reviews */}
          {historicalItems.length > 0 && (
            <div className="border-t border-slate-850 pt-6">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Publication History ({historicalItems.length})</h3>
              <div className="space-y-2.5 max-h-[250px] overflow-y-auto pr-2 scrollbar-thin">
                {historicalItems.map(item => (
                  <div 
                    key={item.queue_id}
                    className="bg-slate-950/20 border border-slate-900 rounded-lg p-3 flex justify-between items-center text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <img 
                        src={item.media_url} 
                        alt="surfer snapshot"
                        className="w-10 h-10 object-cover rounded border border-slate-850"
                      />
                      <div>
                        <div className="font-semibold text-slate-300">Published post for booking: {item.booking_id}</div>
                        <div className="text-slate-500 text-[10px] mt-0.5 truncate max-w-[280px]">"{item.caption}"</div>
                      </div>
                    </div>

                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      <Check className="w-3.5 h-3.5" />
                      Approved & Published
                    </span>
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

export default MediaReview;
