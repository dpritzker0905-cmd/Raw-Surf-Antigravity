/**
 * GalleryItemModal - View/Purchase modal for gallery items
 * Shows full-size photo preview or playable video with pricing and actions.
 */
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../lib/apiClient';
import { getFullUrl } from '../../utils/media';
import { isGrom } from '../../lib/roles';
import { submitPurchaseRequest } from '../../utils/gromPurchase';
import { 
  Lock, Eye, ShoppingCart, Download, DollarSign, Edit3, Loader2, Check,
  Play, Image as ImageIcon, X, Send, UserPlus, ImagePlus
} from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import logger from '../../utils/logger';
import { PriceSourceBadge } from './PriceSourceBadge';


import { getErrorMessage } from '../../utils/errors';

export const GalleryItemModal = ({ item, onClose, onPurchased, galleryId, onSetAsCover }) => {
  const { user } = useAuth();
  const [purchasing, setPurchasing] = useState(false);
  const [pricingInfo, setPricingInfo] = useState(null);
  const [loadingPricing, setLoadingPricing] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [customPrice, setCustomPrice] = useState(item.custom_price || item.price || 5);
  const [saving, setSaving] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [unlockAnimation, setUnlockAnimation] = useState(false);
  const [justPurchased, setJustPurchased] = useState(false);
  
  // Per-image tagging state (photographer only)
  const [tagParticipants, setTagParticipants] = useState([]);
  const [tagLoading, setTagLoading] = useState({});
  const [loadingTagParticipants, setLoadingTagParticipants] = useState(false);
  // Track which surfers this item is already tagged to (from item data + live tags)
  const [taggedIds, setTaggedIds] = useState(() => {
    const existing = item.tagged_surfers?.map(s => s.surfer_id) || [];
    return new Set(existing);
  });
  
  // Check if current user is the owner
  const isOwner = user?.id === item.photographer_id;
  const userIsGrom = isGrom(user);
  const isVideo = item.media_type === 'video' || item.type === 'video';
  
  // Resolve the correct preview URL  
  const mediaUrl = getFullUrl(
    isOwner 
      ? (item.original_url || item.preview_url) 
      : (item.is_purchased ? item.original_url : item.preview_url)
  );

  // Fetch pricing info including session deals
  useEffect(() => {
    const fetchPricing = async () => {
      try {
        const response = await apiClient.get(
          `/gallery/item/${item.id}/pricing?viewer_id=${user?.id || ''}`
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

  // Fetch session participants for per-image tagging (owner only)
  useEffect(() => {
    if (!isOwner || !galleryId) return;
    const fetchTagParticipants = async () => {
      setLoadingTagParticipants(true);
      try {
        const response = await apiClient.get(
          `/gallery/${galleryId}/session-participants?photographer_id=${user.id}`
        );
        setTagParticipants(response.data.participants || []);
      } catch (error) {
        logger.error('Failed to fetch tag participants:', error);
      } finally {
        setLoadingTagParticipants(false);
      }
    };
    fetchTagParticipants();
  }, [isOwner, galleryId, user?.id]);

  // Tag single item to a surfer
  const handleTagToSurfer = async (surferId, surferName) => {
    if (!galleryId) return;
    setTagLoading(prev => ({ ...prev, [surferId]: true }));
    try {
      const response = await apiClient.post(
        `/gallery/${galleryId}/tag-item?photographer_id=${user.id}`,
        { surfer_id: surferId, item_id: item.id }
      );
      
      if (response.data.already_tagged) {
        toast.info(`Already tagged to ${surferName}`);
        setTaggedIds(prev => new Set([...prev, surferId]));
      } else {
        const accessType = response.data.access_type;
        const accessLabel = accessType === 'included' 
          ? '— Full resolution (included in buy-in 🌟)' 
          : '— Added to Locker';
        toast.success(`✅ Tagged to ${surferName} ${accessLabel}`);
        
        // Mark as tagged in local state
        setTaggedIds(prev => new Set([...prev, surferId]));
        
        // Update participant credits
        if (response.data.credits_remaining >= 0) {
          setTagParticipants(prev => prev.map(p => 
            p.surfer_id === surferId 
              ? { ...p, photos_credit_remaining: response.data.credits_remaining, items_distributed: (p.items_distributed || 0) + 1 }
              : p
          ));
        }
        
        // Trigger gallery refresh so grid shows avatar chips
        if (onPurchased) onPurchased();
      }
    } catch (error) {
      toast.error(getErrorMessage(error, `Failed to tag to ${surferName}`));
    } finally {
      setTagLoading(prev => ({ ...prev, [surferId]: false }));
    }
  };

  const handlePurchase = async () => {
    if (userIsGrom) {
      await submitPurchaseRequest({
        gromId: user.id,
        itemType: 'gallery_photo',
        itemId: item.id,
        itemName: item.title || 'Gallery Photo',
        amount: pricingInfo?.session_price_override || item.price || 5,
        qualityTier: 'standard'
      });
      return;
    }
    setPurchasing(true);
    try {
      const _response = await apiClient.post(
        `/gallery/item/${item.id}/purchase?buyer_id=${user.id}`,
        { payment_method: 'credits' }
      );
      
      toast.success('Photo purchased! Check your downloads.');
      // Trigger unlock animation
      setUnlockAnimation(true);
      setJustPurchased(true);
      setTimeout(() => {
        setUnlockAnimation(false);
        onPurchased();
      }, 2000);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Purchase failed'));
    } finally {
      setPurchasing(false);
    }
  };

  const handleDownload = async () => {
    try {
      const response = await apiClient.get(
        `/gallery/download/${item.id}?buyer_id=${user.id}`
      );
      
      // Use native download link instead of window.open
      const url = getFullUrl(response.data.original_url || response.data.download_url);
      const link = document.createElement('a');
      link.href = url;
      link.download = `rawsurf_${item.id?.slice(-8) || 'photo'}.jpg`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`📸 Saved! ${response.data.downloads_remaining} downloads remaining`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Download failed'));
    }
  };

  const handleSavePrice = async () => {
    setSaving(true);
    try {
      await apiClient.patch(
        `/gallery/item/${item.id}/custom-price?photographer_id=${user.id}`,
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
      await apiClient.delete(
        `/gallery/item/${item.id}/custom-price?photographer_id=${user.id}`
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
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-2xl max-h-[95vh] overflow-y-auto p-0">
        <DialogTitle className="sr-only">{item.title || 'Gallery Item'}</DialogTitle>
        
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-30 w-9 h-9 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/80 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* ── Media Preview ── */}
        <div className="relative bg-black w-full">
          {isVideo ? (
            // Video player
            mediaUrl && !imgError ? (
              <video
                src={mediaUrl}
                controls
                playsInline
                preload="metadata"
                poster={getFullUrl(item.thumbnail_url)}
                className="w-full max-h-[50vh] object-contain"
                onError={() => setImgError(true)}
              >
                Your browser does not support video playback.
              </video>
            ) : (
              <div className="w-full h-48 flex flex-col items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900 text-zinc-500">
                <Play className="w-12 h-12 mb-2 opacity-50" />
                <span className="text-sm">Video preview unavailable</span>
              </div>
            )
          ) : (
            // Image preview
            mediaUrl && !imgError ? (
              <img
                src={mediaUrl}
                alt={item.title || 'Gallery photo'}
                className="w-full max-h-[50vh] object-contain"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="w-full h-48 flex flex-col items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900 text-zinc-500">
                <ImageIcon className="w-12 h-12 mb-2 opacity-50" />
                <span className="text-sm">Photo preview unavailable</span>
              </div>
            )
          )}
          
          {/* Watermark overlay for non-owners who haven't purchased */}
          {!isOwner && !item.is_purchased && !justPurchased && !imgError && mediaUrl && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center p-4 bg-black/60 rounded-xl backdrop-blur-sm">
                <Lock className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
                <p className="text-white font-medium text-sm">Watermarked Preview</p>
                <p className="text-gray-400 text-xs">Purchase for full resolution</p>
              </div>
            </div>
          )}
          
          {/* Unlock animation overlay */}
          {unlockAnimation && (
            <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
              <div className="text-center animate-bounce">
                <div className="w-20 h-20 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-emerald-500/50">
                  <Check className="w-10 h-10 text-white" />
                </div>
                <p className="text-white text-xl font-bold">🎉 Unlocked!</p>
                <p className="text-emerald-400 text-sm mt-1">Full resolution available</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Item Info ── */}
        <div className="px-5 pb-5 pt-3">
          {item.title && (
            <h3 className="text-lg font-bold text-white">{item.title}</h3>
          )}
          {item.description && (
            <p className="text-gray-400 mt-1 text-sm">{item.description}</p>
          )}

          <div className="flex items-center gap-4 mt-3 text-sm text-gray-400">
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
            <div className="mt-4 p-4 bg-zinc-800 rounded-lg">
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

          {/* ── Per-Image Tag to Surfer (Owner Only) ── */}
          {isOwner && galleryId && (
            <div className="mt-4 p-4 bg-zinc-800/80 rounded-lg border border-purple-500/20">
              {/* Status header — immediately tells photographer what happened */}
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-white flex items-center gap-2">
                  <Send className="w-4 h-4 text-purple-400" />
                  Tag to Surfer
                </h4>
                {/* AI status badge */}
                {item.ai_suggested_count > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                    🤖 AI matched to {item.ai_suggested_count} surfer{item.ai_suggested_count !== 1 ? 's' : ''}
                  </span>
                ) : item.distributed_count > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    ✅ Distributed to {item.distributed_count}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    👤 Needs manual tagging
                  </span>
                )}
              </div>
              
              {loadingTagParticipants ? (
                <div className="flex items-center justify-center py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                  <span className="ml-2 text-gray-400 text-xs">Loading participants...</span>
                </div>
              ) : tagParticipants.length > 0 ? (
                <div className="space-y-2">
                  {tagParticipants.map((p) => {
                    const isLoading = tagLoading[p.surfer_id];
                    const isTagged = taggedIds.has(p.surfer_id);
                    const hasCredits = p.photos_credit_remaining > 0;
                    const selfieOrAvatar = getFullUrl(p.selfie_url || p.avatar_url);
                    // Determine if this was an AI match or manual tag
                    const isAiMatch = p.ai_suggested || p.match_method === 'ai';
                    const matchConfidence = p.match_confidence;
                    return (
                      <button
                        key={p.surfer_id}
                        onClick={() => !isTagged && handleTagToSurfer(p.surfer_id, p.full_name || p.username)}
                        disabled={isLoading || isTagged}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left ${
                          isTagged
                            ? 'border-emerald-500/50 bg-emerald-500/15 cursor-default'
                            : hasCredits 
                              ? 'border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 hover:border-emerald-400/60'
                              : 'border-zinc-600 bg-zinc-700/50 hover:bg-zinc-700 hover:border-purple-500/50'
                        }`}
                      >
                        {/* Selfie / Avatar — shown larger as reference */}
                        {isLoading ? (
                          <Loader2 className="w-10 h-10 animate-spin text-purple-400 shrink-0" />
                        ) : selfieOrAvatar ? (
                          <div className="relative shrink-0">
                            <img
                              src={selfieOrAvatar}
                              alt={`Reference: ${p.full_name}`}
                              className={`w-10 h-10 rounded-full object-cover border-2 ${
                                isTagged ? 'border-emerald-400' : isAiMatch ? 'border-cyan-400' : 'border-zinc-500'
                              }`}
                            />
                            {/* Provenance mini-badge on avatar */}
                            {isTagged && isAiMatch && (
                              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center text-[8px]" title="AI matched">🤖</span>
                            )}
                            {isTagged && !isAiMatch && (
                              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-purple-500 flex items-center justify-center text-[8px]" title="Manually tagged">👤</span>
                            )}
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-purple-500/30 flex items-center justify-center text-purple-400 text-sm font-bold shrink-0">
                            {(p.full_name || p.username || '?').charAt(0).toUpperCase()}
                          </div>
                        )}
                        
                        {/* Name + status + provenance */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">
                            {p.full_name || p.username}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            {isTagged ? (
                              <span className="text-emerald-400 font-medium">
                                ✅ Tagged — {isAiMatch ? 'AI matched' : 'manually tagged'}
                                {matchConfidence ? ` (${Math.round(matchConfidence * 100)}%)` : ''}
                              </span>
                            ) : hasCredits ? (
                              <span className="text-emerald-400">🎟️ {p.photos_credit_remaining} credits left — tap to tag</span>
                            ) : (
                              <span>💰 Extra item — tap to add to locker</span>
                            )}
                          </p>
                        </div>
                        
                        {/* Action indicator */}
                        <div className="shrink-0">
                          {isTagged ? (
                            <Check className="w-5 h-5 text-emerald-400" />
                          ) : (
                            <UserPlus className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-4">
                  <UserPlus className="w-6 h-6 text-zinc-500 mx-auto mb-2" />
                  <p className="text-xs text-gray-500">No session participants found.</p>
                  <p className="text-[10px] text-gray-600 mt-1">Use the gallery-level "Tag & Assign" to search all surfers.</p>
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

          <div className="flex gap-3 mt-5">
            {isOwner ? (
              <>
                <Button
                  onClick={() => window.open(getFullUrl(item.original_url), '_blank')}
                  className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-black"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Original
                </Button>
                {onSetAsCover && !isVideo && (
                  <Button
                    variant="outline"
                    onClick={() => onSetAsCover(item.id)}
                    className="border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10"
                    title="Use this photo as the folder thumbnail"
                  >
                    <ImagePlus className="w-4 h-4 mr-2" />
                    Set as Cover
                  </Button>
                )}
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
            ) : userIsGrom ? (
              /* ── GROM: Parent-mediated purchase ── */
              <>
                <Button
                  onClick={handlePurchase}
                  className="flex-1 font-bold bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
                >
                  👨‍👧 Ask Parent to Approve
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
