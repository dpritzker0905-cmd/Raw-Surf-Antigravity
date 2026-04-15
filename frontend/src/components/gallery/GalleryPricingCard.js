/**
 * GalleryPricingCard - Pricing settings card for photographers
 * Extracted from GalleryPage.js for better organization
 */
import React from 'react';
import { DollarSign, Settings } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';

export const GalleryPricingCard = ({ 
  generalSettings, 
  lastUpdated, 
  onEditPricing,
  isPhotographer = true,
  canSellPhotos = true
}) => {
  // Don't render if user can't sell photos
  if (!isPhotographer || !canSellPhotos) {
    return null;
  }

  return (
    <Card className="bg-zinc-800 border-zinc-700" data-testid="gallery-pricing-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-white text-sm">
          <DollarSign className="w-4 h-4 text-emerald-400" />
          Gallery Pricing
          {lastUpdated && (
            <Badge variant="outline" className="text-[10px] ml-auto border-emerald-500/50 text-emerald-400">
              Updated
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-400">Photo (Web)</span>
            <span className="text-emerald-400">${generalSettings?.photo_price_web?.toFixed(2) || '3.00'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Photo (Standard)</span>
            <span className="text-emerald-400">${generalSettings?.photo_price_standard?.toFixed(2) || '5.00'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Photo (High-Res)</span>
            <span className="text-emerald-400">${generalSettings?.photo_price_high?.toFixed(2) || '10.00'}</span>
          </div>
          <div className="border-t border-zinc-700 my-2"></div>
          <div className="flex justify-between">
            <span className="text-gray-400">Video (720p)</span>
            <span className="text-emerald-400">${generalSettings?.video_price_720p?.toFixed(2) || '8.00'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Video (1080p)</span>
            <span className="text-emerald-400">${generalSettings?.video_price_1080p?.toFixed(2) || '15.00'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Video (4K)</span>
            <span className="text-emerald-400">${generalSettings?.video_price_4k?.toFixed(2) || '30.00'}</span>
          </div>
        </div>
        <Button 
          size="sm" 
          variant="outline" 
          className="w-full mt-3 border-zinc-600 text-white hover:bg-zinc-700"
          onClick={onEditPricing}
        >
          <Settings className="w-3 h-3 mr-1" />
          Edit Pricing
        </Button>
      </CardContent>
    </Card>
  );
};

export default GalleryPricingCard;
