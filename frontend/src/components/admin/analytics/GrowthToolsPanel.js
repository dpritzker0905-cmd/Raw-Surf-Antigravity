/**
 * GrowthToolsPanel — Extracted from AdminUnifiedAnalytics.js (v81)
 * Promo Codes, Feature Flags, and Push Campaigns management.
 */
import React, { useState } from 'react';
import {
  Gift, Flag as FlagIcon, Bell, Loader2, Plus, Send
} from 'lucide-react';
import { Card, CardContent } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { Badge } from '../../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Switch } from '../../ui/switch';
import { toast } from 'sonner';
import apiClient from '../../../lib/apiClient';

var GrowthToolsPanel = ({
  promoCodes,
  featureFlags,
  campaigns,
  cardBgClass,
  textClass,
  textSecondary,
  onRefresh,
}) => {
  const [showCreatePromo, setShowCreatePromo] = useState(false);
  const [showCreateFlag, setShowCreateFlag] = useState(false);
  const [showCreateCampaign, setShowCreateCampaign] = useState(false);
  const [newPromo, setNewPromo] = useState({ code: '', code_type: 'percentage', discount_value: 10, max_uses: null, campaign_name: '' });
  const [newFlag, setNewFlag] = useState({ key: '', name: '', description: '', rollout_percentage: 0, is_experiment: false });
  const [newCampaign, setNewCampaign] = useState({ name: '', title: '', body: '', target_all_users: true });
  const [actionLoading, setActionLoading] = useState(false);

  const handleCreatePromo = async () => {
    if (!newPromo.code) { toast.error('Please enter a code'); return; }
    setActionLoading(true);
    try {
      await apiClient.post(`/admin/promo-codes`, newPromo);
      toast.success('Promo code created');
      setShowCreatePromo(false);
      setNewPromo({ code: '', code_type: 'percentage', discount_value: 10, max_uses: null, campaign_name: '' });
      onRefresh();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create promo code');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTogglePromo = async (codeId) => {
    try {
      await apiClient.put(`/admin/promo-codes/${codeId}/toggle`);
      onRefresh();
    } catch (error) {
      toast.error('Failed to toggle');
    }
  };

  const handleCreateFlag = async () => {
    if (!newFlag.key || !newFlag.name) { toast.error('Please fill required fields'); return; }
    setActionLoading(true);
    try {
      await apiClient.post(`/admin/feature-flags`, newFlag);
      toast.success('Feature flag created');
      setShowCreateFlag(false);
      setNewFlag({ key: '', name: '', description: '', rollout_percentage: 0, is_experiment: false });
      onRefresh();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create flag');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleFlag = async (flagId, currentState) => {
    try {
      await apiClient.put(`/admin/feature-flags/${flagId}?is_enabled=${!currentState}`);
      onRefresh();
    } catch (error) {
      toast.error('Failed to toggle');
    }
  };

  const handleCreateCampaign = async () => {
    if (!newCampaign.name || !newCampaign.title) { toast.error('Please fill required fields'); return; }
    setActionLoading(true);
    try {
      await apiClient.post(`/admin/notification-campaigns`, newCampaign);
      toast.success('Campaign created');
      setShowCreateCampaign(false);
      setNewCampaign({ name: '', title: '', body: '', target_all_users: true });
      onRefresh();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create campaign');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendCampaign = async (campaignId) => {
    if (!confirm('Send this campaign now?')) return;
    try {
      const res = await apiClient.post(`/admin/notification-campaigns/${campaignId}/send`);
      toast.success(`Sent to ${res.data.total_sent} users`);
      onRefresh();
    } catch (error) {
      toast.error('Failed to send');
    }
  };

  return (
    <>
      <div className="space-y-6">
        {/* Promo Codes */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <h3 className={`font-medium ${textClass}`}>Promo Codes</h3>
            <Button size="sm" onClick={() => setShowCreatePromo(true)} className="bg-green-500 hover:bg-green-600" aria-label="Add">
              <Plus className="w-4 h-4 mr-1" /> Create Code
            </Button>
          </div>
          {promoCodes.length === 0 ? (
            <Card className={cardBgClass}>
              <CardContent className="py-8 text-center">
                <Gift className="w-10 h-10 mx-auto text-gray-500 mb-2" />
                <p className={textSecondary}>No promo codes</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-2">
              {promoCodes.map(p => (
                <Card key={p.id} className={cardBgClass}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Gift className="w-5 h-5 text-green-400" />
                      <div>
                        <code className="font-bold text-foreground bg-muted px-2 py-0.5 rounded text-sm">{p.code}</code>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {p.code_type === 'percentage' ? `${p.discount_value}% off` : `$${p.discount_value} off`}
                          {p.campaign_name && ` · ${p.campaign_name}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{p.current_uses}/{p.max_uses || '∞'}</span>
                      <Switch checked={p.is_active} onCheckedChange={() => handleTogglePromo(p.id)} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Feature Flags */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <h3 className={`font-medium ${textClass}`}>Feature Flags</h3>
            <Button size="sm" onClick={() => setShowCreateFlag(true)} className="bg-blue-500 hover:bg-blue-600" aria-label="Add">
              <Plus className="w-4 h-4 mr-1" /> Create Flag
            </Button>
          </div>
          {featureFlags.length === 0 ? (
            <Card className={cardBgClass}>
              <CardContent className="py-8 text-center">
                <FlagIcon className="w-10 h-10 mx-auto text-gray-500 mb-2" />
                <p className={textSecondary}>No feature flags</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-2">
              {featureFlags.map(f => (
                <Card key={f.id} className={cardBgClass}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <code className="text-sm font-mono text-foreground bg-muted px-2 py-0.5 rounded">{f.key}</code>
                      <p className="text-sm text-gray-300 mt-1">{f.name}</p>
                      <p className="text-xs text-gray-500">Rollout: {f.rollout_percentage}%</p>
                    </div>
                    <Switch checked={f.is_enabled} onCheckedChange={() => handleToggleFlag(f.id, f.is_enabled)} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Push Campaigns */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <h3 className={`font-medium ${textClass}`}>Push Campaigns</h3>
            <Button size="sm" onClick={() => setShowCreateCampaign(true)} className="bg-purple-500 hover:bg-purple-600" aria-label="Add">
              <Plus className="w-4 h-4 mr-1" /> Create Campaign
            </Button>
          </div>
          {campaigns.length === 0 ? (
            <Card className={cardBgClass}>
              <CardContent className="py-8 text-center">
                <Bell className="w-10 h-10 mx-auto text-gray-500 mb-2" />
                <p className={textSecondary}>No campaigns</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-2">
              {campaigns.map(c => (
                <Card key={c.id} className={cardBgClass}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">{c.name}</p>
                        <Badge className={`text-xs ${
                          c.status === 'sent' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                        }`}>{c.status}</Badge>
                      </div>
                      <p className="text-xs text-gray-500">{c.title}</p>
                    </div>
                    {c.status === 'draft' && (
                      <Button aria-label="Send" size="sm" onClick={() => handleSendCampaign(c.id)} className="bg-green-500 hover:bg-green-600">
                        <Send className="w-3 h-3 mr-1" /> Send
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Promo Modal */}
      <Dialog open={showCreatePromo} onOpenChange={setShowCreatePromo}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader><DialogTitle>Create Promo Code</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Code</label>
              <Input value={newPromo.code} onChange={(e) => setNewPromo({...newPromo, code: e.target.value.toUpperCase()})} placeholder="SUMMER2026" className="bg-muted border-border mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">Type</label>
                <Select value={newPromo.code_type} onValueChange={(v) => setNewPromo({...newPromo, code_type: v})}>
                  <SelectTrigger className="bg-muted border-border mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage Off</SelectItem>
                    <SelectItem value="fixed_amount">Fixed Amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{newPromo.code_type === 'percentage' ? 'Percentage' : 'Amount'}</label>
                <Input type="number" value={newPromo.discount_value} onChange={(e) => setNewPromo({...newPromo, discount_value: parseFloat(e.target.value) || 0})} className="bg-muted border-border mt-1" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreatePromo(false)}>Cancel</Button>
            <Button aria-label="Loader2" onClick={handleCreatePromo} disabled={actionLoading} className="bg-green-500">{actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Flag Modal */}
      <Dialog open={showCreateFlag} onOpenChange={setShowCreateFlag}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader><DialogTitle>Create Feature Flag</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Key (snake_case)</label>
              <Input value={newFlag.key} onChange={(e) => setNewFlag({...newFlag, key: e.target.value.toLowerCase().replace(/\s/g, '_')})} placeholder="new_feature" className="bg-muted border-border mt-1 font-mono" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Name</label>
              <Input value={newFlag.name} onChange={(e) => setNewFlag({...newFlag, name: e.target.value})} placeholder="New Feature" className="bg-muted border-border mt-1" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Rollout %</label>
              <Input type="number" min="0" max="100" value={newFlag.rollout_percentage} onChange={(e) => setNewFlag({...newFlag, rollout_percentage: parseInt(e.target.value) || 0})} className="bg-muted border-border mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateFlag(false)}>Cancel</Button>
            <Button aria-label="Loader2" onClick={handleCreateFlag} disabled={actionLoading} className="bg-blue-500">{actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Campaign Modal */}
      <Dialog open={showCreateCampaign} onOpenChange={setShowCreateCampaign}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader><DialogTitle>Create Push Campaign</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Campaign Name</label>
              <Input value={newCampaign.name} onChange={(e) => setNewCampaign({...newCampaign, name: e.target.value})} placeholder="Summer Promo" className="bg-muted border-border mt-1" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Notification Title</label>
              <Input value={newCampaign.title} onChange={(e) => setNewCampaign({...newCampaign, title: e.target.value})} placeholder="Don't miss out!" className="bg-muted border-border mt-1" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Body</label>
              <Textarea value={newCampaign.body} onChange={(e) => setNewCampaign({...newCampaign, body: e.target.value})} placeholder="Your message..." className="bg-muted border-border mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateCampaign(false)}>Cancel</Button>
            <Button aria-label="Loader2" onClick={handleCreateCampaign} disabled={actionLoading} className="bg-purple-500">{actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default GrowthToolsPanel;
