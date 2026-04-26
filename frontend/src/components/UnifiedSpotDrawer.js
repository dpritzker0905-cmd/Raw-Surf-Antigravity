import React, { useState, useRef, useEffect, useCallback } from 'react';

import { useNavigate } from 'react-router-dom';

import { MapPin, Camera, Radio, Users, Waves, AlertTriangle, DollarSign, Zap, Check, ArrowLeft, Image, Tag, Sparkles, Star, CreditCard, Coins, Loader2, RefreshCw, ChevronDown, ChevronRight, Calendar, Lock, Crown, Trophy, CheckCircle, ExternalLink } from 'lucide-react';

import { Button } from './ui/button';

import { SpotConditions } from './SpotConditions';

import { SpotVerificationNudge } from './SpotVerificationNudge';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';

import { Drawer, DrawerContent } from './ui/drawer';

import { Input } from './ui/input';

import { Switch } from './ui/switch';

import { Badge } from './ui/badge';

import { useAuth } from '../contexts/AuthContext';

import { usePersona } from '../contexts/PersonaContext';

import { JumpInSessionModal } from './JumpInSessionModal';

import { LockerSelfieModal } from './LockerSelfieModal';

import { ScanFace } from 'lucide-react';

import apiClient from '../lib/apiClient';

import { toast } from 'sonner';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';



// Drawer modes
const DRAWER_MODE = {
  REPORT: 'REPORT',      // Surf report, tides, active shooters
  SETUP: 'SETUP',        // Session settings before going live
  JUMP_IN: 'JUMP_IN',    // Surfer joining a session (selfie + payment)
  PHOTOGRAPHER_PROFILE: 'PHOTOGRAPHER_PROFILE'  // Expanded photographer view
};

// =====================================
// SPOT OF THE DAY BADGE COMPONENT
// =====================================
const SpotOfTheDayBadge = ({ spotOfTheDay, onClick }) => {
  if (!spotOfTheDay || !spotOfTheDay.has_spot_of_the_day) return null;
  
  const getRatingColor = (rating) => {
    switch (rating?.toUpperCase()) {
      case 'EPIC': return 'from-orange-500 to-red-500';
      case 'GOOD_TO_EPIC': return 'from-yellow-500 to-orange-500';
      case 'GOOD': return 'from-green-500 to-emerald-500';
      case 'FAIR_TO_GOOD': return 'from-cyan-500 to-green-500';
      default: return 'from-cyan-500 to-blue-500';
    }
  };
  
  return (
    <div 
      onClick={onClick}
      className={`mx-4 my-3 p-3 bg-gradient-to-r ${getRatingColor(spotOfTheDay.rating)} rounded-xl cursor-pointer hover:scale-[1.02] transition-transform`}
      data-testid="spot-of-the-day-banner"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
            <Trophy className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1">
              <span className="text-white font-bold text-sm">Spot of the Day</span>
              {spotOfTheDay.rating && (
                <Badge className="bg-white/20 text-white text-[10px] ml-1">
                  {spotOfTheDay.rating}
                </Badge>
              )}
            </div>
            <p className="text-white/80 text-xs">
              {spotOfTheDay.active_photographers > 0 
                ? `${spotOfTheDay.active_photographers} Pro${spotOfTheDay.active_photographers > 1 ? 's' : ''} shooting now`
                : 'Best conditions today'}
            </p>
          </div>
        </div>
        
        {spotOfTheDay.featured_photographer && (
          <div className="flex items-center gap-2">
            <img src={getFullUrl(spotOfTheDay.featured_photographer.avatar_url || '/default-avatar.png')}
              alt={spotOfTheDay.featured_photographer.full_name}
              className="w-8 h-8 rounded-full border-2 border-white/30"
            />
          </div>
        )}
      </div>
      
      {spotOfTheDay.featured_photo_url && (
        <div className="mt-2 rounded-lg overflow-hidden">
          <img 
            src={spotOfTheDay.featured_photo_url} 
            alt="Conditions" 
            className="w-full h-24 object-cover"
          />
        </div>
      )}
      
      <p className="text-center text-white/70 text-[10px] mt-2">
        Tap to book instantly
      </p>
    </div>
  );
};

// Live Savings Badge Component - Shows only when promotional pricing is active
const LiveSavingsBadge = ({ generalPrice, livePrice, pricingMode = 'tiered', highResPrice, className = '' }) => {
  // Only show savings badge in promotional mode
  if (pricingMode !== 'promotional') return null;
  
  // Compare against high-res price in promotional mode
  const comparePrice = highResPrice || generalPrice;
  const savings = comparePrice - livePrice;
  
  if (savings <= 0) return null;
  
  return (
    <Badge className={`bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold animate-pulse ${className}`}>
      <Sparkles className="w-3 h-3 mr-1" />
      Save ${savings} per photo!
    </Badge>
  );
};

// Star Rating Component
const StarRating = ({ rating, size = 'sm' }) => {
  const stars = [];
  const sizeClass = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <Star 
        key={i} 
        className={`${sizeClass} ${i <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`} 
      />
    );
  }
  return <div className="flex items-center gap-0.5">{stars}</div>;
};

// Reviews Carousel Component
const ReviewsCarousel = ({ reviews }) => {
  if (!reviews || reviews.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500 text-sm">
        No reviews yet
      </div>
    );
  }
  
  return (
    <div className="space-y-2">
      {reviews.slice(0, 3).map((review, i) => (
        <div key={i} className="p-3 bg-zinc-800/50 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-full bg-zinc-700 overflow-hidden">
              {review.reviewer_avatar ? (
                <img src={review.reviewer_avatar} className="w-full h-full object-cover" alt="" />
              ) : (
                <span className="flex items-center justify-center h-full text-xs text-gray-400">
                  {review.reviewer_name?.[0]}
                </span>
              )}
            </div>
            <span className="text-gray-300 text-xs font-medium">{review.reviewer_name}</span>
            <StarRating rating={review.rating} />
          </div>
          <p className="text-gray-400 text-xs line-clamp-2">{review.comment}</p>
        </div>
      ))}
    </div>
  );
};

