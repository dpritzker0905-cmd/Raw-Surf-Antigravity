import React, { useState, useEffect, useRef } from 'react';

import { useParams, useNavigate } from 'react-router-dom';

import { 

  MapPin, Waves, Camera, Clock, Users, X, TrendingUp, Loader2, Radio, Calendar, MessageCircle, Compass,
  Sun, Lock, Crown, Eye, Heart, ChevronLeft,
  Navigation, AlertCircle, Zap, CalendarClock, ChevronRight,
  Bell, Send, DollarSign, Star, Wind, CloudRain
} from 'lucide-react';
import { Button } from './ui/button';

import { Badge } from './ui/badge';

import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';

import { Textarea } from './ui/textarea';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import apiClient from '../lib/apiClient';

import { toast } from 'sonner';

import { ScheduledBookingDrawer } from './ScheduledBookingDrawer';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import { getThemeTokens } from '../utils/themeTokens';
import { ROLES } from '../constants/roles';



// Conditions color mapping
const conditionColors = {
  "Flat": { bg: "bg-gray-500", text: "text-gray-400" },
  "Ankle High": { bg: "bg-blue-400", text: "text-blue-400" },
  "Knee High": { bg: "bg-blue-500", text: "text-blue-400" },
  "Waist High": { bg: "bg-emerald-400", text: "text-emerald-400" },
  "Chest High": { bg: "bg-emerald-500", text: "text-emerald-400" },
  "Head High": { bg: "bg-yellow-400", text: "text-yellow-400" },
  "Overhead": { bg: "bg-orange-400", text: "text-orange-400" },
  "Double Overhead": { bg: "bg-orange-500", text: "text-orange-400" },
  "Triple Overhead+": { bg: "bg-red-500", text: "text-red-400" }
};

