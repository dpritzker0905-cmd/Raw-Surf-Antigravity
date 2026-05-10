import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../ui/dialog';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Switch } from '../../ui/switch';
import { Loader2 } from 'lucide-react';

export const AdminP2Modals = ({
  showCreatePromo, setShowCreatePromo, newPromo, setNewPromo, handleCreatePromo,
  showCreateFlag, setShowCreateFlag, newFlag, setNewFlag, handleCreateFlag,
  showCreateCampaign, setShowCreateCampaign, newCampaign, setNewCampaign, handleCreateCampaign,
  actionLoading
}) => {
  return (
    <>
      <Dialog open={showCreatePromo} onOpenChange={setShowCreatePromo}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle>Create Promo Code</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Code</label>
              <Input
                value={newPromo.code}
                onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })}
                placeholder="SUMMER2026"
                className="bg-muted border-border mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">Type</label>
                <Select value={newPromo.code_type} onValueChange={(v) => setNewPromo({ ...newPromo, code_type: v })}>
                  <SelectTrigger className="bg-muted border-border mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage Off</SelectItem>
                    <SelectItem value="fixed_amount">Fixed Amount</SelectItem>
                    <SelectItem value="free_credits">Free Credits</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">
                  {newPromo.code_type === 'percentage' ? 'Percentage' : 'Amount'}
                </label>
                <Input
                  type="number"
                  value={newPromo.discount_value}
                  onChange={(e) => setNewPromo({ ...newPromo, discount_value: parseFloat(e.target.value) })}
                  className="bg-muted border-border mt-1"
                />
              </div>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Max Uses (optional)</label>
              <Input
                type="number"
                value={newPromo.max_uses || ''}
                onChange={(e) => setNewPromo({ ...newPromo, max_uses: e.target.value ? parseInt(e.target.value) : null })}
                placeholder="Unlimited"
                className="bg-muted border-border mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Campaign Name (optional)</label>
              <Input
                value={newPromo.campaign_name}
                onChange={(e) => setNewPromo({ ...newPromo, campaign_name: e.target.value })}
                placeholder="Summer Sale 2026"
                className="bg-muted border-border mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreatePromo(false)}>Cancel</Button>
            <Button aria-label="Loader2" onClick={handleCreatePromo} disabled={actionLoading} className="bg-green-500 hover:bg-green-600">
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateFlag} onOpenChange={setShowCreateFlag}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle>Create Feature Flag</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Key (snake_case)</label>
              <Input
                value={newFlag.key}
                onChange={(e) => setNewFlag({ ...newFlag, key: e.target.value.toLowerCase().replace(/\s/g, '_') })}
                placeholder="new_booking_flow"
                className="bg-muted border-border mt-1 font-mono"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Name</label>
              <Input
                value={newFlag.name}
                onChange={(e) => setNewFlag({ ...newFlag, name: e.target.value })}
                placeholder="New Booking Flow"
                className="bg-muted border-border mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Description</label>
              <Textarea
                value={newFlag.description}
                onChange={(e) => setNewFlag({ ...newFlag, description: e.target.value })}
                placeholder="What does this flag control?"
                className="bg-muted border-border mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Initial Rollout %</label>
              <Input
                type="number"
                min="0"
                max="100"
                value={newFlag.rollout_percentage}
                onChange={(e) => setNewFlag({ ...newFlag, rollout_percentage: parseInt(e.target.value) })}
                className="bg-muted border-border mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateFlag(false)}>Cancel</Button>
            <Button aria-label="Loader2" onClick={handleCreateFlag} disabled={actionLoading} className="bg-blue-500 hover:bg-blue-600">
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateCampaign} onOpenChange={setShowCreateCampaign}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle>Create Push Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Campaign Name</label>
              <Input
                value={newCampaign.name}
                onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })}
                placeholder="Summer Promo Announcement"
                className="bg-muted border-border mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Notification Title</label>
              <Input
                value={newCampaign.title}
                onChange={(e) => setNewCampaign({ ...newCampaign, title: e.target.value })}
                placeholder="🔥 Don't miss out!"
                className="bg-muted border-border mt-1"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Notification Body</label>
              <Textarea
                value={newCampaign.body}
                onChange={(e) => setNewCampaign({ ...newCampaign, body: e.target.value })}
                placeholder="Book your next session and get 20% off..."
                className="bg-muted border-border mt-1"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={newCampaign.target_all_users}
                onCheckedChange={(v) => setNewCampaign({ ...newCampaign, target_all_users: v })}
              />
              <label className="text-sm text-muted-foreground">Send to all users</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateCampaign(false)}>Cancel</Button>
            <Button aria-label="Loader2" onClick={handleCreateCampaign} disabled={actionLoading} className="bg-purple-500 hover:bg-purple-600">
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
