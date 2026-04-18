import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { getNotifications, getUnreadCount, markRead, markAllRead, sendNotification, sendPhotographerAlert, createNotification, markAlertRead } from '../services/notificationService';
import { 
  X, Heart, Download, Calendar, Camera, Check, Lock, Sparkles, CreditCard, Gift
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { toast } from 'sonner';
import logger from '../utils/logger';


export const TaggedPhotoModal = ({ 
  isOpen, 
  onClose, 
  photo,  // The tagged photo item
  onPhotoViewed,  // Callback when photo is marked as viewed
  onPurchaseComplete  // Callback when purchase completes
}) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  
  const [purchasing, setPurchasing] = useState(false);
  const [thankSent, setThankSent] = useState(false);
  const [selectedTier, setSelectedTier] = useState('standard');
  const [galleryPricing, setGalleryPricing] = useState(null);
  const [hasPurchased, setHasPurchased] = useState(false);

  // Theme classes
  const isLight = theme === 'light';
  const bgClass = isLight ? 'bg-white' : 'bg-zinc-900';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-700';

  useEffect(() => {
    if (isOpen && photo) {
      // Mark as viewed when modal opens
      markAsViewed();
      // Fetch gallery pricing if needed
      if (!photo.access_granted && !photo.is_gift) {
        fetchGalleryPricing();
      }
    }
  }, [isOpen, photo]);

  const markAsViewed = async () => {
    if (photo?.is_new && photo?.tag_id) {
      try {
        await apiClient.post(`/ai/mark-photo-viewed?user_id=${user?.id}&tag_id=${photo.tag_id}`);
        onPhotoViewed?.(photo.id);
      } catch (e) {
        logger.error('Failed to mark as viewed:', e);
      }
    }
  };

  const fetchGalleryPricing = async () => {
    // If we have session pricing, use that for participants
    if (photo.was_session_participant && photo.session_photo_price !== null) {
      return; // Use session pricing
    }
    
    // Default gallery pricing (can be fetched from API if needed)
    setGalleryPricing({
      photo: { web: 3, standard: 5, high: 10 },
      video: { '720p': 8, '1080p': 15, '4k': 30 }
    });
  };

  const handleThankPhotographer = async () => {
    try {
      await sendNotification({
        recipient_id: photo.photographer_id,
        sender_id: user?.id,
        type: 'thank_you',
        title: 'Thanks for the photo!',
        body: `${user?.full_name || 'A surfer'} thanked you for tagging them in a photo`
      });
      setThankSent(true);
      toast.success('Thank you sent to photographer!');
    } catch (e) {
      toast.error('Failed to send thank you');
    }
  };

  const handleSuggestBooking = () => {
    // Navigate to photographer's profile with booking intent
    navigate(`/profile/${photo.photographer_id}?action=book`);
    onClose();
  };

  const handlePurchase = async () => {
    setPurchasing(true);
    try {
      // Determine price based on user status
      let price;
      let quality = selectedTier;
      
      if (photo.was_session_participant && photo.session_photo_price !== null) {
        // Session participant - use session price
        price = photo.session_photo_price;
        quality = 'session'; // Special quality tier for session purchases
      } else {
        // Non-participant - use gallery pricing
        price = galleryPricing?.photo?.[selectedTier] || 5;
      }

      // Purchase photo - this moves it to user's personal gallery
      const response = await apiClient.post(`/gallery/items/${photo.id}/purchase`, {
        buyer_id: user?.id,
        quality_tier: quality,
        amount: price
      });

      if (response.data.success) {
        setHasPurchased(true);
        toast.success('Photo added to your gallery! You can now download it.');
        onPurchaseComplete?.(photo.id);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Purchase failed. Check your credit balance.');
    } finally {
      setPurchasing(false);
    }
  };

  const handleClaimFreePhoto = async () => {
    // For session participants with $0 price - claim without payment
    try {
      const response = await apiClient.post(`/gallery/items/${photo.id}/claim`, {
        user_id: user?.id,
        tag_id: photo.tag_id
      });
      
      if (response.data.success) {
        setHasPurchased(true);
        toast.success('Photo claimed! It\'s now in your gallery.');
        onPurchaseComplete?.(photo.id);
      }
    } catch (e) {
      toast.error('Failed to claim photo');
    }
  };

  if (!photo) return null;

  // Determine what the user can see
  const canViewFull = photo.access_granted || photo.is_gift || hasPurchased;
  const isSessionParticipant = photo.was_session_participant;
  const sessionPrice = photo.session_photo_price;
  const isGift = photo.is_gift;
  const needsToPay = !canViewFull;

  // Determine pricing to show
  const getPriceDisplay = () => {
    if (canViewFull) return null;
    
    if (isSessionParticipant && sessionPrice !== null) {
      if (sessionPrice === 0) {
        return { type: 'included', message: 'Included with your session - no extra charge!' };
      }
      return { 
        type: 'session', 
        price: sessionPrice, 
        message: `Session rate: ${sessionPrice} credits` 
      };
    }
    
    // Gallery pricing for non-participants
    return { type: 'gallery', message: 'Choose quality to add to your gallery:' };
  };

  const priceInfo = getPriceDisplay();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${bgClass} border ${borderClass} max-w-2xl p-0 overflow-hidden`} aria-describedby="tagged-photo-description">
        <DialogTitle className="sr-only">Tagged Photo from {photo.tagged_by || 'Photographer'}</DialogTitle>
        {/* Header */}
        <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10">
              <AvatarImage src={photo.photographer_avatar} />
              <AvatarFallback className="bg-gradient-to-br from-cyan-400 to-blue-500 text-white">
                <Camera className="w-5 h-5" />
              </AvatarFallback>
            </Avatar>
            <div>
              <p className={`font-medium ${textPrimary}`}>{photo.tagged_by || 'Photographer'}</p>
              <p className={`text-xs ${textSecondary}`}>
                {isGift ? 'Gifted you this photo' : 'Tagged you in this photo'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isGift && (
              <Badge className="bg-pink-500/20 text-pink-400">
                <Gift className="w-3 h-3 mr-1" /> Gift
              </Badge>
            )}
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Photo */}
        <div className="relative aspect-video bg-black flex items-center justify-center">
          <img 
            src={photo.media_url || photo.preview_url} 
            alt="Tagged photo"
            className={`max-w-full max-h-full object-contain ${needsToPay ? 'blur-md' : ''}`}
          />
          
          {/* Lock overlay for unpurchased photos */}
          {needsToPay && (
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center">
              <Lock className="w-12 h-12 text-white/80 mb-4" />
              <p className={`text-white text-lg font-medium mb-2`}>
                {isSessionParticipant ? 'Session Photo' : 'Purchase to Add to Gallery'}
              </p>
              {priceInfo?.type === 'session' && priceInfo.price > 0 && (
                <Badge className="bg-cyan-500/20 text-cyan-400 text-lg px-4 py-1">
                  {priceInfo.price} credits
                </Badge>
              )}
            </div>
          )}
          
          {/* Access granted badge */}
          {canViewFull && (
            <div className="absolute top-4 right-4">
              <Badge className="bg-green-500/90 text-white">
                <Check className="w-3 h-3 mr-1" /> 
                {isGift ? 'Gift' : hasPurchased ? 'In Your Gallery' : 'No Extra Charge'}
              </Badge>
            </div>
          )}
        </div>

        {/* Actions & Pricing */}
        <div className="p-4 space-y-4">
          {/* Pricing Section - Only show if needs to pay */}
          {needsToPay && (
            <div className={`p-4 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
              {priceInfo?.type === 'included' ? (
                <div className="text-center">
                  <Sparkles className="w-8 h-8 mx-auto mb-2 text-green-400" />
                  <p className={`${textPrimary} font-medium`}>{priceInfo.message}</p>
                  <Button
                    onClick={handleClaimFreePhoto}
                    className="mt-3 bg-gradient-to-r from-green-400 to-emerald-500 text-black"
                  >
                    <Check className="w-4 h-4 mr-2" /> Add to My Gallery
                  </Button>
                </div>
              ) : priceInfo?.type === 'session' ? (
                <div className="text-center">
                  <p className={`${textSecondary} mb-2`}>You were in this session!</p>
                  <p className={`${textPrimary} text-xl font-bold mb-3`}>
                    {priceInfo.price} <span className="text-sm font-normal">credits</span>
                  </p>
                  <Button
                    onClick={handlePurchase}
                    disabled={purchasing}
                    className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black"
                  >
                    {purchasing ? 'Processing...' : (
                      <>
                        <CreditCard className="w-4 h-4 mr-2" /> Add to My Gallery
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                // Gallery pricing tiers - photo gets added to user's personal gallery
                <div>
                  <p className={`${textSecondary} mb-3 text-center`}>{priceInfo?.message}</p>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {[
                      { id: 'web', label: 'Web', price: galleryPricing?.photo?.web || 3, desc: '800px' },
                      { id: 'standard', label: 'HD', price: galleryPricing?.photo?.standard || 5, desc: '1920px' },
                      { id: 'high', label: '4K', price: galleryPricing?.photo?.high || 10, desc: 'Full res' }
                    ].map(tier => (
                      <button
                        key={tier.id}
                        onClick={() => setSelectedTier(tier.id)}
                        className={`p-3 rounded-lg border-2 transition-colors ${
                          selectedTier === tier.id 
                            ? 'border-cyan-400 bg-cyan-400/10' 
                            : `border-transparent ${isLight ? 'bg-white' : 'bg-zinc-700'}`
                        }`}
                      >
                        <p className={`font-medium ${textPrimary}`}>{tier.label}</p>
                        <p className="text-cyan-400 font-bold">{tier.price}c</p>
                        <p className={`text-xs ${textSecondary}`}>{tier.desc}</p>
                      </button>
                    ))}
                  </div>
                  <Button
                    onClick={handlePurchase}
                    disabled={purchasing}
                    className="w-full bg-gradient-to-r from-cyan-400 to-blue-500 text-black"
                  >
                    {purchasing ? 'Processing...' : (
                      <>
                        <CreditCard className="w-4 h-4 mr-2" /> 
                        Add to My Gallery ({galleryPricing?.photo?.[selectedTier] || 5}c)
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* CTA Buttons - Always show */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleThankPhotographer}
              disabled={thankSent}
              className={`flex-1 ${borderClass}`}
            >
              {thankSent ? (
                <>
                  <Check className="w-4 h-4 mr-2 text-green-400" /> Thanks Sent!
                </>
              ) : (
                <>
                  <Heart className="w-4 h-4 mr-2" /> Thank Photographer
                </>
              )}
            </Button>
            <Button
              onClick={handleSuggestBooking}
              className="flex-1 bg-gradient-to-r from-purple-400 to-pink-500 text-black"
            >
              <Calendar className="w-4 h-4 mr-2" /> Suggest a Booking
            </Button>
          </div>

          {/* Download button - Only when in user's gallery */}
          {canViewFull && (
            <Button
              variant="outline"
              className={`w-full ${borderClass}`}
              onClick={() => {
                // Open original image in new tab for download
                window.open(photo.media_url || photo.preview_url, '_blank');
              }}
            >
              <Download className="w-4 h-4 mr-2" /> Download Photo
            </Button>
          )}

          {/* Info footer */}
          <div className={`flex items-center justify-between text-xs ${textSecondary} pt-2 border-t ${borderClass}`}>
            <span>Tagged {new Date(photo.created_at).toLocaleDateString()}</span>
            <div className="flex gap-2">
              {isGift && (
                <Badge variant="outline" className="text-xs text-pink-400 border-pink-400/50">
                  <Gift className="w-3 h-3 mr-1" /> Gift
                </Badge>
              )}
              {photo.was_session_participant && (
                <Badge variant="outline" className="text-xs">
                  Session Participant
                </Badge>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
