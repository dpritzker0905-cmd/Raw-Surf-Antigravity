import React, { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../../lib/apiClient';
import {
  Shield, Zap, Users, DollarSign, Search, Ban, CheckCircle,
  Loader2, ChevronDown, ChevronLeft, ChevronRight, Eye, Trash2, UserX, UserCheck,
  Crown, Trophy, Radio, MapPin, Camera, Play, Square, Image, Video,
  Upload, X, Check, User, FileText, ArrowLeft, Settings, Activity,
  Megaphone, History, RefreshCw, TrendingUp, PieChart, BarChart3, Wallet, AlertCircle, Edit, BarChart2,
  Headphones, Server, Flag, Mail, Layout, Lock
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { toast } from 'sonner';
import { getFullUrl } from '../../utils/media';
import logger from '../../utils/logger';
import { AdminSpotEditor } from './AdminSpotEditor';
import { AdminPrecisionQueue } from './AdminPrecisionQueue';

/**
 * AdControlsPanel — Extracted from UnifiedAdminConsole
 * Admin control for ad frequency, approval queue, and variant management.
 */
// Ad Controls Panel Component with Approval Queue
const AdControlsPanel = ({ user }) => {
  const [config, setConfig] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('overview'); // 'overview', 'queue', 'variants'
  const [processingAd, setProcessingAd] = useState(null);
  const [editingAd, setEditingAd] = useState(null);
  const [editForm, setEditForm] = useState({});

  useEffect(() => {
    fetchAdData();
  }, [user?.id]);

  const fetchAdData = async () => {
    try {
      const [configRes, analyticsRes, queueRes] = await Promise.all([
        apiClient.get(`/admin/ads/config`).catch(() => ({ data: { config: null } })),
        apiClient.get(`/admin/ads/analytics`).catch(() => ({ data: null })),
        apiClient.get(`/admin/ads/queue?status=pending`).catch(() => ({ data: { queue: [], counts: {} } }))
      ]);
      setConfig(configRes.data?.config);
      setAnalytics(analyticsRes.data);
      setQueue(queueRes.data);
    } catch (error) {
      logger.error('Failed to fetch ad config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFrequencyChange = async (newFreq) => {
    setSaving(true);
    try {
      await apiClient.patch(`/admin/ads/frequency?frequency=${newFreq}`);
      setConfig(prev => ({ ...prev, frequency: newFreq }));
      toast.success(`Ad frequency updated to 1 per ${newFreq} posts`);
    } catch (error) {
      toast.error('Failed to update frequency');
    } finally {
      setSaving(false);
    }
  };

  const toggleVariant = async (variantId, isActive) => {
    try {
      await apiClient.patch(`/admin/ads/variant/${variantId}/toggle?is_active=${isActive}`);
      setConfig(prev => ({
        ...prev,
        variants: prev.variants.map(v => v.id === variantId ? { ...v, is_active: isActive } : v)
      }));
      toast.success(`Variant ${isActive ? 'enabled' : 'disabled'}`);
    } catch (error) {
      toast.error('Failed to toggle variant');
    }
  };

  const handleApproveAd = async (adId) => {
    setProcessingAd(adId);
    try {
      await apiClient.post(`/admin/ads/queue/${adId}/action`, {
        action: 'approve'
      });
      toast.success('Ad approved and activated!');
      fetchAdData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to approve ad');
    } finally {
      setProcessingAd(null);
    }
  };

  const handleRejectAd = async (adId, reason) => {
    setProcessingAd(adId);
    try {
      await apiClient.post(`/admin/ads/queue/${adId}/action`, {
        action: 'reject',
        reason: reason || 'Does not meet advertising guidelines'
      });
      toast.success('Ad rejected');
      fetchAdData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to reject ad');
    } finally {
      setProcessingAd(null);
    }
  };

  const handleEditAd = async (adId) => {
    setProcessingAd(adId);
    try {
      await apiClient.post(`/admin/ads/queue/${adId}/action`, {
        action: 'edit',
        edited_content: editForm
      });
      toast.success('Ad content updated');
      setEditingAd(null);
      setEditForm({});
      fetchAdData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to edit ad');
    } finally {
      setProcessingAd(null);
    }
  };

  const startEditing = (ad) => {
    setEditingAd(ad.id);
    setEditForm({
      headline: ad.headline,
      description: ad.description || ad.body,
      cta: ad.cta,
      cta_link: ad.cta_link
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex border-b border-zinc-700">
        <button
          onClick={() => setActiveSubTab('overview')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            activeSubTab === 'overview' 
              ? 'text-white border-b-2 border-cyan-400' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveSubTab('queue')}
          className={`flex-1 py-2 text-sm font-medium transition-colors relative ${
            activeSubTab === 'queue' 
              ? 'text-white border-b-2 border-cyan-400' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Approval Queue
          {queue?.counts?.pending > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
              {queue.counts.pending}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveSubTab('variants')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            activeSubTab === 'variants' 
              ? 'text-white border-b-2 border-cyan-400' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          All Variants
        </button>
      </div>

      {/* Overview Sub-Tab */}
      {activeSubTab === 'overview' && (
        <>
          {/* Analytics */}
          {analytics && (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-white text-sm">Ad Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-zinc-800 rounded-lg p-2 text-center">
                    <p className="text-gray-400 text-xs">Impressions</p>
                    <p className="text-white font-bold">{analytics.analytics?.total_impressions || 0}</p>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-2 text-center">
                    <p className="text-gray-400 text-xs">Clicks</p>
                    <p className="text-white font-bold">{analytics.analytics?.total_clicks || 0}</p>
                  </div>
                  <div className="bg-zinc-800 rounded-lg p-2 text-center">
                    <p className="text-gray-400 text-xs">Ad-Free Users</p>
                    <p className="text-green-400 font-bold">{analytics.ad_free_users || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Frequency Control */}
          {config && (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-white text-sm">Ad Frequency</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <p className="text-gray-400 text-sm flex-1">
                    Show 1 ad every <span className="text-cyan-400 font-bold">{config.frequency}</span> posts
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleFrequencyChange(Math.max(3, (config.frequency || 6) - 1))}
                      disabled={saving || config.frequency <= 3}
                      className="border-zinc-700 w-8 h-8 p-0"
                    >
                      -
                    </Button>
                    <span className="text-white font-bold w-8 text-center">{config.frequency}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleFrequencyChange(Math.min(20, (config.frequency || 6) + 1))}
                      disabled={saving || config.frequency >= 20}
                      className="border-zinc-700 w-8 h-8 p-0"
                    >
                      +
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Queue Summary */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-white text-sm">Approval Queue Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-center">
                  <p className="text-yellow-400 text-xs">Pending</p>
                  <p className="text-white font-bold text-xl">{queue?.counts?.pending || 0}</p>
                </div>
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-center">
                  <p className="text-green-400 text-xs">Approved</p>
                  <p className="text-white font-bold text-xl">{queue?.counts?.approved || 0}</p>
                </div>
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">
                  <p className="text-red-400 text-xs">Rejected</p>
                  <p className="text-white font-bold text-xl">{queue?.counts?.rejected || 0}</p>
                </div>
              </div>
              {queue?.counts?.pending > 0 && (
                <Button 
                  onClick={() => setActiveSubTab('queue')}
                  className="w-full mt-3 bg-yellow-500 hover:bg-yellow-600 text-black"
                >
                  Review {queue.counts.pending} Pending Ad{queue.counts.pending > 1 ? 's' : ''}
                </Button>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Approval Queue Sub-Tab */}
      {activeSubTab === 'queue' && (
        <div className="space-y-3">
          {(!queue?.pending || queue?.pending?.length === 0) ? (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="py-8 text-center">
                <Megaphone className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">No pending ads to review</p>
                <p className="text-gray-500 text-sm mt-1">
                  User-submitted ads will appear here for approval
                </p>
              </CardContent>
            </Card>
          ) : (
            queue?.pending?.map((ad) => (
              <Card key={ad.id} className="bg-zinc-900 border-yellow-500/30">
                <CardContent className="p-4">
                  {editingAd === ad.id ? (
                    // Edit Mode
                    <div className="space-y-3">
                      <Input
                        value={editForm.headline}
                        onChange={(e) => setEditForm(prev => ({ ...prev, headline: e.target.value }))}
                        placeholder="Headline"
                        className="bg-zinc-800 border-zinc-700 text-white"
                      />
                      <Textarea
                        value={editForm.description}
                        onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Description"
                        className="bg-zinc-800 border-zinc-700 text-white"
                        rows={2}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          value={editForm.cta}
                          onChange={(e) => setEditForm(prev => ({ ...prev, cta: e.target.value }))}
                          placeholder="CTA Text"
                          className="bg-zinc-800 border-zinc-700 text-white"
                        />
                        <Input
                          value={editForm.cta_link}
                          onChange={(e) => setEditForm(prev => ({ ...prev, cta_link: e.target.value }))}
                          placeholder="CTA Link"
                          className="bg-zinc-800 border-zinc-700 text-white"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleEditAd(ad.id)}
                          disabled={processingAd === ad.id}
                          className="flex-1 bg-cyan-500 hover:bg-cyan-600"
                        >
                          {processingAd === ad.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => { setEditingAd(null); setEditForm({}); }}
                          className="border-zinc-700"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // View Mode
                    <>
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="text-white font-medium">{ad.headline}</p>
                          <p className="text-gray-400 text-sm">{ad.description || ad.body}</p>
                        </div>
                        <Badge className="bg-yellow-500/20 text-yellow-400">
                          {ad.approval_status || 'pending'}
                        </Badge>
                      </div>
                      
                      <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                        <span>By: {ad.submitted_by_name || 'Unknown'}</span>
                        <span>Budget: ${ad.budget_credits || 0}</span>
                        <span>CTA: {ad.cta}</span>
                      </div>
                      
                      {/* Media Preview - Support for both images and videos */}
                      {(ad.image_url || ad.video_url) && (
                        <div className="mb-3 relative rounded-lg overflow-hidden">
                          {ad.media_type === 'video' || ad.video_url ? (
                            <>
                              <video 
                                src={ad.video_url || ad.image_url} 
                                poster={ad.thumbnail_url}
                                className="w-full h-32 object-cover" 
                                controls
                              />
                              <div className="absolute top-2 left-2">
                                <Badge className="bg-red-500/90 text-white text-xs">
                                  <Video className="w-3 h-3 mr-1" />
                                  Video
                                </Badge>
                              </div>
                            </>
                          ) : (
                            <>
                              <img 
                                src={getFullUrl(ad.image_url)} 
                                alt="Ad preview" 
                                className="w-full h-32 object-cover" 
                              />
                              <div className="absolute top-2 left-2">
                                <Badge className="bg-blue-500/90 text-white text-xs">
                                  <Image className="w-3 h-3 mr-1" />
                                  Image
                                </Badge>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleApproveAd(ad.id)}
                          disabled={processingAd === ad.id}
                          className="flex-1 bg-green-500 hover:bg-green-600"
                        >
                          {processingAd === ad.id ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                            <>
                              <Check className="w-4 h-4 mr-1" />
                              Approve
                            </>
                          )}
                        </Button>
                        <Button
                          onClick={() => handleRejectAd(ad.id)}
                          disabled={processingAd === ad.id}
                          className="flex-1 bg-red-500 hover:bg-red-600"
                        >
                          <X className="w-4 h-4 mr-1" />
                          Reject
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => startEditing(ad)}
                          className="border-zinc-700"
                        >
                          <FileText className="w-4 h-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* All Variants Sub-Tab */}
      {activeSubTab === 'variants' && config?.variants && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-white text-sm">All Ad Variants ({config.variants.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {config.variants.map((variant) => (
                <div key={variant.id} className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg">
                  <div className="flex-1">
                    <p className="text-white font-medium text-sm">{variant.headline}</p>
                    <p className="text-gray-400 text-xs">
                      {variant.type} • {variant.cta}
                      {variant.submitted_by_name && (
                        <span className="text-cyan-400 ml-2">by {variant.submitted_by_name}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {variant.approval_status && (
                      <Badge className={
                        variant.approval_status === 'approved' ? 'bg-green-500/20 text-green-400' :
                        variant.approval_status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }>
                        {variant.approval_status}
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant={variant.is_active ? 'default' : 'outline'}
                      onClick={() => toggleVariant(variant.id, !variant.is_active)}
                      className={variant.is_active ? 'bg-green-500 hover:bg-green-600' : 'border-zinc-600'}
                    >
                      {variant.is_active ? 'Active' : 'Disabled'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};



export { AdControlsPanel };
