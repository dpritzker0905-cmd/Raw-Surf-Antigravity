/**
 * GalleryItemModal - View/Purchase modal for gallery items
 * Extracted from GalleryPage.js for cleaner architecture
 */
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import axios from 'axios';
import { 
  Lock, Eye, ShoppingCart, Download, DollarSign, Edit3, Loader2, Check
} from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import logger from '../../utils/logger';
import { PriceSourceBadge } from './PriceSourceBadge';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Helper function to safely extract error messages from API responses
const getErrorMessage = (error, fallback = 'An error occurred') => {
  const detail = error?.response?.data?.detail;
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map(e => e.msg || e.message || JSON.stringify(e)).join(', ');
  }
  if (typeof detail === 'object') {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return fallback;
};

export const GalleryItemModal = ({ item, onClose, onPurchased }) => {
  const { user } = useAuth();
  const [purchasing, setPurchasing] = useState(false);
  const [pricingInfo, setPricingInfo] = useState(null);
  const [loadingPricing, setLoadingPricing] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [customPrice, setCustomPrice] = useState(item.custom_price || item.price || 5);
  const [saving, setSaving] = useState(false);
  
  // Check if current user is the owner
  const isOwner = user?.id === item.photographer_id;

  // Fetch pricing info including session deals
  useEffect(() => {
    const fetchPricing = async () => {
      try {
        const response = await axios.get(
          `${API}/gallery/item/${item.id}/pricing?viewer_id=${user?.id || ''}`
        );
        setPricingInfo(response.data);
      } catch (error) {
        logger.error('Failed to fetch pricing:', error);
      } finally {
        setLoadingPricing(false);
      }
    };
    fetchPricing();
  }, [item.id, user?.id]);

  const handlePurchase = async () => {
    setPurchasing(true);
    try {
      const _response = await axios.post(
        `${API}/gallery/item/${item.id}/purchase?buyer_id=${user.id}`,
        { payment_method: 'credits' }
      );
      
      toast.success('Photo purchased! Check your downloads.');
      onPurchased();
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Purchase failed'));
    } finally {
      setPurchasing(false);
    }
  };

  const handleDownload = async () => {
    try {
      const response = await axios.get(
        `${API}/gallery/download/${item.id}?buyer_id=${user.id}`
      );
      
      // Open original URL in new tab
      window.open(response.data.original_url, '_blank');
      toast.success(`${response.data.downloads_remaining} downloads remaining`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Download failed'));
    }
  };

  const handleSavePrice = async () => {
    setSaving(true);
    try {
      await axios.patch(
        `${API}/gallery/item/${item.id}/custom-price?photographer_id=${user.id}`,
        { custom_price: customPrice }
      );
      toast.success('Price updated successfully');
      setEditMode(false);
      onPurchased(); // Refresh gallery
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update price'));
    } finally {
      setSaving(false);
    }
  };

  const handleClearPrice = async () => {
    setSaving(true);
    try {
      await axios.delete(
        `${API}/gallery/item/${item.id}/custom-price?photographer_id=${user.id}`
      );
      toast.success('Price reset to gallery default');
      setEditMode(false);
      onPurchased();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to reset price'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogTitle className="sr-only">Dialog</DialogTitle>
        <div className="relative">
          <img
            src={isOwner ? (item.original_url || item.preview_url) : (item.is_purchased ? item.original_url : item.preview_url)}
            alt={item.title || 'Gallery photo'}
            className="w-full rounded-lg"
          />
          
          {!isOwner && !item.is_purchased && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg">
              <div className="text-center p-6 bg-black/70 rounded-xl">
                <Lock className="w-10 h-10 text-yellow-400 mx-auto mb-3" />
                <p className="text-white font-medium mb-1">Watermarked Preview</p>
                <p className="text-gray-400 text-sm">Purchase to get high-res original</p>
              </div>
            </div>
          )}
        </div>

        <div className="pt-4">
          {item.title && (
            <h3 className="text-xl font-bold text-white">{item.title}</h3>
          )}
          {item.description && (
            <p className="text-gray-400 mt-2">{item.description}</p>
          )}

          <div className="flex items-center gap-4 mt-4 text-sm text-gray-400">
            <span className="flex items-center gap-1">
              <Eye className="w-4 h-4" />
              {item.view_count || 0} views
            </span>
            <span className="flex items-center gap-1">
              <ShoppingCart className="w-4 h-4" />
              {item.purchase_count || 0} sales
            </span>
            {item.photographer_name && (
              <span>by {item.photographer_name}</span>
            )}
          </div>

          {/* Owner: Price Editing Section */}
          {isOwner && (
            <div className="mt-6 p-4 bg-zinc-800 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-white flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-green-400" />
                  Pricing
                </h4>
                {!editMode && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-zinc-700 text-gray-400"
                    onClick={() => setEditMode(true)}
                  >
                    <Edit3 className="w-4 h-4 mr-1" />
                    Edit Price
                  </Button>
                )}
              </div>
              
              {editMode ? (
                <div className="space-y-4">
                  <div>
                    <Label className="text-gray-400">Custom Price (Credits)</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-2xl text-white">$</span>
                      <Input
                        type="number"
                        value={customPrice}
                        onChange={(e) => setCustomPrice(parseFloat(e.target.value) || 0)}
                        className="bg-zinc-900 text-white border-zinc-700 text-xl w-24"
                        min="0"
                        step="0.5"
                      />
                      <span className="text-gray-500">per download</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Gallery default: ${item.price || 5}
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setCustomPrice(3)}
                      className={`p-2 rounded text-sm ${customPrice === 3 ? 'bg-cyan-500 text-black' : 'bg-zinc-700 text-white'}`}
                    >
                      $3 Web
                    </button>
                    <button
                      onClick={() => setCustomPrice(5)}
                      className={`p-2 rounded text-sm ${customPrice === 5 ? 'bg-cyan-500 text-black' : 'bg-zinc-700 text-white'}`}
                    >
                      $5 Standard
                    </button>
                    <button
                      onClick={() => setCustomPrice(10)}
                      className={`p-2 rounded text-sm ${customPrice === 10 ? 'bg-cyan-500 text-black' : 'bg-zinc-700 text-white'}`}
                    >
                      $10 High-Res
                    </button>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      onClick={handleSavePrice}
                      disabled={saving}
                      className="flex-1 bg-green-500 hover:bg-green-600 text-white"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Price'}
                    </Button>
                    <Button
                      onClick={handleClearPrice}
                      disabled={saving}
                      variant="outline"
                      className="border-zinc-700 text-gray-400"
                    >
                      Reset to Default
                    </Button>
                    <Button
                      onClick={() => setEditMode(false)}
                      variant="ghost"
                      className="text-gray-400"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-3xl font-bold text-green-400">${item.custom_price || item.price || 5}</p>
                    <p className="text-sm text-gray-500">
                      {item.custom_price ? 'Custom price' : 'Gallery default'}
                    </p>
                  </div>
                  <div className="text-right text-sm text-gray-500">
                    <p>You earn: ${((item.custom_price || item.price || 5) * 0.8).toFixed(2)}</p>
                    <p className="text-xs">After 20% platform fee</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Session Deal Banner - Only for non-owners */}
          {!isOwner && pricingInfo?.is_session_participant && (
            <div className="mt-4 p-3 bg-emerald-500/20 border border-emerald-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <PriceSourceBadge 
                  source={pricingInfo.is_free_from_session ? 'free_from_buyin' : 'session_override'}
                  originalPrice={pricingInfo?.pricing?.tiers?.[0]?.general_price}
                  currentPrice={pricingInfo.is_free_from_session ? 0 : pricingInfo.session_price_override}
                  size="md"
                />
              </div>
              <p className="text-sm text-gray-300">
                {pricingInfo.is_free_from_session ? (
                  <>This photo is <span className="text-emerald-400 font-bold">FREE</span> - included in your session buy-in!</>
                ) : (
                  <>You get the special session price: <span className="text-emerald-400 font-bold">${pricingInfo.session_price_override}</span> instead of general gallery price</>
                )}
              </p>
              {pricingInfo.session_photos_included > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  {pricingInfo.photos_already_claimed} / {pricingInfo.session_photos_included} included photos claimed
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3 mt-6">
            {isOwner ? (
              <>
                <Button
                  onClick={() => window.open(item.original_url, '_blank')}
                  className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-black"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Original
                </Button>
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="border-zinc-700 text-white hover:bg-zinc-800"
                >
                  Close
                </Button>
              </>
            ) : item.is_purchased ? (
              <>
                <Button
                  onClick={handleDownload}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Original
                </Button>
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="border-zinc-700 text-white hover:bg-zinc-800"
                >
                  Close
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={handlePurchase}
                  disabled={purchasing || loadingPricing}
                  className={`flex-1 font-bold ${
                    pricingInfo?.is_free_from_session 
                      ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                      : 'bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black'
                  }`}
                >
                  {purchasing ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : pricingInfo?.is_free_from_session ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Claim Free Photo
                    </>
                  ) : (
                    <>
                      <ShoppingCart className="w-4 h-4 mr-2" />
                      Buy for ${pricingInfo?.session_price_override || item.price} credits
                      {pricingInfo?.is_session_participant && pricingInfo?.pricing?.tiers?.[0]?.general_price && (
                        <span className="ml-2 line-through text-black/50">
                          ${pricingInfo.pricing.tiers[0].general_price}
                        </span>
                      )}
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="border-zinc-700 text-white hover:bg-zinc-800"
                >
                  Close
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GalleryItemModal;
