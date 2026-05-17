import React from 'react';
import { Card, CardContent } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Bell, Plus, Users, Check, Eye, Send } from 'lucide-react';

export const AdminP2CampaignsTab = ({
  campaigns,
  setShowCreateCampaign,
  handleSendCampaign,
  actionLoading,
  cardBgClass,
  textClass,
  textSecondary,
  formatDate
}) => {
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className={`font-medium ${textClass}`}>Push Notification Campaigns</h3>
        <Button size="sm" onClick={() => setShowCreateCampaign(true)} className="bg-purple-500 hover:bg-purple-600" aria-label="Add">
          <Plus className="w-4 h-4 mr-1" /> Create Campaign
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <Card className={cardBgClass}>
          <CardContent className="py-12 text-center">
            <Bell className="w-12 h-12 mx-auto text-gray-500 mb-3" />
            <p className={textSecondary}>No campaigns yet</p>
          </CardContent>
        </Card>
      ) : (
        campaigns.map(campaign => (
          <Card key={campaign.id} className={cardBgClass}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className={`font-medium ${textClass}`}>{campaign.name}</p>
                    <Badge className={`text-xs ${
                      campaign.status === 'sent' ? 'bg-green-500/20 text-green-400' :
                      campaign.status === 'scheduled' ? 'bg-blue-500/20 text-blue-400' :
                      campaign.status === 'cancelled' ? 'bg-gray-500/20 text-muted-foreground' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {campaign.status}
                    </Badge>
                  </div>
                  <p className={`text-sm ${textSecondary}`}>
                    <strong>{campaign.title}</strong>: {campaign.body}
                  </p>
                  
                  {campaign.status === 'sent' && (
                    <div className="flex gap-4 mt-2 text-xs">
                      <span className="text-muted-foreground">
                        <Users className="w-3 h-3 inline mr-1" />
                        {campaign.stats.targeted} targeted
                      </span>
                      <span className="text-green-400">
                        <Check className="w-3 h-3 inline mr-1" />
                        {campaign.stats.delivered} delivered
                      </span>
                      <span className="text-blue-400">
                        <Eye className="w-3 h-3 inline mr-1" />
                        {campaign.stats.open_rate}% opened
                      </span>
                    </div>
                  )}
                </div>
                
                <div className="shrink-0 flex flex-col items-end gap-2">
                  <p className={`text-xs ${textSecondary}`}>
                    {campaign.sent_at ? `Sent ${formatDate(campaign.sent_at)}` : 
                     campaign.scheduled_at ? `Scheduled ${formatDate(campaign.scheduled_at)}` :
                     formatDate(campaign.created_at)}
                  </p>
                  {campaign.status === 'draft' && (
                    <Button aria-label="Send"
                      size="sm"
                      onClick={() => handleSendCampaign(campaign.id)}
                      disabled={actionLoading}
                      className="bg-green-500 hover:bg-green-600"
                    >
                      <Send className="w-3 h-3 mr-1" /> Send Now
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
};
