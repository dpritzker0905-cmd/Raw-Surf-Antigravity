import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import axios from 'axios';
import { Radio, MapPin, Users, DollarSign, Clock, Play, Square, Eye, Camera, Zap, Settings, RefreshCw, ChevronDown, Image as ImageIcon, Heart, Target, Bug, Video, Signal, Tag, Percent, Sparkles, Calculator, Upload, AlertTriangle, Check, Search, X } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { toast } from 'sonner';
import PhotoUploadModal from './PhotoUploadModal';
import ConditionsModal from './ConditionsModal';
import EndSessionModal from './EndSessionModal';
import { SurferRosterCard } from './SurferRosterCard';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Helper function to get commission rate based on subscription tier
const getCommissionRate = (subscriptionTier) => {
  // Check localStorage for admin-configured rates first
  const savedRates = localStorage.getItem('admin_commission_rates');
  if (savedRates) {
    try {
      const adminRates = JSON.parse(savedRates);
      const tier = subscriptionTier?.toLowerCase?.() || 'free';
      const tierMap = { 'basic': 'tier_2', 'premium': 'tier_3', 'pro': 'tier_3' };
      const normalizedTier = tierMap[tier] || tier;
      if (adminRates[normalizedTier] !== undefined) {
        return adminRates[normalizedTier] / 100;
      }
    } catch (e) {
      // Fall through to defaults
    }
  }
  
  // Default commission rates (handles multiple naming conventions)
  const COMMISSION_RATES = {
    'free': 0.25,
    'tier_1': 0.25,
    'tier_2': 0.20,
    'basic': 0.20,      // Alias for tier_2
    'tier_3': 0.15,
    'premium': 0.15,    // Alias for tier_3
    'pro': 0.15,
  };
  
  const tier = subscriptionTier?.toLowerCase?.() || 'free';
  return COMMISSION_RATES[tier] || COMMISSION_RATES.free;
};

// Live Savings Badge Component - Synced with UnifiedSpotDrawer
const LiveSavingsBadge = ({ generalPrice, livePrice, className = '' }) => {
  const savings = generalPrice - livePrice;
  const _savingsPercent = Math.round((savings / generalPrice) * 100);
  
  if (savings <= 0) return null;
  
  return (
    <Badge className={`bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold animate-pulse ${className}`}>
      <Sparkles className="w-3 h-3 mr-1" />
      Save ${savings} per photo!
    </Badge>
  );
};

// Potential Earnings Calculator Component
const PotentialEarningsCalculator = ({ 
  buyinPrice, 
  maxSurfers, 
  photoPrice, 
  estimatedPhotosPerSurfer = 5,
  commissionRate = 0.20,
  isLight,
  textPrimaryClass,
  textSecondaryClass 
}) => {
  const buyinEarnings = buyinPrice * maxSurfers;
  const photoEarnings = photoPrice * estimatedPhotosPerSurfer * maxSurfers;
  const grossTotal = buyinEarnings + photoEarnings;
  const platformFee = grossTotal * commissionRate;
  const netTotal = grossTotal - platformFee;
  const commissionPercent = Math.round(commissionRate * 100);
  
  return (
    <div className={`p-4 rounded-xl bg-gradient-to-r ${isLight ? 'from-amber-50 to-orange-50 border border-amber-200' : 'from-amber-500/10 to-orange-500/10 border border-amber-500/30'}`}>
      <div className="flex items-center gap-2 mb-3">
        <Calculator className="w-5 h-5 text-amber-400" />
        <span className={`font-bold ${textPrimaryClass}`}>Potential Earnings</span>
      </div>
      
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className={textSecondaryClass}>Buy-ins ({maxSurfers} × ${buyinPrice})</span>
          <span className="text-green-400 font-medium">${buyinEarnings}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className={textSecondaryClass}>Photo sales (est. {estimatedPhotosPerSurfer}/surfer × ${photoPrice})</span>
          <span className="text-cyan-400 font-medium">${photoEarnings}</span>
        </div>
        <div className={`pt-2 border-t ${isLight ? 'border-amber-200' : 'border-amber-500/30'}`}>
          <div className="flex justify-between text-sm mb-1">
            <span className={textSecondaryClass}>Gross Total</span>
            <span className={textPrimaryClass}>${grossTotal}</span>
          </div>
          <div className="flex justify-between text-sm mb-1">
            <span className={textSecondaryClass}>Platform fee ({commissionPercent}%)</span>
            <span className="text-red-400">-${platformFee.toFixed(2)}</span>
          </div>
        </div>
        <div className={`pt-2 border-t ${isLight ? 'border-amber-200' : 'border-amber-500/30'} flex justify-between`}>
          <span className={`font-bold ${textPrimaryClass}`}>Your Net Earnings</span>
          <span className="text-amber-400 text-xl font-bold">${netTotal.toFixed(2)}</span>
        </div>
      </div>
      
      <p className={`text-xs ${textSecondaryClass} mt-2`}>
        Based on {maxSurfers} surfers at ${buyinPrice} buy-in + ~{estimatedPhotosPerSurfer} photos each at ${photoPrice}
      </p>
    </div>
  );
};

// Promotional Preview Component - Shows how deal appears to surfers
const _PromotionalPreview = ({ 
  generalPhotoPrice, 
  livePhotoPrice, 
  buyinPrice, 
  photosIncluded,
  isLight,
  textPrimaryClass,
  textSecondaryClass 
}) => {
  const savings = generalPhotoPrice - livePhotoPrice;
  const hasSavings = savings > 0;
  const savingsPercent = Math.round((savings / generalPhotoPrice) * 100);
  
  return (
    <div className={`p-4 rounded-xl ${isLight ? 'bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200' : 'bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/30'}`}>
      <div className="flex items-center gap-2 mb-3">
        <Eye className="w-5 h-5 text-blue-400" />
        <span className={`font-bold ${textPrimaryClass}`}>Surfer Preview</span>
        <Badge variant="outline" className="text-xs border-blue-500/50 text-blue-400 ml-auto">
          What surfers see
        </Badge>
      </div>
      
      <div className={`p-3 rounded-lg ${isLight ? 'bg-white' : 'bg-zinc-900/50'}`}>
        {hasSavings && (
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-green-400" />
            <span className="text-green-400 font-bold text-sm">Live Session Savings!</span>
          </div>
        )}
        
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className={textSecondaryClass}>Session Buy-in</span>
            <span className={`font-bold ${textPrimaryClass}`}>${buyinPrice}</span>
          </div>
          
          {photosIncluded > 0 && (
            <div className="flex items-center justify-between">
              <span className={textSecondaryClass}>Photos Included</span>
              <span className="text-cyan-400 font-medium">{photosIncluded} photos</span>
            </div>
          )}
          
          <div className="flex items-center justify-between">
            <span className={textSecondaryClass}>Additional Photos</span>
            <div className="flex items-center gap-2">
              {hasSavings && (
                <span className="text-gray-500 line-through text-sm">${generalPhotoPrice}</span>
              )}
              <span className="text-white font-bold">${livePhotoPrice}</span>
              {hasSavings && (
                <Badge className="bg-green-500 text-white text-xs">
                  {savingsPercent}% OFF
                </Badge>
              )}
            </div>
          </div>
        </div>
        
        {hasSavings && (
          <p className="text-xs text-green-400 mt-3">
            Surfers save ${savings} per photo by joining your live session!
          </p>
        )}
      </div>
    </div>
  );
};

