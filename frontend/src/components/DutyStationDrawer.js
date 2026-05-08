/**
 * DutyStationDrawer - Unified Photographer Duty Management
 * 
 * Features:
 * - Mode Selector (Live vs On-Demand) - mutually exclusive
 * - Role-based visibility (Hobbyists only see Live mode)
 * - GPS validation for Live mode (must be within 0.2 miles of spot)
 * - Multi-spot selection for On-Demand mode with role-based radius:
 *   - Regular Photographer: 10-20 miles
 *   - Approved Pro: up to 50 miles
 * - Deselection capability for both modes
 * - Warning messages for GPS issues and compliance
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { 
  Radio, Zap, X, Navigation
} from 'lucide-react';
import { Sheet, SheetContent } from './ui/sheet';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { GpsProximityCheck, OnDemandSpotSelector, StatusCard, ModeSelector, GpsWarningBanner, SelectedSpotDisplay, StatsPreview, QuickActions } from './on-demand/DutyStationComponents';
import apiClient from '../lib/apiClient';
import { SpotSelector } from './SpotSelector';
import { motion, AnimatePresence } from 'framer-motion';
import logger from '../utils/logger';
import ConditionsModal from './ConditionsModal';
import { ROLES } from '../constants/roles';


// Distance constants
export const LIVE_PROXIMITY_MILES = 0.2; // Must be within 0.2 miles to go live
export const LIVE_PROXIMITY_METERS = LIVE_PROXIMITY_MILES * 1609.34;

// On-Demand radius by role (in miles)
const ON_DEMAND_RADIUS = {
  standard: { min: 10, max: 20 },  // Regular Photographer
  pro: { min: 10, max: 50 }        // Approved Pro
};

// Mode configurations with theming
export const MODE_CONFIG = {
  live: {
    id: 'live',
    label: 'Live',
    icon: Radio,
    description: 'Actively shooting at a spot',
    activeText: 'Currently shooting',
    inactiveText: 'Ready to go live',
    colors: {
      primary: 'bg-blue-500',
      primaryHover: 'hover:bg-blue-400',
      text: 'text-blue-400',
      textLight: 'text-blue-300',
      border: 'border-blue-500/50',
      glow: 'shadow-[0_0_20px_rgba(59,130,246,0.4)]',
      gradient: 'from-blue-500/20 to-cyan-500/20',
      ring: 'bg-blue-500/20'
    }
  },
  onDemand: {
    id: 'onDemand',
    label: 'On-Demand',
    icon: Zap,
    description: 'Available for requests nearby',
    activeText: 'Accepting requests',
    inactiveText: 'Ready to activate',
    colors: {
      primary: 'bg-amber-500',
      primaryHover: 'hover:bg-amber-400',
      text: 'text-amber-400',
      textLight: 'text-amber-300',
      border: 'border-amber-500/50',
      glow: 'shadow-[0_0_20px_rgba(245,158,11,0.4)]',
      gradient: 'from-amber-500/20 to-orange-500/20',
      ring: 'bg-amber-500/20'
    }
  }
};

/**
 * Calculate distance between two coordinates in meters (Haversine formula)
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

const metersToMiles = (meters) => meters / 1609.34;

// ModeSelector, GpsWarningBanner, SelectedSpotDisplay, StatsPreview, QuickActions
// → Extracted to ./on-demand/DutyStationComponents.js



/**
 * DutyStationDrawer - Main exported component
 */
