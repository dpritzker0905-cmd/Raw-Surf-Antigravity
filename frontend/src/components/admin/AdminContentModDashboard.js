import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import axios from 'axios';
import {
  Shield, Image, MessageSquare, Check, X,
  Loader2, RefreshCw, Eye, Flag, Trash2
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Textarea } from '../ui/textarea';
import { toast } from 'sonner';
import logger from '../../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Admin Content Moderation Dashboard
 * - Review flagged content (posts, comments, images)
 * - Approve, reject, or escalate content
 * - Bulk moderation actions
 */
export const AdminContentModDashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedItems, setSelectedItems] = useState(new Set());
  
  // Filters
  const [contentType, setContentType] = useState('all');
  const [status, setStatus] = useState('pending');
  
  // Preview
  const [selectedItem, setSelectedItem] = useState(null);
  const [moderationNote, setModerationNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/50 border-zinc-800';
  const textClass = isLight ? 'text-gray-900' : 'text-white';

  useEffect(() => {
    if (user?.id) {
      fetchQueue();
      fetchStats();
    }
  }, [user?.id, contentType, status]);

  const fetchQueue = async () => {
    setLoading(true);
    try {
      let url = `${API}/admin/content-moderation/queue?admin_id=${user.id}&status=${status}&limit=50`;
      if (contentType && contentType !== 'all') url += `&content_type=${contentType}`;
      const response = await axios.get(url);
      setItems(response.data.items || []);
    } catch (error) {
      logger.error('Failed to load queue:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await axios.get(`${API}/admin/content-moderation/stats?admin_id=${user.id}&days=30`);
      setStats(response.data);
    } catch (error) {
      logger.error('Failed to load stats:', error);
    }
  };

  const handleModerate = async (itemId, decision) => {
    setActionLoading(true);
    try {
      await axios.post(`${API}/admin/content-moderation/${itemId}/moderate?admin_id=${user.id}`, {
        decision,
        notes: moderationNote
      });
      toast.success(`Content ${decision}`);
      setSelectedItem(null);
      setModerationNote('');
      fetchQueue();
      fetchStats();
    } catch (error) {
      toast.error('Failed to moderate content');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkModerate = async (decision) => {
    if (selectedItems.size === 0) return;
    setActionLoading(true);
    try {
      await axios.post(`${API}/admin/content-moderation/bulk-moderate?admin_id=${user.id}`, {
        item_ids: Array.from(selectedItems),
        decision
      });
      toast.success(`${selectedItems.size} items ${decision}`);
      setSelectedItems(new Set());
      fetchQueue();
      fetchStats();
    } catch (error) {
      toast.error('Bulk moderation failed');
    } finally {
      setActionLoading(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getContentIcon = (type) => {
    switch (type) {
      case 'image': return <Image className="w-4 h-4 text-purple-400" />;
      case 'post': return <MessageSquare className="w-4 h-4 text-blue-400" />;
      case 'comment': return <MessageSquare className="w-4 h-4 text-green-400" />;
      default: return <Flag className="w-4 h-4 text-gray-400" />;
    }
  };

  const getReasonColor = (reason) => {
    switch (reason) {
      case 'spam': return 'bg-orange-500/20 text-orange-400';
      case 'harassment': return 'bg-red-500/20 text-red-400';
      case 'inappropriate': return 'bg-pink-500/20 text-pink-400';
      case 'copyright': return 'bg-purple-500/20 text-purple-400';
      case 'violence': return 'bg-red-500/20 text-red-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  return (
    <div className="space-y-4" data-testid="admin-content-mod-dashboard">
      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Card className={`${cardBgClass} border-yellow-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Pending Review</p>
              <p className="text-2xl font-bold text-yellow-400">{stats.pending_count}</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-green-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Approved (30d)</p>
              <p className="text-2xl font-bold text-green-400">{stats.approved_count}</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-red-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Removed (30d)</p>
              <p className="text-2xl font-bold text-red-400">{stats.removed_count}</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-cyan-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Avg Response</p>
              <p className="text-2xl font-bold text-cyan-400">{stats.avg_response_time_hours}h</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-purple-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">False Positives</p>
              <p className="text-2xl font-bold text-purple-400">{stats.false_positive_rate}%</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters & Bulk Actions */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-32 bg-zinc-800 border-zinc-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="removed">Removed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={contentType} onValueChange={setContentType}>
            <SelectTrigger className="w-32 bg-zinc-800 border-zinc-700">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="post">Posts</SelectItem>
              <SelectItem value="comment">Comments</SelectItem>
              <SelectItem value="image">Images</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => { fetchQueue(); fetchStats(); }}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {selectedItems.size > 0 && (
          <div className="flex gap-2 items-center">
            <Badge className="bg-cyan-500/20 text-cyan-400">{selectedItems.size} selected</Badge>
            <Button size="sm" onClick={() => handleBulkModerate('approved')} disabled={actionLoading} className="bg-green-500 hover:bg-green-600">
              <Check className="w-4 h-4 mr-1" /> Approve All
            </Button>
            <Button size="sm" onClick={() => handleBulkModerate('removed')} disabled={actionLoading} className="bg-red-500 hover:bg-red-600">
              <Trash2 className="w-4 h-4 mr-1" /> Remove All
            </Button>
          </div>
        )}
      </div>

      {/* Queue */}
      <Card className={cardBgClass}>
        <CardHeader className="pb-2">
          <CardTitle className={`text-sm ${textClass}`}>
            Moderation Queue ({items.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-[500px] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-8">
              <Shield className="w-10 h-10 mx-auto text-gray-500 mb-2" />
              <p className="text-gray-500">No items in queue</p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map(item => (
                <div
                  key={item.id}
                  className={`p-3 rounded-lg border transition-all ${
                    selectedItems.has(item.id)
                      ? 'bg-cyan-500/10 border-cyan-500/50'
                      : 'bg-zinc-800/50 border-transparent hover:bg-zinc-800'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className="mt-1 rounded border-zinc-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {getContentIcon(item.content_type)}
                        <span className="text-xs text-gray-500">{item.content_type}</span>
                        <Badge className={`text-[10px] ${getReasonColor(item.flag_reason)}`}>
                          {item.flag_reason}
                        </Badge>
                        <span className="text-xs text-gray-500">{item.flag_count} flags</span>
                      </div>
                      <p className={`text-sm ${textClass} line-clamp-2`}>{item.content_preview}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        By: {item.author_name} • {new Date(item.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setSelectedItem(item)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      {status === 'pending' && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => handleModerate(item.id, 'approved')} className="text-green-400 hover:bg-green-500/20">
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleModerate(item.id, 'removed')} className="text-red-400 hover:bg-red-500/20">
                            <X className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Modal */}
      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedItem && getContentIcon(selectedItem.content_type)}
              Review Content
            </DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-4">
              {/* Content Preview */}
              <div className="p-3 bg-zinc-800 rounded-lg">
                {selectedItem.media_url && (
                  <img src={selectedItem.media_url} alt="Content" className="w-full rounded mb-2 max-h-48 object-cover" />
                )}
                <p className="text-sm text-gray-300">{selectedItem.content_preview}</p>
              </div>

              {/* Metadata */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 bg-zinc-800/50 rounded">
                  <span className="text-gray-500">Author:</span>
                  <span className="text-white ml-1">{selectedItem.author_name}</span>
                </div>
                <div className="p-2 bg-zinc-800/50 rounded">
                  <span className="text-gray-500">Flags:</span>
                  <span className="text-red-400 ml-1">{selectedItem.flag_count}</span>
                </div>
                <div className="p-2 bg-zinc-800/50 rounded">
                  <span className="text-gray-500">Reason:</span>
                  <Badge className={`ml-1 text-[10px] ${getReasonColor(selectedItem.flag_reason)}`}>
                    {selectedItem.flag_reason}
                  </Badge>
                </div>
                <div className="p-2 bg-zinc-800/50 rounded">
                  <span className="text-gray-500">Created:</span>
                  <span className="text-white ml-1">{new Date(selectedItem.created_at).toLocaleDateString()}</span>
                </div>
              </div>

              {/* Moderation Note */}
              {status === 'pending' && (
                <div>
                  <label className="text-xs text-gray-500">Moderation Note (optional)</label>
                  <Textarea
                    value={moderationNote}
                    onChange={(e) => setModerationNote(e.target.value)}
                    placeholder="Add a note about this decision..."
                    className="bg-zinc-800 border-zinc-700 mt-1"
                  />
                </div>
              )}
            </div>
          )}
          {status === 'pending' && selectedItem && (
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setSelectedItem(null)}>Cancel</Button>
              <Button onClick={() => handleModerate(selectedItem.id, 'approved')} disabled={actionLoading} className="bg-green-500 hover:bg-green-600">
                <Check className="w-4 h-4 mr-1" /> Approve
              </Button>
              <Button onClick={() => handleModerate(selectedItem.id, 'removed')} disabled={actionLoading} className="bg-red-500 hover:bg-red-600">
                <Trash2 className="w-4 h-4 mr-1" /> Remove
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminContentModDashboard;