export const PhotographerSessionsManager = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [isLive, setIsLive] = useState(false);
  const [currentSession, setCurrentSession] = useState(null);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [_showPromoPreview, _setShowPromoPreview] = useState(false);
  const [surfSpots, setSurfSpots] = useState([]);
  const [_galleries, setGalleries] = useState([]);
  const [showGalleryCreatedModal, setShowGalleryCreatedModal] = useState(false);
  const [lastCreatedGallery, setLastCreatedGallery] = useState(null);
  
  // Earnings destination (for Hobbyists)
  const [causes, setCauses] = useState([]);
  const [groms, setGroms] = useState([]);
  const isHobbyist = ['Hobbyist', 'Grom Parent'].includes(user?.role);
  
  // Debug overlay state
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  // Modal states - SEPARATED WORKFLOWS
  const [showSettingsModal, setShowSettingsModal] = useState(false);  // Rates/Pricing setup
  const [showGoLiveModal, setShowGoLiveModal] = useState(false);       // Location selection for Go Live
  const [showConditionsModal, setShowConditionsModal] = useState(false);
  const [showEndSessionModal, setShowEndSessionModal] = useState(false);
  const [goLiveLoading, setGoLiveLoading] = useState(false);
  const [endSessionLoading, setEndSessionLoading] = useState(false);
  const [isOnDemandActive, setIsOnDemandActive] = useState(false);  // Track on-demand status for mutual exclusivity
  // Collapsible settings sections state
  const [expandedSections, setExpandedSections] = useState({
    buyin: true,      // Session Buy-in - expanded by default
    pricing: false,   // Resolution-Based Pricing
    videoPricing: false, // Video Pricing
    settings: false,  // Session Settings
    earnings: false   // Earnings Destination
  });
  
  // Location verification state for live sessions
  const [userLocation, setUserLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [distanceToSpot, setDistanceToSpot] = useState(null);
  const [manualConfirm, setManualConfirm] = useState(false);
  const [nearbySpots, setNearbySpots] = useState([]);
  const [nearbySpotsLoading, setNearbySpotsLoading] = useState(false);
  const [spotSearchQuery, setSpotSearchQuery] = useState(''); // Search query for manual spot selection
  const REQUIRED_DISTANCE_MILES = 0.2; // Must be within 0.2 miles of spot
  const NEARBY_RADIUS_MILES = 25; // Radius for fetching nearby spots
  
  const [debugInfo, setDebugInfo] = useState({
    gpsAccuracy: null,
    gpsStatus: 'unknown',
    latitude: null,
    longitude: null,
    cameraStatus: 'unknown',
    cameraStream: null,
    permissionStep: 'idle'
  });
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  
  // Session settings - SYNCED WITH UnifiedSpotDrawer
  const [sessionSettings, setSessionSettings] = useState({
    location: '',
    surf_spot_id: null,
    price_per_join: 25,
    auto_accept: true,
    max_surfers: 10,
    estimated_duration: 2,
    // Live Session Rates (synced with map drawer)
    live_photo_price: 5,
    photos_included: 3,
    videos_included: 1,       // Videos included in buy-in
    general_photo_price: 10,
    // Resolution-based pricing (MANDATORY for all workflows)
    photo_price_web: 3,       // Web-res (social media optimized)
    photo_price_standard: 5,  // Standard digital delivery
    photo_price_high: 10,     // High-res (print quality)
    // Pricing mode: 'tiered' (Web/Standard/High) or 'promotional' (single rate for all)
    pricing_mode: 'tiered',
    // Video pricing settings
    video_price_720p: 8,      // 720p video
    video_price_1080p: 15,    // 1080p video
    video_price_4k: 30,       // 4K video
    video_pricing_mode: 'tiered',  // 'tiered' or 'promotional'
    live_video_price: 12,     // Promotional flat rate for videos
    // Earnings destination
    earnings_destination_type: null,
    earnings_destination_id: null,
    earnings_cause_name: null
  });
  
  // Pricing settings (global photographer settings)
  const [pricing, setPricing] = useState({
    live_buyin_price: 25,
    live_photo_price: 5,
    photo_package_size: 3,
    booking_hourly_rate: 50,
    booking_min_hours: 1,
    gallery_photo_price: 10  // General gallery price for comparison
  });
  
  // Theme-specific classes
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const mainBgClass = isLight ? 'bg-gray-50' : isBeach ? 'bg-black' : 'bg-zinc-900';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-gray-400';
  const borderClass = isLight ? 'border-gray-200' : isBeach ? 'border-zinc-800' : 'border-zinc-700';
  const inputBgClass = isLight ? 'bg-white' : 'bg-zinc-900';

  // Calculate live savings based on pricing mode
  // In promotional mode: compare promotional rate vs high-res standard price
  // In tiered mode: compare general price vs live photo price (for surfers who already joined)
  const liveSavings = sessionSettings.pricing_mode === 'promotional'
    ? sessionSettings.photo_price_high - sessionSettings.live_photo_price
    : sessionSettings.general_photo_price - sessionSettings.live_photo_price;
  const hasSavings = liveSavings > 0 && sessionSettings.pricing_mode === 'promotional';

  // Toggle collapsible section
  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Calculate distance between two coordinates (Haversine formula)
  const _calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Update distance when spot is selected from nearby list (for edge cases)
  useEffect(() => {
    if (sessionSettings.surf_spot_id && showGoLiveModal && nearbySpots.length > 0) {
      const selectedSpot = nearbySpots.find(s => s.id === sessionSettings.surf_spot_id);
      if (selectedSpot && selectedSpot.distance !== undefined) {
        setDistanceToSpot(selectedSpot.distance);
      }
    }
  }, [sessionSettings.surf_spot_id, showGoLiveModal, nearbySpots]);

  // Check if user is within range
  const isWithinRange = distanceToSpot !== null && distanceToSpot <= REQUIRED_DISTANCE_MILES;
  const canProceed = isWithinRange || manualConfirm;
  
  // Get dynamic commission rate based on user's subscription tier
  const commissionRate = getCommissionRate(user?.subscription_tier);

  useEffect(() => {
    if (user?.id) {
      fetchSessionData();
      fetchSurfSpots();
      fetchGalleries();
      if (isHobbyist) {
        fetchCausesAndGroms();
      }
    }
  }, [user?.id]);

  const fetchCausesAndGroms = async () => {
    try {
      const [causesRes, gromsRes] = await Promise.all([
        axios.get(`${API}/impact/causes`),
        axios.get(`${API}/impact/search-groms?limit=20`)
      ]);
      setCauses(causesRes.data || []);
      setGroms(gromsRes.data || []);
    } catch (e) {
      logger.error('Error fetching causes/groms:', e);
    }
  };

  const fetchSurfSpots = async () => {
    try {
      const res = await axios.get(`${API}/surf-spots`);
      setSurfSpots(res.data || []);
    } catch (e) {
      logger.error('Error fetching surf spots:', e);
    }
  };

  const fetchGalleries = async () => {
    try {
      const res = await axios.get(`${API}/galleries/photographer/${user?.id}`);
      setGalleries(res.data || []);
    } catch (e) {
      logger.error('Error fetching galleries:', e);
    }
  };

  const fetchSessionData = async () => {
    setLoading(true);
    try {
      // Fetch pricing settings
      try {
        const pricingRes = await axios.get(`${API}/photographer/${user?.id}/pricing`);
        setPricing(prev => ({
          ...prev,
          ...pricingRes.data
        }));
        // Sync session settings with pricing
        setSessionSettings(prev => ({
          ...prev,
          price_per_join: pricingRes.data.live_buyin_price || 25,
          live_photo_price: pricingRes.data.live_photo_price || 5,
          photos_included: pricingRes.data.photo_package_size || 3
        }));
      } catch (e) {
        logger.error('Error fetching pricing:', e);
      }
      
      // Fetch gallery pricing (for general_photo_price comparison and resolution pricing)
      try {
        const galleryPricingRes = await axios.get(`${API}/photographer/${user?.id}/gallery-pricing`);
        const standardPrice = galleryPricingRes.data.photo_pricing?.standard || 10;
        const webPrice = galleryPricingRes.data.photo_pricing?.web || 3;
        const highPrice = galleryPricingRes.data.photo_pricing?.high || 10;
        const liveSessionPrice = galleryPricingRes.data.session_pricing?.live_session_photo_price || 5;
        const photosIncluded = galleryPricingRes.data.session_pricing?.live_session_photos_included || 3;
        
        setPricing(prev => ({ ...prev, gallery_photo_price: standardPrice }));
        setSessionSettings(prev => ({ 
          ...prev, 
          general_photo_price: standardPrice,
          // Resolution-based pricing defaults from gallery settings
          photo_price_web: webPrice,
          photo_price_standard: standardPrice,
          photo_price_high: highPrice,
          live_photo_price: liveSessionPrice,
          photos_included: photosIncluded
        }));
      } catch (e) {
        logger.error('Error fetching gallery pricing:', e);
      }
      
      // Check if photographer has an active session
      const activeRes = await axios.get(`${API}/photographer/${user?.id}/active-session`);
      if (activeRes.data) {
        setIsLive(true);
        setCurrentSession(activeRes.data);
        // Populate settings from active session
        setSessionSettings(prev => ({
          ...prev,
          location: activeRes.data.location || '',
          price_per_join: activeRes.data.price_per_join || prev.price_per_join
        }));
      } else {
        setIsLive(false);
        setCurrentSession(null);
      }
      
      // Check on-demand status for mutual exclusivity warning
      try {
        const statusRes = await axios.get(`${API}/photographer/${user?.id}/status`);
        setIsOnDemandActive(statusRes.data.on_demand_available || false);
      } catch (e) {
        logger.error('Error fetching photographer status:', e);
        setIsOnDemandActive(false);
      }
      
      // Fetch session history
      try {
        const historyRes = await axios.get(`${API}/photographer/${user?.id}/session-history`);
        setSessionHistory(historyRes.data || []);
      } catch (e) {
        setSessionHistory([]);
      }
    } catch (error) {
      logger.error('Error fetching session data:', error);
      setIsLive(false);
      setCurrentSession(null);
      setSessionHistory([]);
    } finally {
      setLoading(false);
    }
  };

  // ============ SEQUENTIAL PERMISSION REQUEST ============
  
  const requestLocationPermission = async () => {
    setDebugInfo(prev => ({ ...prev, permissionStep: 'location', gpsStatus: 'requesting' }));
    
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        setDebugInfo(prev => ({ ...prev, gpsStatus: 'unsupported' }));
        reject(new Error('Geolocation not supported'));
        return;
      }
      
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setDebugInfo(prev => ({
            ...prev,
            gpsStatus: 'granted',
            gpsAccuracy: position.coords.accuracy,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          }));
          resolve(position);
        },
        (error) => {
          setDebugInfo(prev => ({ ...prev, gpsStatus: 'denied', gpsAccuracy: null }));
          reject(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  };
  
  const requestCameraPermission = async () => {
    setDebugInfo(prev => ({ ...prev, permissionStep: 'camera', cameraStatus: 'requesting' }));
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' },
        audio: false 
      });
      
      streamRef.current = stream;
      setDebugInfo(prev => ({ 
        ...prev, 
        cameraStatus: 'granted',
        cameraStream: stream 
      }));
      
      return stream;
    } catch (error) {
      setDebugInfo(prev => ({ ...prev, cameraStatus: 'denied' }));
      throw error;
    }
  };
  
  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setDebugInfo(prev => ({ ...prev, cameraStream: null, cameraStatus: 'stopped' }));
    }
  };
  
  // SETTINGS: Save session rates/pricing (separate from Go Live)
  const handleSaveSettings = async () => {
    try {
      // Save settings to backend
      const response = await axios.post(`${API}/photographer/session-settings`, {
        user_id: user.id,
        ...sessionSettings
      });
      
      if (response.data.success) {
        toast.success('Session rates saved!');
        setShowSettingsModal(false);
      }
    } catch (error) {
      // Settings saved locally even if API fails
      toast.success('Session rates saved locally');
      setShowSettingsModal(false);
    }
  };

  // Fetch nearby spots based on user's GPS location
  const fetchNearbySpots = async (lat, lng) => {
    setNearbySpotsLoading(true);
    try {
      const response = await axios.get(`${API}/surf-spots/nearby`, {
        params: {
          latitude: lat,
          longitude: lng,
          radius_miles: NEARBY_RADIUS_MILES
        }
      });
      
      // Map response and calculate distance for each spot
      const spotsWithDistance = (response.data || []).map(spot => {
        const distance = spot.distance_miles || spot.distance || calculateDistanceInMiles(
          lat, lng, spot.latitude, spot.longitude
        );
        return { ...spot, distance };
      }).sort((a, b) => a.distance - b.distance); // Sort by distance (closest first)
      
      setNearbySpots(spotsWithDistance);
    } catch (error) {
      logger.error('Failed to fetch nearby spots:', error);
      // Fallback to all spots if nearby endpoint fails
      setNearbySpots(surfSpots.map(spot => ({
        ...spot,
        distance: spot.latitude && spot.longitude 
          ? calculateDistanceInMiles(lat, lng, spot.latitude, spot.longitude)
          : null
      })).filter(s => s.distance !== null).sort((a, b) => a.distance - b.distance));
    } finally {
      setNearbySpotsLoading(false);
    }
  };

  // Helper: Calculate distance in miles between two coordinates
  const calculateDistanceInMiles = (lat1, lon1, lat2, lon2) => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // GO LIVE STEP 1: Start the Go Live flow - Request location and fetch nearby spots
  const startSequentialGoLive = async () => {
    // Check mutual exclusivity: cannot go live while On-Demand is active
    if (isOnDemandActive) {
      toast.error('Cannot start a live session while On-Demand mode is active. Please disable On-Demand first from On-Demand Settings.');
      return;
    }
    
    try {
      // Request Location first
      setDebugInfo(prev => ({ ...prev, permissionStep: 'location' }));
      toast.info('Requesting location access...');
      
      const position = await requestLocationPermission();
      toast.success('Location access granted!');
      
      // Set user location
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      setUserLocation({ lat, lng });
      setLocationError(null);
      
      // Fetch nearby spots based on GPS location
      await fetchNearbySpots(lat, lng);
      
      // Show Go Live Spot Picker Modal
      setDebugInfo(prev => ({ ...prev, permissionStep: 'spot_picker' }));
      setShowGoLiveModal(true);
      
    } catch (error) {
      // GPS failed - fallback to manual spot selection with all spots
      logger.warn('GPS unavailable, falling back to manual spot selection:', error);
      setLocationError('GPS unavailable - select your spot manually');
      setUserLocation(null);
      
      // Use all surf spots as fallback (no distance info)
      setNearbySpots(surfSpots.map(spot => ({
        ...spot,
        distance: null // No distance available without GPS
      })));
      
      toast.warning('GPS unavailable - you can still select a spot manually');
      setDebugInfo(prev => ({ ...prev, permissionStep: 'spot_picker' }));
      setShowGoLiveModal(true);
    }
  };

  // GO LIVE STEP 2: After spot selected and location verified, show Conditions Modal
  const handleGoLiveConfirmed = () => {
    if (!sessionSettings.surf_spot_id) {
      toast.error('Please select a surf spot before going live');
      return;
    }
    
    // Check location verification
    if (distanceToSpot !== null && !isWithinRange && !manualConfirm) {
      toast.error('Please verify your location or manually confirm you are at the spot');
      return;
    }
    
    // Close Go Live modal and open conditions modal
    setShowGoLiveModal(false);
    setShowConditionsModal(true);
  };

  // STEP 3: Handle final Go Live with conditions data
  const handleGoLiveWithConditions = async (conditionsData) => {
    setGoLiveLoading(true);
    
    try {
      // Request Camera for session selfie (optional)
      setDebugInfo(prev => ({ ...prev, permissionStep: 'camera' }));
      
      try {
        await requestCameraPermission();
        setTimeout(() => stopCameraStream(), 2000);
      } catch (_camError) {
        logger.warn('Camera access denied, continuing without selfie');
      }
      
      setDebugInfo(prev => ({ ...prev, permissionStep: 'ready' }));
      
      const selectedSpot = surfSpots.find(s => s.id === sessionSettings.surf_spot_id);
      
      // Prepare form data for media upload
      const formData = new FormData();
      formData.append('spot_id', sessionSettings.surf_spot_id);
      formData.append('location', selectedSpot?.name || sessionSettings.location);
      formData.append('latitude', debugInfo.latitude || '');
      formData.append('longitude', debugInfo.longitude || '');
      formData.append('price_per_join', sessionSettings.price_per_join);
      formData.append('max_surfers', sessionSettings.max_surfers);
      formData.append('auto_accept', sessionSettings.auto_accept);
      formData.append('estimated_duration', sessionSettings.estimated_duration);
      formData.append('live_photo_price', sessionSettings.live_photo_price);
      formData.append('photos_included', sessionSettings.photos_included);
      formData.append('general_photo_price', sessionSettings.general_photo_price);
      
      // Add conditions data
      if (conditionsData.spotNotes) {
        formData.append('spot_notes', conditionsData.spotNotes);
      }
      if (conditionsData.media) {
        formData.append('condition_media', conditionsData.media);
        formData.append('condition_media_type', conditionsData.mediaType);
      }
      
      // Hobbyist earnings destination
      if (sessionSettings.earnings_destination_type) {
        formData.append('earnings_destination_type', sessionSettings.earnings_destination_type);
      }
      if (sessionSettings.earnings_destination_id) {
        formData.append('earnings_destination_id', sessionSettings.earnings_destination_id);
      }
      if (sessionSettings.earnings_cause_name) {
        formData.append('earnings_cause_name', sessionSettings.earnings_cause_name);
      }
      
      // Use regular JSON call for now (media upload handled separately if needed)
      const response = await axios.post(`${API}/photographer/${user?.id}/go-live`, {
        ...sessionSettings,
        location: selectedSpot?.name || sessionSettings.location,
        spot_id: sessionSettings.surf_spot_id,
        latitude: debugInfo.latitude,
        longitude: debugInfo.longitude,
        live_photo_price: sessionSettings.live_photo_price,
        photos_included: sessionSettings.photos_included,
        general_photo_price: sessionSettings.general_photo_price,
        estimated_duration: sessionSettings.estimated_duration,
        spot_notes: conditionsData.spotNotes || '',
        // Resolution-based pricing (MANDATORY for all workflows)
        photo_price_web: sessionSettings.photo_price_web,
        photo_price_standard: sessionSettings.photo_price_standard,
        photo_price_high: sessionSettings.photo_price_high,
        // Earnings destination for Hobbyists
        earnings_destination_type: sessionSettings.earnings_destination_type,
        earnings_destination_id: sessionSettings.earnings_destination_id,
        earnings_cause_name: sessionSettings.earnings_cause_name
      });
      
      setIsLive(true);
      setCurrentSession({
        photographer_id: user?.id,
        location: selectedSpot?.name || sessionSettings.location,
        surf_spot_id: sessionSettings.surf_spot_id,
        price_per_join: sessionSettings.price_per_join,
        active_surfers: 0,
        views: 0,
        earnings: 0,
        started_at: new Date().toISOString(),
        participants: [],
        live_session_id: response.data.live_session_id,
        earnings_destination: response.data.earnings_destination,
        live_session_rates: response.data.live_session_rates,
        spot_notes: conditionsData.spotNotes || ''
      });
      
      setShowConditionsModal(false);
      toast.success('You are now live! Surfers can find you on the map.');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to start session');
      setDebugInfo(prev => ({ ...prev, permissionStep: 'idle' }));
    } finally {
      setGoLiveLoading(false);
    }
  };

  // Legacy handleGoLive - now redirects to new flow
  const _handleGoLive = async () => {
    if (!sessionSettings.surf_spot_id) {
      toast.error('Please select a surf spot before going live');
      setShowSettingsModal(true);
      return;
    }
    // Redirect to new conditions gatekeeper flow
    startSequentialGoLive();
  };

  // Show End Session confirmation modal (Kill Switch)
  const handleEndSessionClick = () => {
    setShowEndSessionModal(true);
  };

  // Actual end session logic after confirmation
  const handleEndSessionConfirmed = async () => {
    if (endSessionLoading) return; // Prevent double-clicks
    
    setEndSessionLoading(true);
    
    // Retry logic for robustness
    let attempts = 0;
    const maxAttempts = 2;
    
    while (attempts < maxAttempts) {
      try {
        attempts++;
        const response = await axios.post(`${API}/photographer/${user?.id}/end-session`);
        setIsLive(false);
        setCurrentSession(null);
        setShowEndSessionModal(false);
        
        if (response.data.gallery_id) {
          setLastCreatedGallery({
            id: response.data.gallery_id,
            title: response.data.gallery_title,
            total_surfers: response.data.total_surfers,
            total_earnings: response.data.total_earnings,
            duration_mins: response.data.duration_mins
          });
          setShowGalleryCreatedModal(true);
          fetchGalleries();
          
          // Navigate to "Impacted" tab (session summary)
          // Using setTimeout to allow modal to close gracefully
          setTimeout(() => {
            navigate('/impacted');
          }, 500);
        } else {
          toast.success(`Session ended! Total: $${response.data.total_earnings || 0} from ${response.data.total_surfers || 0} surfers`);
          // Navigate to Impacted dashboard for session summary
          navigate('/impacted');
        }
        fetchSessionData();
        break; // Success - exit retry loop
      } catch (error) {
        if (attempts >= maxAttempts) {
          toast.error(error.response?.data?.detail || 'Failed to end session. Please try again.');
        } else {
          // Wait a moment before retry
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
    
    setEndSessionLoading(false);
  };

  // Legacy handleEndSession for backward compatibility
  const handleEndSession = async () => {
    handleEndSessionClick();
  };

  const handleSavePricing = async () => {
    try {
      await axios.put(`${API}/photographer/${user?.id}/pricing`, {
        live_buyin_price: pricing.live_buyin_price,
        live_photo_price: pricing.live_photo_price,
        photo_package_size: pricing.photo_package_size,
        booking_hourly_rate: pricing.booking_hourly_rate,
        booking_min_hours: pricing.booking_min_hours
      });
      toast.success('Pricing updated successfully');
      setShowPricingModal(false);
      // Sync session settings with new pricing
      setSessionSettings(prev => ({
        ...prev,
        price_per_join: pricing.live_buyin_price,
        live_photo_price: pricing.live_photo_price,
        photos_included: pricing.photo_package_size
      }));
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update pricing');
    }
  };

  const refreshSession = async () => {
    if (!isLive) return;
    try {
      const activeRes = await axios.get(`${API}/photographer/${user?.id}/active-session`);
      if (activeRes.data) {
        setCurrentSession(activeRes.data);
      }
    } catch (error) {
      logger.error('Error refreshing session:', error);
    }
  };

  // Auto-refresh active session every 30 seconds
  useEffect(() => {
    let interval;
    if (isLive) {
      interval = setInterval(refreshSession, 30000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLive]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center min-h-screen ${mainBgClass}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
      </div>
    );
  }

  return (
    <div className={`pb-20 min-h-screen ${mainBgClass} transition-colors duration-300`} data-testid="photographer-sessions-page">
      {/* Note: Live Status HUD is now Map-integrated, shown only on MapPage */}
      
      <div className="max-w-2xl mx-auto p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className={`text-3xl font-bold ${textPrimaryClass}`} style={{ fontFamily: 'Oswald' }}>
            Live Sessions
          </h1>
        </div>

        {/* Live Status Card */}
        <Card className={`mb-6 ${isLive ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 border-green-500/50' : cardBgClass}`}>
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shrink-0 ${
                  isLive ? 'bg-green-500/30' : isLight ? 'bg-gray-100' : 'bg-zinc-800'
                }`}>
                  {isLive ? (
                    <Radio className="w-6 h-6 sm:w-8 sm:h-8 text-green-400 animate-pulse" />
                  ) : (
                    <Camera className={`w-6 h-6 sm:w-8 sm:h-8 ${textSecondaryClass}`} />
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className={`text-lg sm:text-xl font-bold ${textPrimaryClass}`}>
                    {isLive ? "You're Live!" : 'Start a Live Session'}
                  </h2>
                  <p className={`${textSecondaryClass} text-sm sm:text-base truncate`}>
                    {isLive 
                      ? `Capturing action from ${currentSession?.location || sessionSettings.location}`
                      : 'Go live to let surfers find and join your session'
                    }
                  </p>
                  {/* Live Savings Badge - Synced with map */}
                  {!isLive && hasSavings && (
                    <LiveSavingsBadge 
                      generalPrice={sessionSettings.general_photo_price} 
                      livePrice={sessionSettings.live_photo_price}
                      className="mt-2"
                    />
                  )}
                </div>
              </div>
              
              {isLive ? (
                <div className="flex flex-wrap gap-2 justify-end">
                  <Button
                    onClick={() => setShowPhotoUpload(true)}
                    variant="outline"
                    className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
                    data-testid="upload-photos-btn"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Media
                  </Button>
                  <Button
                    onClick={refreshSession}
                    variant="outline"
                    size="icon"
                    className="border-green-500/50 text-green-400 hover:bg-green-500/10 shrink-0"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                  <Button
                    onClick={handleEndSession}
                    className="bg-red-500 hover:bg-red-600 text-white shrink-0"
                    data-testid="end-session-btn"
                  >
                    <Square className="w-4 h-4 mr-2" />
                    End
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={startSequentialGoLive}
                  className="bg-gradient-to-r from-green-400 to-emerald-500 hover:from-green-500 hover:to-emerald-600 text-black font-medium"
                  data-testid="go-live-btn"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Go Live
                </Button>
              )}
            </div>

            {/* Live Session Stats */}
            {isLive && currentSession && (
              <div className={`mt-6 grid grid-cols-3 gap-4 pt-4 border-t ${borderClass}`}>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Users className="w-4 h-4 text-cyan-400" />
                    <span className={`text-2xl font-bold ${textPrimaryClass}`}>
                      {currentSession.active_surfers || 0}
                    </span>
                  </div>
                  <p className={`text-xs ${textSecondaryClass}`}>Active Surfers</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Eye className="w-4 h-4 text-yellow-400" />
                    <span className={`text-2xl font-bold ${textPrimaryClass}`}>
                      {currentSession.views || 0}
                    </span>
                  </div>
                  <p className={`text-xs ${textSecondaryClass}`}>Views</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <DollarSign className="w-4 h-4 text-green-400" />
                    <span className={`text-2xl font-bold ${textPrimaryClass}`}>
                      ${currentSession.earnings?.toFixed(2) || '0.00'}
                    </span>
                  </div>
                  <p className={`text-xs ${textSecondaryClass}`}>Earned</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Enhanced Surfer Roster - Full grid with selfies and identification */}
        {isLive && (
          <div className="mb-6">
            <SurferRosterCard
              photographerId={user?.id}
              isLive={isLive}
              theme={theme}
              onParticipantsUpdate={(data) => {
                // Update the stats in current session
                setCurrentSession(prev => prev ? {
                  ...prev,
                  active_surfers: data.count,
                  earnings: data.earnings
                } : prev);
              }}
            />
          </div>
        )}

        {/* Quick Settings - SYNCED WITH Map Drawer */}
        {!isLive && (
          <Card className={`mb-6 ${cardBgClass}`}>
            <CardHeader>
              <CardTitle className={`text-lg ${textPrimaryClass} flex items-center gap-2`}>
                <Settings className="w-5 h-5" />
                Session Setup
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Buy-in Price */}
              <div className="flex items-center justify-between">
                <div>
                  <p className={textPrimaryClass}>Session Buy-in</p>
                  <p className={`text-sm ${textSecondaryClass}`}>${sessionSettings.price_per_join} per surfer</p>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowSettingsModal(true)}
                  className={isLight ? 'border-gray-300' : 'border-zinc-700'}
                >
                  Edit
                </Button>
              </div>
              
              {/* Photos Included */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-cyan-400" />
                  <div>
                    <p className={textPrimaryClass}>Photos Included</p>
                    <p className={`text-sm ${textSecondaryClass}`}>{sessionSettings.photos_included} with buy-in</p>
                  </div>
                </div>
              </div>
              
              {/* Videos Included */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-red-400" />
                  <div>
                    <p className={textPrimaryClass}>Videos Included</p>
                    <p className={`text-sm ${textSecondaryClass}`}>{sessionSettings.videos_included} with buy-in</p>
                  </div>
                </div>
              </div>
              
              {/* Photo Pricing */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-purple-400" />
                  <div>
                    <p className={textPrimaryClass}>Photo Pricing</p>
                    <div className="flex items-center gap-2">
                      {sessionSettings.pricing_mode === 'promotional' ? (
                        <>
                          <span className={`text-sm ${textSecondaryClass}`}>${sessionSettings.live_photo_price}/photo</span>
                          {sessionSettings.live_photo_price < sessionSettings.photo_price_high && (
                            <>
                              <span className="text-gray-500 line-through text-xs">${sessionSettings.photo_price_high}</span>
                              <Badge className="bg-green-500/20 text-green-400 text-xs">
                                Save ${sessionSettings.photo_price_high - sessionSettings.live_photo_price}
                              </Badge>
                            </>
                          )}
                        </>
                      ) : (
                        <span className={`text-sm ${textSecondaryClass}`}>
                          ${sessionSettings.photo_price_web} / ${sessionSettings.photo_price_standard} / ${sessionSettings.photo_price_high}
                        </span>
                      )}
                    </div>
                    <p className={`text-xs ${textSecondaryClass}`}>
                      {sessionSettings.pricing_mode === 'promotional' ? 'Promo rate (high-res)' : 'Web / Standard / High-res'}
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Video Pricing */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-red-400" />
                  <div>
                    <p className={textPrimaryClass}>Video Pricing</p>
                    <div className="flex items-center gap-2">
                      {sessionSettings.video_pricing_mode === 'promotional' ? (
                        <>
                          <span className={`text-sm ${textSecondaryClass}`}>${sessionSettings.live_video_price}/video</span>
                          {sessionSettings.live_video_price < sessionSettings.video_price_4k && (
                            <>
                              <span className="text-gray-500 line-through text-xs">${sessionSettings.video_price_4k}</span>
                              <Badge className="bg-green-500/20 text-green-400 text-xs">
                                Save ${sessionSettings.video_price_4k - sessionSettings.live_video_price}
                              </Badge>
                            </>
                          )}
                        </>
                      ) : (
                        <span className={`text-sm ${textSecondaryClass}`}>
                          ${sessionSettings.video_price_720p} / ${sessionSettings.video_price_1080p} / ${sessionSettings.video_price_4k}
                        </span>
                      )}
                    </div>
                    <p className={`text-xs ${textSecondaryClass}`}>
                      {sessionSettings.video_pricing_mode === 'promotional' ? 'Promo rate (4K quality)' : '720p / 1080p / 4K'}
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Max Surfers */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-400" />
                  <div>
                    <p className={textPrimaryClass}>Max Surfers</p>
                    <p className={`text-sm ${textSecondaryClass}`}>{sessionSettings.max_surfers} capacity</p>
                  </div>
                </div>
              </div>
              
              {/* Auto-Accept */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <div>
                    <p className={textPrimaryClass}>Auto-accept Surfers</p>
                    <p className={`text-sm ${textSecondaryClass}`}>
                      {sessionSettings.auto_accept ? 'Walk-ups welcome' : 'Manual approval'}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Potential Earnings Calculator */}
        {!isLive && (
          <div className="mb-6">
            <PotentialEarningsCalculator
              buyinPrice={sessionSettings.price_per_join}
              maxSurfers={sessionSettings.max_surfers}
              photoPrice={sessionSettings.live_photo_price}
              commissionRate={commissionRate}
              isLight={isLight}
              textPrimaryClass={textPrimaryClass}
              textSecondaryClass={textSecondaryClass}
            />
          </div>
        )}

        {/* Session History */}
        <div>
          <h2 className={`text-xl font-bold ${textPrimaryClass} mb-4`} style={{ fontFamily: 'Oswald' }}>
            Session History
          </h2>
          
          {sessionHistory.length === 0 ? (
            <Card className={cardBgClass}>
              <CardContent className="py-12 text-center">
                <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
                  <Radio className={`w-8 h-8 ${textSecondaryClass}`} />
                </div>
                <h3 className={`text-lg font-medium ${textPrimaryClass} mb-2`}>No Past Sessions</h3>
                <p className={textSecondaryClass}>
                  Your completed live sessions will appear here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {sessionHistory.map((session) => (
                <Card key={session.id} className={cardBgClass}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <MapPin className={`w-4 h-4 ${textSecondaryClass}`} />
                          <span className={textPrimaryClass}>{session.location}</span>
                        </div>
                        <p className={`text-sm ${textSecondaryClass} mt-1`}>
                          {new Date(session.started_at).toLocaleDateString()} - {session.duration_mins} mins
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <Users className="w-4 h-4 text-cyan-400" />
                          <span className={textPrimaryClass}>{session.total_surfers}</span>
                        </div>
                        <p className="text-green-400 font-bold">${session.total_earnings?.toFixed(2) || '0.00'}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal - RATES/PRICING ONLY (Separated from Go Live) */}
      <Dialog open={showSettingsModal} onOpenChange={setShowSettingsModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader className="border-b border-inherit">
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <Settings className="w-5 h-5 text-cyan-400" />
              Session Rates & Settings
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 sm:px-6" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="space-y-3 py-4">
            {/* Live Savings Preview - Shows only in Promotional mode with savings */}
            {hasSavings && sessionSettings.pricing_mode === 'promotional' && (
              <div className={`p-3 rounded-xl bg-gradient-to-r ${isLight ? 'from-green-50 to-emerald-50 border border-green-200' : 'from-green-500/10 to-emerald-500/10 border border-green-500/30'}`}>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-green-400" />
                  <span className="text-green-400 font-bold text-sm">
                    Promo Active: Surfers save ${liveSavings}/photo
                  </span>
                  <span className="text-gray-500 line-through text-xs ml-auto">${sessionSettings.photo_price_high}</span>
                  <span className={`font-bold ${textPrimaryClass}`}>${sessionSettings.live_photo_price}</span>
                </div>
              </div>
            )}
            
            {/* Standard Rates Info - Shows in Standard mode */}
            {sessionSettings.pricing_mode === 'tiered' && (
              <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100 border border-gray-200' : 'bg-zinc-800/50 border border-zinc-700'}`}>
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-purple-400" />
                  <span className={`text-sm ${textPrimaryClass}`}>
                    Standard Tiered Pricing Active
                  </span>
                  <span className={`text-xs ${textSecondaryClass} ml-auto`}>
                    ${sessionSettings.photo_price_web} / ${sessionSettings.photo_price_standard} / ${sessionSettings.photo_price_high}
                  </span>
                </div>
              </div>
            )}

            {/* Video Pricing Summary - Shows current video pricing mode */}
            {sessionSettings.video_pricing_mode === 'promotional' && sessionSettings.live_video_price < sessionSettings.video_price_4k && (
              <div className={`p-3 rounded-xl bg-gradient-to-r ${isLight ? 'from-red-50 to-orange-50 border border-red-200' : 'from-red-500/10 to-orange-500/10 border border-red-500/30'}`}>
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-red-400" />
                  <span className="text-red-400 font-bold text-sm">
                    Video Promo: Surfers save ${sessionSettings.video_price_4k - sessionSettings.live_video_price}/video
                  </span>
                  <span className="text-gray-500 line-through text-xs ml-auto">${sessionSettings.video_price_4k}</span>
                  <span className={`font-bold ${textPrimaryClass}`}>${sessionSettings.live_video_price}</span>
                </div>
              </div>
            )}
            {sessionSettings.video_pricing_mode === 'tiered' && (
              <div className={`p-3 rounded-xl ${isLight ? 'bg-red-50/50 border border-red-200' : 'bg-red-900/20 border border-red-700/30'}`}>
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-red-400" />
                  <span className={`text-sm ${textPrimaryClass}`}>
                    Video Tiered Pricing
                  </span>
                  <span className={`text-xs ${textSecondaryClass} ml-auto`}>
                    ${sessionSettings.video_price_720p} / ${sessionSettings.video_price_1080p} / ${sessionSettings.video_price_4k}
                  </span>
                </div>
              </div>
            )}

            {/* Collapsible Section: Session Buy-in */}
            <div className={`rounded-xl border ${borderClass} overflow-hidden`}>
              <button
                onClick={() => toggleSection('buyin')}
                className={`w-full flex items-center justify-between p-3 ${isLight ? 'bg-gray-50 hover:bg-gray-100' : 'bg-zinc-800/50 hover:bg-zinc-800'} transition-colors`}
              >
                <div className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-green-400" />
                  <span className={`font-bold ${textPrimaryClass}`}>Session Buy-in</span>
                  <span className={`text-sm ${textSecondaryClass}`}>(${sessionSettings.price_per_join})</span>
                </div>
                <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.buyin ? 'rotate-180' : ''}`} />
              </button>
              {expandedSections.buyin && (
                <div className="p-3 space-y-3 border-t border-inherit">
                  <div className="space-y-2">
                    <Label className={textSecondaryClass}>Buy-in Price (to join session)</Label>
                    <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                      <span className={`text-2xl font-bold ${textPrimaryClass}`}>$</span>
                      <Input
                        type="number"
                        value={sessionSettings.price_per_join}
                        onChange={(e) => setSessionSettings(prev => ({ ...prev, price_per_join: parseInt(e.target.value) || 0 }))}
                        className={`${inputBgClass} ${textPrimaryClass} text-2xl font-bold h-12 text-center`}
                        min="0"
                        max="500"
                      />
                      <span className={`text-sm whitespace-nowrap ${textSecondaryClass}`}>per surfer</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className={`flex items-center gap-2 ${textSecondaryClass}`}>
                      <ImageIcon className="w-4 h-4 text-blue-400" />
                      Photos Included in Buy-in
                    </Label>
                    <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                      <Input
                        type="number"
                        value={sessionSettings.photos_included}
                        onChange={(e) => setSessionSettings(prev => ({ ...prev, photos_included: parseInt(e.target.value) || 0 }))}
                        className={`${inputBgClass} ${textPrimaryClass} text-xl font-bold h-12 text-center w-24`}
                        min="0"
                        max="50"
                      />
                      <span className={`text-sm ${textSecondaryClass}`}>digital downloads included</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className={`flex items-center gap-2 ${textSecondaryClass}`}>
                      <Video className="w-4 h-4 text-red-400" />
                      Videos Included in Buy-in
                    </Label>
                    <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                      <Input
                        type="number"
                        value={sessionSettings.videos_included}
                        onChange={(e) => setSessionSettings(prev => ({ ...prev, videos_included: parseInt(e.target.value) || 0 }))}
                        className={`${inputBgClass} ${textPrimaryClass} text-xl font-bold h-12 text-center w-24`}
                        min="0"
                        max="20"
                      />
                      <span className={`text-sm ${textSecondaryClass}`}>digital downloads included</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Collapsible Section: Resolution-Based Pricing */}
            <div className={`rounded-xl border ${borderClass} overflow-hidden`}>
              <button
                onClick={() => toggleSection('pricing')}
                className={`w-full flex items-center justify-between p-3 ${isLight ? 'bg-gray-50 hover:bg-gray-100' : 'bg-zinc-800/50 hover:bg-zinc-800'} transition-colors`}
              >
                <div className="flex items-center gap-2">
                  <Tag className="w-5 h-5 text-purple-400" />
                  <span className={`font-bold ${textPrimaryClass}`}>Photo Pricing</span>
                  <Badge variant="outline" className={`text-xs ${sessionSettings.pricing_mode === 'promotional' ? 'border-green-500/50 text-green-400' : 'border-purple-500/50 text-purple-400'}`}>
                    {sessionSettings.pricing_mode === 'promotional' ? 'Promo Active' : 'Per Photo'}
                  </Badge>
                </div>
                <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.pricing ? 'rotate-180' : ''}`} />
              </button>
              {expandedSections.pricing && (
                <div className="p-3 space-y-3 border-t border-inherit">
                  {/* Pricing Mode Toggle */}
                  <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                    <p className={`text-xs ${textSecondaryClass} mb-3`}>
                      Choose how surfers are charged for photos:
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setSessionSettings(prev => ({ ...prev, pricing_mode: 'tiered' }))}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          sessionSettings.pricing_mode === 'tiered'
                            ? `${isLight ? 'bg-purple-50 border-purple-300' : 'bg-purple-500/20 border-purple-500/50'} ring-2 ring-purple-400/50`
                            : `${isLight ? 'bg-white border-gray-200 hover:bg-gray-50' : 'bg-zinc-900 border-zinc-700 hover:bg-zinc-800'}`
                        }`}
                      >
                        <Tag className={`w-5 h-5 mx-auto mb-1 ${sessionSettings.pricing_mode === 'tiered' ? 'text-purple-400' : textSecondaryClass}`} />
                        <span className={`text-sm font-medium ${sessionSettings.pricing_mode === 'tiered' ? 'text-purple-400' : textPrimaryClass}`}>Standard Rates</span>
                        <p className={`text-xs ${textSecondaryClass} mt-1`}>Web/Standard/High tiers</p>
                      </button>
                      <button
                        onClick={() => setSessionSettings(prev => ({ ...prev, pricing_mode: 'promotional' }))}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          sessionSettings.pricing_mode === 'promotional'
                            ? `${isLight ? 'bg-green-50 border-green-300' : 'bg-green-500/20 border-green-500/50'} ring-2 ring-green-400/50`
                            : `${isLight ? 'bg-white border-gray-200 hover:bg-gray-50' : 'bg-zinc-900 border-zinc-700 hover:bg-zinc-800'}`
                        }`}
                      >
                        <Sparkles className={`w-5 h-5 mx-auto mb-1 ${sessionSettings.pricing_mode === 'promotional' ? 'text-green-400' : textSecondaryClass}`} />
                        <span className={`text-sm font-medium ${sessionSettings.pricing_mode === 'promotional' ? 'text-green-400' : textPrimaryClass}`}>Promotional</span>
                        <p className={`text-xs ${textSecondaryClass} mt-1`}>Single flat rate</p>
                      </button>
                    </div>
                  </div>

                  {/* Standard Tiered Pricing */}
                  {sessionSettings.pricing_mode === 'tiered' && (
                    <>
                      <p className={`text-xs ${textSecondaryClass}`}>
                        Set prices for each resolution tier. Surfers choose their preferred quality at checkout.
                      </p>

                      <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-blue-50' : 'bg-blue-500/10'}`}>
                        <span className="w-3 h-3 rounded-full bg-blue-400"></span>
                        <span className={`text-sm ${textSecondaryClass} flex-1`}>Web-Res</span>
                        <span className={`font-bold ${textPrimaryClass}`}>$</span>
                        <Input
                          type="number"
                          value={sessionSettings.photo_price_web}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, photo_price_web: parseFloat(e.target.value) || 0 }))}
                          className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-20`}
                          min="0"
                          max="100"
                          step="0.50"
                        />
                      </div>

                      <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-cyan-50' : 'bg-cyan-500/10'}`}>
                        <span className="w-3 h-3 rounded-full bg-cyan-400"></span>
                        <span className={`text-sm ${textSecondaryClass} flex-1`}>Standard</span>
                        <span className={`font-bold ${textPrimaryClass}`}>$</span>
                        <Input
                          type="number"
                          value={sessionSettings.photo_price_standard}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, photo_price_standard: parseFloat(e.target.value) || 0 }))}
                          className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-20`}
                          min="0"
                          max="100"
                          step="0.50"
                        />
                      </div>

                      <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-purple-50' : 'bg-purple-500/10'}`}>
                        <span className="w-3 h-3 rounded-full bg-purple-400"></span>
                        <span className={`text-sm ${textSecondaryClass} flex-1`}>High-Res</span>
                        <span className={`font-bold ${textPrimaryClass}`}>$</span>
                        <Input
                          type="number"
                          value={sessionSettings.photo_price_high}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, photo_price_high: parseFloat(e.target.value) || 0 }))}
                          className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-20`}
                          min="0"
                          max="100"
                          step="0.50"
                        />
                      </div>

                      <div className={`p-2 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                        <p className={`text-xs ${textSecondaryClass}`}>
                          <span className="font-medium">Note:</span> Photos beyond the {sessionSettings.photos_included} included in buy-in will use these tiered prices.
                        </p>
                      </div>
                    </>
                  )}

                  {/* Promotional Flat Rate */}
                  {sessionSettings.pricing_mode === 'promotional' && (
                    <>
                      <div className={`p-3 rounded-xl border ${isLight ? 'bg-green-50 border-green-200' : 'bg-green-500/10 border-green-500/30'}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-4 h-4 text-green-400" />
                          <span className={`text-sm font-medium ${textPrimaryClass}`}>Promotional Rate</span>
                          <Badge className="bg-green-500 text-white text-xs ml-auto">All High-Res</Badge>
                        </div>
                        <p className={`text-xs ${textSecondaryClass} mb-3`}>
                          All photos delivered at full high-resolution quality at one promotional price (including photos beyond buy-in).
                        </p>
                        <div className={`flex items-center gap-3`}>
                          <span className={`text-2xl font-bold ${textPrimaryClass}`}>$</span>
                          <Input
                            type="number"
                            value={sessionSettings.live_photo_price}
                            onChange={(e) => setSessionSettings(prev => ({ ...prev, live_photo_price: parseFloat(e.target.value) || 0 }))}
                            className={`${inputBgClass} ${textPrimaryClass} text-2xl font-bold h-14 text-center w-24`}
                            min="0"
                            max="100"
                            step="0.50"
                          />
                          <span className={`text-sm ${textSecondaryClass}`}>per photo</span>
                        </div>
                      </div>
                      
                      {sessionSettings.live_photo_price < sessionSettings.photo_price_high && (
                        <div className={`flex items-center gap-2 p-2 rounded-lg ${isLight ? 'bg-amber-50' : 'bg-amber-500/10'}`}>
                          <Percent className="w-4 h-4 text-amber-400" />
                          <span className={`text-sm ${textSecondaryClass}`}>
                            Surfers save <span className="text-green-400 font-bold">${(sessionSettings.photo_price_high - sessionSettings.live_photo_price).toFixed(0)}</span> vs standard high-res (${sessionSettings.photo_price_high})
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Collapsible Section: Video Pricing */}
            <div className={`rounded-xl border ${borderClass} overflow-hidden`}>
              <button
                onClick={() => toggleSection('videoPricing')}
                className={`w-full flex items-center justify-between p-3 ${isLight ? 'bg-gray-50 hover:bg-gray-100' : 'bg-zinc-800/50 hover:bg-zinc-800'} transition-colors`}
              >
                <div className="flex items-center gap-2">
                  <Video className="w-5 h-5 text-red-400" />
                  <span className={`font-bold ${textPrimaryClass}`}>Video Pricing</span>
                  <Badge variant="outline" className={`text-xs ${sessionSettings.video_pricing_mode === 'promotional' ? 'border-green-500/50 text-green-400' : 'border-red-500/50 text-red-400'}`}>
                    {sessionSettings.video_pricing_mode === 'promotional' ? 'Promo Active' : 'Per Video'}
                  </Badge>
                </div>
                <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.videoPricing ? 'rotate-180' : ''}`} />
              </button>
              {expandedSections.videoPricing && (
                <div className="p-3 space-y-3 border-t border-inherit">
                  {/* Video Pricing Mode Toggle */}
                  <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                    <p className={`text-xs ${textSecondaryClass} mb-3`}>
                      Choose how surfers are charged for video clips:
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setSessionSettings(prev => ({ ...prev, video_pricing_mode: 'tiered' }))}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          sessionSettings.video_pricing_mode === 'tiered'
                            ? `${isLight ? 'bg-red-50 border-red-300' : 'bg-red-500/20 border-red-500/50'} ring-2 ring-red-400/50`
                            : `${isLight ? 'bg-white border-gray-200 hover:bg-gray-50' : 'bg-zinc-900 border-zinc-700 hover:bg-zinc-800'}`
                        }`}
                      >
                        <Video className={`w-5 h-5 mx-auto mb-1 ${sessionSettings.video_pricing_mode === 'tiered' ? 'text-red-400' : textSecondaryClass}`} />
                        <span className={`text-sm font-medium ${sessionSettings.video_pricing_mode === 'tiered' ? 'text-red-400' : textPrimaryClass}`}>Standard Rates</span>
                        <p className={`text-xs ${textSecondaryClass} mt-1`}>720p/1080p/4K tiers</p>
                      </button>
                      <button
                        onClick={() => setSessionSettings(prev => ({ ...prev, video_pricing_mode: 'promotional' }))}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          sessionSettings.video_pricing_mode === 'promotional'
                            ? `${isLight ? 'bg-green-50 border-green-300' : 'bg-green-500/20 border-green-500/50'} ring-2 ring-green-400/50`
                            : `${isLight ? 'bg-white border-gray-200 hover:bg-gray-50' : 'bg-zinc-900 border-zinc-700 hover:bg-zinc-800'}`
                        }`}
                      >
                        <Sparkles className={`w-5 h-5 mx-auto mb-1 ${sessionSettings.video_pricing_mode === 'promotional' ? 'text-green-400' : textSecondaryClass}`} />
                        <span className={`text-sm font-medium ${sessionSettings.video_pricing_mode === 'promotional' ? 'text-green-400' : textPrimaryClass}`}>Promotional</span>
                        <p className={`text-xs ${textSecondaryClass} mt-1`}>Single flat rate</p>
                      </button>
                    </div>
                  </div>

                  {/* Standard Tiered Video Pricing */}
                  {sessionSettings.video_pricing_mode === 'tiered' && (
                    <>
                      <p className={`text-xs ${textSecondaryClass}`}>
                        Set prices for each video quality tier. Surfers choose their preferred resolution at checkout.
                      </p>

                      <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-orange-50' : 'bg-orange-500/10'}`}>
                        <span className="w-3 h-3 rounded-full bg-orange-400"></span>
                        <span className={`text-sm ${textSecondaryClass} flex-1`}>720p HD</span>
                        <span className={`font-bold ${textPrimaryClass}`}>$</span>
                        <Input
                          type="number"
                          value={sessionSettings.video_price_720p}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, video_price_720p: parseFloat(e.target.value) || 0 }))}
                          className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-20`}
                          min="0"
                          max="200"
                          step="1"
                        />
                      </div>

                      <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-red-50' : 'bg-red-500/10'}`}>
                        <span className="w-3 h-3 rounded-full bg-red-400"></span>
                        <span className={`text-sm ${textSecondaryClass} flex-1`}>1080p Full HD</span>
                        <span className={`font-bold ${textPrimaryClass}`}>$</span>
                        <Input
                          type="number"
                          value={sessionSettings.video_price_1080p}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, video_price_1080p: parseFloat(e.target.value) || 0 }))}
                          className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-20`}
                          min="0"
                          max="200"
                          step="1"
                        />
                      </div>

                      <div className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-pink-50' : 'bg-pink-500/10'}`}>
                        <span className="w-3 h-3 rounded-full bg-pink-400"></span>
                        <span className={`text-sm ${textSecondaryClass} flex-1`}>4K Ultra HD</span>
                        <span className={`font-bold ${textPrimaryClass}`}>$</span>
                        <Input
                          type="number"
                          value={sessionSettings.video_price_4k}
                          onChange={(e) => setSessionSettings(prev => ({ ...prev, video_price_4k: parseFloat(e.target.value) || 0 }))}
                          className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-20`}
                          min="0"
                          max="200"
                          step="1"
                        />
                      </div>

                      <div className={`p-2 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                        <p className={`text-xs ${textSecondaryClass}`}>
                          <span className="font-medium">Note:</span> Video clips are priced separately from photos. Surfers select quality at purchase.
                        </p>
                      </div>
                    </>
                  )}

                  {/* Promotional Flat Rate for Videos */}
                  {sessionSettings.video_pricing_mode === 'promotional' && (
                    <>
                      <div className={`p-3 rounded-xl border ${isLight ? 'bg-green-50 border-green-200' : 'bg-green-500/10 border-green-500/30'}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-4 h-4 text-green-400" />
                          <span className={`text-sm font-medium ${textPrimaryClass}`}>Promotional Rate</span>
                          <Badge className="bg-green-500 text-white text-xs ml-auto">All 4K Quality</Badge>
                        </div>
                        <p className={`text-xs ${textSecondaryClass} mb-3`}>
                          All videos delivered at full 4K quality at one promotional price.
                        </p>
                        <div className={`flex items-center gap-3`}>
                          <span className={`text-2xl font-bold ${textPrimaryClass}`}>$</span>
                          <Input
                            type="number"
                            value={sessionSettings.live_video_price}
                            onChange={(e) => setSessionSettings(prev => ({ ...prev, live_video_price: parseFloat(e.target.value) || 0 }))}
                            className={`${inputBgClass} ${textPrimaryClass} text-2xl font-bold h-14 text-center w-24`}
                            min="0"
                            max="200"
                            step="1"
                          />
                          <span className={`text-sm ${textSecondaryClass}`}>per video</span>
                        </div>
                      </div>
                      
                      {sessionSettings.live_video_price < sessionSettings.video_price_4k && (
                        <div className={`flex items-center gap-2 p-2 rounded-lg ${isLight ? 'bg-amber-50' : 'bg-amber-500/10'}`}>
                          <Percent className="w-4 h-4 text-amber-400" />
                          <span className={`text-sm ${textSecondaryClass}`}>
                            Surfers save <span className="text-green-400 font-bold">${(sessionSettings.video_price_4k - sessionSettings.live_video_price).toFixed(0)}</span> vs standard 4K (${sessionSettings.video_price_4k})
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Collapsible Section: Session Settings */}
            <div className={`rounded-xl border ${borderClass} overflow-hidden`}>
              <button
                onClick={() => toggleSection('settings')}
                className={`w-full flex items-center justify-between p-3 ${isLight ? 'bg-gray-50 hover:bg-gray-100' : 'bg-zinc-800/50 hover:bg-zinc-800'} transition-colors`}
              >
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-orange-400" />
                  <span className={`font-bold ${textPrimaryClass}`}>Session Settings</span>
                  <span className={`text-sm ${textSecondaryClass}`}>({sessionSettings.max_surfers} surfers, {sessionSettings.estimated_duration}h)</span>
                </div>
                <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.settings ? 'rotate-180' : ''}`} />
              </button>
              {expandedSections.settings && (
                <div className="p-3 space-y-3 border-t border-inherit">
                  <div className={`flex items-center justify-between p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                    <div className="flex items-center gap-3">
                      <Users className="w-5 h-5 text-blue-400" />
                      <div>
                        <span className={`font-medium ${textPrimaryClass}`}>Max Surfers</span>
                        <p className={`text-xs ${textSecondaryClass}`}>Limit session capacity</p>
                      </div>
                    </div>
                    <Input
                      type="number"
                      value={sessionSettings.max_surfers}
                      onChange={(e) => setSessionSettings(prev => ({ ...prev, max_surfers: parseInt(e.target.value) || 1 }))}
                      className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-20`}
                      min="1"
                      max="50"
                    />
                  </div>

                  <div className={`flex items-center justify-between p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                    <div className="flex items-center gap-3">
                      <Clock className="w-5 h-5 text-orange-400" />
                      <div>
                        <span className={`font-medium ${textPrimaryClass}`}>Duration</span>
                        <p className={`text-xs ${textSecondaryClass}`}>Estimated session length</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={sessionSettings.estimated_duration}
                        onChange={(e) => setSessionSettings(prev => ({ ...prev, estimated_duration: parseInt(e.target.value) || 1 }))}
                        className={`${inputBgClass} ${textPrimaryClass} font-bold h-10 text-center w-16`}
                        min="1"
                        max="8"
                      />
                      <span className={`text-sm ${textSecondaryClass}`}>hrs</span>
                    </div>
                  </div>

                  <div className={`flex items-center justify-between p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                    <div className="flex items-center gap-3">
                      <Zap className="w-5 h-5 text-yellow-400" />
                      <div>
                        <span className={`font-medium ${textPrimaryClass}`}>Auto-Accept</span>
                        <p className={`text-xs ${textSecondaryClass}`}>Allow walk-ups without approval</p>
                      </div>
                    </div>
                    <Switch
                      checked={sessionSettings.auto_accept}
                      onCheckedChange={(checked) => setSessionSettings(prev => ({ ...prev, auto_accept: checked }))}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Collapsible Section: Earnings Destination (Hobbyists only) */}
            {isHobbyist && (
              <div className={`rounded-xl border ${isLight ? 'border-amber-200' : 'border-amber-500/30'} overflow-hidden`}>
                <button
                  onClick={() => toggleSection('earnings')}
                  className={`w-full flex items-center justify-between p-3 ${isLight ? 'bg-amber-50 hover:bg-amber-100' : 'bg-amber-900/20 hover:bg-amber-900/30'} transition-colors`}
                >
                  <div className="flex items-center gap-2">
                    <Heart className="w-5 h-5 text-amber-400" />
                    <span className={`font-bold ${textPrimaryClass}`}>Earnings Destination</span>
                  </div>
                  <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.earnings ? 'rotate-180' : ''}`} />
                </button>
                {expandedSections.earnings && (
                  <div className="p-3 space-y-3 border-t border-inherit">
                    <Label className={textSecondaryClass}>Where should session earnings go?</Label>
                    <select
                      value={sessionSettings.earnings_destination_type || ''}
                      onChange={(e) => {
                        const type = e.target.value;
                        setSessionSettings({
                          ...sessionSettings,
                          earnings_destination_type: type || null,
                          earnings_destination_id: null,
                          earnings_cause_name: null
                        });
                      }}
                      className={`w-full px-3 py-2 rounded-md border ${borderClass} ${inputBgClass} ${textPrimaryClass}`}
                    >
                      <option value="">Gear Credits (default)</option>
                      <option value="grom">Support a Grom</option>
                      <option value="cause">Support a Cause</option>
                    </select>
                    
                    {sessionSettings.earnings_destination_type === 'grom' && (
                      <select
                        value={sessionSettings.earnings_destination_id || ''}
                        onChange={(e) => setSessionSettings({
                          ...sessionSettings,
                          earnings_destination_id: e.target.value || null
                        })}
                        className={`w-full px-3 py-2 rounded-md border ${borderClass} ${inputBgClass} ${textPrimaryClass}`}
                      >
                        <option value="">Select a Grom...</option>
                        {groms.map(grom => (
                          <option key={grom.id} value={grom.id}>
                            {grom.full_name} {grom.location ? `- ${grom.location}` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    
                    {sessionSettings.earnings_destination_type === 'cause' && (
                      <select
                        value={sessionSettings.earnings_cause_name || ''}
                        onChange={(e) => setSessionSettings({
                          ...sessionSettings,
                          earnings_cause_name: e.target.value || null
                        })}
                        className={`w-full px-3 py-2 rounded-md border ${borderClass} ${inputBgClass} ${textPrimaryClass}`}
                      >
                        <option value="">Select a cause...</option>
                        {causes.map(cause => (
                          <option key={cause.id} value={cause.name}>
                            {cause.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Potential Earnings Preview */}
            <PotentialEarningsCalculator
              buyinPrice={sessionSettings.price_per_join}
              maxSurfers={sessionSettings.max_surfers}
              photoPrice={sessionSettings.live_photo_price}
              commissionRate={commissionRate}
              isLight={isLight}
              textPrimaryClass={textPrimaryClass}
              textSecondaryClass={textSecondaryClass}
            />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setShowSettingsModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveSettings}
              className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-medium"
              data-testid="save-settings-btn"
            >
              <Check className="w-4 h-4 mr-2" />
              Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Go Live Modal - GPS-BASED NEARBY SPOTS SELECTION */}
      <Dialog open={showGoLiveModal} onOpenChange={setShowGoLiveModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader className="border-b border-inherit">
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <Radio className="w-5 h-5 text-green-400 animate-pulse" />
              Go Live - Select Location
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 sm:px-6" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="space-y-4 py-4">
            {/* Current Settings Summary */}
            <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
              <p className={`text-xs ${textSecondaryClass} mb-2`}>Your current session rates:</p>
              <div className="flex items-center gap-4 flex-wrap">
                <span className={`text-sm ${textPrimaryClass}`}>
                  <span className="text-green-400 font-bold">${sessionSettings.price_per_join}</span> buy-in
                </span>
                <span className={`text-sm ${textPrimaryClass}`}>
                  <span className="text-cyan-400 font-bold">{sessionSettings.photos_included}</span> photos included
                </span>
                <span className={`text-sm ${textPrimaryClass}`}>
                  {sessionSettings.pricing_mode === 'promotional' ? (
                    <><span className="text-purple-400 font-bold">${sessionSettings.live_photo_price}</span> promo rate</>
                  ) : (
                    <span className="text-purple-400">Tiered pricing</span>
                  )}
                </span>
              </div>
            </div>

            {/* GPS-Based Nearby Spots OR Search Input */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className={`${textSecondaryClass} flex items-center gap-2`}>
                  <MapPin className="w-4 h-4 text-blue-400" />
                  {userLocation ? 'Nearby Surf Spots' : 'Search Surf Spots'}
                </Label>
                {userLocation ? (
                  <Badge variant="outline" className="text-xs border-green-500/50 text-green-400">
                    <Target className="w-3 h-3 mr-1" />
                    GPS Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-400">
                    <Search className="w-3 h-3 mr-1" />
                    Manual Search
                  </Badge>
                )}
              </div>
              
              {/* GPS Unavailable - Show Search Input */}
              {!userLocation && !nearbySpotsLoading && (
                <>
                  <div className={`p-3 rounded-xl mb-3 ${isLight ? 'bg-amber-50 border border-amber-200' : 'bg-amber-500/10 border border-amber-500/30'}`}>
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-amber-500 font-medium text-sm">GPS unavailable</p>
                        <p className={`text-xs ${textSecondaryClass} mt-1`}>
                          Search for your spot below. You'll need to confirm you're at the location before going live.
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Search Input */}
                  <div className="relative mb-3">
                    <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondaryClass}`} />
                    <Input
                      type="text"
                      placeholder="Type to search spots..."
                      value={spotSearchQuery}
                      onChange={(e) => setSpotSearchQuery(e.target.value)}
                      className={`pl-10 pr-10 ${inputBgClass} ${textPrimaryClass} border ${borderClass}`}
                      data-testid="spot-search-input"
                    />
                    {spotSearchQuery && (
                      <button
                        onClick={() => setSpotSearchQuery('')}
                        className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-gray-200 dark:hover:bg-zinc-700`}
                      >
                        <X className={`w-4 h-4 ${textSecondaryClass}`} />
                      </button>
                    )}
                  </div>
                </>
              )}
              
              {nearbySpotsLoading ? (
                <div className={`flex flex-col items-center justify-center py-8 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                  <RefreshCw className="w-6 h-6 animate-spin text-cyan-400 mb-2" />
                  <p className={`text-sm ${textSecondaryClass}`}>Finding nearby spots...</p>
                </div>
              ) : userLocation ? (
                /* GPS Available - Show Nearby Spots List */
                nearbySpots.length === 0 ? (
                  <div className={`flex flex-col items-center justify-center py-8 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                    <MapPin className={`w-8 h-8 ${textSecondaryClass} mb-2 opacity-50`} />
                    <p className={`text-sm ${textPrimaryClass} font-medium`}>No spots nearby</p>
                    <p className={`text-xs ${textSecondaryClass} text-center mt-1`}>
                      No surf spots found within {NEARBY_RADIUS_MILES} miles of your location
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                    {nearbySpots.map((spot) => {
                      const isSelected = sessionSettings.surf_spot_id === spot.id;
                      const hasDistance = spot.distance !== null && spot.distance !== undefined;
                      const isWithinLiveRange = hasDistance && spot.distance <= REQUIRED_DISTANCE_MILES;
                    
                    return (
                      <button
                        key={spot.id}
                        onClick={() => {
                          setSessionSettings({ 
                            ...sessionSettings, 
                            surf_spot_id: spot.id,
                            location: spot.name
                          });
                          setDistanceToSpot(spot.distance);
                          setManualConfirm(false);
                        }}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                          isSelected
                            ? isWithinLiveRange
                              ? `${isLight ? 'bg-green-50 border-2 border-green-400' : 'bg-green-500/20 border-2 border-green-500/50'}`
                              : `${isLight ? 'bg-blue-50 border-2 border-blue-400' : 'bg-blue-500/20 border-2 border-blue-500/50'}`
                            : `${isLight ? 'bg-gray-50 border border-gray-200 hover:bg-gray-100' : 'bg-zinc-800/50 border border-zinc-700 hover:bg-zinc-800'}`
                        }`}
                        data-testid={`nearby-spot-${spot.id}`}
                      >
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          isSelected
                            ? isWithinLiveRange ? 'bg-green-500/30' : 'bg-blue-500/30'
                            : isLight ? 'bg-gray-200' : 'bg-zinc-700'
                        }`}>
                          {isWithinLiveRange ? (
                            <Check className={`w-5 h-5 ${isSelected ? 'text-green-400' : 'text-green-500'}`} />
                          ) : (
                            <MapPin className={`w-5 h-5 ${isSelected ? 'text-blue-400' : textSecondaryClass}`} />
                          )}
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <p className={`font-medium truncate ${isSelected ? (isWithinLiveRange ? 'text-green-400' : 'text-blue-400') : textPrimaryClass}`}>
                            {spot.name}
                          </p>
                          <p className={`text-xs truncate ${textSecondaryClass}`}>
                            {spot.region || spot.city || 'Unknown region'}
                          </p>
                        </div>
                        <div className="flex flex-col items-end flex-shrink-0">
                          {hasDistance ? (
                            <>
                              <span className={`text-sm font-bold ${
                                isWithinLiveRange 
                                  ? 'text-green-400' 
                                  : spot.distance <= 1 
                                    ? 'text-cyan-400' 
                                    : textSecondaryClass
                              }`}>
                                {spot.distance < 0.1 ? '<0.1' : spot.distance.toFixed(1)} mi
                              </span>
                              {isWithinLiveRange && (
                                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs mt-1">
                                  In Range
                                </Badge>
                              )}
                            </>
                          ) : (
                            <span className={`text-xs ${textSecondaryClass}`}>
                              No GPS
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                )
              ) : (
                /* GPS Unavailable - Show Search Results */
                <>
                  {spotSearchQuery.trim() === '' ? (
                    <div className={`flex flex-col items-center justify-center py-8 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                      <Search className={`w-8 h-8 ${textSecondaryClass} mb-2 opacity-50`} />
                      <p className={`text-sm ${textPrimaryClass} font-medium`}>Start typing to search</p>
                      <p className={`text-xs ${textSecondaryClass} text-center mt-1`}>
                        Enter a spot name, city, or region to find your location
                      </p>
                    </div>
                  ) : (
                    (() => {
                      const query = spotSearchQuery.toLowerCase().trim();
                      const filteredSpots = surfSpots.filter(spot => 
                        spot.name?.toLowerCase().includes(query) ||
                        spot.region?.toLowerCase().includes(query) ||
                        spot.city?.toLowerCase().includes(query) ||
                        spot.country?.toLowerCase().includes(query)
                      ).slice(0, 10); // Limit to 10 results
                      
                      if (filteredSpots.length === 0) {
                        return (
                          <div className={`flex flex-col items-center justify-center py-8 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
                            <MapPin className={`w-8 h-8 ${textSecondaryClass} mb-2 opacity-50`} />
                            <p className={`text-sm ${textPrimaryClass} font-medium`}>No spots found</p>
                            <p className={`text-xs ${textSecondaryClass} text-center mt-1`}>
                              Try a different search term
                            </p>
                          </div>
                        );
                      }
                      
                      return (
                        <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                          {filteredSpots.map((spot) => {
                            const isSelected = sessionSettings.surf_spot_id === spot.id;
                            
                            return (
                              <button
                                key={spot.id}
                                onClick={() => {
                                  setSessionSettings({ 
                                    ...sessionSettings, 
                                    surf_spot_id: spot.id,
                                    location: spot.name
                                  });
                                  setDistanceToSpot(null); // No distance without GPS
                                  setManualConfirm(false);
                                }}
                                className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                                  isSelected
                                    ? `${isLight ? 'bg-blue-50 border-2 border-blue-400' : 'bg-blue-500/20 border-2 border-blue-500/50'}`
                                    : `${isLight ? 'bg-gray-50 border border-gray-200 hover:bg-gray-100' : 'bg-zinc-800/50 border border-zinc-700 hover:bg-zinc-800'}`
                                }`}
                                data-testid={`search-spot-${spot.id}`}
                              >
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                  isSelected ? 'bg-blue-500/30' : isLight ? 'bg-gray-200' : 'bg-zinc-700'
                                }`}>
                                  <MapPin className={`w-5 h-5 ${isSelected ? 'text-blue-400' : textSecondaryClass}`} />
                                </div>
                                <div className="flex-1 text-left min-w-0">
                                  <p className={`font-medium truncate ${isSelected ? 'text-blue-400' : textPrimaryClass}`}>
                                    {spot.name}
                                  </p>
                                  <p className={`text-xs truncate ${textSecondaryClass}`}>
                                    {[spot.city, spot.region, spot.country].filter(Boolean).join(', ') || 'Unknown location'}
                                  </p>
                                </div>
                                {isSelected && (
                                  <Check className="w-5 h-5 text-blue-400 flex-shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()
                  )}
                </>
              )}
            </div>

            {/* Location Verification Status - Shows after spot is selected */}
            {sessionSettings.surf_spot_id && distanceToSpot !== null && (
              <div className="space-y-3">
                {/* Within Range - Good to go */}
                {isWithinRange && (
                  <div className={`p-3 rounded-xl ${isLight ? 'bg-green-50 border border-green-200' : 'bg-green-500/10 border border-green-500/30'}`}>
                    <div className="flex items-center gap-2">
                      <Check className="w-5 h-5 text-green-400" />
                      <div>
                        <p className="text-green-400 font-medium text-sm">You're at the spot!</p>
                        <p className={`text-xs ${textSecondaryClass}`}>
                          {distanceToSpot.toFixed(2)} miles away - Ready to go live
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Not at spot - Distance Warning + Manual Override */}
                {!isWithinRange && (
                  <>
                    <div className={`p-3 rounded-xl ${isLight ? 'bg-amber-50 border border-amber-300' : 'bg-amber-500/10 border border-amber-500/30'}`}>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-amber-500" />
                        <div>
                          <p className="text-amber-500 font-medium text-sm">Not at the spot yet</p>
                          <p className="text-amber-500 text-xs">
                            You're {distanceToSpot.toFixed(2)} miles away (need to be within {REQUIRED_DISTANCE_MILES} miles)
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Manual Override Option */}
                    <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100 border border-gray-200' : 'bg-zinc-800 border border-zinc-700'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <Target className="w-4 h-4 text-muted-foreground" />
                        <span className={`font-medium text-sm ${textPrimaryClass}`}>GPS not accurate?</span>
                      </div>
                      <p className={`text-xs ${textSecondaryClass} mb-2`}>
                        If you're physically at {nearbySpots.find(s => s.id === sessionSettings.surf_spot_id)?.name} but GPS shows otherwise, you can manually confirm.
                      </p>
                      <p className="text-amber-500 text-xs mb-3 flex items-start gap-1">
                        <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span>Warning: Going live when not at the spot may result in negative reviews, selling suspension, or account action.</span>
                      </p>
                      <button
                        onClick={() => setManualConfirm(true)}
                        className={`w-full py-2 rounded-lg border text-sm font-medium transition-colors ${
                          manualConfirm
                            ? 'bg-green-500/20 border-green-500/50 text-green-400'
                            : `${isLight ? 'border-gray-300 hover:bg-gray-50' : 'border-zinc-600 hover:bg-zinc-700'} ${textPrimaryClass}`
                        }`}
                        data-testid="manual-confirm-location"
                      >
                        {manualConfirm ? (
                          <span className="flex items-center justify-center gap-2">
                            <Check className="w-4 h-4" />
                            Confirmed - I'm at this spot
                          </span>
                        ) : (
                          <span className="flex items-center justify-center gap-2">
                            <Check className="w-4 h-4" />
                            I confirm I'm at this spot
                          </span>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* GPS Unavailable - Manual Confirmation Required */}
            {sessionSettings.surf_spot_id && (distanceToSpot === null || distanceToSpot === undefined) && !userLocation && (
              <div className="space-y-3">
                <div className={`p-3 rounded-xl ${isLight ? 'bg-amber-50 border border-amber-300' : 'bg-amber-500/10 border border-amber-500/30'}`}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    <div>
                      <p className="text-amber-500 font-medium text-sm">GPS unavailable - Manual confirmation required</p>
                      <p className={`text-xs ${textSecondaryClass} mt-1`}>
                        Without GPS, we can't verify your location. Please confirm you're at the selected spot.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Required Manual Confirmation */}
                <div className={`p-3 rounded-xl ${isLight ? 'bg-gray-100 border border-gray-200' : 'bg-zinc-800 border border-zinc-700'}`}>
                  <p className="text-amber-500 text-xs mb-3 flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>Warning: Going live when not at the spot may result in negative reviews, selling suspension, or account action.</span>
                  </p>
                  <button
                    onClick={() => setManualConfirm(true)}
                    className={`w-full py-2 rounded-lg border text-sm font-medium transition-colors ${
                      manualConfirm
                        ? 'bg-green-500/20 border-green-500/50 text-green-400'
                        : `${isLight ? 'border-gray-300 hover:bg-gray-50' : 'border-zinc-600 hover:bg-zinc-700'} ${textPrimaryClass}`
                    }`}
                    data-testid="manual-confirm-location-no-gps"
                  >
                    {manualConfirm ? (
                      <span className="flex items-center justify-center gap-2">
                        <Check className="w-4 h-4" />
                        Confirmed - I'm at {nearbySpots.find(s => s.id === sessionSettings.surf_spot_id)?.name}
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <Check className="w-4 h-4" />
                        I confirm I'm at this spot
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Location Error */}
            {locationError && (
              <div className={`p-3 rounded-xl ${isLight ? 'bg-red-50 border border-red-200' : 'bg-red-500/10 border border-red-500/30'}`}>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <div>
                    <p className="text-red-400 font-medium text-sm">Location Error</p>
                    <p className={`text-xs ${textSecondaryClass}`}>{locationError}</p>
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setShowGoLiveModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleGoLiveConfirmed}
              disabled={!sessionSettings.surf_spot_id || !canProceed}
              className="bg-gradient-to-r from-green-400 to-emerald-500 text-black font-medium disabled:opacity-50"
              data-testid="go-live-next-btn"
            >
              <Play className="w-4 h-4 mr-2" />
              Next: Add Conditions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pricing Modal */}
      <Dialog open={showPricingModal} onOpenChange={setShowPricingModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={textPrimaryClass}>Live Session Pricing</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className={`text-sm ${textSecondaryClass}`}>
              Set your default pricing for live sessions. All prices are in credits (1 credit = $1).
            </p>
            
            <div className={`p-4 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
              <h4 className={`font-medium ${textPrimaryClass} mb-3`}>Live Session Pricing</h4>
              <div className="space-y-3">
                <div>
                  <Label className={textSecondaryClass}>Buy-in Price (credits)</Label>
                  <Input
                    type="number"
                    value={pricing.live_buyin_price}
                    onChange={(e) => setPricing({ ...pricing, live_buyin_price: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                  <p className={`text-xs ${textSecondaryClass} mt-1`}>Price for surfers to join your live session</p>
                </div>
                <div>
                  <Label className={textSecondaryClass}>Price per Photo (credits)</Label>
                  <Input
                    type="number"
                    value={pricing.live_photo_price}
                    onChange={(e) => setPricing({ ...pricing, live_photo_price: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                  <p className={`text-xs ${textSecondaryClass} mt-1`}>Additional cost per photo after buy-in</p>
                </div>
                <div>
                  <Label className={textSecondaryClass}>Photos Included in Buy-in</Label>
                  <Input
                    type="number"
                    value={pricing.photo_package_size}
                    onChange={(e) => setPricing({ ...pricing, photo_package_size: parseInt(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                  <p className={`text-xs ${textSecondaryClass} mt-1`}>Number of free photos included with session buy-in (0 = none)</p>
                </div>
              </div>
            </div>
            
            <div className={`p-3 rounded-lg ${isLight ? 'bg-blue-50' : 'bg-blue-500/10'}`}>
              <p className={`text-sm ${isLight ? 'text-blue-800' : 'text-blue-400'}`}>
                <strong>Note:</strong> Booking rates are managed in the <a href="/photographer/bookings" className="underline">Bookings Manager</a>.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPricingModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSavePricing}
              className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black"
            >
              Save Pricing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Gallery Created Modal */}
      <Dialog open={showGalleryCreatedModal} onOpenChange={setShowGalleryCreatedModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <ImageIcon className="w-5 h-5 text-green-400" />
              Gallery Created!
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className={`p-4 rounded-lg ${isLight ? 'bg-green-50' : 'bg-green-500/10'} border border-green-500/30`}>
              <p className={textPrimaryClass}>
                Your live session has ended and a new gallery has been automatically created:
              </p>
              <h3 className="text-xl font-bold text-green-400 mt-2">
                {lastCreatedGallery?.title}
              </h3>
            </div>
            
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                <Users className={`w-5 h-5 mx-auto mb-1 ${textSecondaryClass}`} />
                <p className={`text-lg font-bold ${textPrimaryClass}`}>{lastCreatedGallery?.total_surfers || 0}</p>
                <p className={`text-xs ${textSecondaryClass}`}>Surfers</p>
              </div>
              <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                <Clock className={`w-5 h-5 mx-auto mb-1 ${textSecondaryClass}`} />
                <p className={`text-lg font-bold ${textPrimaryClass}`}>{lastCreatedGallery?.duration_mins || 0}m</p>
                <p className={`text-xs ${textSecondaryClass}`}>Duration</p>
              </div>
              <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                <DollarSign className={`w-5 h-5 mx-auto mb-1 text-green-400`} />
                <p className={`text-lg font-bold text-green-400`}>${lastCreatedGallery?.total_earnings?.toFixed(2) || '0.00'}</p>
                <p className={`text-xs ${textSecondaryClass}`}>Earned</p>
              </div>
            </div>
            
            <p className={`text-sm ${textSecondaryClass}`}>
              Upload your photos to this gallery and set per-gallery pricing to sell them to surfers who attended.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGalleryCreatedModal(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setShowGalleryCreatedModal(false);
                navigate(`/photographer/galleries/${lastCreatedGallery?.id}`);
              }}
              className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black"
            >
              <ImageIcon className="w-4 h-4 mr-2" />
              Upload Photos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Debug Overlay Toggle Button */}
      <button
        onClick={() => setShowDebugOverlay(!showDebugOverlay)}
        className="fixed bottom-24 right-4 z-50 w-10 h-10 bg-zinc-800 border border-zinc-700 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:border-cyan-500 transition-all shadow-lg md:bottom-4"
        title="Toggle Debug Overlay"
        data-testid="debug-toggle"
      >
        <Bug className="w-5 h-5" />
      </button>

      {/* Debug Overlay */}
      {showDebugOverlay && (
        <div className="fixed bottom-36 right-4 z-50 w-72 bg-black/90 backdrop-blur-sm border border-cyan-500/50 rounded-lg p-4 shadow-xl md:bottom-16" data-testid="debug-overlay">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-cyan-400 font-bold text-sm flex items-center gap-2">
              <Bug className="w-4 h-4" />
              Debug Overlay
            </h3>
            <button
              onClick={() => setShowDebugOverlay(false)}
              className="text-zinc-500 hover:text-white"
            >
              x
            </button>
          </div>
          
          {/* GPS Status */}
          <div className="mb-3 p-2 bg-zinc-900/50 rounded border border-zinc-800">
            <div className="flex items-center gap-2 mb-1">
              <Signal className={`w-4 h-4 ${
                debugInfo.gpsStatus === 'granted' ? 'text-green-400' :
                debugInfo.gpsStatus === 'denied' ? 'text-red-400' :
                debugInfo.gpsStatus === 'requesting' ? 'text-yellow-400 animate-pulse' :
                'text-zinc-500'
              }`} />
              <span className="text-zinc-400 text-xs font-medium">GPS Status</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-zinc-500">Status:</span>
                <span className={`ml-1 font-mono ${
                  debugInfo.gpsStatus === 'granted' ? 'text-green-400' : 'text-zinc-400'
                }`}>
                  {debugInfo.gpsStatus}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Accuracy:</span>
                <span className="ml-1 font-mono text-cyan-400">
                  {debugInfo.gpsAccuracy ? `${debugInfo.gpsAccuracy.toFixed(1)}m` : '--'}
                </span>
              </div>
            </div>
            {debugInfo.latitude && (
              <div className="mt-1 text-xs text-zinc-500 font-mono truncate">
                {debugInfo.latitude.toFixed(6)}, {debugInfo.longitude.toFixed(6)}
              </div>
            )}
          </div>
          
          {/* Camera Status */}
          <div className="mb-3 p-2 bg-zinc-900/50 rounded border border-zinc-800">
            <div className="flex items-center gap-2 mb-1">
              <Video className={`w-4 h-4 ${
                debugInfo.cameraStatus === 'granted' ? 'text-green-400' :
                debugInfo.cameraStatus === 'denied' ? 'text-red-400' :
                debugInfo.cameraStatus === 'requesting' ? 'text-yellow-400 animate-pulse' :
                'text-zinc-500'
              }`} />
              <span className="text-zinc-400 text-xs font-medium">Camera Status</span>
            </div>
            <div className="text-xs">
              <span className="text-zinc-500">Status:</span>
              <span className={`ml-1 font-mono ${
                debugInfo.cameraStatus === 'granted' ? 'text-green-400' : 'text-zinc-400'
              }`}>
                {debugInfo.cameraStatus}
              </span>
            </div>
            {debugInfo.cameraStream && (
              <div className="mt-2 aspect-video bg-zinc-800 rounded overflow-hidden">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              </div>
            )}
          </div>
          
          {/* Permission Flow Step */}
          <div className="p-2 bg-zinc-900/50 rounded border border-zinc-800">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-zinc-400 text-xs font-medium">Permission Flow</span>
            </div>
            <div className="flex items-center gap-1">
              {['location', 'spot_picker', 'camera', 'ready'].map((step, i) => (
                <React.Fragment key={step}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    debugInfo.permissionStep === step ? 'bg-cyan-500 text-black animate-pulse' :
                    ['location', 'spot_picker', 'camera', 'ready'].indexOf(debugInfo.permissionStep) > i ? 'bg-green-500 text-black' :
                    'bg-zinc-700 text-zinc-500'
                  }`}>
                    {i + 1}
                  </div>
                  {i < 3 && <div className="flex-1 h-0.5 bg-zinc-700" />}
                </React.Fragment>
              ))}
            </div>
            <div className="text-center mt-1 text-xs text-zinc-500">
              {debugInfo.permissionStep === 'idle' && 'Ready to start'}
              {debugInfo.permissionStep === 'location' && 'Getting location...'}
              {debugInfo.permissionStep === 'spot_picker' && 'Select surf spot'}
              {debugInfo.permissionStep === 'camera' && 'Camera access...'}
              {debugInfo.permissionStep === 'ready' && 'All set!'}
            </div>
          </div>
          
          {/* Quick Actions */}
          <div className="mt-3 flex gap-2">
            <button
              onClick={requestLocationPermission}
              className="flex-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-1.5 rounded"
            >
              Test GPS
            </button>
            <button
              onClick={requestCameraPermission}
              className="flex-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-1.5 rounded"
            >
              Test Camera
            </button>
          </div>
        </div>
      )}
      
      {/* Photo Upload Modal */}
      <PhotoUploadModal
        isOpen={showPhotoUpload}
        onClose={() => setShowPhotoUpload(false)}
        sessionId={currentSession?.live_session_id}
        galleryId={null}
        participants={currentSession?.participants || []}
        sessionPricing={{
          live_photo_price: sessionSettings.live_photo_price,
          general_photo_price: sessionSettings.general_photo_price
        }}
        onSuccess={(data) => {
          toast.success(`Uploaded ${data.uploaded} photos!`);
          setShowPhotoUpload(false);
        }}
      />

      {/* Conditions Modal - Go Live Gatekeeper */}
      <ConditionsModal
        isOpen={showConditionsModal}
        onClose={() => setShowConditionsModal(false)}
        onConfirm={handleGoLiveWithConditions}
        spotName={surfSpots.find(s => s.id === sessionSettings.surf_spot_id)?.name || 'Selected Spot'}
        isLoading={goLiveLoading}
      />

      {/* End Session Modal - Kill Switch */}
      <EndSessionModal
        isOpen={showEndSessionModal}
        onClose={() => setShowEndSessionModal(false)}
        onConfirm={handleEndSessionConfirmed}
        session={currentSession}
        isLoading={endSessionLoading}
      />
    </div>
  );
};
