/**
 * QualityComparisonModal - TICKET-004
 * Side-by-side quality tier comparison for photo/video purchases
 * Shows resolution differences and helps surfers choose the right tier
 */
import React, { useState, useEffect, useRef } from 'react';
import { ZoomIn, ZoomOut, Monitor, Printer, 
  Smartphone, Check, Lock, Loader2, Info, Download
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';


import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';

// Photo tier configurations
const PHOTO_TIERS = {
  web: {
    label: 'Web',
    maxWidth: 800,
    description: 'Perfect for social media and web',
    icon: Smartphone,
    bestFor: ['Instagram', 'Facebook', 'Twitter', 'Web profiles'],
    fileSize: '~200KB'
  },
  standard: {
    label: 'Standard',
    maxWidth: 1920,
    description: 'Great for larger screens and sharing',
    icon: Monitor,
    bestFor: ['Desktop wallpaper', 'Email sharing', 'Blog posts', 'Presentations'],
    fileSize: '~800KB'
  },
  high: {
    label: 'High-Res',
    maxWidth: 4000,
    description: 'Full resolution for prints and edits',
    icon: Printer,
    bestFor: ['Large prints', 'Photo editing', 'Professional use', 'Archival'],
    fileSize: '~2-5MB'
  }
};

// Video tier configurations
const VIDEO_TIERS = {
  '720p': {
    label: '720p HD',
    resolution: '1280x720',
    description: 'Good for mobile viewing',
    icon: Smartphone,
    bestFor: ['Mobile viewing', 'Quick sharing', 'Low bandwidth'],
    fileSize: '~50MB/min'
  },
  '1080p': {
    label: '1080p Full HD',
    resolution: '1920x1080',
    description: 'Standard high definition',
    icon: Monitor,
    bestFor: ['TV viewing', 'YouTube uploads', 'General use'],
    fileSize: '~150MB/min'
  },
  '4k': {
    label: '4K Ultra HD',
    resolution: '3840x2160',
    description: 'Maximum quality for professionals',
    icon: Printer,
    bestFor: ['Large displays', 'Professional editing', 'Future-proofing'],
    fileSize: '~400MB/min'
  }
};

/**
 * Zoom lens component for quality comparison
 */
const ZoomLens = ({ imageRef, zoomPosition, zoomLevel = 2 }) => {
  const [croppedImage, setCroppedImage] = useState(null);
  const lensSize = 150;
  
  useEffect(() => {
    if (!imageRef.current || !zoomPosition) return;
    
    const img = imageRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = lensSize;
    canvas.height = lensSize;
    const ctx = canvas.getContext('2d');
    
    // Calculate source region
    const sourceX = (zoomPosition.x / img.clientWidth) * img.naturalWidth - (lensSize / zoomLevel / 2);
    const sourceY = (zoomPosition.y / img.clientHeight) * img.naturalHeight - (lensSize / zoomLevel / 2);
    const sourceSize = lensSize / zoomLevel;
    
    ctx.drawImage(
      img,
      sourceX, sourceY, sourceSize, sourceSize,
      0, 0, lensSize, lensSize
    );
    
    setCroppedImage(canvas.toDataURL());
  }, [imageRef, zoomPosition, zoomLevel]);
  
  if (!zoomPosition || !croppedImage) return null;
  
  return (
    <div 
      className="absolute pointer-events-none border-2 border-cyan-400 rounded-lg overflow-hidden shadow-xl"
      style={{
        width: lensSize,
        height: lensSize,
        left: Math.min(zoomPosition.clientX + 20, window.innerWidth - lensSize - 40),
        top: Math.min(zoomPosition.clientY - lensSize / 2, window.innerHeight - lensSize - 40),
        position: 'fixed',
        zIndex: 100
      }}
    >
      <img src={croppedImage} alt="Zoomed" className="w-full h-full" />
      <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 rounded text-[10px] text-cyan-400">
        {zoomLevel}x
      </div>
    </div>
  );
};

/**
 * Tier comparison card
 */
const TierComparisonCard = ({ 
  tier, 
  config, 
  price, 
  isAvailable, 
  isSelected,
  isPurchased,
  onSelect,
  mediaType = 'photo'
}) => {
  const Icon = config.icon;
  
  return (
    <button
      onClick={() => isAvailable && !isPurchased && onSelect(tier)}
      disabled={!isAvailable || isPurchased}
      className={`
        relative p-4 rounded-xl text-left transition-all
        ${isPurchased 
          ? 'bg-green-500/10 border-2 border-green-500' 
          : !isAvailable 
            ? 'bg-zinc-800/50 border border-zinc-700 opacity-50 cursor-not-allowed'
            : isSelected 
              ? 'bg-cyan-500/10 border-2 border-cyan-500' 
              : 'bg-zinc-800 border border-zinc-700 hover:border-zinc-500'
        }
      `}
      data-testid={`tier-card-${tier}`}
    >
      {/* Selected indicator */}
      {isSelected && !isPurchased && (
        <div className="absolute top-2 right-2">
          <div className="w-6 h-6 rounded-full bg-cyan-500 flex items-center justify-center">
            <Check className="w-4 h-4 text-white" />
          </div>
        </div>
      )}
      
      {/* Purchased indicator */}
      {isPurchased && (
        <div className="absolute top-2 right-2">
          <Badge className="bg-green-500 text-white">Owned</Badge>
        </div>
      )}
      
      {/* Locked indicator */}
      {!isAvailable && !isPurchased && (
        <div className="absolute top-2 right-2">
          <Badge className="bg-zinc-600 text-zinc-300">
            <Lock className="w-3 h-3 mr-1" />
            Pro Only
          </Badge>
        </div>
      )}
      
      {/* Content */}
      <div className="flex items-start gap-3">
        <div className={`p-2.5 rounded-lg ${
          isPurchased ? 'bg-green-500/20' : isSelected ? 'bg-cyan-500/20' : 'bg-zinc-700'
        }`}>
          <Icon className={`w-5 h-5 ${
            isPurchased ? 'text-green-400' : isSelected ? 'text-cyan-400' : 'text-zinc-300'
          }`} />
        </div>
        <div className="flex-1">
          <h4 className="font-semibold text-white">{config.label}</h4>
          <p className="text-xs text-zinc-400 mt-0.5">{config.description}</p>
          
          {/* Resolution/dimensions */}
          <p className="text-xs text-cyan-400 mt-2">
            {mediaType === 'photo' 
              ? `Up to ${config.maxWidth}px wide`
              : config.resolution
            }
          </p>
          
          {/* File size estimate */}
          <p className="text-xs text-zinc-500">{config.fileSize}</p>
        </div>
      </div>
      
      {/* Price */}
      <div className="mt-3 pt-3 border-t border-zinc-700">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">Price</span>
          <span className={`font-bold ${
            isPurchased ? 'text-green-400' : price === 0 ? 'text-green-400' : 'text-white'
          }`}>
            {isPurchased ? 'Purchased' : price === 0 ? 'FREE' : `$${price.toFixed(2)}`}
          </span>
        </div>
      </div>
      
      {/* Best for section */}
      <div className="mt-3">
        <p className="text-xs text-zinc-500 mb-1">Best for:</p>
        <div className="flex flex-wrap gap-1">
          {config.bestFor.slice(0, 3).map((use, idx) => (
            <Badge key={idx} variant="outline" className="text-[10px] border-zinc-600 text-zinc-300">
              {use}
            </Badge>
          ))}
        </div>
      </div>
    </button>
  );
};

/**
 * Main QualityComparisonModal component
 */
export const QualityComparisonModal = ({ 
  open, 
  onOpenChange, 
  itemId,
  mediaType = 'photo',
  galleryTier = 'standard', // 'standard' or 'pro'
  pricingData = null,
  onSelectTier,
  purchasedTiers = []
}) => {
  const [selectedTier, setSelectedTier] = useState('standard');
  const [previewUrls, setPreviewUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [zoomPosition, setZoomPosition] = useState(null);
  const [zoomEnabled, setZoomEnabled] = useState(false);
  const imageRef = useRef(null);
  
  const tiers = mediaType === 'photo' ? PHOTO_TIERS : VIDEO_TIERS;
  const tierKeys = Object.keys(tiers);
  
  // Determine available tiers based on gallery tier
  const availableTiers = galleryTier === 'pro' 
    ? tierKeys 
    : mediaType === 'photo' 
      ? ['web', 'standard'] 
      : ['720p', '1080p'];
  
  // Fetch preview URLs for comparison
  useEffect(() => {
    if (!open || !itemId) return;
    
    const fetchPreviews = async () => {
      setLoading(true);
      try {
        const response = await apiClient.get(`/gallery/item/${itemId}/quality-previews`);
        setPreviewUrls(response.data.previews || {});
      } catch (error) {
        logger.error('Failed to fetch quality previews:', error);
        // Use placeholder or main preview
        setPreviewUrls({});
      } finally {
        setLoading(false);
      }
    };
    
    fetchPreviews();
  }, [open, itemId]);
  
  // Handle zoom
  const handleMouseMove = (e) => {
    if (!zoomEnabled || !imageRef.current) return;
    
    const rect = imageRef.current.getBoundingClientRect();
    setZoomPosition({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      clientX: e.clientX,
      clientY: e.clientY
    });
  };
  
  const handleMouseLeave = () => {
    setZoomPosition(null);
  };
  
  const handleSelectTier = (tier) => {
    setSelectedTier(tier);
    onSelectTier?.(tier);
  };
  
  // Get price for tier
  const getTierPrice = (tier) => {
    if (!pricingData?.tiers) return null;
    const tierData = pricingData.tiers.find(t => t.tier === tier);
    return tierData?.price ?? null;
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ZoomIn className="w-5 h-5 text-cyan-400" />
            Compare Quality Tiers
          </DialogTitle>
        </DialogHeader>
        
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Preview image with zoom */}
            <div className="relative">
              <div 
                className="relative aspect-video rounded-lg overflow-hidden bg-zinc-800 cursor-crosshair"
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              >
                <img
                  ref={imageRef}
                  src={previewUrls[selectedTier] || previewUrls.standard || ''}
                  alt={`${selectedTier} quality preview`}
                  className="w-full h-full object-contain"
                />
                
                {/* Tier label overlay */}
                <div className="absolute top-3 left-3 px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-sm">
                  <span className="text-sm font-medium text-white">
                    {tiers[selectedTier]?.label}
                  </span>
                  <span className="text-xs text-zinc-400 ml-2">
                    {mediaType === 'photo' 
                      ? `${tiers[selectedTier]?.maxWidth}px`
                      : tiers[selectedTier]?.resolution
                    }
                  </span>
                </div>
                
                {/* Zoom toggle */}
                <Button
                  size="sm"
                  variant="outline"
                  className={`absolute top-3 right-3 ${zoomEnabled ? 'bg-cyan-500 text-black border-cyan-500' : 'bg-black/50 border-zinc-600'}`}
                  onClick={() => setZoomEnabled(!zoomEnabled)}
                >
                  {zoomEnabled ? <ZoomOut className="w-4 h-4 mr-1" /> : <ZoomIn className="w-4 h-4 mr-1" />}
                  {zoomEnabled ? 'Disable Zoom' : 'Enable Zoom'}
                </Button>
                
                {zoomEnabled && (
                  <p className="absolute bottom-3 left-3 text-xs text-zinc-400 bg-black/50 px-2 py-1 rounded">
                    Hover over image to zoom
                  </p>
                )}
              </div>
              
              {/* Zoom lens */}
              {zoomEnabled && <ZoomLens imageRef={imageRef} zoomPosition={zoomPosition} />}
            </div>
            
            {/* Tier selector tabs */}
            <Tabs value={selectedTier} onValueChange={setSelectedTier}>
              <TabsList className="w-full bg-zinc-800 p-1">
                {tierKeys.map(tier => {
                  const isAvailable = availableTiers.includes(tier);
                  const isPurchased = purchasedTiers.includes(tier);
                  
                  return (
                    <TabsTrigger
                      key={tier}
                      value={tier}
                      disabled={!isAvailable && !isPurchased}
                      className={`flex-1 ${!isAvailable && !isPurchased ? 'opacity-50' : ''}`}
                    >
                      {tiers[tier].label}
                      {isPurchased && <Check className="w-3 h-3 ml-1 text-green-400" />}
                      {!isAvailable && !isPurchased && <Lock className="w-3 h-3 ml-1" />}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
            
            {/* Tier comparison cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {tierKeys.map(tier => {
                const config = tiers[tier];
                const isAvailable = availableTiers.includes(tier);
                const isPurchased = purchasedTiers.includes(tier);
                const price = getTierPrice(tier);
                
                return (
                  <TierComparisonCard
                    key={tier}
                    tier={tier}
                    config={config}
                    price={price ?? 0}
                    isAvailable={isAvailable}
                    isSelected={selectedTier === tier}
                    isPurchased={isPurchased}
                    onSelect={handleSelectTier}
                    mediaType={mediaType}
                  />
                );
              })}
            </div>
            
            {/* Pro tier upsell if not available */}
            {galleryTier !== 'pro' && (
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-400">
                      Want {mediaType === 'photo' ? 'High-Res (4K)' : '4K'} quality?
                    </p>
                    <p className="text-xs text-zinc-400 mt-1">
                      Book a <span className="text-amber-400 font-medium">Scheduled Session</span> for PRO tier access with full resolution {mediaType === 'photo' ? 'photos' : 'videos'}.
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            {/* Purchase button */}
            {selectedTier && !purchasedTiers.includes(selectedTier) && availableTiers.includes(selectedTier) && (
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button 
                  className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white"
                  onClick={() => {
                    onSelectTier?.(selectedTier);
                    onOpenChange(false);
                  }}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Select {tiers[selectedTier].label} (${getTierPrice(selectedTier)?.toFixed(2) || '0.00'})
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default QualityComparisonModal;
