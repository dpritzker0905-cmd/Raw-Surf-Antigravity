import React from 'react';
import { Card, CardContent } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Switch } from '../../ui/switch';
import { Gift, Copy, Plus } from 'lucide-react';
import { toast } from 'sonner';

export var AdminP2PromoTab = ({
  promoCodes,
  setShowCreatePromo,
  handleTogglePromo,
  cardBgClass,
  textClass,
  textSecondary,
  formatDate
}) => {
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className={`font-medium ${textClass}`}>Promo Codes</h3>
        <Button size="sm" onClick={() => setShowCreatePromo(true)} className="bg-green-500 hover:bg-green-600" aria-label="Add">
          <Plus className="w-4 h-4 mr-1" /> Create Code
        </Button>
      </div>

      {promoCodes.length === 0 ? (
        <Card className={cardBgClass}>
          <CardContent className="py-12 text-center">
            <Gift className="w-12 h-12 mx-auto text-gray-500 mb-3" />
            <p className={textSecondary}>No promo codes yet</p>
          </CardContent>
        </Card>
      ) : (
        promoCodes.map(promo => (
          <Card key={promo.id} className={cardBgClass}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-green-500/20 rounded-lg">
                    <Gift className="w-6 h-6 text-green-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <code className="text-lg font-bold text-foreground bg-muted px-2 py-0.5 rounded">
                        {promo.code}
                      </code>
                      <Button aria-label="Copy" 
                        size="sm" 
                        variant="ghost" 
                        className="h-6 w-6 p-0"
                        onClick={() => { navigator.clipboard.writeText(promo.code); toast.success('Copied!'); }}
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                    <p className={`text-sm ${textSecondary}`}>
                      {promo.code_type === 'percentage' ? `${promo.discount_value}% off` :
                       promo.code_type === 'fixed_amount' ? `$${promo.discount_value} off` :
                       `${promo.discount_value} free credits`}
                      {promo.campaign_name && ` — ${promo.campaign_name}`}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm text-foreground">
                      {promo.current_uses} / {promo.max_uses || '∞'} uses
                    </p>
                    {promo.valid_until && (
                      <p className="text-xs text-gray-500">
                        Expires {formatDate(promo.valid_until)}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={promo.is_active}
                    onCheckedChange={() => handleTogglePromo(promo.id)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
};
