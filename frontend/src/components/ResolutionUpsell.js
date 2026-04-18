/**
 * ResolutionUpsell - "Upgrade to RAW" button and modal
 * 
 * Shows on all Social-tier (1080p) clips with available RAW/4K versions.
 * Pulls price difference from photographer's pricing logic.
 */
import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { 
  Crown, ArrowUp, Loader2, Check, Zap
} from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Compact Upsell Badge - Shows on gallery item cards
 */
export const ResolutionUpsellBadge = ({ 
  galleryItemId, 
  userId,
  currentTier = 'standard',
  onUpgradeComplete
}) => {
  const [upsellInfo, setUpsellInfo] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [_loading, _setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  
  useEffect(() => {
    if (currentTier === 'pro') return; // Already at max
    
    const fetchUpsell = async () => {
      try {
        const response = await axios.get(
          `${API}/surfer-gallery/resolution-upsell/${galleryItemId}?user_id=${userId}`
        );
        if (response.data.upgrade_available) {
          setUpsellInfo(response.data);
        }
      } catch (error) {
        // Silently fail - upsell is optional
      }
    };
    
    fetchUpsell();
  }, [galleryItemId, userId, currentTier]);
  
  const handleUpgrade = async () => {
    setProcessing(true);
    try {
      await axios.post(
        `${API}/surfer-gallery/upgrade-resolution/${galleryItemId}?user_id=${userId}`
      );
      
      toast.success('Upgraded to 4K RAW!');
      setShowModal(false);
      onUpgradeComplete?.();
    } catch (error) {
      if (error.response?.status === 402) {
        toast.error('Insufficient balance');
      } else {
        toast.error('Failed to upgrade');
      }
    } finally {
      setProcessing(false);
    }
  };
  
  if (!upsellInfo?.upgrade_available) {
    return null;
  }
  
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10 gap-1"
        onClick={() => setShowModal(true)}
        data-testid="upgrade-to-raw-badge"
      >
        <ArrowUp className="w-3 h-3" />
        4K RAW
        <span className="text-xs opacity-75">+${upsellInfo.upgrade_price}</span>
      </Button>
      
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-amber-400" />
              Upgrade to RAW Quality
            </DialogTitle>
            <DialogDescription>
              Get the full resolution original file
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Current vs Upgraded */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-lg bg-zinc-800 border border-zinc-700">
                <p className="text-xs text-zinc-400 mb-1">Current</p>
                <p className="font-medium text-foreground">1080p Social</p>
                <p className="text-xs text-zinc-500 mt-1">
                  {upsellInfo.media_type === 'video' ? 'HD Video' : 'Standard Photo'}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30">
                <p className="text-xs text-amber-400 mb-1">Upgraded</p>
                <p className="font-medium text-amber-300">4K RAW</p>
                <p className="text-xs text-amber-400/70 mt-1">
                  {upsellInfo.media_type === 'video' ? '4K Video' : 'Original RAW'}
                </p>
              </div>
            </div>
            
            {/* Benefits */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="text-zinc-300">Full original resolution</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="text-zinc-300">No watermarks</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="text-zinc-300">Print-ready quality</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="text-zinc-300">Unlimited downloads</span>
              </div>
            </div>
            
            {/* Price */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <span className="text-zinc-400">Upgrade Price</span>
              <span className="text-xl font-bold text-amber-400">
                ${upsellInfo.upgrade_price.toFixed(2)}
              </span>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              Maybe Later
            </Button>
            <Button
              className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
              onClick={handleUpgrade}
              disabled={processing}
            >
              {processing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Upgrading...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Upgrade Now
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

/**
 * Inline Upsell Card - Shows in gallery view for Standard tier items
 */
export const ResolutionUpsellCard = ({ 
  galleryItemId, 
  userId, 
  _mediaType = 'image',
  onUpgradeComplete 
}) => {
  const [upsellInfo, setUpsellInfo] = useState(null);
  const [processing, setProcessing] = useState(false);
  
  useEffect(() => {
    const fetchUpsell = async () => {
      try {
        const response = await axios.get(
          `${API}/surfer-gallery/resolution-upsell/${galleryItemId}?user_id=${userId}`
        );
        if (response.data.upgrade_available) {
          setUpsellInfo(response.data);
        }
      } catch (error) {
        // Silently fail
      }
    };
    
    fetchUpsell();
  }, [galleryItemId, userId]);
  
  const handleUpgrade = async () => {
    setProcessing(true);
    try {
      await axios.post(
        `${API}/surfer-gallery/upgrade-resolution/${galleryItemId}?user_id=${userId}`
      );
      
      toast.success('Upgraded to 4K RAW!');
      onUpgradeComplete?.();
    } catch (error) {
      if (error.response?.status === 402) {
        toast.error('Insufficient balance');
      } else {
        toast.error('Failed to upgrade');
      }
    } finally {
      setProcessing(false);
    }
  };
  
  if (!upsellInfo?.upgrade_available) {
    return null;
  }
  
  return (
    <div className="flex items-center justify-between p-3 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-lg">
      <div className="flex items-center gap-2">
        <Crown className="w-5 h-5 text-amber-400" />
        <div>
          <p className="text-sm font-medium text-amber-300">Upgrade to RAW</p>
          <p className="text-xs text-amber-400/70">Get full 4K resolution</p>
        </div>
      </div>
      <Button
        size="sm"
        className="bg-amber-500 hover:bg-amber-600 text-black"
        onClick={handleUpgrade}
        disabled={processing}
      >
        {processing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>+${upsellInfo.upgrade_price}</>
        )}
      </Button>
    </div>
  );
};

export default ResolutionUpsellBadge;