// Forecast day card - starts from TOMORROW (day 1 = tomorrow, not today)
const ForecastDayCard = ({ day, _dayIndex, isLocked = false }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const rowBg = isLight ? 'bg-gray-100/80 shadow-inner' : 'bg-zinc-800/50';
  const lockBg = isLight ? 'bg-gray-100/50' : 'bg-zinc-800/50';
  
  const dateObj = new Date(day.date);
  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
  const dateNum = dateObj.getDate();
  const colors = conditionColors[day.label] || { bg: 'bg-gray-500', text: 'text-gray-400' };
  
  if (isLocked) {
    return (
      <div className={`flex flex-col items-center p-2 rounded-lg min-w-[55px] ${lockBg}`}>
        <span className={`text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>{dayName}</span>
        <span className="text-sm font-bold text-gray-600">{dateNum}</span>
        <Lock className="w-3 h-3 text-purple-400 my-0.5" />
      </div>
    );
  }
  
  return (
    <div className={`flex flex-col items-center p-2 rounded-lg min-w-[55px] ${rowBg}`}>
      <span className={`text-[10px] ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>{dayName}</span>
      <span className={`text-sm font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>{dateNum}</span>
      <Waves className={`w-4 h-4 ${colors.text} my-0.5`} />
      <span className="text-xs font-bold">{day.wave_height_max}ft</span>
    </div>
  );
};

// Media grid item
const MediaItem = ({ item, onClick }) => (
  <div 
    onClick={onClick}
    className="relative aspect-square bg-zinc-800 rounded-lg overflow-hidden cursor-pointer group"
  >
    <img 
      src={getFullUrl(item.thumbnail_url || item.media_url || item.image_url)} 
      alt="" 
      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      onError={(e) => {
        // Replace broken images with a gradient placeholder
        e.target.style.display = 'none';
        e.target.parentElement.classList.add('bg-gradient-to-br', 'from-zinc-700', 'to-zinc-900');
      }}
    />
    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
      <Eye className="w-5 h-5 text-white" />
    </div>
    {item.likes_count > 0 && (
      <div className="absolute bottom-1 left-1 flex items-center gap-0.5 text-white text-[10px] bg-black/50 px-1 py-0.5 rounded">
        <Heart className="w-2.5 h-2.5 fill-current" />
        {item.likes_count}
      </div>
    )}
  </div>
);

/**
 * Booking Type Selection Modal - Let users choose booking type
 */
const BookingTypeModal = ({ isOpen, onClose, photographer, spotId, spotName, onSelectType }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const cardBg = isLight ? 'bg-gray-50' : 'bg-zinc-800';
  
  const isPro = photographer?.role === 'approved_pro' || photographer?.role === ROLES.APPROVED_PRO;
  
  // Check if photographer is actively shooting at THIS specific spot
  const isCurrentlyShooting = photographer?.is_shooting && 
    (photographer?.current_spot_id === spotId || photographer?.is_shooting === true);
  const isOnDemandAvailable = photographer?.is_on_demand;
  
  const bookingOptions = [
    {
      id: 'live_active',
      label: 'Jump In Now',
      description: isCurrentlyShooting 
        ? `${photographer?.full_name} is shooting here now!` 
        : 'Not currently shooting at this spot',
      icon: Radio,
      color: 'from-green-500 to-emerald-500',
      textColor: 'text-green-400',
      available: isCurrentlyShooting,
      price: photographer?.session_price ? `$${photographer.session_price}/session` : null
    },
    {
      id: 'on_demand',
      label: 'On-Demand Request',
      description: isOnDemandAvailable 
        ? 'Request them to come to you (fast response)' 
        : 'On-demand not available',
      icon: Zap,
      color: 'from-amber-500 to-orange-500',
      textColor: 'text-amber-400',
      available: isOnDemandAvailable,
      price: photographer?.on_demand_hourly_rate ? `$${photographer.on_demand_hourly_rate}/hr` : null
    },
    {
      id: 'scheduled',
      label: 'Schedule a Session',
      description: 'Book a specific date & time',
      icon: CalendarClock,
      color: 'from-cyan-500 to-blue-500',
      textColor: 'text-cyan-400',
      available: true,
      price: photographer?.booking_hourly_rate || photographer?.hourly_rate || photographer?.session_price
        ? `$${photographer.booking_hourly_rate || photographer.hourly_rate || photographer.session_price}/session` 
        : null
    }
  ];
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border-zinc-800 max-w-md`}>
        <DialogHeader>
          <DialogTitle className={`text-lg font-bold ${textPrimary} flex items-center gap-2`}>
            <Camera className="w-5 h-5 text-yellow-400" />
            Book {photographer?.full_name}
          </DialogTitle>
        </DialogHeader>
        
        {/* Photographer Info */}
        <div className={`p-3 rounded-xl ${cardBg} mb-4`}>
          <div className="flex items-center gap-3">
            <Avatar className={`w-12 h-12 ${isPro ? 'ring-2 ring-yellow-400' : 'ring-2 ring-cyan-500'}`}>
              <AvatarImage src={getFullUrl(photographer?.avatar_url)} />
              <AvatarFallback>{photographer?.full_name?.[0]}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className={`font-medium ${textPrimary}`}>{photographer?.full_name}</span>
                {isPro && <Badge className="bg-yellow-500 text-black text-[10px]">PRO</Badge>}
              </div>
              <p className={`text-xs ${textSecondary} flex items-center gap-1`}>
                <MapPin className="w-3 h-3" />
                {spotName || 'This spot'}
              </p>
            </div>
          </div>
        </div>
        
        {/* Booking Options */}
        <div className="space-y-3">
          {bookingOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                onClick={() => option.available && onSelectType(option.id, photographer)}
                disabled={!option.available}
                className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                  option.available 
                    ? `border-zinc-700 hover:border-zinc-500 ${isLight ? 'hover:bg-gray-50' : 'hover:bg-zinc-800/50'}`
                    : 'border-zinc-800 opacity-50 cursor-not-allowed'
                }`}
                data-testid={`booking-option-${option.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${option.color} flex items-center justify-center ${!option.available && 'grayscale'}`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${textPrimary}`}>{option.label}</span>
                      {option.id === 'live_active' && isCurrentlyShooting && (
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      )}
                    </div>
                    <p className={`text-xs ${textSecondary}`}>{option.description}</p>
                  </div>
                  {option.price && option.available && (
                    <div className="text-right">
                      <span className={`text-sm font-bold ${option.textColor}`}>{option.price}</span>
                    </div>
                  )}
                  {option.available && (
                    <ChevronRight className={`w-4 h-4 ${textSecondary}`} />
                  )}
                </div>
              </button>
            );
          })}
        </div>
        
        {/* Spot Link */}
        {spotId && (
          <p className={`text-xs ${textSecondary} text-center mt-2`}>
            Booking for session at this surf spot
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
};

/**
 * Photographer Request Alert Modal - Request coverage at a spot with no active photographers
 */
const PhotographerRequestModal = ({ isOpen, onClose, spot, spotId, onSuccess }) => {
  const { theme } = useTheme();
  const { user } = useAuth();
  const isLight = theme === 'light';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const cardBg = isLight ? 'bg-gray-50' : 'bg-zinc-800';
  const inputBg = isLight ? 'bg-white border-gray-300' : 'bg-zinc-900 border-zinc-700';
  
  const [urgency, setUrgency] = useState('today');
  const [preferredTime, setPreferredTime] = useState('');
  const [duration, setDuration] = useState(2);
  const [notes, setNotes] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const urgencyOptions = [
    { id: 'now', label: 'Right Now', emoji: '🚨', description: 'ASAP (expires in 2 hours)' },
    { id: 'today', label: 'Today', emoji: '📸', description: 'Within the day (expires in 12 hours)' },
    { id: 'flexible', label: 'Flexible', emoji: '📷', description: 'Anytime works (expires in 3 days)' }
  ];
  
  const timeOptions = ['Dawn Patrol', 'Morning', 'Midday', 'Afternoon', 'Sunset', 'Flexible'];
  
  const handleSubmit = async () => {
    if (!user?.id) {
      toast.error('Please sign in to request a photographer');
      return;
    }
    
    setIsSubmitting(true);
    try {
      const response = await apiClient.post(`/photographer-request?user_id=${user.id}`, {
        spot_id: spotId,
        urgency,
        preferred_time: preferredTime || null,
        duration_hours: duration,
        notes: notes || null,
        max_budget: maxBudget ? parseFloat(maxBudget) : null
      });
      
      toast.success(`Request sent! ${response.data.notified_photographers} photographers notified`);
      onSuccess?.(response.data);
      onClose();
    } catch (error) {
      logger.error('Error creating photographer request:', error);
      toast.error(error.response?.data?.detail || 'Failed to send request');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border-zinc-800 max-w-md max-h-[85vh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle className={`text-lg font-bold ${textPrimary} flex items-center gap-2`}>
            <Bell className="w-5 h-5 text-amber-400" />
            Request Photographer Coverage
          </DialogTitle>
          <DialogDescription className={textSecondary}>
            Alert nearby photographers that you want coverage at {spot?.name || 'this spot'}
          </DialogDescription>
        </DialogHeader>
        
        {/* Spot Info */}
        <div className={`p-3 rounded-xl ${cardBg} mb-4 flex items-center gap-3`}>
          {spot?.image_url && (
            <img src={getFullUrl(spot.image_url)} alt={spot.name} className="w-14 h-14 rounded-lg object-cover" />
          )}
          <div>
            <span className={`font-medium ${textPrimary}`}>{spot?.name}</span>
            <p className={`text-xs ${textSecondary} flex items-center gap-1`}>
              <MapPin className="w-3 h-3" />
              {spot?.region || 'Surf Spot'}
            </p>
          </div>
        </div>
        
        {/* Urgency Selection */}
        <div className="space-y-2">
          <label className={`text-sm font-medium ${textPrimary}`}>When do you need coverage?</label>
          <div className="grid grid-cols-3 gap-2">
            {urgencyOptions.map((option) => (
              <button
                key={option.id}
                onClick={() => setUrgency(option.id)}
                className={`p-3 rounded-xl border-2 transition-all text-center ${
                  urgency === option.id
                    ? 'border-amber-500 bg-amber-500/10'
                    : `border-zinc-700 ${isLight ? 'hover:bg-gray-50' : 'hover:bg-zinc-800'}`
                }`}
                data-testid={`urgency-${option.id}`}
              >
                <span className="text-xl">{option.emoji}</span>
                <p className={`text-xs font-medium ${textPrimary} mt-1`}>{option.label}</p>
              </button>
            ))}
          </div>
          <p className={`text-xs ${textSecondary}`}>
            {urgencyOptions.find(o => o.id === urgency)?.description}
          </p>
        </div>
        
        {/* Preferred Time */}
        <div className="space-y-2 mt-4">
          <label className={`text-sm font-medium ${textPrimary}`}>Preferred Time (optional)</label>
          <div className="flex flex-wrap gap-2">
            {timeOptions.map((time) => (
              <button
                key={time}
                onClick={() => setPreferredTime(preferredTime === time ? '' : time)}
                className={`px-3 py-1.5 rounded-full text-xs transition-all ${
                  preferredTime === time
                    ? 'bg-cyan-500 text-white'
                    : `${isLight ? 'bg-gray-100 text-gray-700' : 'bg-zinc-800 text-gray-300'} hover:bg-cyan-500/20`
                }`}
              >
                {time}
              </button>
            ))}
          </div>
        </div>
        
        {/* Duration */}
        <div className="space-y-2 mt-4">
          <label className={`text-sm font-medium ${textPrimary}`}>Session Duration</label>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((hours) => (
              <button
                key={hours}
                onClick={() => setDuration(hours)}
                className={`flex-1 py-2 rounded-lg text-sm transition-all ${
                  duration === hours
                    ? 'bg-cyan-500 text-white'
                    : `${isLight ? 'bg-gray-100 text-gray-700' : 'bg-zinc-800 text-gray-300'}`
                }`}
              >
                {hours}h
              </button>
            ))}
          </div>
        </div>
        
        {/* Budget (Optional) */}
        <div className="space-y-2 mt-4">
          <label className={`text-sm font-medium ${textPrimary} flex items-center gap-1`}>
            <DollarSign className="w-4 h-4" />
            Max Budget (optional)
          </label>
          <div className="relative">
            <span className={`absolute left-3 top-1/2 -translate-y-1/2 ${textSecondary}`}>$</span>
            <input
              type="number"
              value={maxBudget}
              onChange={(e) => setMaxBudget(e.target.value)}
              placeholder="e.g. 100"
              className={`w-full pl-7 pr-3 py-2 rounded-lg border ${inputBg} ${textPrimary} text-sm`}
            />
          </div>
        </div>
        
        {/* Notes */}
        <div className="space-y-2 mt-4">
          <label className={`text-sm font-medium ${textPrimary}`}>Notes for Photographer (optional)</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. I'll be in a red wetsuit, looking for action shots..."
            className={`${inputBg} ${textPrimary} text-sm min-h-[80px]`}
            maxLength={500}
          />
        </div>
        
        {/* Submit Button */}
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full mt-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold py-3"
          data-testid="submit-photographer-request"
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Send className="w-4 h-4 mr-2" />
          )}
          Send Alert to Photographers
        </Button>
        
        <p className={`text-xs ${textSecondary} text-center mt-2`}>
          Nearby photographers will be notified instantly
        </p>
      </DialogContent>
    </Dialog>
  );
};