// Expanded Photographer Profile Component (In-Drawer) - OLD VERSION (keeping for reference)
const PhotographerProfile = ({ photographer, onBack, onJumpIn }) => {
  const [reviews, setReviews] = useState([]);
  const [recentBookings, setRecentBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    fetchPhotographerData();
  }, [photographer?.id]);
  
  const fetchPhotographerData = async () => {
    if (!photographer?.id) return;
    setLoading(true);
    try {
      // Fetch reviews
      const reviewsRes = await apiClient.get(`/reviews/photographer/${photographer.id}?limit=5`);
      setReviews(reviewsRes.data || []);
      
      // Fetch recent sessions
      const sessionsRes = await apiClient.get(`/photographer/${photographer.id}/session-history?limit=3`);
      setRecentBookings(sessionsRes.data || []);
    } catch (e) {
      logger.error('Error fetching photographer data:', e);
    } finally {
      setLoading(false);
    }
  };
  
  const avgRating = reviews.length > 0 
    ? (reviews.reduce((acc, r) => acc + (r.rating || 0), 0) / reviews.length).toFixed(1)
    : null;
  
  return (
    <div 
      className="relative bg-zinc-900" 
      style={{ 
        height: '90vh',
        maxHeight: '90vh'
      }}
    >
      {/* Header - Absolute positioned at top */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 p-4 border-b border-zinc-800 bg-zinc-900">
        <button onClick={onBack} className="text-gray-400 hover:text-white p-2 -ml-2">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h3 className="text-white font-bold flex-1">Photographer Profile</h3>
      </div>
      
      {/* Scrollable Content - Absolute positioned */}
      <div 
        className="absolute left-0 right-0 overflow-y-scroll overflow-x-hidden p-4 space-y-4"
        style={{ 
          top: '60px',
          bottom: '80px',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          touchAction: 'pan-y'
        }}
      >
        {/* Profile Header */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full p-[2px] bg-gradient-to-r from-cyan-400 to-blue-500">
            <div className="w-full h-full rounded-full bg-zinc-800 overflow-hidden">
              {photographer?.avatar_url ? (
                <img src={getFullUrl(photographer.avatar_url)} className="w-full h-full object-cover" alt="" />
              ) : (
                <span className="flex items-center justify-center h-full text-2xl text-cyan-400">
                  {photographer?.full_name?.charAt(0)}
                </span>
              )}
            </div>
          </div>
          <div className="flex-1">
            <h2 className="text-white font-bold text-lg">{photographer?.full_name}</h2>
            <p className="text-gray-400 text-sm">{photographer?.role}</p>
            {avgRating && (
              <div className="flex items-center gap-1 mt-1">
                <StarRating rating={Math.round(parseFloat(avgRating))} />
                <span className="text-yellow-400 text-sm font-medium ml-1">{avgRating}</span>
                <span className="text-gray-500 text-xs">({reviews.length} reviews)</span>
              </div>
            )}
          </div>
        </div>
        
        {/* Session Pricing */}
        <div className="bg-zinc-800/50 rounded-xl p-4">
          <h4 className="text-gray-400 text-xs uppercase tracking-wider mb-3">Session Pricing</h4>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-green-400 text-xl font-bold">${photographer?.session_price || 25}</p>
              <p className="text-gray-500 text-xs">Buy-in</p>
            </div>
            <div>
              <p className="text-cyan-400 text-xl font-bold">${photographer?.live_photo_price || 5}</p>
              <p className="text-gray-500 text-xs">Per Photo</p>
            </div>
            <div>
              <p className="text-white text-xl font-bold">{photographer?.photo_package_size || 3}</p>
              <p className="text-gray-500 text-xs">Included</p>
            </div>
          </div>
        </div>
        
        {/* Equipment Badge */}
        {photographer?.equipment && (
          <div className="bg-zinc-800/50 rounded-xl p-4">
            <h4 className="text-gray-400 text-xs uppercase tracking-wider mb-2 flex items-center gap-2">
              <Camera className="w-4 h-4" />
              Equipment
            </h4>
            <div className="flex items-center gap-2">
              <Badge className="bg-purple-500/20 text-purple-400">
                {photographer.equipment}
              </Badge>
            </div>
          </div>
        )}
        
        {/* Top Reviews */}
        <div className="bg-zinc-800/50 rounded-xl p-4">
          <h4 className="text-gray-400 text-xs uppercase tracking-wider mb-3 flex items-center gap-2">
            <Star className="w-4 h-4 text-yellow-400" />
            Top Reviews
          </h4>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
            </div>
          ) : (
            <ReviewsCarousel reviews={reviews.filter(r => r.rating >= 4)} />
          )}
        </div>
        
        {/* Recent Bookings */}
        <div className="bg-zinc-800/50 rounded-xl p-4">
          <h4 className="text-gray-400 text-xs uppercase tracking-wider mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Recent Sessions
          </h4>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
            </div>
          ) : recentBookings.length > 0 ? (
            <div className="space-y-2">
              {recentBookings.map((booking, i) => (
                <div key={i} className="flex items-center gap-3 p-2 bg-zinc-900/50 rounded-lg">
                  <MapPin className="w-4 h-4 text-cyan-400" />
                  <div className="flex-1">
                    <p className="text-gray-300 text-sm">{booking.location}</p>
                    <p className="text-gray-500 text-xs">
                      {new Date(booking.started_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-green-400 text-xs">{booking.total_surfers} surfers</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm text-center py-2">No recent sessions</p>
          )}
        </div>
      </div>
      
      {/* Fixed Bottom Button - Absolute positioned */}
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-zinc-800 bg-zinc-900" style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
        <Button
          onClick={onJumpIn}
          className="w-full h-12 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold text-lg"
        >
          <Users className="w-5 h-5 mr-2" />
          Jump In - ${photographer?.session_price || 25}
        </Button>
      </div>
    </div>
  );
};

// Photographer Profile Content - SCROLLABLE CONTENT ONLY (for vaul drawer)
const PhotographerProfileContent = ({ photographer }) => {
  const [reviews, setReviews] = useState([]);
  const [recentBookings, setRecentBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    fetchPhotographerData();
  }, [photographer?.id]);
  
  const fetchPhotographerData = async () => {
    if (!photographer?.id) return;
    setLoading(true);
    try {
      const reviewsRes = await apiClient.get(`/reviews/photographer/${photographer.id}?limit=5`);
      setReviews(reviewsRes.data || []);
      
      const sessionsRes = await apiClient.get(`/photographer/${photographer.id}/session-history?limit=3`);
      setRecentBookings(sessionsRes.data || []);
    } catch (e) {
      logger.error('Error fetching photographer data:', e);
    } finally {
      setLoading(false);
    }
  };
  
  const avgRating = reviews.length > 0 
    ? (reviews.reduce((acc, r) => acc + (r.rating || 0), 0) / reviews.length).toFixed(1)
    : null;

  return (
    <>
      {/* Profile Header */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full p-[2px] bg-gradient-to-r from-cyan-400 to-blue-500">
          <div className="w-full h-full rounded-full bg-zinc-800 overflow-hidden">
            {photographer?.avatar_url ? (
              <img src={getFullUrl(photographer.avatar_url)} className="w-full h-full object-cover" alt="" />
            ) : (
              <span className="flex items-center justify-center h-full text-2xl text-cyan-400">
                {photographer?.full_name?.charAt(0)}
              </span>
            )}
          </div>
        </div>
        <div className="flex-1">
          <h2 className="text-white font-bold text-lg">{photographer?.full_name}</h2>
          <p className="text-gray-400 text-sm">{photographer?.role}</p>
          {avgRating && (
            <div className="flex items-center gap-1 mt-1">
              <StarRating rating={Math.round(parseFloat(avgRating))} />
              <span className="text-yellow-400 text-sm font-medium ml-1">{avgRating}</span>
              <span className="text-gray-500 text-xs">({reviews.length} reviews)</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Session Pricing */}
      <div className="bg-zinc-800/50 rounded-xl p-4">
        <h4 className="text-gray-400 text-xs uppercase tracking-wider mb-3">Session Pricing</h4>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-green-400 text-xl font-bold">${photographer?.live_buyin_price || photographer?.session_price || 25}</p>
            <p className="text-gray-500 text-xs">Buy-in</p>
          </div>
          <div>
            <p className="text-cyan-400 text-xl font-bold">${photographer?.live_photo_price || 5}</p>
            <p className="text-gray-500 text-xs">Per Photo</p>
          </div>
          <div>
            <p className="text-white text-xl font-bold">{photographer?.photo_package_size || 3}</p>
            <p className="text-gray-500 text-xs">Included</p>
          </div>
        </div>
      </div>
      
      {/* Equipment Badge */}
      {photographer?.equipment && (
        <div className="bg-zinc-800/50 rounded-xl p-4">
          <h4 className="text-gray-400 text-xs uppercase tracking-wider mb-2 flex items-center gap-2">
            <Camera className="w-4 h-4" />
            Equipment
          </h4>
          <div className="flex items-center gap-2">
            <Badge className="bg-purple-500/20 text-purple-400">
              {photographer.equipment}
            </Badge>
          </div>
        </div>
      )}
      
      {/* Top Reviews */}
      <div className="bg-zinc-800/50 rounded-xl p-4">
        <h4 className="text-gray-400 text-xs uppercase tracking-wider mb-3 flex items-center gap-2">
          <Star className="w-4 h-4 text-yellow-400" />
          Top Reviews
        </h4>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
          </div>
        ) : (
          <ReviewsCarousel reviews={reviews.filter(r => r.rating >= 4)} />
        )}
      </div>
      
      {/* Recent Bookings */}
      <div className="bg-zinc-800/50 rounded-xl p-4">
        <h4 className="text-gray-400 text-xs uppercase tracking-wider mb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Recent Sessions
        </h4>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
          </div>
        ) : recentBookings.length > 0 ? (
          <div className="space-y-2">
            {recentBookings.map((booking, i) => (
              <div key={i} className="flex items-center gap-3 p-2 bg-zinc-900/50 rounded-lg">
                <MapPin className="w-4 h-4 text-cyan-400" />
                <div className="flex-1">
                  <p className="text-gray-300 text-sm">{booking.location}</p>
                  <p className="text-gray-500 text-xs">
                    {new Date(booking.started_at).toLocaleDateString()}
                  </p>
                </div>
                <span className="text-green-400 text-xs">{booking.total_surfers} surfers</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm text-center py-2">No recent sessions</p>
        )}
      </div>
    </>
  );
};

// LocalStorage key for camera permission persistence
const CAMERA_AUTHORIZED_KEY = 'raw_surf_camera_authorized';

// Privacy Shield Upgrade CTA Component - High Intent Conversion Gate
const GeofenceUpgradeCTA = ({ distanceMiles, _visibilityRadius, activePhotographersCount = 0 }) => {
  const navigate = useNavigate();
  
  return (
    <div className="mx-4 my-4 p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-xl">
      {/* High Intent Upsell - Show real photographer count */}
      {activePhotographersCount > 0 && (
        <div className="bg-gradient-to-r from-cyan-500/20 to-green-500/20 border border-cyan-500/40 rounded-lg p-3 mb-3 animate-pulse">
          <div className="flex items-center justify-center gap-2">
            <Camera className="w-5 h-5 text-cyan-400" />
            <span className="text-white font-bold text-lg">
              {activePhotographersCount} Pro{activePhotographersCount > 1 ? 's' : ''} Shooting Now
            </span>
          </div>
          <p className="text-center text-cyan-300 text-sm mt-1">
            Upgrade to Premium to Book
          </p>
        </div>
      )}
      
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
          <Lock className="w-5 h-5 text-purple-400" />
        </div>
        <div>
          <h3 className="text-white font-medium">Outside Your Coverage Area</h3>
          <p className="text-gray-400 text-xs">
            {distanceMiles ? `${distanceMiles.toFixed(1)} miles away` : 'Expand your range to view live activity'}
          </p>
        </div>
      </div>
      
      <div className="bg-zinc-800/50 rounded-lg p-3 mb-3">
        <p className="text-gray-300 text-sm mb-2">
          Upgrade to see:
        </p>
        <ul className="space-y-1 text-xs text-gray-400">
          <li className="flex items-center gap-2">
            <Check className="w-3 h-3 text-green-400" />
            Live photographers at this spot
          </li>
          <li className="flex items-center gap-2">
            <Check className="w-3 h-3 text-green-400" />
            Real-time conditions & session reports
          </li>
          <li className="flex items-center gap-2">
            <Check className="w-3 h-3 text-green-400" />
            Instant booking capability
          </li>
        </ul>
      </div>
      
      <div className="grid grid-cols-2 gap-2">
        <Button
          onClick={() => navigate('/settings?tab=billing')}
          className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium"
          data-testid="upgrade-plan-btn"
        >
          <Crown className="w-4 h-4 mr-1" />
          Upgrade Plan
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate('/wallet')}
          className="border-purple-500/50 text-purple-400"
          data-testid="view-plans-btn"
        >
          View Plans
        </Button>
      </div>
      
      <p className="text-center text-gray-500 text-[10px] mt-2">
        Premium members get unlimited range access
      </p>
    </div>
  );
};

// Jump In Flow Component (Selfie + Payment) - Integrated into Drawer
const JumpInFlow = ({ photographer, onBack, onSuccess }) => {
  const { user, updateUser } = useAuth();
  const { getEffectiveRole, isGodMode, activePersona } = usePersona();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  
  // Check if camera was previously authorized
  const isCameraAuthorized = localStorage.getItem(CAMERA_AUTHORIZED_KEY) === 'true';
  
  const [step, setStep] = useState(isCameraAuthorized ? 'selfie' : 'preflight'); // preflight, selfie, payment, success
  const [selfieUrl, setSelfieUrl] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('credits');
  const [permissionDenied, setPermissionDenied] = useState(false);
  
  // Calculate session pricing
  const sessionBuyinPrice = photographer?.session_price || photographer?.live_buyin_price || 25;
  const _sessionPhotoPrice = photographer?.live_photo_price || 5;
  const photosIncluded = photographer?.photo_package_size || 3;
  const galleryPhotoPrice = photographer?.gallery_photo_price || photographer?.photo_price_standard || 10;
  
  // Savings calculation
  const estimatedPhotos = photosIncluded > 0 ? photosIncluded : 3;
  const galleryTotalCost = estimatedPhotos * galleryPhotoPrice;
  const sessionTotalCost = sessionBuyinPrice;
  const savingsAmount = galleryTotalCost - sessionTotalCost;
  const savingsPercent = galleryTotalCost > 0 ? Math.round((savingsAmount / galleryTotalCost) * 100) : 0;
  
  // Subscription discounts
  let subDiscount = 0;
  if (user?.subscription_tier === 'basic') subDiscount = 0.10;
  else if (user?.subscription_tier === 'premium') subDiscount = 0.20;
  const finalPrice = sessionBuyinPrice * (1 - subDiscount);
  const hasEnoughCredits = (user?.credit_balance || 0) >= finalPrice;
  
  // Request camera permission (pre-flight)
  const requestCameraPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: 640, height: 480 } 
      });
      localStorage.setItem(CAMERA_AUTHORIZED_KEY, 'true');
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setCameraActive(true);
      } else {
        stream.getTracks().forEach(track => track.stop());
      }
      
      setStep('selfie');
      setPermissionDenied(false);
    } catch (err) {
      logger.error('Camera permission error:', err);
      setPermissionDenied(true);
      toast.error('Camera permission denied. Please enable in browser settings.');
    }
  }, []);
  
  // Camera functions
  const startCamera = useCallback(async () => {
    if (streamRef.current) {
      setCameraActive(true);
      return;
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: 640, height: 480 } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setCameraActive(true);
        localStorage.setItem(CAMERA_AUTHORIZED_KEY, 'true');
      }
    } catch (err) {
      logger.error('Camera error:', err);
      toast.error('Could not access camera. Please allow camera permissions.');
    }
  }, []);
  
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setCameraActive(false);
    }
  }, []);
  
  const captureSelfie = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    setSelfieUrl(dataUrl);
    stopCamera();
  }, [stopCamera]);
  
  const retakeSelfie = useCallback(() => {
    setSelfieUrl(null);
    startCamera();
  }, [startCamera]);
  
  // Helper to convert data URL to File and upload
  const uploadSelfie = async (dataUrl) => {
    if (!dataUrl || !dataUrl.startsWith('data:image')) return null;
    
    try {
      // Convert data URL to blob
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      
      // Create a File from blob
      const file = new File([blob], `selfie_${Date.now()}.jpg`, { type: 'image/jpeg' });
      
      // Upload using FormData
      const formData = new FormData();
      formData.append('file', file);
      
      const uploadRes = await apiClient.post(`/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      return uploadRes.data.url;
    } catch (error) {
      logger.error('Selfie upload error:', error);
      return dataUrl; // Fall back to data URL if upload fails
    }
  };
  
  // Handle join session
  const handleJoinSession = async () => {
    setLoading(true);
    try {
      // Upload selfie to server first (if captured)
      let uploadedSelfieUrl = null;
      if (selfieUrl) {
        uploadedSelfieUrl = await uploadSelfie(selfieUrl);
      }
      
      // Get effective role for God Mode support - pass user's actual role
      const effectiveRole = getEffectiveRole(user?.role);
      
      const response = await apiClient.post(`/sessions/join?surfer_id=${user.id}`, {
        photographer_id: photographer.id,
        selfie_url: uploadedSelfieUrl,
        payment_method: paymentMethod,
        // Pass effective role for God Mode persona validation
        effective_role: isGodMode && activePersona ? effectiveRole : null
      });
      
      if (paymentMethod === 'credits') {
        updateUser({ credit_balance: response.data.remaining_credits });
      }
      
      setStep('success');
      toast.success('You\'re in the session!');
      
      setTimeout(() => {
        onSuccess?.(response.data);
      }, 2000);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to join session');
    } finally {
      setLoading(false);
    }
  };
  
  // Cleanup on unmount
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);
  
  // Keyboard shortcut for closing map/drawer
  useEffect(() => {
    if (step === 'selfie' && !selfieUrl) {
      startCamera();
    }
  }, [step, selfieUrl, startCamera]);
  
  return (
    <div 
      className="relative bg-zinc-900" 
      style={{ 
        height: '90vh',
        maxHeight: '90vh'
      }}
    >
      {/* Header - Fixed at top with z-index */}
      <div 
        className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 p-4 border-b border-zinc-800 bg-zinc-900"
      >
        <button onClick={onBack} className="text-gray-400 hover:text-white p-2 -ml-2">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h3 className="text-white font-bold flex-1">
          {step === 'preflight' ? 'Camera Access Required' : 'Jump In Session'}
        </h3>
      </div>
      
      {/* Scrollable Content Area - Absolute positioned below header */}
      <div 
        className="absolute left-0 right-0 overflow-y-scroll overflow-x-hidden"
        style={{ 
          top: '60px', // Header height
          bottom: step === 'payment' || step === 'selfie' ? '80px' : '0', // Space for fixed button
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          touchAction: 'pan-y'
        }}
      >
      
      {/* Pre-flight Camera Permission Step */}
      {step === 'preflight' && (
        <div className="p-6 flex flex-col items-center justify-center text-center min-h-full">
          <div className="w-20 h-20 rounded-full bg-cyan-500/20 flex items-center justify-center mb-4">
            <Camera className="w-10 h-10 text-cyan-400" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Enable Camera</h3>
          <p className="text-gray-400 mb-6 max-w-xs">
            We need camera access so you can take a quick selfie. This helps the photographer identify you in the water.
          </p>
          
          {permissionDenied && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 max-w-xs">
              <span className="text-red-300 text-sm">
                Camera access was denied. Please enable it in your browser settings.
              </span>
            </div>
          )}
          
          <Button
            onClick={requestCameraPermission}
            className="w-full max-w-xs bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold py-3"
            data-testid="enable-camera-btn"
          >
            <Camera className="w-5 h-5 mr-2" />
            Enable Camera & Continue
          </Button>
          
          <button
            onClick={() => setStep('payment')}
            className="mt-3 text-gray-500 text-sm hover:text-gray-300"
          >
            Skip selfie (not recommended)
          </button>
        </div>
      )}
      
      {/* Photographer Info Bar - Hidden in preflight */}
      {step !== 'preflight' && (
        <div className="p-4 bg-zinc-800/50 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full p-[2px] bg-gradient-to-r from-cyan-400 to-blue-500">
            <div className="w-full h-full rounded-full bg-zinc-800 overflow-hidden">
              {photographer?.avatar_url ? (
                <img src={getFullUrl(photographer.avatar_url)} className="w-full h-full object-cover" alt="" />
              ) : (
                <span className="flex items-center justify-center h-full text-lg text-cyan-400">
                  {photographer?.full_name?.charAt(0)}
                </span>
              )}
            </div>
          </div>
          <div className="flex-1">
            <div className="text-white font-medium">{photographer?.full_name}</div>
            <div className="text-gray-400 text-sm">at {photographer?.current_spot_name}</div>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold text-white">${sessionBuyinPrice}</div>
            {subDiscount > 0 && (
              <div className="text-emerald-400 text-xs">-{subDiscount * 100}% subscriber</div>
            )}
          </div>
        </div>
      )}
      
      {/* Session Value Breakdown - Hidden in preflight */}
      {step !== 'preflight' && savingsAmount > 0 && (
        <div className="px-4 py-3 bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border-y border-emerald-500/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-emerald-400 text-sm font-medium">Live Session Deal</p>
              <p className="text-gray-400 text-xs">{photosIncluded} photos included vs ${galleryPhotoPrice}/photo in gallery</p>
            </div>
            <div className="text-right">
              <p className="text-emerald-400 font-bold">Save ${savingsAmount.toFixed(0)}</p>
              <p className="text-emerald-300 text-xs">{savingsPercent}% off gallery price</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Step Content */}
      <div className="p-4">
        {/* Step 1: Selfie Capture */}
        {step === 'selfie' && (
          <div className="space-y-4">
            {/* Camera / Preview - Constrained on desktop, full on mobile */}
            <div className="flex flex-col items-center">
              <div className="relative w-full md:max-w-[400px] md:max-h-[400px] aspect-[4/3] bg-black rounded-xl overflow-hidden">
                {!selfieUrl ? (
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover scale-x-[-1]"
                    />
                    {!cameraActive && (
                      <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                        <Loader2 className="w-8 h-8 text-yellow-400 animate-spin" />
                      </div>
                    )}
                  </>
                ) : (
                  <img src={selfieUrl} alt="Your selfie" className="w-full h-full object-cover" />
                )}
                <canvas ref={canvasRef} className="hidden" />
              </div>
              
              {/* PROMINENT Identification Instruction */}
              <div className="mt-4 p-4 bg-cyan-500/20 border-2 border-cyan-500/40 rounded-xl w-full md:max-w-[400px]">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-cyan-500/30 flex items-center justify-center shrink-0">
                    <span className="text-2xl">🏄</span>
                  </div>
                  <div>
                    <p className="text-cyan-300 font-bold">Hold your surfboard up!</p>
                    <p className="text-cyan-400/80 text-sm">
                      This helps the photographer find you in the lineup.
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Desktop Camera Controls - Hidden on mobile (uses sticky footer) */}
              <div className="hidden md:flex gap-3 justify-center md:max-w-[400px] mx-auto w-full mt-4">
                {!selfieUrl ? (
                  <Button
                    onClick={captureSelfie}
                    disabled={!cameraActive}
                    className="flex-1 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold"
                    data-testid="capture-selfie-btn"
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    Capture Selfie
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={retakeSelfie}
                      variant="outline"
                      className="flex-1 border-zinc-600 text-white hover:bg-zinc-800"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Retake
                    </Button>
                    <Button
                      onClick={() => setStep('payment')}
                      className="flex-1 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold"
                    >
                      Continue
                    </Button>
                  </>
                )}
              </div>
            </div>
            
            {/* Skip selfie option - Desktop only (mobile has sticky footer) */}
            <button
              onClick={() => setStep('payment')}
              className="hidden md:block w-full text-center text-gray-500 text-sm hover:text-gray-300 md:max-w-[400px] mx-auto"
            >
              Skip selfie (not recommended)
            </button>
          </div>
        )}
        
        {/* Step 2: Payment Selection */}
        {step === 'payment' && (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <div className="text-gray-300 text-sm">
                Choose how you'd like to pay
              </div>
            </div>
            
            {/* Price Summary */}
            <div className="bg-zinc-800 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-400">Session Price</span>
                <span className="text-white">${sessionBuyinPrice.toFixed(2)}</span>
              </div>
              {subDiscount > 0 && (
                <div className="flex justify-between items-center mb-2 text-emerald-400">
                  <span>Subscriber Discount ({subDiscount * 100}%)</span>
                  <span>-${(sessionBuyinPrice * subDiscount).toFixed(2)}</span>
                </div>
              )}
              <div className="border-t border-zinc-700 pt-2 mt-2 flex justify-between items-center">
                <span className="text-white font-bold">Total</span>
                <span className="text-xl font-bold text-yellow-400">${finalPrice.toFixed(2)}</span>
              </div>
            </div>
            
            {/* Payment Options */}
            <div className="space-y-3">
              {/* Credits Option */}
              <button
                onClick={() => setPaymentMethod('credits')}
                disabled={!hasEnoughCredits}
                className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-all ${
                  paymentMethod === 'credits'
                    ? 'border-yellow-400 bg-yellow-400/10'
                    : hasEnoughCredits
                      ? 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                      : 'border-zinc-800 bg-zinc-800/50 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  paymentMethod === 'credits' ? 'border-yellow-400' : 'border-zinc-600'
                }`}>
                  {paymentMethod === 'credits' && <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />}
                </div>
                <Coins className={`w-6 h-6 ${paymentMethod === 'credits' ? 'text-yellow-400' : 'text-gray-400'}`} />
                <div className="text-left flex-1">
                  <div className="text-white font-medium">Pay with Credits</div>
                  <div className="text-gray-400 text-sm">
                    Balance: ${(user?.credit_balance || 0).toFixed(2)}
                    {!hasEnoughCredits && <span className="text-red-400 ml-2">(insufficient)</span>}
                  </div>
                </div>
              </button>
              
              {/* Card Option */}
              <button
                onClick={() => setPaymentMethod('card')}
                className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-all ${
                  paymentMethod === 'card'
                    ? 'border-yellow-400 bg-yellow-400/10'
                    : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  paymentMethod === 'card' ? 'border-yellow-400' : 'border-zinc-600'
                }`}>
                  {paymentMethod === 'card' && <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />}
                </div>
                <CreditCard className={`w-6 h-6 ${paymentMethod === 'card' ? 'text-yellow-400' : 'text-gray-400'}`} />
                <div className="text-left flex-1">
                  <div className="text-white font-medium">Pay with Card</div>
                  <div className="text-gray-400 text-sm">Visa, Mastercard, etc.</div>
                </div>
              </button>
            </div>
            
            {/* Back button */}
            <button
              onClick={() => setStep('selfie')}
              className="w-full text-center text-gray-500 text-sm hover:text-gray-300"
            >
              ← Back to selfie
            </button>
          </div>
        )}
        
        {/* Step 3: Success */}
        {step === 'success' && (
          <div className="py-8 text-center space-y-4">
            <div className="w-20 h-20 mx-auto rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Check className="w-10 h-10 text-emerald-400" />
            </div>
            <h3 className="text-2xl font-bold text-white" style={{ fontFamily: 'Oswald' }}>
              You're In!
            </h3>
            <p className="text-gray-400">
              {photographer?.full_name} can now see you in their session. 
              Head to the water and catch some waves!
            </p>
            <div className="bg-zinc-800 rounded-lg p-4 text-left">
              <div className="text-sm text-gray-400 mb-1">Shooting at</div>
              <div className="text-white font-medium">{photographer?.current_spot_name}</div>
            </div>
          </div>
        )}
      </div>
      </div>
      {/* End of Scrollable Container */}
      
      {/* Fixed Bottom Button - Pay Now - Absolute positioned */}
      {step === 'payment' && (
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-zinc-800 bg-zinc-900" style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
          <Button
            onClick={handleJoinSession}
            disabled={loading || (paymentMethod === 'credits' && !hasEnoughCredits)}
            className="w-full h-12 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold text-lg"
            data-testid="pay-now-btn"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>Pay Now - ${finalPrice.toFixed(2)}</>
            )}
          </Button>
        </div>
      )}
      
      {/* Fixed Bottom - Selfie Controls (Mobile sticky footer) - Absolute positioned */}
      {step === 'selfie' && (
        <div className="absolute bottom-0 left-0 right-0 md:hidden p-4 border-t border-zinc-800 bg-zinc-900" style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
          <div className="flex gap-3">
            {!selfieUrl ? (
              <Button
                onClick={captureSelfie}
                disabled={!cameraActive}
                className="flex-1 h-12 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold text-lg"
                data-testid="capture-selfie-btn-mobile"
              >
                <Camera className="w-5 h-5 mr-2" />
                Take Selfie
              </Button>
            ) : (
              <>
                <Button
                  onClick={retakeSelfie}
                  variant="outline"
                  className="flex-1 h-12 border-zinc-600 text-white hover:bg-zinc-800"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retake
                </Button>
                <Button
                  onClick={() => setStep('payment')}
                  className="flex-1 h-12 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold"
                >
                  Continue
                </Button>
              </>
            )}
          </div>
          <button
            onClick={() => setStep('payment')}
            className="w-full text-center text-gray-500 text-sm hover:text-gray-300 mt-2"
          >
            Skip selfie
          </button>
        </div>
      )}
    </div>
  );
};

const UnifiedSpotDrawer = ({
  spot,
  isOpen,
  onClose,
  onStartShooting,
  onSwitchLocation,
  activeShooters = [],
  isPhotographer = false,
  isUserLive = false,
  currentLiveSpot = null,
  goLiveLoading = false,
  userId = null
}) => {
  // Privacy Shield: Check if spot is within user's geofence
  const { user } = useAuth();
  const navigate = useNavigate();
  const isWithinGeofence = spot?.is_within_geofence !== false;
  const distanceMiles = spot?.distance_miles;
  const visibilityRadius = spot?.visibility_radius_miles;
  
  // Drawer mode
  const [drawerMode, setDrawerMode] = useState(DRAWER_MODE.REPORT);
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false);
  const [selectedPhotographer, setSelectedPhotographer] = useState(null);
  const _drawerRef = useRef(null);
  
  // Snap point control for drawer height
  const [activeSnapPoint, setActiveSnapPoint] = useState(0.75);
  
  // Jump In Session Modal state
  const [showJumpInModal, setShowJumpInModal] = useState(false);
  
  // Refine Location Modal state
  const [showRefineModal, setShowRefineModal] = useState(false);
  const [refinePosition, setRefinePosition] = useState(null);
  const [refineLoading, setRefineLoading] = useState(false);
  const refineMapRef = useRef(null);
  const refineMapInstanceRef = useRef(null);
  const refineMarkerRef = useRef(null);
  
  // Check if user is live at THIS specific spot
  const isLiveAtThisSpot = isUserLive && currentLiveSpot?.id === spot?.id;
  
  // Session pricing settings
  const [sessionSettings, setSessionSettings] = useState({
    price_per_join: 25,
    auto_accept: true,
    max_surfers: 10,
    estimated_duration: 2,
    live_photo_price: 5,
    photos_included: 3,
    general_photo_price: 10,
    photo_price_high: 10,
    pricing_mode: 'tiered' // 'tiered' or 'promotional'
  });

  // Spot of the Day state
  const [spotOfTheDay, setSpotOfTheDay] = useState(null);

  // Real-Time Wave Height state (NOAA/Open-Meteo data)
  const [liveWaveHeight, setLiveWaveHeight] = useState(null);
  
  // User's current location for verification nudge
  const [userLocation, setUserLocation] = useState(null);

  // Helper function to get wave badge color based on wave height
  const getWaveBadgeColor = (height) => {
    if (height >= 10) return 'bg-red-500 text-white';
    if (height >= 8) return 'bg-orange-500 text-white';
    if (height >= 6) return 'bg-yellow-500 text-black';
    if (height >= 4) return 'bg-emerald-500 text-white';
    if (height >= 2) return 'bg-blue-500 text-white';
    return 'bg-gray-500 text-white';
  };

  // Fetch user's existing pricing when drawer opens
  useEffect(() => {
    if (isOpen && isPhotographer && userId) {
      fetchPricing();
    }
  }, [isOpen, isPhotographer, userId]);

  // Fetch Spot of the Day when drawer opens
  useEffect(() => {
    if (isOpen && spot?.region) {
      fetchSpotOfTheDay();
    }
  }, [isOpen, spot?.region]);

  // Fetch Real-Time Wave Height when drawer opens
  useEffect(() => {
    if (isOpen && spot?.id) {
      fetchLiveWaveHeight();
    }
  }, [isOpen, spot?.id]);

  // Get user location for verification nudge (photographers only)
  useEffect(() => {
    if (isOpen && isPhotographer && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          logger.debug('Geolocation error:', error);
        },
        { enableHighAccuracy: true }
      );
    }
  }, [isOpen, isPhotographer]);

  const fetchLiveWaveHeight = async () => {
    try {
      const response = await apiClient.get(`/conditions/${spot.id}`);
      if (response.data?.current?.wave_height_ft) {
        setLiveWaveHeight(Math.round(response.data.current.wave_height_ft));
      }
    } catch (error) {
      logger.debug('Wave height data not available');
      setLiveWaveHeight(null);
    }
  };

  const fetchSpotOfTheDay = async () => {
    try {
      const response = await apiClient.get(`/spot-of-the-day`, {
        params: { region: spot?.region }
      });
      if (response.data.has_spot_of_the_day) {
        // Only show if it's for THIS spot
        if (response.data.spot?.id === spot?.id) {
          setSpotOfTheDay(response.data);
        } else {
          setSpotOfTheDay(null);
        }
      }
    } catch (error) {
      logger.debug('Spot of the Day not available');
    }
  };

  // Reset drawer mode when spot changes or drawer closes
  useEffect(() => {
    if (spot) {
      setDrawerMode(DRAWER_MODE.REPORT);
      setSelectedPhotographer(null);
    }
  }, [spot?.id]);

  useEffect(() => {
    if (!isOpen) {
      setDrawerMode(DRAWER_MODE.REPORT);
      setSelectedPhotographer(null);
    }
  }, [isOpen]);

  const fetchPricing = async () => {
    try {
      const [pricingRes, galleryRes] = await Promise.all([
        apiClient.get(`/photographer/${userId}/pricing`),
        apiClient.get(`/photographer/${userId}/gallery-pricing`).catch(() => ({ data: {} }))
      ]);
      
      const generalPrice = galleryRes.data?.photo_pricing?.standard || 10;
      
      setSessionSettings(prev => ({
        ...prev,
        price_per_join: pricingRes.data.live_buyin_price || 25,
        live_photo_price: pricingRes.data.live_photo_price || 5,
        photos_included: pricingRes.data.photo_package_size || 3,
        general_photo_price: generalPrice
      }));
    } catch (e) {
      logger.error('Error fetching pricing:', e);
    }
  };

  // Calculate live savings - only show in promotional mode
  const liveSavings = sessionSettings.pricing_mode === 'promotional'
    ? (sessionSettings.photo_price_high || sessionSettings.general_photo_price) - sessionSettings.live_photo_price
    : sessionSettings.general_photo_price - sessionSettings.live_photo_price;
  const hasSavings = liveSavings > 0 && sessionSettings.pricing_mode === 'promotional';

  const handleStartShooting = () => {
    if (isUserLive && currentLiveSpot?.id !== spot.id) {
      setShowSwitchConfirm(true);
    } else {
      setDrawerMode(DRAWER_MODE.SETUP);
    }
  };

  const confirmSwitchLocation = () => {
    setShowSwitchConfirm(false);
    onSwitchLocation?.(spot?.id, sessionSettings);
  };

  // Find Me Spot Scanner State
  const [scanModalOpen, setScanModalOpen] = useState(false);

  // ============ REFINE LOCATION FUNCTIONS ============
  const openRefineModal = () => {
    setRefinePosition({ lat: spot.latitude, lng: spot.longitude });
    setShowRefineModal(true);
  };

  const initRefineMap = useCallback(() => {
    if (!refineMapRef.current || !window.L || !spot) return;
    
    // Clean up existing map
    if (refineMapInstanceRef.current) {
      refineMapInstanceRef.current.remove();
      refineMapInstanceRef.current = null;
    }
    
    const map = window.L.map(refineMapRef.current, {
      center: [spot.latitude, spot.longitude],
      zoom: 17,
      zoomControl: true
    });
    
    // Satellite layer (Esri World Imagery)
    window.L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Esri', maxZoom: 19 }
    ).addTo(map);
    
    // Create draggable marker
    const icon = window.L.divIcon({
      className: 'refine-pin-marker',
      html: `
        <div class="relative">
          <div class="w-8 h-8 rounded-full bg-gradient-to-r from-cyan-400 to-green-400 border-4 border-white shadow-lg flex items-center justify-center">
            <div class="w-3 h-3 bg-white rounded-full"></div>
          </div>
          <div class="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[10px] border-t-cyan-400"></div>
        </div>
      `,
      iconSize: [32, 40],
      iconAnchor: [16, 40]
    });
    
    const marker = window.L.marker([spot.latitude, spot.longitude], {
      icon,
      draggable: true
    }).addTo(map);
    
    // Track drag events
    marker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      setRefinePosition({ lat: pos.lat, lng: pos.lng });
    });
    
    refineMarkerRef.current = marker;
    refineMapInstanceRef.current = map;
  }, [spot]);

  // Initialize refine map when modal opens
  useEffect(() => {
    if (showRefineModal && spot) {
      setTimeout(() => initRefineMap(), 100);
    }
    
    return () => {
      if (refineMapInstanceRef.current) {
        refineMapInstanceRef.current.remove();
        refineMapInstanceRef.current = null;
      }
    };
  }, [showRefineModal, spot, initRefineMap]);

  // Submit refinement
  const submitRefinement = async () => {
    if (!userId || !spot?.id || !refinePosition) return;
    
    setRefineLoading(true);
    try {
      await apiClient.post(`/spots/${spot.id}/refine-location`, null, {
        params: {
          photographer_id: userId,
          new_latitude: refinePosition.lat,
          new_longitude: refinePosition.lng
        }
      });
      toast.success('Peak location submitted for review!', {
        description: 'Thanks for helping improve spot accuracy'
      });
      setShowRefineModal(false);
    } catch (error) {
      const msg = error.response?.data?.detail || 'Failed to submit refinement';
      toast.error(msg);
    } finally {
      setRefineLoading(false);
    }
  };

  const handleConfirmGoLive = () => {
    // Pass spot.id (not entire spot object) and session settings
    onStartShooting?.(spot?.id, sessionSettings);
  };

  const handleJumpInClick = (shooter) => {
    setSelectedPhotographer({
      ...shooter,
      current_spot_name: spot?.name
    });
    // Open the Jump In modal directly instead of going to profile first
    setShowJumpInModal(true);
  };

  // Handler for viewing photographer profile without joining
  const _handleViewPhotographerProfile = (shooter) => {
    setSelectedPhotographer({
      ...shooter,
      current_spot_name: spot?.name
    });
    setDrawerMode(DRAWER_MODE.PHOTOGRAPHER_PROFILE);
    // Expand drawer to full height when viewing photographer profile
    setActiveSnapPoint(1);
  };

  const _handleJumpInSuccess = (_data) => {
    setShowJumpInModal(false);
    setDrawerMode(DRAWER_MODE.REPORT);
    setSelectedPhotographer(null);
    setActiveSnapPoint(0.6); // Reset to default snap point
    // Could trigger a refresh of active shooters here
  };

  if (!spot) return null;

  return (
    <>
      {/* Main Drawer - Using vaul for proper mobile scrolling */}
      <Drawer 
        open={isOpen && !showJumpInModal} 
        onOpenChange={(open) => {
          if (!open && !showJumpInModal) {
            onClose();
            setActiveSnapPoint(0.75); // Reset on close
          }
        }} 
        snapPoints={[0.5, 0.75, 1]}
        activeSnapPoint={activeSnapPoint}
        setActiveSnapPoint={setActiveSnapPoint}
      >
        <DrawerContent 
          className="bg-zinc-900 border-t border-zinc-700 max-h-[90vh] focus:outline-none"
          data-testid="unified-spot-drawer"
        >
          {/* Expanded Photographer Profile View */}
          {drawerMode === DRAWER_MODE.PHOTOGRAPHER_PROFILE && selectedPhotographer && (
            <div className="flex flex-col" style={{ height: '85vh', maxHeight: '85vh' }}>
              {/* Header - Fixed */}
              <div className="flex items-center gap-3 p-4 border-b border-zinc-800 shrink-0">
                <button onClick={() => {
                  setDrawerMode(DRAWER_MODE.REPORT);
                  setActiveSnapPoint(0.6);
                }} className="text-gray-400 hover:text-white p-2 -ml-2">
                  <ArrowLeft className="w-6 h-6" />
                </button>
                <h3 className="text-white font-bold flex-1">Photographer Profile</h3>
              </div>
              
              {/* Scrollable Content */}
              <div 
                className="flex-1 overflow-y-auto p-4 space-y-4"
                style={{ 
                  WebkitOverflowScrolling: 'touch',
                  touchAction: 'pan-y'
                }}
              >
                <PhotographerProfileContent 
                  photographer={selectedPhotographer}
                />
                {/* Bottom spacer for scroll */}
                <div className="h-4" />
              </div>
              
              {/* Fixed Bottom Button - Opens Jump In Modal */}
              <div className="shrink-0 p-4 border-t border-zinc-800 bg-zinc-900" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
                <Button
                  onClick={() => setShowJumpInModal(true)}
                  className="w-full h-12 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold text-lg"
                  data-testid="jump-in-session-btn"
                >
                  <Users className="w-5 h-5 mr-2" />
                  Jump In - ${selectedPhotographer?.live_buyin_price || selectedPhotographer?.session_price || 25}
                </Button>
              </div>
            </div>
          )}

          {/* Standard Views (REPORT and SETUP) */}
          {(drawerMode === DRAWER_MODE.REPORT || drawerMode === DRAWER_MODE.SETUP) && (
            <div className="flex flex-col max-h-[85vh]">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
                <div className="flex items-center gap-3">
                  {drawerMode === DRAWER_MODE.SETUP && (
                    <button
                      onClick={() => setDrawerMode(DRAWER_MODE.REPORT)}
                      className="text-gray-400 hover:text-white"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  )}
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 p-0.5">
                    <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center">
                      <MapPin className="w-5 h-5 text-cyan-400" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2
                        className="text-white font-bold text-lg cursor-pointer hover:text-cyan-400 transition-colors truncate"
                        style={{ fontFamily: 'Oswald' }}
                        onClick={() => { navigate(`/spot-hub/${spot.id}`); onClose?.(); }}
                        title="View Spot Hub"
                      >
                        {spot.name}
                      </h2>
                      {/* Real-Time Wave Height Badge - NOAA/Open-Meteo data */}
                      {liveWaveHeight !== null && (
                        <Badge className={`text-xs px-1.5 py-0.5 shrink-0 ${getWaveBadgeColor(liveWaveHeight)}`} data-testid="live-wave-badge">
                          <Waves className="w-3 h-3 mr-0.5" />
                          {liveWaveHeight}ft
                        </Badge>
                      )}
                      {/* Community Verified Badge */}
                      {spot.community_verified && (
                        <Badge className="bg-emerald-500 text-white text-xs px-1.5 py-0.5 shrink-0" data-testid="community-verified-badge">
                          <CheckCircle className="w-3 h-3 mr-0.5" />
                          Verified
                        </Badge>
                      )}
                    </div>
                    <p className="text-gray-400 text-xs">{spot.region}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Refine Peak button - shows when photographer is LIVE at THIS spot */}
                  {isPhotographer && isLiveAtThisSpot && drawerMode === DRAWER_MODE.REPORT && (
                    <Button
                      onClick={openRefineModal}
                      size="sm"
                      variant="outline"
                      className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
                      data-testid="refine-peak-btn"
                    >
                      <MapPin className="w-4 h-4 mr-1" />
                      Refine Peak
                    </Button>
                  )}
                  
                  {/* Start Shooting button - only for photographers in REPORT mode */}
                  {isPhotographer && drawerMode === DRAWER_MODE.REPORT && (
                    <Button
                      onClick={handleStartShooting}
                      disabled={goLiveLoading}
                      size="sm"
                      className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-medium"
                      data-testid="start-shooting-btn"
                    >
                      {goLiveLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Camera className="w-4 h-4 mr-1" />
                          Start Shooting
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {/* Scrollable Content */}
              <div 
                className="flex-1 overflow-y-auto overscroll-contain pb-6"
                style={{ 
                  WebkitOverflowScrolling: 'touch',
                  touchAction: 'pan-y'
                }}
              >
                {/* ==================== REPORT MODE ==================== */}
                {drawerMode === DRAWER_MODE.REPORT && (
                  <>
                    {/* Live Session Savings Banner */}
                    {activeShooters.length > 0 && (
                      <div className="px-4 py-3 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-b border-green-500/20">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-green-400" />
                          <span className="text-green-400 font-medium text-sm">Live Session Savings!</span>
                        </div>
                        <p className="text-gray-400 text-xs mt-1">
                          Join a session now and get photos at discounted rates
                        </p>
                      </div>
                    )}

                    {/* Spot of the Day Badge - Social Discovery Engine */}
                    {spotOfTheDay && (
                      <SpotOfTheDayBadge 
                        spotOfTheDay={spotOfTheDay}
                        onClick={() => {
                          // Scroll to photographer list or open booking
                          if (activeShooters.length > 0) {
                            handleJumpInClick(activeShooters[0]);
                          }
                        }}
                      />
                    )}

                    {/* Surf Conditions - Always visible */}
                    <div className="px-4">
                      <SpotConditions spotId={spot?.id} spotName={spot?.name} />
                      
                      {/* Targeted Spot AI Scan Feature */}
                      {user && (
                        <div className="mt-4 p-4 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 rounded-xl">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h4 className="text-white font-medium flex items-center gap-2">
                                <ScanFace className="w-4 h-4 text-cyan-400" />
                                Scan {spot?.name} for My Photos
                              </h4>
                              <p className="text-gray-400 text-xs mt-1">
                                Did you shred here recently? We'll sweep this exact spot searching for your wetsuit, board, and face.
                              </p>
                            </div>
                            <Button
                              onClick={() => setScanModalOpen(true)}
                              className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold shrink-0"
                              size="sm"
                              data-testid="spot-scan-btn"
                            >
                              Scan Spot
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Photographer Verification Nudge - Show when photographer is within 200m */}
                    {isPhotographer && (
                      <div className="px-4 py-3">
                        <SpotVerificationNudge 
                          spot={spot}
                          userLocation={userLocation}
                        />
                      </div>
                    )}

                    {/* Privacy Shield: Show upgrade CTA if outside geofence */}
                    {!isWithinGeofence && (
                      <GeofenceUpgradeCTA 
                        distanceMiles={distanceMiles}
                        visibilityRadius={visibilityRadius}
                        activePhotographersCount={spot?.active_photographers_count || 0}
                      />
                    )}

                    {/* Active Photographers - Only show if within geofence */}
                    {isWithinGeofence && (
                      <div className="px-4 py-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Radio className="w-4 h-4 text-green-400" />
                          <h3 className="text-white font-medium text-sm">
                            Live Now ({activeShooters.length})
                          </h3>
                        </div>

                        {activeShooters.length > 0 ? (
                          <div className="space-y-3">
                            {activeShooters.map((shooter) => (
                              <div 
                                key={shooter.id} 
                                className="flex items-center gap-3 p-3 bg-zinc-800/50 rounded-xl cursor-pointer hover:bg-zinc-800 transition-colors"
                                onClick={() => handleJumpInClick(shooter)}
                                data-testid={`photographer-card-${shooter.id}`}
                              >
                                <div className="relative">
                                  <div className="w-12 h-12 rounded-full p-[2px] bg-gradient-to-r from-green-400 to-cyan-400">
                                    <div className="w-full h-full rounded-full bg-zinc-800 overflow-hidden">
                                      {shooter.avatar_url ? (
                                        <img src={getFullUrl(shooter.avatar_url)} className="w-full h-full object-cover" alt="" />
                                      ) : (
                                        <span className="flex items-center justify-center h-full text-cyan-400">
                                          {shooter.full_name?.[0]}
                                        </span>
                                      )}
                                    </div>
                                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full border-2 border-zinc-900" />
                                  </div>
                                </div>
                                <div className="flex-1">
                                  <p className="text-white font-medium text-sm">{shooter.full_name}</p>
                                  <div className="flex items-center gap-2">
                                    <p className="text-gray-400 text-xs">
                                      ${shooter.session_price || 25} buy-in
                                    </p>
                                    {shooter.live_photo_price && shooter.general_photo_price && 
                                     shooter.live_photo_price < shooter.general_photo_price && (
                                      <Badge className="bg-green-500/20 text-green-400 text-[10px] px-1.5 py-0">
                                        Save ${shooter.general_photo_price - shooter.live_photo_price}/photo
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10 text-xs"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleJumpInClick(shooter);
                                  }}
                                  data-testid={`jump-in-btn-${shooter.id}`}
                                >
                                  <Users className="w-3 h-3 mr-1" />
                                  Jump In
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-6 text-gray-500">
                            <Camera className="w-8 h-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No photographers shooting here yet</p>
                            {isPhotographer && (
                              <p className="text-xs text-cyan-400 mt-1">Be the first to go live!</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Difficulty Badge */}
                    {spot.difficulty && (
                      <div className="px-4 py-3">
                        <span className="inline-block px-3 py-1 bg-zinc-800 rounded-lg text-xs text-gray-300">
                          {spot.difficulty}
                        </span>
                      </div>
                    )}

                    {/* Open Sessions - Bookings with split_mode='open_nearby' */}
                    {isWithinGeofence && spot.open_bookings?.length > 0 && (
                      <div className="px-4 py-4 border-t border-zinc-800">
                        <div className="flex items-center gap-2 mb-3">
                          <Users className="w-4 h-4 text-cyan-400" />
                          <h3 className="text-white font-medium text-sm">
                            Join a Crew ({spot.open_bookings.length})
                          </h3>
                          <Badge className="bg-cyan-500/20 text-cyan-400 text-[10px] px-1.5 py-0">
                            Open to Nearby
                          </Badge>
                        </div>
                        
                        <div className="space-y-3">
                          {spot.open_bookings.map((booking) => (
                            <div 
                              key={booking.id}
                              className="p-3 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-xl border border-cyan-500/30 cursor-pointer hover:border-cyan-500/50 transition-colors"
                              onClick={() => {
                                // Navigate to bookings page with this invite code
                                navigate(`/bookings?join=${booking.invite_code}`);
                                onClose?.();
                              }}
                              data-testid={`open-booking-${booking.id}`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  {booking.photographer_avatar ? (
                                    <img 
                                      src={booking.photographer_avatar}
                                      alt=""
                                      className="w-8 h-8 rounded-full object-cover border border-cyan-500/30"
                                    />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white text-sm font-bold">
                                      {booking.photographer_name?.[0] || '?'}
                                    </div>
                                  )}
                                  <div>
                                    <p className="text-white text-sm font-medium">
                                      {booking.photographer_name || 'Session'}
                                    </p>
                                    <p className="text-gray-400 text-xs">
                                      {new Date(booking.session_date).toLocaleDateString(undefined, { 
                                        weekday: 'short', 
                                        month: 'short', 
                                        day: 'numeric',
                                        hour: 'numeric',
                                        minute: '2-digit'
                                      })}
                                    </p>
                                  </div>
                                </div>
                                <Badge className="bg-green-500/20 text-green-400 text-xs px-2 py-0.5">
                                  {booking.spots_left} spot{booking.spots_left > 1 ? 's' : ''} left
                                </Badge>
                              </div>
                              
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 text-xs text-gray-400">
                                  <span className="flex items-center gap-1">
                                    <DollarSign className="w-3 h-3" />
                                    ${booking.price_per_person?.toFixed(2)}/person
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Users className="w-3 h-3" />
                                    {booking.max_participants - booking.spots_left}/{booking.max_participants}
                                  </span>
                                </div>
                                <Button
                                  size="sm"
                                  className="bg-cyan-500 hover:bg-cyan-600 text-black text-xs h-7"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/bookings?join=${booking.invite_code}`);
                                    onClose?.();
                                  }}
                                >
                                  Join Crew
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* ── View Full Spot Hub CTA ──────────────────────────── */}
                    <div className="px-4 py-4">
                      <button
                        onClick={() => { navigate(`/spot-hub/${spot.id}`); onClose?.(); }}
                        className="w-full group relative overflow-hidden rounded-xl border border-cyan-500/30 bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-500/10 hover:from-cyan-500/20 hover:via-blue-500/20 hover:to-purple-500/20 transition-all duration-300"
                        data-testid="view-spot-hub-btn"
                      >
                        <div className="flex items-center justify-between px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 p-0.5 shrink-0">
                              <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center">
                                <ExternalLink className="w-4 h-4 text-cyan-400" />
                              </div>
                            </div>
                            <div>
                              <p className="text-white font-semibold text-sm">View Full Spot Hub</p>
                              <p className="text-gray-400 text-xs">Forecast, reports, galleries & more</p>
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-cyan-400 group-hover:translate-x-1 transition-transform" />
                        </div>
                      </button>
                    </div>

                    {/* Bottom safe area padding for mobile */}
                    <div className="h-20" aria-hidden="true" />
                  </>
                )}

                {/* ==================== SETUP MODE ==================== */}
                {drawerMode === DRAWER_MODE.SETUP && (
                  <div className="px-4 py-6 space-y-5">
                    {/* Setup Header Info */}
                    <div className="text-center mb-4">
                      <p className="text-gray-400 text-sm">
                        Set your <span className="text-cyan-400 font-semibold">Live Session Rates</span> for
                      </p>
                      <p className="text-white font-medium">{spot.name}</p>
                    </div>

                    {/* Live Savings Preview - Shows only in Promotional mode */}
                    {hasSavings && (
                      <div className="p-4 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-5 h-5 text-green-400" />
                          <span className="text-green-400 font-bold text-sm">Promotional Rate Active</span>
                        </div>
                        <p className="text-gray-300 text-xs">
                          Surfers will see: "Save <span className="text-green-400 font-bold">${liveSavings}</span> per photo by joining now!"
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-gray-500 line-through text-sm">${sessionSettings.photo_price_high || sessionSettings.general_photo_price}</span>
                          <span className="text-white font-bold text-lg">${sessionSettings.live_photo_price}</span>
                          <Badge className="bg-green-500 text-white text-xs">
                            {Math.round((liveSavings / (sessionSettings.photo_price_high || sessionSettings.general_photo_price)) * 100)}% OFF
                          </Badge>
                        </div>
                      </div>
                    )}
                    
                    {/* Standard Rates Info - Shows when NOT in promotional mode */}
                    {!hasSavings && sessionSettings.pricing_mode !== 'promotional' && (
                      <div className="p-3 bg-zinc-800/50 border border-zinc-700 rounded-xl">
                        <div className="flex items-center gap-2">
                          <Tag className="w-4 h-4 text-purple-400" />
                          <span className="text-gray-300 text-sm">Standard Tiered Pricing</span>
                        </div>
                        <p className="text-gray-500 text-xs mt-1">
                          Surfers will choose Web/Standard/High resolution at checkout
                        </p>
                      </div>
                    )}

                    {/* Buy-in Price */}
                    <div className="space-y-2">
                      <label className="text-gray-400 text-sm flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-green-400" />
                        Session Buy-in Price
                      </label>
                      <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-xl">
                        <span className="text-2xl font-bold text-white">$</span>
                        <Input
                          type="number"
                          value={sessionSettings.price_per_join}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, price_per_join: parseInt(e.target.value) || 0 }))}
                          className="bg-transparent border-none text-2xl font-bold text-white text-center"
                          min="0"
                          max="500"
                        />
                        <span className="text-gray-400 text-sm whitespace-nowrap">per surfer</span>
                      </div>
                    </div>

                    {/* Photos Included */}
                    <div className="space-y-2">
                      <label className="text-gray-400 text-sm flex items-center gap-2">
                        <Image className="w-4 h-4 text-blue-400" />
                        Photos Included in Buy-in
                      </label>
                      <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-xl">
                        <Input
                          type="number"
                          value={sessionSettings.photos_included}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, photos_included: parseInt(e.target.value) || 0 }))}
                          className="bg-transparent border-none text-xl font-bold text-white text-center w-20"
                          min="0"
                          max="50"
                        />
                        <span className="text-gray-400 text-sm">digital downloads included</span>
                      </div>
                    </div>

                    {/* Live Photo Price - Promotional Rate */}
                    <div className="space-y-2">
                      <label className="text-gray-400 text-sm flex items-center gap-2">
                        <Tag className="w-4 h-4 text-purple-400" />
                        Price per Additional Photo
                        {sessionSettings.pricing_mode === 'promotional' && (
                          <Badge className="bg-green-500/20 text-green-400 text-[10px] ml-1">PROMO</Badge>
                        )}
                      </label>
                      <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-xl">
                        <span className="text-xl font-bold text-white">$</span>
                        <Input
                          type="number"
                          value={sessionSettings.live_photo_price}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, live_photo_price: parseFloat(e.target.value) || 0 }))}
                          className="bg-transparent border-none text-xl font-bold text-white text-center w-20"
                          min="0"
                          max="100"
                          step="0.50"
                        />
                        <div className="flex-1">
                          <span className="text-gray-400 text-sm">per photo</span>
                          {hasSavings && (
                            <p className="text-green-400 text-xs">${liveSavings} less than high-res!</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Max Surfers */}
                    <div className="flex items-center justify-between p-3 bg-zinc-800 rounded-xl">
                      <div className="flex items-center gap-3">
                        <Users className="w-5 h-5 text-blue-400" />
                        <div>
                          <span className="text-white font-medium">Max Surfers</span>
                          <p className="text-gray-500 text-xs">Session capacity</p>
                        </div>
                      </div>
                      <Input
                        type="number"
                        value={sessionSettings.max_surfers}
                        onChange={(e) => setSessionSettings(prev => ({ ...prev, max_surfers: parseInt(e.target.value) || 1 }))}
                        className="bg-zinc-900 border-zinc-700 text-white font-bold text-center w-20"
                        min="1"
                        max="50"
                      />
                    </div>

                    {/* Auto-Accept Toggle */}
                    <div className="flex items-center justify-between p-3 bg-zinc-800 rounded-xl">
                      <div className="flex items-center gap-3">
                        <Zap className="w-5 h-5 text-yellow-400" />
                        <div>
                          <span className="text-white font-medium">Auto-Accept</span>
                          <p className="text-gray-500 text-xs">Allow walk-ups without approval</p>
                        </div>
                      </div>
                      <Switch
                        checked={sessionSettings.auto_accept}
                        onCheckedChange={(checked) => setSessionSettings(prev => ({ ...prev, auto_accept: checked }))}
                      />
                    </div>

                    {/* Continue Button - Opens Conditions Modal */}
                    <Button
                      onClick={handleConfirmGoLive}
                      disabled={goLiveLoading}
                      className="w-full h-12 bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-lg"
                      data-testid="continue-to-conditions-btn"
                    >
                      {goLiveLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          Continue
                          <ChevronDown className="w-5 h-5 ml-2 rotate-[-90deg]" />
                        </>
                      )}
                    </Button>
                    <p className="text-center text-gray-500 text-xs mt-2">
                      You'll capture current conditions next
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DrawerContent>
      </Drawer>

      {/* Switch Location Confirmation Dialog */}
      <Dialog open={showSwitchConfirm} onOpenChange={setShowSwitchConfirm}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-sm z-[1100]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              Switch Location?
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            <p className="text-gray-400 text-sm mb-3">
              You're currently live at <span className="text-white font-medium">{currentLiveSpot?.name}</span>.
            </p>
            <p className="text-gray-400 text-sm">
              Do you want to end that session and start shooting at <span className="text-cyan-400 font-medium">{spot?.name}</span>?
            </p>
          </div>

          <DialogFooter className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setShowSwitchConfirm(false)}
              className="flex-1 border-zinc-600 text-white"
            >
              Stay Here
            </Button>
            <Button
              onClick={confirmSwitchLocation}
              className="flex-1 bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-bold"
            >
              Switch Location
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refine Location Modal - Photographer crowdsourced peak accuracy */}
      <Dialog open={showRefineModal} onOpenChange={setShowRefineModal}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-lg z-[1100]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <MapPin className="w-5 h-5 text-cyan-400" />
              Refine Peak Location
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Instructions */}
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
              <p className="text-sm text-cyan-300">
                Drag the pin to where waves actually break. Your input helps make this spot more accurate for everyone.
              </p>
            </div>
            
            {/* Map Container */}
            <div 
              ref={refineMapRef} 
              className="w-full h-[300px] rounded-lg border border-zinc-700 overflow-hidden"
              style={{ background: '#1a1a1a' }}
            />
            
            {/* Coordinates Display */}
            {refinePosition && (
              <div className="flex justify-between text-xs text-gray-400">
                <span>Original: {spot?.latitude?.toFixed(6)}, {spot?.longitude?.toFixed(6)}</span>
                <span className="text-cyan-400">New: {refinePosition.lat.toFixed(6)}, {refinePosition.lng.toFixed(6)}</span>
              </div>
            )}
            
            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowRefineModal(false)}
                className="flex-1 border-zinc-600 text-white"
              >
                Cancel
              </Button>
              <Button
                onClick={submitRefinement}
                disabled={refineLoading}
                className="flex-1 bg-gradient-to-r from-cyan-400 to-green-400 text-black font-bold"
              >
                {refineLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-1" />
                    Submit Refinement
                  </>
                )}
              </Button>
            </div>
            
            <p className="text-center text-gray-500 text-xs">
              When 3+ photographers agree, location is queued for admin approval
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Jump In Session Modal - Full selfie + payment flow */}
      {showJumpInModal && selectedPhotographer && (
        <JumpInSessionModal
          photographer={selectedPhotographer}
          onClose={() => setShowJumpInModal(false)}
          onSuccess={() => {
            setShowJumpInModal(false);
            setDrawerMode(DRAWER_MODE.REPORT);
            setSelectedPhotographer(null);
            setActiveSnapPoint(0.6);
            // Could trigger a refresh of active shooters here
          }}
        />
      )}
      {/* LockerSelfieModal bound to this spot */}
      <LockerSelfieModal 
        isOpen={scanModalOpen}
        onClose={() => setScanModalOpen(false)}
        user={user}
        spotId={spot?.id}
        spotName={spot?.name}
      />
    </>
  );
};

export default UnifiedSpotDrawer;
