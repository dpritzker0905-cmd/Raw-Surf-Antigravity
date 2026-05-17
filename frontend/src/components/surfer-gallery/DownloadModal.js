import React from 'react';
import { Download } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

var DownloadModal = ({ item, isOpen, onClose, onDownload, onPurchase }) => {
  if (!item) return null;
  
  const tiers = [
    { id: 'web', label: 'Web Quality', desc: '1200px - Social media', price: item.price !== undefined ? item.price : 3.0 },
    { id: 'standard', label: 'Standard', desc: '2400px - Prints up to 8x10', price: item.price !== undefined ? item.price : 5.0 },
    { id: 'high', label: 'High Resolution', desc: 'Full size - Large prints', price: item.price !== undefined ? item.price : 10.0 },
  ];
  
  const isAccessible = item.is_paid || ['included', 'gifted'].includes(item.access_type);
  const isFreeFromSession = item.price === 0.0 && item.price_source === 'included';
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5 text-cyan-400" />
            Download Options
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {tiers.map(tier => (
            <button
              key={tier.id}
              onClick={() => onDownload(item.id, tier.id)}
              disabled={!isAccessible}
              className={`w-full p-3 rounded-lg border text-left transition-all ${
                isAccessible 
                  ? 'border-zinc-700 hover:border-cyan-500/50 hover:bg-cyan-500/10' 
                  : 'border-border opacity-50 cursor-not-allowed'
              }`}
            >
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-medium">{tier.label}</p>
                  <p className="text-sm text-muted-foreground">{tier.desc}</p>
                </div>
                {isAccessible ? (
                  <Download className="w-5 h-5 text-cyan-400" />
                ) : (
                  <span className="text-amber-400">${tier.price.toFixed(2)}</span>
                )}
              </div>
            </button>
          ))}
        </div>
        {!isAccessible && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex flex-col gap-3">
            <p className="text-sm text-amber-400">
              {isFreeFromSession 
                ? "This photo is included in your session package! Click below to unlock." 
                : "Purchase this photo to unlock downloads"}
            </p>
            <Button
              className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
              onClick={() => onPurchase(item.id, 'high')} // Defaulting to high quality purchase
            >
               {isFreeFromSession ? "Unlock Included Photo" : `Buy Now ($${tiers[2].price.toFixed(2)})`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default DownloadModal;