/**
 * SpotHub Page - Compact surf spot view that fits within app layout
 */
const SpotHub = () => {
  const { spotId } = useParams();
  const { theme } = useTheme();
  const t = getThemeTokens(theme);
  const isLight = t.isLight;
  const textPrimary = t.textPrimary;
  const textSecondary = t.textSecondary;
  const cardBg = t.glassBg;
  const rowBg = t.rowBg;
  
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [spot, setSpot] = useState(null);
  const [spotDetails, setSpotDetails] = useState(null);
  const [activePhotographers, setActivePhotographers] = useState([]);
  const [conditionReports, setConditionReports] = useState([]);
  const [surfReports, setSurfReports] = useState([]); // SurfReport data from spot-details
  const [photographerPosts, setPhotographerPosts] = useState([]); // Posts tagged by photographers
  const [userPosts, setUserPosts] = useState([]); // Posts tagged by regular users
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('conditions');
  const [_userLocation, setUserLocation] = useState(null);
  
  // Collapsible header state
  const heroRef = useRef(null);
  const [isHeroVisible, setIsHeroVisible] = useState(true);
  const [isWithinProximity, setIsWithinProximity] = useState(false);
  
  // Live Pulse state - shows active shooting photographers based on user permissions
  const [livePulse, setLivePulse] = useState(null);
  const [_pulseLoading, setPulseLoading] = useState(false);
  
  // Booking modal state
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedPhotographer, setSelectedPhotographer] = useState(null);
  const [showScheduledDrawer, setShowScheduledDrawer] = useState(false);
  
  // Photographer request modal state
  const [showRequestModal, setShowRequestModal] = useState(false);
  
  // Lightbox state for condition report media
  const [lightboxUrl, setLightboxUrl] = useState(null);
  
  const userTier = user?.subscription_tier || 'free';
  const forecastDaysAllowed = ['premium', 'pro', 'gold'].includes(userTier) ? 10 : ['paid', 'basic'].includes(userTier) ? 7 : 3;
  
  // Calculate distance between two coordinates in miles
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };
  
  // Check user's proximity to the spot
  const checkProximity = (spotLat, spotLng) => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation({ lat: latitude, lng: longitude });
          
          if (spotLat && spotLng) {
            const distance = calculateDistance(latitude, longitude, spotLat, spotLng);
            // If within 1 mile, user can see all photographers regardless of subscription
            setIsWithinProximity(distance <= 1);
          }
        },
        (error) => {
          logger.debug('Could not get user location:', error);
          setIsWithinProximity(false);
        },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    }
  };

  // Fetch live shooting pulse - permission-gated visibility
  const fetchLivePulse = async () => {
    if (!spotId) return;
    try {
      setPulseLoading(true);
      const viewerId = user?.id || '';
      const response = await apiClient.get(`/surf-spots/${spotId}/live-shooting-pulse?viewer_id=${viewerId}`);
      setLivePulse(response.data);
    } catch (error) {
      logger.error('Error fetching live pulse:', error);
      // Don't show error toast - pulse is a nice-to-have feature
    } finally {
      setPulseLoading(false);
    }
  };

  useEffect(() => {
    if (spotId) {
      fetchAllSpotData();
      fetchLivePulse();
      
      // Refresh pulse every 30 seconds for real-time updates
      const pulseInterval = setInterval(fetchLivePulse, 30000);
      return () => clearInterval(pulseInterval);
    }
    // eslint-disable-next-line
  }, [spotId, user?.id]);
  
  // IntersectionObserver for collapsible header — detects when hero scrolls out of view
  useEffect(() => {
    const heroEl = heroRef.current;
    if (!heroEl) return;
    
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsHeroVisible(entry.isIntersecting);
      },
      { threshold: 0.1 } // Compact bar appears when <10% of hero is visible
    );
    
    observer.observe(heroEl);
    return () => observer.disconnect();
  }, [spot]);

  const fetchAllSpotData = async () => {
    setLoading(true);
    try {
      // Fetch spot details with forecast
      const detailsResponse = await apiClient.get(`/explore/spot-details/${spotId}?subscription_tier=${userTier}`);
      if (detailsResponse.data.error) {
        toast.error(detailsResponse.data.error);
        setLoading(false);
        return;
      }
      setSpotDetails(detailsResponse.data);
      setSpot(detailsResponse.data);
      
      // Check user's proximity to the spot
      if (detailsResponse.data.latitude && detailsResponse.data.longitude) {
        checkProximity(detailsResponse.data.latitude, detailsResponse.data.longitude);
      }
      
      // Active photographers come from spot-details response
      setActivePhotographers(detailsResponse.data.active_photographers || []);
      
      // Store surf reports from spot-details (SurfReport model - wave height, crowd, rating)
      setSurfReports(detailsResponse.data.recent_reports || []);
      
      // Fetch additional data in parallel
      const [reportsRes, postsRes] = await Promise.allSettled([
        apiClient.get(`/condition-reports/spot/${spotId}?limit=10`),
        apiClient.get(`/posts/spot/${spotId}?limit=50&viewer_id=${user?.id || ''}`) // Only posts TAGGED to this spot
      ]);
      
      if (reportsRes.status === 'fulfilled') {
        setConditionReports(reportsRes.value.data.reports || reportsRes.value.data || []);
      }
      
      if (postsRes.status === 'fulfilled') {
        // Use the separated posts from the new endpoint
        setPhotographerPosts(postsRes.value.data.photographer_posts || []);
        setUserPosts(postsRes.value.data.user_posts || []);
      }
      
    } catch (error) {
      logger.error('Error fetching spot data:', error);
      toast.error('Failed to load spot information');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    navigate(-1);
  };

  // Handle booking type selection from modal
  const handleBookingTypeSelect = (bookingType, photographer) => {
    setShowBookingModal(false);
    
    switch (bookingType) {
      case 'live_active':
        // Navigate to the bookings page with live_now tab and photographer context
        navigate(`/bookings?tab=live_now&photographer=${photographer.id}&spot=${spotId}`);
        break;
      case 'on_demand':
        // Navigate to the bookings page with on_demand tab
        navigate(`/bookings?tab=on_demand&photographer=${photographer.id}&spot=${spotId}`);
        break;
      case 'scheduled':
        // Open the scheduled booking drawer
        setSelectedPhotographer(photographer);
        setShowScheduledDrawer(true);
        break;
      default:
        break;
    }
  };

  // Open booking modal for a specific photographer
  const handleOpenBookingModal = (photographer) => {
    if (!user) {
      toast.error('Please sign in to book a photographer');
      navigate('/auth?tab=signup');
      return;
    }
    setSelectedPhotographer(photographer);
    setShowBookingModal(true);
  };

  if (loading) {
    return (
      <div className="max-w-xl mx-auto p-4">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      </div>
    );
  }

  if (!spot) {
    return (
      <div className="max-w-xl mx-auto p-4">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mb-3" />
          <h2 className="font-bold mb-1">Spot Not Found</h2>
          <p className="text-sm text-gray-400 mb-4">This spot may have been removed.</p>
          <Button onClick={() => navigate('/explore')} size="sm">
            Back to Explore
          </Button>
        </div>
      </div>
    );
  }

  const currentConditions = spotDetails?.current_conditions;
  const forecast = spotDetails?.forecast || [];

  return (
    <div className={`max-w-xl mx-auto pb-4 ${isLight ? 'bg-gray-50/50 min-h-screen' : ''}`}>
      {/* ===== COMPACT STICKY BAR — appears when hero scrolls out ===== */}
      <div 
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ease-out ${
          isHeroVisible 
            ? 'opacity-0 -translate-y-full pointer-events-none' 
            : 'opacity-100 translate-y-0'
        }`}
      >
        <div className="max-w-xl mx-auto">
          <div className={`flex items-center gap-3 px-3 py-2.5 backdrop-blur-xl border-b ${
            isLight 
              ? 'bg-white/90 border-gray-200 shadow-sm' 
              : 'bg-zinc-900/95 border-zinc-800 shadow-lg shadow-black/20'
          }`}>
            <button 
              onClick={handleClose}
              className={`p-1.5 rounded-full transition-colors ${
                isLight ? 'hover:bg-gray-100 text-gray-700' : 'hover:bg-zinc-800 text-gray-300'
              }`}
              data-testid="compact-back-btn"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0">
              <h2 className={`text-sm font-bold truncate ${textPrimary}`}>{spot.name}</h2>
              <div className="flex items-center gap-1.5 text-[10px]">
                <MapPin className="w-2.5 h-2.5 text-cyan-400" />
                <span className={textSecondary}>{spot.region}</span>
              </div>
            </div>
            {currentConditions && (
              <Badge className={`${conditionColors[currentConditions.label]?.bg || 'bg-cyan-500'} border-none text-white font-bold text-xs shrink-0`}>
                {currentConditions.wave_height_ft}ft
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* ===== FULL HERO HEADER — scrolls away naturally ===== */}
      <div ref={heroRef} className="relative overflow-hidden min-h-[180px] flex items-end">
        {/* Background: try spot image → map → gradient */}
        <div className="absolute inset-0">
          <img 
            src={spot.image_url || (spot.longitude && spot.latitude ? `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${spot.longitude},${spot.latitude}&z=12&l=sat&size=400,300` : '')}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              // If map also fails, hide img and let gradient show through
              e.target.style.display = 'none';
            }}
          />
          {/* Gradient base layer behind img — always visible as ultimate fallback */}
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-700 to-blue-900 -z-10" />
        </div>
        {/* Dark gradient overlay to guarantee text legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20" />
        
        {/* Close Button top-right */}
        <button 
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 bg-black/30 hover:bg-black/50 backdrop-blur-md rounded-full transition-colors text-white z-30"
          data-testid="close-spothub-btn"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Spot Text Info */}
        <div className="relative z-30 px-4 py-3 w-full flex items-end justify-between">
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-2xl truncate text-white drop-shadow-md">{spot.name}</h1>
            <div className="flex items-center gap-2 text-xs text-gray-200 mt-1">
              <MapPin className="w-3 h-3 text-cyan-400 drop-shadow-sm" />
              <span className="drop-shadow-sm font-medium">{spot.region}</span>
              {spot.difficulty && (
                <Badge variant="outline" className="text-[10px] py-0 px-1 border-white/30 text-white bg-black/20 backdrop-blur">
                  {spot.difficulty}
                </Badge>
              )}
            </div>
          </div>
          {currentConditions && (
            <Badge className={`${conditionColors[currentConditions.label]?.bg || 'bg-cyan-500'} shadow-lg border-none text-white font-bold ml-2 shrink-0`}>
              {currentConditions.wave_height_ft}ft
            </Badge>
          )}
        </div>
      </div>

      {/* Live Shooting Pulse Banner - Animated indicator for active photographers */}
      {livePulse?.pulse_active && livePulse.live_photographers?.length > 0 && (
        <div 
          className="mx-4 mt-3 relative overflow-hidden rounded-xl border border-red-500/30"
          data-testid="live-pulse-banner"
        >
          {/* Animated gradient background */}
          <div className="absolute inset-0 bg-gradient-to-r from-red-600/20 via-orange-500/20 to-red-600/20 animate-pulse" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(239,68,68,0.3),transparent_70%)] animate-ping opacity-30" style={{ animationDuration: '2s' }} />
          
          <div className="relative p-3 bg-black/60 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {/* Pulsing live indicator */}
                <div className="relative">
                  <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                  <div className="absolute inset-0 w-3 h-3 bg-red-500 rounded-full animate-ping opacity-75" />
                </div>
                <span className="text-sm font-bold text-white">LIVE SHOOTING</span>
                <Badge className="bg-red-500 text-white text-[10px] animate-pulse">
                  {livePulse.total_live} {livePulse.total_live === 1 ? 'Photographer' : 'Photographers'}
                </Badge>
              </div>
              <Radio className="w-5 h-5 text-red-400 animate-pulse" />
            </div>
            
            {/* Live photographers list */}
            <div className="flex flex-wrap gap-2">
              {livePulse.live_photographers.map((photographer) => (
                <div 
                  key={photographer.photographer_id}
                  onClick={() => navigate(`/profile/${photographer.photographer_id}`)}
                  className="flex items-center gap-2 p-2 bg-zinc-800/80 rounded-lg cursor-pointer hover:bg-zinc-700/80 transition-all group"
                >
                  {/* Animated ring around avatar */}
                  <div className="relative">
                    <div 
                      className="absolute -inset-1 bg-gradient-to-r from-red-500 to-orange-500 rounded-full opacity-75" 
                      style={{ animation: 'spin 3s linear infinite' }} 
                    />
                    <Avatar className="w-8 h-8 relative ring-2 ring-red-500">
                      <AvatarImage src={getFullUrl(photographer.avatar_url)} />
                      <AvatarFallback className="text-xs bg-red-500 text-white">
                        {photographer.photographer_name?.[0]}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white truncate max-w-[100px] group-hover:text-red-300 transition-colors">
                      {photographer.photographer_name}
                    </p>
                    <div className="flex items-center gap-1 text-[10px] text-gray-400">
                      {photographer.is_approved_pro && (
                        <Crown className="w-2.5 h-2.5 text-yellow-400" />
                      )}
                      <Camera className="w-2.5 h-2.5 text-red-400" />
                      <span>{photographer.photo_count || 0} shots</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            {/* Book Now CTA */}
            {livePulse.live_photographers.length > 0 && (
              <div className="mt-2 pt-2 border-t border-red-500/20">
                <button
                  onClick={() => {
                    const firstPhotographer = livePulse.live_photographers[0];
                    navigate(`/bookings?tab=live_now&photographer=${firstPhotographer.photographer_id}&spot=${spotId}`);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white text-sm font-medium rounded-lg transition-all"
                  data-testid="live-pulse-book-now"
                >
                  <Zap className="w-4 h-4" />
                  Get Photos Now
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Active Photographers at this Spot - differentiated by status */}
      {activePhotographers.length > 0 && (
        <div className={`mx-4 mt-3 p-3 rounded-xl border backdrop-blur-md ${cardBg}`} data-testid="photographers-section">
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs flex items-center gap-1 ${textSecondary}`}>
              <Camera className="w-3 h-3 text-cyan-400" />
              Photographers at this Spot
            </span>
            <div className="flex items-center gap-1">
              {activePhotographers.filter(p => p.status === 'live_shooting' || p.is_shooting).length > 0 && (
                <Badge className="bg-red-500/20 text-red-400 text-[10px]">
                  {activePhotographers.filter(p => p.status === 'live_shooting' || p.is_shooting).length} live
                </Badge>
              )}
              {activePhotographers.filter(p => p.status === 'on_demand' || (p.is_on_demand && !p.is_shooting)).length > 0 && (
                <Badge className="bg-amber-500/20 text-amber-400 text-[10px]">
                  {activePhotographers.filter(p => p.status === 'on_demand' || (p.is_on_demand && !p.is_shooting)).length} on-demand
                </Badge>
              )}
            </div>
          </div>
          
          {/* Show photographers - ALL visible if within 1 mile, otherwise subscription gating */}
          <div className="space-y-2">
            {activePhotographers.map((photographer, index) => {
              // If within 1 mile of spot, show ALL photographers regardless of subscription
              // Otherwise apply subscription gating: Free sees 1, Paid sees 3, Premium sees all
              const isHidden = !isWithinProximity && (
                (userTier === 'free' && index >= 1) ||
                (userTier === 'paid' && index >= 3)
              );
              
              if (isHidden) {
                return (
                  <div 
                    key={photographer.id}
                    className={`flex items-center gap-3 p-2 rounded-lg opacity-50 ${rowBg}`}
                  >
                    <div className="w-10 h-10 rounded-full bg-zinc-700/50 flex items-center justify-center">
                      <Lock className="w-4 h-4 text-purple-400" />
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm ${textSecondary}`}>Hidden Photographer</p>
                      <p className="text-[10px] text-purple-400">Upgrade to view</p>
                    </div>
                    <Button 
                      size="sm" 
                      onClick={() => navigate('/settings?tab=billing')}
                      className="text-[10px] bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 h-7 px-2"
                    >
                      <Crown className="w-3 h-3 mr-1" />
                      Unlock
                    </Button>
                  </div>
                );
              }
              
              return (
                <div 
                  key={photographer.id}
                  className={`flex items-center gap-3 p-2 rounded-lg ${rowBg}`}
                >
                  <Avatar 
                    className={`w-10 h-10 cursor-pointer ring-2 ${
                      photographer.status === 'live_shooting' || photographer.is_shooting
                        ? 'ring-red-500'
                        : photographer.status === 'on_demand' || photographer.is_on_demand
                          ? 'ring-amber-500'
                          : 'ring-cyan-500'
                    }`}
                    onClick={() => navigate(`/profile/${photographer.id}`)}
                  >
                    <AvatarImage src={getFullUrl(photographer.avatar_url)} />
                    <AvatarFallback className="text-sm">{photographer.full_name?.[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${textPrimary}`}>{photographer.full_name}</p>
                    <div className="flex items-center gap-2 text-[10px]">
                      <Badge className={`py-0 px-1 ${
                        photographer.role === 'approved_pro' 
                          ? 'bg-yellow-500 text-black' 
                          : 'bg-zinc-600 text-gray-300'
                      }`}>
                        {photographer.role === 'approved_pro' ? 'PRO' : 'Regular'}
                      </Badge>
                      <span className={`flex items-center gap-0.5 ${
                        photographer.status === 'live_shooting' || photographer.is_shooting 
                          ? 'text-red-400' 
                          : photographer.status === 'on_demand' || photographer.is_on_demand
                            ? 'text-amber-400'
                            : 'text-cyan-400'
                      }`}>
                        <Camera className="w-2.5 h-2.5" />
                        {photographer.status === 'live_shooting' || photographer.is_shooting
                          ? 'Live Shooting'
                          : photographer.status === 'on_demand' || photographer.is_on_demand
                            ? 'On-Demand'
                            : 'Available'
                        }
                      </span>
                    </div>
                  </div>
                  {photographer.session_price && (
                    <div className="text-right">
                      <p className="text-sm font-bold text-emerald-400">${photographer.session_price}</p>
                      <p className="text-[9px] text-gray-500">per session</p>
                    </div>
                  )}
                  <Button 
                    size="sm" 
                    onClick={() => handleOpenBookingModal(photographer)}
                    className={`text-[10px] h-7 px-2 ${
                      photographer.status === 'live_shooting' || photographer.is_shooting
                        ? 'bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white'
                        : photographer.status === 'on_demand' || photographer.is_on_demand
                          ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white'
                          : 'bg-cyan-500 hover:bg-cyan-600 text-white'
                    }`}
                    data-testid={`book-photographer-${photographer.id}`}
                  >
                    {photographer.status === 'live_shooting' || photographer.is_shooting
                      ? 'Jump In'
                      : photographer.status === 'on_demand' || photographer.is_on_demand
                        ? 'Request'
                        : 'Book'
                    }
                  </Button>
                </div>
              );
            })}
          </div>
          
          {/* Upgrade prompt for free/paid users - only show if NOT within proximity */}
          {!isWithinProximity && userTier !== 'premium' && activePhotographers.length > (userTier === 'free' ? 1 : 3) && (
            <div className="mt-2 pt-2 border-t border-zinc-700">
              <button 
                onClick={() => navigate('/settings?tab=billing')}
                className="w-full flex items-center justify-center gap-1 text-xs text-purple-400 hover:text-purple-300"
              >
                <Crown className="w-3 h-3" />
                Upgrade to see all {activePhotographers.length} photographers
              </button>
            </div>
          )}
          
          {/* Proximity indicator */}
          {isWithinProximity && (
            <div className="mt-2 pt-2 border-t border-zinc-700">
              <p className="text-[10px] text-emerald-400 text-center flex items-center justify-center gap-1">
                <Navigation className="w-3 h-3" />
                You're within 1 mile - viewing all photographers
              </p>
            </div>
          )}
        </div>
      )}

      {/* Current Conditions Card */}
      {currentConditions && (
        <div className={`mx-4 mt-3 p-3 rounded-xl border backdrop-blur-md ${cardBg}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs flex items-center gap-1 ${textSecondary}`}>
              <Sun className="w-3 h-3" />
              Today's Conditions
            </span>
            <Badge className={`text-xs ${conditionColors[currentConditions.label]?.bg || 'bg-gray-500'}`}>
              {currentConditions.label}
            </Badge>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="text-center">
              <Waves className="w-4 h-4 mx-auto text-cyan-400 mb-0.5" />
              <p className="text-lg font-bold">{currentConditions.wave_height_ft}ft</p>
              <p className="text-[10px] text-gray-500">Height</p>
            </div>
            <div className="text-center">
              <Clock className="w-4 h-4 mx-auto text-blue-400 mb-0.5" />
              <p className="text-lg font-bold">{currentConditions.wave_period || '-'}s</p>
              <p className="text-[10px] text-gray-500">Period</p>
            </div>
            <div className="text-center">
              <div 
                className="inline-block transition-transform duration-700 ease-in-out" 
                style={{ transform: `rotate(${currentConditions.wave_direction}deg)` }}
              >
                <Compass className="w-4 h-4 mx-auto text-emerald-400 mb-0.5" />
              </div>
              <p className={`text-lg font-bold ${textPrimary}`}>{currentConditions.wave_direction || '-'}°</p>
              <p className={`text-[10px] ${textSecondary}`}>Direction</p>
            </div>
            <div className="text-center">
              <TrendingUp className="w-4 h-4 mx-auto text-purple-400 mb-0.5" />
              <p className={`text-lg font-bold ${textPrimary}`}>{currentConditions.swell_height_ft || '-'}ft</p>
              <p className={`text-[10px] ${textSecondary}`}>Swell</p>
            </div>
          </div>
        </div>
      )}

      {/* Forecast Section - Starts from TOMORROW */}
      {forecast.length > 0 && (
        <div className={`mx-4 mt-3 p-3 rounded-xl border backdrop-blur-md ${cardBg} mb-4`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs flex items-center gap-1 ${textSecondary}`}>
              <Calendar className="w-3 h-3" />
              {forecastDaysAllowed}-Day Forecast (Tomorrow onwards)
            </span>
            {userTier !== 'premium' && (
              <button 
                onClick={() => navigate('/settings?tab=billing')}
                className="text-[10px] text-purple-400 flex items-center gap-1"
              >
                <Crown className="w-3 h-3" />
                Upgrade
              </button>
            )}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {forecast.slice(0, forecastDaysAllowed).map((day, i) => (
              <ForecastDayCard key={day.date} day={day} dayIndex={i} />
            ))}
            {/* Show locked days */}
            {forecast.slice(forecastDaysAllowed, 10).map((day, i) => (
              <ForecastDayCard key={day.date} day={day} dayIndex={forecastDaysAllowed + i} isLocked />
            ))}
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex border-b border-zinc-800 mt-4 px-4">
        {[
          { id: 'conditions', label: 'Reports', icon: MessageCircle, count: conditionReports.length + surfReports.length },
          { id: 'pro', label: 'Pro', icon: Camera, count: photographerPosts.length },
          { id: 'community', label: 'Community', icon: Users, count: userPosts.length },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium transition-colors relative ${
              activeTab === tab.id ? 'text-white' : 'text-gray-500'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            {tab.count > 0 && (
              <span className="text-[10px] text-gray-400">({tab.count})</span>
            )}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-cyan-400 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="px-4 py-3">
        {/* Condition Reports Tab */}
        {activeTab === 'conditions' && (
          <div className="space-y-3">
            {/* Photographer Condition Reports (with media) */}
            {conditionReports.length > 0 && (
              <div className="space-y-2">
                <p className={`text-[10px] font-medium ${textSecondary} uppercase tracking-wider flex items-center gap-1`}>
                  <Camera className="w-3 h-3 text-cyan-400" />
                  Live Condition Reports
                </p>
                {conditionReports.map((report) => (
                  <div key={report.id} className={`p-2.5 rounded-lg border ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-900/50 border-zinc-800'}`}>
                    <div className="flex items-center gap-2">
                      <Avatar className="w-8 h-8 ring-2 ring-cyan-500">
                        <AvatarImage src={getFullUrl(report.photographer_avatar)} />
                        <AvatarFallback className="text-xs">{report.photographer_name?.[0]}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${textPrimary}`}>{report.photographer_name}</p>
                        <p className={`text-[10px] ${textSecondary}`}>{report.time_ago}</p>
                      </div>
                      {report.conditions_label && (
                        <Badge className={`text-[10px] ${conditionColors[report.conditions_label]?.bg || 'bg-gray-500'}`}>
                          {report.conditions_label}
                        </Badge>
                      )}
                    </div>
                    {/* Captured timestamp — exact time the media was shot */}
                    <p className={`text-xs mt-1.5 ${textSecondary}`}>
                      Captured {new Date(report.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {new Date(report.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })} — {report.spot_name || spotData?.name || 'Unknown Spot'}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5">
                      {report.wave_height_ft && (
                        <span className="text-xs flex items-center gap-1">
                          <Waves className="w-3 h-3 text-cyan-400" />
                          <span className={textPrimary}>{report.wave_height_ft}ft</span>
                        </span>
                      )}
                      {report.wind_conditions && (
                        <span className="text-xs flex items-center gap-1">
                          <Wind className="w-3 h-3 text-emerald-400" />
                          <span className={textPrimary}>{report.wind_conditions}</span>
                        </span>
                      )}
                      {report.crowd_level && (
                        <span className="text-xs flex items-center gap-1">
                          <Users className="w-3 h-3 text-purple-400" />
                          <span className={textPrimary}>{report.crowd_level}</span>
                        </span>
                      )}
                    </div>
                    {(() => {
                      // Get the best available image URL, filtering out broken local paths
                      const candidateUrls = [
                        report.thumbnail_url,
                        report.media_url
                      ].filter(url => url && url.trim() && !url.startsWith('/api/uploads/'));
                      const primaryUrl = candidateUrls[0];
                      const fallbackUrl = candidateUrls[1];
                      
                      if (!primaryUrl) return null;
                      
                      return (
                        <img 
                          src={getFullUrl(primaryUrl)} 
                          alt="" 
                          className="mt-2 w-full h-56 object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => setLightboxUrl(getFullUrl(primaryUrl))}
                          onError={(e) => {
                            // Try fallback URL before hiding
                            if (fallbackUrl && e.target.src !== getFullUrl(fallbackUrl)) {
                              e.target.src = getFullUrl(fallbackUrl);
                            } else {
                              e.target.style.display = 'none';
                            }
                          }}
                        />
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}

            {/* Surf Reports (user-submitted wave data from spot-details) */}
            {surfReports.length > 0 && (
              <div className="space-y-2">
                <p className={`text-[10px] font-medium ${textSecondary} uppercase tracking-wider flex items-center gap-1`}>
                  <CloudRain className="w-3 h-3 text-emerald-400" />
                  Community Surf Reports
                </p>
                {surfReports.map((report) => (
                  <div key={report.id} className={`p-2.5 rounded-lg border ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-900/50 border-zinc-800'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        {report.conditions && (
                          <Badge className={`text-[10px] ${conditionColors[report.conditions]?.bg || 'bg-emerald-500'}`}>
                            {report.conditions}
                          </Badge>
                        )}
                        {report.wave_height && (
                          <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-400/30">
                            <Waves className="w-2.5 h-2.5 mr-0.5" />
                            {report.wave_height}
                          </Badge>
                        )}
                        {report.crowd_level && (
                          <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/30">
                            <Users className="w-2.5 h-2.5 mr-0.5" />
                            {report.crowd_level}
                          </Badge>
                        )}
                        {report.wind_direction && (
                          <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30">
                            <Wind className="w-2.5 h-2.5 mr-0.5" />
                            {report.wind_direction}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {report.rating && (
                          <div className="flex items-center gap-0.5 text-yellow-400">
                            <Star className="w-3 h-3 fill-current" />
                            <span className="text-xs font-bold">{report.rating}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    {report.notes && (
                      <p className={`text-xs mt-1.5 ${textSecondary}`}>{report.notes}</p>
                    )}
                    {report.created_at && (
                      <p className={`text-[10px] mt-1 ${textSecondary}`}>
                        {new Date(report.created_at).toLocaleDateString('en-US', { 
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                        })}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Empty state - only show if BOTH are empty */}
            {conditionReports.length === 0 && surfReports.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No condition reports yet</p>
                <p className="text-xs">Photographers will post when they start shooting</p>
              </div>
            )}
          </div>
        )}

        {/* Photographer Tagged Posts Tab */}
        {activeTab === 'pro' && (
          <div>
            {photographerPosts.length > 0 ? (
              <>
                <p className="text-[10px] text-gray-500 mb-2">
                  Photos/videos tagged to this spot by photographers
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {photographerPosts.map((post) => (
                    <MediaItem 
                      key={post.id} 
                      item={post}
                      onClick={() => navigate(`/post/${post.id}`)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Camera className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No pro photos tagged here</p>
                <p className="text-xs">Photographers can tag their photos to this spot</p>
              </div>
            )}
          </div>
        )}

        {/* User Tagged Posts Tab */}
        {activeTab === 'community' && (
          <div>
            {userPosts.length > 0 ? (
              <>
                <p className="text-[10px] text-gray-500 mb-2">
                  Photos/videos tagged to this spot by surfers
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {userPosts.map((post) => (
                    <MediaItem 
                      key={post.id} 
                      item={post}
                      onClick={() => navigate(`/post/${post.id}`)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No community posts tagged here</p>
                <p className="text-xs">Tag your photos to this spot to appear here</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Request Photographer Button - Only show if no photographers at spot */}
      {activePhotographers.length === 0 && (
        <div className="px-4 mt-2 pb-20">
          <Button 
            onClick={() => {
              if (!user) {
                toast.error('Please sign in to request a photographer');
                navigate('/auth?tab=signup');
                return;
              }
              setShowRequestModal(true);
            }}
            className="w-full bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-black font-bold py-4 rounded-xl"
            data-testid="request-pro-btn"
          >
            <Bell className="w-4 h-4 mr-2" />
            Request Photographer Coverage
          </Button>
          <p className="text-xs text-gray-500 text-center mt-2">
            Alert nearby photographers that you want coverage
          </p>
        </div>
      )}

      {/* Booking Type Selection Modal */}
      <BookingTypeModal
        isOpen={showBookingModal}
        onClose={() => setShowBookingModal(false)}
        photographer={selectedPhotographer}
        spotId={spotId}
        spotName={spot?.name}
        onSelectType={handleBookingTypeSelect}
      />

      {/* Photographer Request Alert Modal */}
      <PhotographerRequestModal
        isOpen={showRequestModal}
        onClose={() => setShowRequestModal(false)}
        spot={spot}
        spotId={spotId}
        onSuccess={() => {
          // Optionally refresh data or show a success state
        }}
      />

      {/* Scheduled Booking Drawer */}
      <ScheduledBookingDrawer
        isOpen={showScheduledDrawer}
        onClose={() => setShowScheduledDrawer(false)}
        photographer={selectedPhotographer}
        onSuccess={(_result) => {
          setShowScheduledDrawer(false);
          toast.success('Session booked successfully!');
          navigate('/bookings?tab=scheduled');
        }}
      />

      {/* Custom scrollbar hiding */}
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* Lightbox Modal for Condition Report Media */}
      {lightboxUrl && (
        <div 
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          <button 
            className="absolute top-4 right-4 text-white/80 hover:text-white z-10"
            onClick={() => setLightboxUrl(null)}
          >
            <X className="w-8 h-8" />
          </button>
          <img 
            src={lightboxUrl} 
            alt="Condition report" 
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};

export default SpotHub;