export const DutyStationDrawer = ({ isOpen, onClose }) => {
  const _navigate = useNavigate();
  const { user } = useAuth();
  const { getEffectiveRole } = usePersona();
  
  // State
  const [mode, setMode] = useState('live');
  const [liveActive, setLiveActive] = useState(false);
  const [onDemandActive, setOnDemandActive] = useState(false);
  const [selectedSpot, setSelectedSpot] = useState(null); // For Live mode
  const [selectedSpots, setSelectedSpots] = useState([]); // For On-Demand mode
  const [availableSpots, setAvailableSpots] = useState([]);
  const [spotsLoading, setSpotsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nearbyShooters, setNearbyShooters] = useState(0);
  const [userLocation, setUserLocation] = useState(null);
  const [gpsAvailable, setGpsAvailable] = useState(true);
  const [proximityConfirmed, setProximityConfirmed] = useState(false);
  const [stats, setStats] = useState({ todayEarnings: 0, sessionsToday: 0 });
  const [showConditionsModal, setShowConditionsModal] = useState(false);
  // Photographer pricing config - fetched on mount, included in go-live payload
  const [pricingConfig, setPricingConfig] = useState({
    price_per_join: 25,
    live_photo_price: 5,
    photos_included: 3,
    videos_included: 1,
    general_photo_price: 10,
    photo_price_web: 3,
    photo_price_standard: 5,
    photo_price_high: 10,
    estimated_duration: 2,
    max_surfers: 10,
    auto_accept: true,
    // Earnings destination (Hobbyist cause/grom)
    earnings_destination_type: null,
    earnings_destination_id: null,
    earnings_cause_name: null
  });
  
  // Role-based permissions
  const effectiveRole = getEffectiveRole(user?.role);
  const isHobbyist = effectiveRole === ROLES.HOBBYIST;
  const isApprovedPro = effectiveRole === ROLES.APPROVED_PRO;
  const showOnDemand = !isHobbyist;
  
  // Get radius based on tier
  const photographerTier = isApprovedPro ? 'pro' : 'standard';
  const radiusConfig = ON_DEMAND_RADIUS[photographerTier];
  
  // isActive tracks whether the CURRENTLY VIEWED mode is active
  const isActive = mode === 'live' ? liveActive : onDemandActive;
  // anyModeActive is true if EITHER mode is active (used to lock tab switching)
  const anyModeActive = liveActive || onDemandActive;
  
  // Determine if can activate
  const canActivateLive = selectedSpot && proximityConfirmed;
  const canActivateOnDemand = selectedSpots.length > 0;
  const canActivate = mode === 'live' ? canActivateLive : canActivateOnDemand;
  
  // Fetch user's GPS location
  useEffect(() => {
    if (isOpen && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy
          });
          setGpsAvailable(true);
        },
        (error) => {
          logger.error('GPS error:', error);
          setUserLocation(null);
          setGpsAvailable(false);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    }
  }, [isOpen]);
  
  // Fetch statuses + pricing on mount
  useEffect(() => {
    if (user?.id && isOpen) {
      fetchStatuses();
      fetchNearbyShooters();
      fetchPricingConfig();
    }
  }, [user?.id, isOpen]);

  // Fetch photographer pricing to include in go-live payload (mirrors PSM)
  const fetchPricingConfig = async () => {
    try {
      const [pricingRes, galleryRes] = await Promise.allSettled([
        apiClient.get(`/photographer/${user.id}/pricing`),
        apiClient.get(`/photographer/${user.id}/gallery-pricing`)
      ]);
      const p = pricingRes.status === 'fulfilled' ? pricingRes.value.data : {};
      const g = galleryRes.status === 'fulfilled' ? galleryRes.value.data : {};
      setPricingConfig(prev => ({
        ...prev,
        price_per_join: p.live_buyin_price ?? prev.price_per_join,
        live_photo_price: g.session_pricing?.live_session_photo_price ?? p.live_photo_price ?? prev.live_photo_price,
        photos_included: g.session_pricing?.live_session_photos_included ?? p.photo_package_size ?? prev.photos_included,
        videos_included: g.session_pricing?.live_session_videos_included ?? prev.videos_included,
        general_photo_price: g.photo_pricing?.standard ?? p.gallery_photo_price ?? prev.general_photo_price,
        photo_price_web: g.photo_pricing?.web ?? prev.photo_price_web,
        photo_price_standard: g.photo_pricing?.standard ?? prev.photo_price_standard,
        photo_price_high: g.photo_pricing?.high ?? prev.photo_price_high
      }));
    } catch (err) {
      logger.warn('[DutyStation] Could not fetch pricing - using defaults:', err.message);
    }
  };
  
  // Fetch spots when location becomes available (for On-Demand)
  useEffect(() => {
    if (userLocation && showOnDemand && isOpen) {
      fetchAvailableSpots();
    }
  }, [userLocation, showOnDemand, isOpen]);
  
  // Reset proximity confirmation when spot changes
  useEffect(() => {
    setProximityConfirmed(false);
  }, [selectedSpot?.id]);
  
  const fetchStatuses = async () => {
    try {
      const liveResponse = await apiClient.get(`/photographer/${user.id}/status`);
      const liveData = liveResponse.data;
      setLiveActive(liveData?.is_shooting || false);
      
      if (liveData?.is_shooting && liveData?.current_spot_id) {
        setSelectedSpot({
          id: liveData.current_spot_id,
          name: liveData.current_spot_name,
          latitude: liveData.current_spot_latitude,
          longitude: liveData.current_spot_longitude
        });
        setMode('live');
        setProximityConfirmed(true);
      }
      
      if (showOnDemand) {
        const onDemandResponse = await apiClient.get(`/photographer/${user.id}/on-demand-status`);
        const onDemandData = onDemandResponse.data;
        setOnDemandActive(onDemandData?.is_available || false);
        
        if (onDemandData?.is_available) {
          // Always switch to On-Demand tab when it's active
          setSelectedSpots(onDemandData.active_spots || []);
          setMode('onDemand');
        }
      }
      
      try {
        const statsResponse = await apiClient.get(`/photographer/${user.id}/daily-stats`);
        setStats(statsResponse.data || { todayEarnings: 0, sessionsToday: 0 });
      } catch (e) { /* daily stats are optional - don't block on failure */ }
    } catch (error) {
      logger.error('Failed to fetch statuses:', error);
      // If status fetch fails but the user has a stale session, the backend will
      // still report is_shooting=true.  Fallback: assume not active so the user
      // can at least attempt to go live (the backend will catch conflicts).
      setLiveActive(false);
      setOnDemandActive(false);
    }
  };
  
  // Force-end a stale session that's blocking new go-live attempts
  const forceEndStaleSession = async () => {
    try {
      setLoading(true);
      await apiClient.post(`/photographer/${user.id}/end-session`);
      setLiveActive(false);
      setSelectedSpot(null);
      toast.success('Previous session ended. You can now go live again.');
      // Re-fetch clean status
      await fetchStatuses();
    } catch (err) {
      const errDetail = err.response?.data?.detail;
      // "No active session to end" means the DB is already clean - clear local state
      if (errDetail && errDetail.toLowerCase().includes('no active session')) {
        setLiveActive(false);
        toast.success('Session already cleared. You can go live now.');
      } else {
        toast.error(`Could not end session: ${errDetail || err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };
  
  const fetchAvailableSpots = async () => {
    if (!userLocation) return;
    
    setSpotsLoading(true);
    try {
      // Use correct endpoint: /surf-spots/nearby with radius_miles parameter
      const response = await apiClient.get(`/surf-spots/nearby`, {
        params: {
          latitude: userLocation.lat,
          longitude: userLocation.lng,
          radius_miles: radiusConfig.max // Use max radius for the tier
        }
      });
      
      // Map response and filter spots within the tier's radius
      const spotsWithDistance = (response.data || []).map(spot => {
        // Backend already provides distance_miles, but calculate if missing
        const distance = spot.distance_miles || spot.distance || metersToMiles(
          calculateDistance(userLocation.lat, userLocation.lng, spot.latitude, spot.longitude)
        );
        return { ...spot, distance };
      }).filter(spot => spot.distance <= radiusConfig.max);
      
      setAvailableSpots(spotsWithDistance);
    } catch (error) {
      logger.error('Failed to fetch spots:', error);
      setAvailableSpots([]);
    } finally {
      setSpotsLoading(false);
    }
  };
  
  const fetchNearbyShooters = async () => {
    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
          const response = await apiClient.get(`/photographers/live`, {
            params: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              radius: 25
            }
          });
          const others = (response.data || []).filter(p => p.id !== user?.id);
          setNearbyShooters(others.length);
        });
      }
    } catch (error) {
      logger.error('Failed to fetch nearby shooters:', error);
    }
  };
  
  const handleSelectSpot = useCallback((spot) => {
    setSelectedSpot(spot);
    setProximityConfirmed(false);
  }, []);
  
  const handleDeselectSpot = useCallback(() => {
    setSelectedSpot(null);
    setProximityConfirmed(false);
  }, []);
  
  const handleToggleOnDemandSpot = useCallback((spot) => {
    setSelectedSpots(prev => {
      const exists = prev.some(s => s.id === spot.id);
      if (exists) {
        return prev.filter(s => s.id !== spot.id);
      }
      return [...prev, spot];
    });
  }, []);
  
  const handleSelectAllSpots = useCallback(() => {
    if (selectedSpots.length === availableSpots.length) {
      setSelectedSpots([]);
    } else {
      setSelectedSpots([...availableSpots]);
    }
  }, [availableSpots, selectedSpots.length]);
  
  const handleDeselectAllSpots = useCallback(() => {
    setSelectedSpots([]);
  }, []);
  
  const handleManualConfirm = () => {
    setProximityConfirmed(true);
    toast.warning('Location manually confirmed. Remember: going live when not at the spot may result in negative reviews or account action.');
  };
  
  const handleActivateLive = async () => {
    if (!selectedSpot) {
      toast.error('Please select a spot first');
      return;
    }
    
    if (!proximityConfirmed) {
      toast.error('Please confirm you are at the spot location');
      return;
    }
    
    // Show conditions modal - actual go-live happens in handleConditionsConfirm
    setShowConditionsModal(true);
  };
  
  // Handle conditions report confirmation - actually goes live
  // Uses two-step flow: (1) pre-upload media to /upload/conditions, (2) send URL to go-live
  // Includes automatic retry for Render cold-start resilience
  const handleConditionsConfirm = async (conditionsData) => {
    setLoading(true);
    try {
      if (onDemandActive) {
        try {
          await apiClient.post(`/photographer/${user.id}/on-demand-toggle`, { is_available: false });
          setOnDemandActive(false);
          toast.info('Switching to Live mode. On-Demand disabled.');
        } catch (odErr) {
          // Don't block go-live if on-demand toggle fails - backend will auto-disable
          logger.warn('[DutyStation] On-Demand toggle failed, backend will handle:', odErr);
        }
      }
      
      // Step 1: Pre-upload condition media via multipart form to avoid large JSON body
      let conditionMediaUrl = null;
      let conditionMediaType = conditionsData?.mediaType || null;
      let uploadWokeServer = false; // Track if the upload request woke a sleeping server
      if (conditionsData?.media instanceof Blob) {
        try {
          const ext = conditionMediaType === 'video' ? '.webm' : '.jpg';
          const mimeType = conditionMediaType === 'video' ? 'video/webm' : 'image/jpeg';
          const formData = new FormData();
          formData.append('file', conditionsData.media, `conditions${ext}`);
          formData.append('user_id', user.id);
          logger.log('[DutyStation] Pre-uploading condition media-', { size: conditionsData.media.size, type: mimeType });
          const uploadStart = Date.now();
          const uploadRes = await apiClient.post('/upload/conditions', formData, {
            headers: { 'Content-Type': undefined }, // Let browser set multipart boundary
            timeout: 60000 // 60s for large video uploads
          });
          const uploadDuration = Date.now() - uploadStart;
          conditionMediaUrl = uploadRes.data?.media_url;
          conditionMediaType = uploadRes.data?.media_type || conditionMediaType;
          logger.log('[DutyStation] Condition media uploaded:', conditionMediaUrl, `(${uploadDuration}ms)`);
          // If upload took > 10s, server was likely cold-starting - it's warm now
          if (uploadDuration > 10000) uploadWokeServer = true;
        } catch (uploadErr) {
          // Non-fatal: proceed without condition media (matches PSM pattern)
          logger.warn('[DutyStation] Condition media upload failed (non-fatal):', uploadErr.message);
          conditionMediaUrl = null;
          conditionMediaType = null;
          // Upload failure likely means server was sleeping - flag for warm-up
          uploadWokeServer = true;
        }
      }
      
      // Step 2: Build go-live request - clean JSON payload with pricing config
      // IMPORTANT: latitude/longitude must be USER's GPS position (not spot coords)
      // - the backend uses these for Hobbyist proximity checks against nearby Pros
      const goLivePayload = {
        // Core spot data
        spot_id: selectedSpot.id,
        spot_name: selectedSpot.name,
        location: selectedSpot.name,
        // User's GPS coords (for Hobbyist proximity check), fall back to spot coords
        latitude: userLocation?.lat || selectedSpot.latitude,
        longitude: userLocation?.lng || selectedSpot.longitude,
        // Session pricing - mirrors PhotographerSessionsManager
        price_per_join: pricingConfig.price_per_join,
        live_photo_price: pricingConfig.live_photo_price,
        photos_included: pricingConfig.photos_included,
        videos_included: pricingConfig.videos_included ?? 1,
        general_photo_price: pricingConfig.general_photo_price,
        photo_price_web: pricingConfig.photo_price_web,
        photo_price_standard: pricingConfig.photo_price_standard,
        photo_price_high: pricingConfig.photo_price_high,
        estimated_duration: pricingConfig.estimated_duration,
        max_surfers: pricingConfig.max_surfers,
        auto_accept: pricingConfig.auto_accept,
        // Condition media (URL only - no base64 fallback)
        condition_media_url: conditionMediaUrl || null,
        condition_media_type: conditionMediaType,
        // Spot notes
        spot_notes: conditionsData?.spotNotes || null,
        // Earnings destination (Hobbyist cause/grom allocation)
        earnings_destination_type: pricingConfig.earnings_destination_type || null,
        earnings_destination_id: pricingConfig.earnings_destination_id || null,
        earnings_cause_name: pricingConfig.earnings_cause_name || null
      };
      
      logger.log('[DutyStation] Go-live payload:', {
        ...goLivePayload,
        condition_media_url: goLivePayload.condition_media_url ? '(url set)' : null
      });
      
      // -- Go-live POST with automatic retry for cold-start resilience --
      // Render free tier drops the first request while waking up.
      // Strategy: always warm the server with a lightweight ping first,
      // then POST go-live. If that fails with no response, wait and retry.
      const MAX_ATTEMPTS = 3;
      let lastError = null;
      
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          // ALWAYS warm the server before go-live - cold starts are the #1 failure cause.
          // On attempt 1: quick ping to wake if sleeping.
          // On retries: longer wait + ping to let server finish booting.
          if (attempt > 1) {
            const retryDelay = attempt === 2 ? 5000 : 10000; // 5s, then 10s
            toast.loading(`Server waking up - retry ${attempt - 1} of ${MAX_ATTEMPTS - 1}-`, { id: 'go-live-warmup' });
            await new Promise(r => setTimeout(r, retryDelay));
          } else {
            toast.loading('Connecting to server-', { id: 'go-live-warmup' });
          }
          
          try {
            // Lightweight status check to confirm server is alive
            await apiClient.get(`/photographer/${user.id}/status`, { timeout: 30000 });
            logger.log(`[DutyStation] Server warm-up ping succeeded (attempt ${attempt})`);
          } catch (pingErr) {
            if (attempt === 1) {
              // First ping failed - server is definitely cold. Wait for it.
              logger.warn('[DutyStation] Server cold - waiting 8s for boot-', pingErr.message);
              toast.loading('Server is starting up-', { id: 'go-live-warmup' });
              await new Promise(r => setTimeout(r, 8000));
              // Try ping again after waiting
              try {
                await apiClient.get(`/photographer/${user.id}/status`, { timeout: 30000 });
                logger.log('[DutyStation] Server alive after wait');
              } catch (secondPingErr) {
                logger.warn('[DutyStation] Server still unresponsive after 8s wait:', secondPingErr.message);
              }
            } else {
              logger.warn(`[DutyStation] Warm-up ping failed on attempt ${attempt}:`, pingErr.message);
            }
          }
          toast.dismiss('go-live-warmup');
          
          const goLiveRes = await apiClient.post(`/photographer/${user.id}/go-live`, goLivePayload, {
            timeout: 120000 // 120s - matches PSM; accommodates Render cold starts
          });
          logger.log('[DutyStation] Go-live success:', goLiveRes.data?.live_session_id);
          setLiveActive(true);
          setShowConditionsModal(false);
          toast.success(`Now live at ${selectedSpot.name}!`);
          return; // ? Success - exit the function
        } catch (err) {
          lastError = err;
          toast.dismiss('go-live-warmup');
          const hasResponse = !!err.response;
          const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout');
          
          // Only retry on cold-start symptoms (no HTTP response, or timeout)
          // Do NOT retry on 4xx/5xx - those are real server errors
          if (hasResponse || attempt >= MAX_ATTEMPTS) {
            break; // Server responded with an error, or out of retries
          }
          
          // No response or timeout - server is likely still booting
          logger.warn(`[DutyStation] Go-live attempt ${attempt} failed, will retry-`, err.code, err.message);
        }
      }
      
      // If we get here, all attempts failed - surface the error from the last attempt
      throw lastError;
    } catch (error) {
      const detail = error.response?.data?.detail || '';
      const status = error.response?.status;
      logger.error('[DutyStation] Go-live failed after retries:', { status, detail, message: error.message });
      
      // Check specific statuses FIRST - before the generic detail fallback
      if (status === 413) {
        toast.error('Media file too large. Please use a shorter video or lower-quality photo.');
      } else if (status === 400 && detail.toLowerCase().includes('already')) {
        // Stale session blocking new go-live - offer recovery action
        toast.error('You have a stale live session blocking new activations.', {
          duration: 8000,
          action: {
            label: 'End Stale Session',
            onClick: () => forceEndStaleSession()
          }
        });
      } else if (status === 409) {
        toast.error('Session conflict detected. Please refresh and try again.');
      } else if (detail) {
        // Generic backend error message (covers 403 role errors, etc.)
        toast.error(`Go-live error: ${detail}`);
      } else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        toast.error('Server is warming up - please wait a moment and try again.', { duration: 6000 });
      } else if (!error.response) {
        // Exhausted retries with no server response
        logger.error('[DutyStation] No HTTP response after retries:', error.code, error.message);
        toast.error('Could not reach the server after retrying. Please check your connection and try again.', { duration: 8000 });
      } else {
        toast.error('Failed to go live. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };
  
  const handleActivateOnDemand = async () => {
    if (selectedSpots.length === 0) {
      toast.error('Please select at least one spot');
      return;
    }
    
    // Check GPS availability
    if (!gpsAvailable) {
      toast.error('GPS is required for On-Demand mode');
      return;
    }
    
    setLoading(true);
    try {
      if (liveActive) {
        await apiClient.post(`/photographer/${user.id}/end-session`);
        setLiveActive(false);
        toast.info('Switching to On-Demand mode. Live session ended.');
      }
      
      await apiClient.post(`/photographer/${user.id}/on-demand-toggle`, {
        is_available: true,
        spots: selectedSpots.map(s => ({ id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude }))
      });
      setOnDemandActive(true);
      toast.success(`On-Demand activated for ${selectedSpots.length} spot${selectedSpots.length !== 1 ? 's' : ''}!`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to activate On-Demand');
    } finally {
      setLoading(false);
    }
  };
  
  const handleDeactivateLive = async () => {
    setLoading(true);
    try {
      await apiClient.post(`/photographer/${user.id}/end-session`);
      setLiveActive(false);
      setSelectedSpot(null);
      setProximityConfirmed(false);
      toast.success('Live session ended');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to end session');
    } finally {
      setLoading(false);
    }
  };
  
  const handleDeactivateOnDemand = async () => {
    setLoading(true);
    try {
      await apiClient.post(`/photographer/${user.id}/on-demand-toggle`, { is_available: false });
      setOnDemandActive(false);
      setSelectedSpots([]);
      toast.success('On-Demand mode deactivated');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update status');
    } finally {
      setLoading(false);
    }
  };
  
  const handleActivate = mode === 'live' ? handleActivateLive : handleActivateOnDemand;
  const handleDeactivate = mode === 'live' ? handleDeactivateLive : handleDeactivateOnDemand;
  
  const config = MODE_CONFIG[mode];
  const Icon = config.icon;
  
  return (
    <Sheet open={isOpen} modal={false} onOpenChange={onClose}>
      <SheetContent 
        side="bottom"
        hideCloseButton
        className="bg-background/95 backdrop-blur-2xl border-t border-border rounded-t-3xl overflow-hidden flex flex-col p-0
          h-auto
          md:rounded-2xl md:border md:w-[600px] md:max-w-[90vw] md:max-h-[85vh] md:!bottom-4
          lg:w-[700px]"
        style={{
          bottom: 'var(--safe-bottom, 84px)',
          maxHeight: 'calc(100dvh - var(--safe-bottom, 84px) - 56px)',
        }}
      >
        {/* Drag Handle - hide on desktop */}
        <div className="flex justify-center pt-3 pb-2 md:pt-4 md:pb-3">
          <div className="w-12 h-1.5 rounded-full bg-muted-foreground/30 md:hidden" />
        </div>
        
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 pb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isActive ? config.colors.ring : 'bg-muted'}`}>
              <Icon className={`w-5 h-5 ${isActive ? config.colors.text : 'text-muted-foreground'}`} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground tracking-tight">Duty Station</h2>
              <p className="text-xs text-muted-foreground">
                {isActive 
                  ? `${mode === 'live' ? 'Live' : 'On-Demand'} - Active`
                  : 'Manage your availability'
                }
              </p>
            </div>
          </div>
          
          <button aria-label="Close"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            data-testid="duty-drawer-close"
          ><X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Scrollable Content */}
        <div 
          className="overflow-y-auto flex-1 px-4 sm:px-6 space-y-5 overscroll-contain"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 16px) + 24px)' }}
        >
          {/* Mode Selector */}
          <ModeSelector 
            selectedMode={mode}
            onModeChange={setMode}
            showOnDemand={showOnDemand}
            isActive={isActive}
            liveActive={liveActive}
            onDemandActive={onDemandActive}
          />
          
          {/* Status Card */}
          <StatusCard
            mode={mode}
            isActive={isActive}
            selectedSpot={selectedSpot}
            selectedSpots={selectedSpots}
            onToggle={isActive ? handleDeactivate : handleActivate}
            loading={loading}
            canActivate={canActivate}
          />
          
          {/* Mode-specific content */}
          {!isActive && (
            <AnimatePresence mode="wait">
              {mode === 'live' ? (
                <motion.div
                  key="live-content"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  {/* Selected Spot Display with Deselect */}
                  {selectedSpot ? (
                    <SelectedSpotDisplay 
                      spot={selectedSpot} 
                      onDeselect={handleDeselectSpot} 
                    />
                  ) : (
                    /* Spot Selector for Live */
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Navigation className="w-4 h-4 text-cyan-400" />
                        <span className="text-sm font-medium text-foreground">Select Your Spot</span>
                        <Badge className="bg-blue-500/20 text-blue-400 border-0 text-xs ml-auto">
                          Within 0.2 mi
                        </Badge>
                      </div>
                      <SpotSelector
                        selectedSpot={selectedSpot}
                        onSelectSpot={handleSelectSpot}
                        photographerTier={photographerTier}
                        disabled={false}
                        compact={false}
                      />
                    </div>
                  )}
                  
                  {/* GPS Proximity Check for Live */}
                  {selectedSpot && (
                    <GpsProximityCheck
                      selectedSpot={selectedSpot}
                      userLocation={userLocation}
                      gpsAvailable={gpsAvailable}
                      onProximityConfirmed={setProximityConfirmed}
                      onManualConfirm={handleManualConfirm}
                    />
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="ondemand-content"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  {/* GPS Warning for On-Demand */}
                  {!gpsAvailable && (
                    <GpsWarningBanner onConfirmAnyway={() => setGpsAvailable(true)} />
                  )}
                  
                  {/* Multi-spot selector for On-Demand */}
                  <div className="rounded-xl border border-border bg-card p-4">
                    <OnDemandSpotSelector
                      spots={availableSpots}
                      selectedSpots={selectedSpots}
                      onToggleSpot={handleToggleOnDemandSpot}
                      onSelectAll={handleSelectAllSpots}
                      onDeselectAll={handleDeselectAllSpots}
                      loading={spotsLoading}
                      radiusInfo={radiusConfig}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
          
          {/* Stats Preview */}
          <StatsPreview mode={mode} stats={stats} />
          
          {/* Quick Actions */}
          <QuickActions mode={mode} onClose={onClose} nearbyShooters={nearbyShooters} />
        </div>
      </SheetContent>
      
      {/* Conditions Modal - Required before going live */}
      <ConditionsModal
        isOpen={showConditionsModal}
        onClose={() => setShowConditionsModal(false)}
        onConfirm={handleConditionsConfirm}
        spotName={selectedSpot?.name}
        isLoading={loading}
      />
    </Sheet>
  );
};

// DutyStationIcon extracted to ./on-demand/DutyStationIcon.js
export { default as DutyStationIcon } from './on-demand/DutyStationIcon';

export default DutyStationDrawer;