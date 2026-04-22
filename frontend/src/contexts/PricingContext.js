import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';


// Pricing Context for dynamic, reactive gallery pricing
const PricingContext = createContext(null);

export const usePricing = () => {
  const context = useContext(PricingContext);
  if (!context) {
    throw new Error('usePricing must be used within a PricingProvider');
  }
  return context;
};

/**
 * Smart Price Calculation Function
 * Priority order:
 * 1. Custom price (manual override on the item)
 * 2. Session price (if viewing items from an active session)
 * 3. Base price (photographer's general gallery pricing)
 */
export const calculateDisplayPrice = (mediaItem, sessionPricing, generalSettings, qualityTier = 'standard') => {
  // Rule 1: Custom price override takes priority
  if (mediaItem?.custom_price !== null && mediaItem?.custom_price !== undefined && mediaItem.custom_price > 0) {
    return {
      price: mediaItem.custom_price,
      source: 'custom',
      label: 'Fixed Price'
    };
  }

  // Rule 2: Session-specific pricing (for items from live sessions)
  if (sessionPricing?.is_active) {
    const isVideo = mediaItem?.media_type === 'video';
    const sessionPrice = isVideo ? sessionPricing.session_video_price : sessionPricing.session_photo_price;
    if (sessionPrice !== null && sessionPrice !== undefined) {
      return {
        price: sessionPrice,
        source: 'session',
        label: 'Session Price'
      };
    }
  }

  // Rule 3: Base price from general settings
  if (generalSettings) {
    const isVideo = mediaItem?.media_type === 'video';
    let basePrice;
    
    if (isVideo) {
      switch (qualityTier) {
        case '720p':
          basePrice = generalSettings.video_price_720p;
          break;
        case '1080p':
          basePrice = generalSettings.video_price_1080p;
          break;
        case '4k':
          basePrice = generalSettings.video_price_4k;
          break;
        default:
          basePrice = generalSettings.video_price_1080p;
      }
    } else {
      switch (qualityTier) {
        case 'web':
          basePrice = generalSettings.photo_price_web;
          break;
        case 'standard':
          basePrice = generalSettings.photo_price_standard;
          break;
        case 'high':
          basePrice = generalSettings.photo_price_high;
          break;
        default:
          basePrice = generalSettings.photo_price_standard;
      }
    }
    
    return {
      price: basePrice || mediaItem?.price || 5,
      source: 'base',
      label: 'Gallery Price'
    };
  }

  // Fallback to item's default price
  return {
    price: mediaItem?.price || 5,
    source: 'default',
    label: 'Default'
  };
};

export const PricingProvider = ({ children }) => {
  const { user } = useAuth();
  const [generalSettings, setGeneralSettings] = useState(null);
  const [sessionPricing, setSessionPricing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(Date.now());

  // Fetch photographer's general pricing settings
  const fetchGeneralSettings = useCallback(async () => {
    if (!user?.id) return;
    
    const isPhotographer = ['Grom Parent', 'Hobbyist', 'Photographer', 'Approved Pro'].includes(user?.role);
    if (!isPhotographer) {
      setLoading(false);
      return;
    }

    try {
      const res = await apiClient.get(`/photographer/${user.id}/gallery-pricing`);
      const sp = res.data.session_pricing || {};
      const od = res.data.on_demand_pricing || {};
      const ls = res.data.live_session_pricing || {};
      const bk = res.data.booking_pricing || {};

      setGeneralSettings({
        // ── Gallery (general) pricing ──
        photo_price_web: res.data.photo_pricing?.web || 3,
        photo_price_standard: res.data.photo_pricing?.standard || 5,
        photo_price_high: res.data.photo_pricing?.high || 10,
        video_price_720p: res.data.video_pricing?.['720p'] || 8,
        video_price_1080p: res.data.video_pricing?.['1080p'] || 15,
        video_price_4k: res.data.video_pricing?.['4k'] || 30,

        // ── Session-level metadata (included counts, buy-in, etc.) ──
        on_demand_photo_price: sp.on_demand_photo_price || 10,
        on_demand_photos_included: sp.on_demand_photos_included || 3,
        on_demand_videos_included: sp.on_demand_videos_included || 0,
        on_demand_full_gallery: sp.on_demand_full_gallery || false,
        live_session_photo_price: sp.live_session_photo_price || 5,
        live_session_photos_included: sp.live_session_photos_included || 3,
        live_session_videos_included: sp.live_session_videos_included || 0,
        live_session_full_gallery: sp.live_session_full_gallery || false,
        booking_hourly_rate: sp.booking_hourly_rate || 50,
        booking_photos_included: sp.booking_photos_included || 3,
        booking_videos_included: sp.booking_videos_included || 0,
        booking_full_gallery: sp.booking_full_gallery || false,
        on_demand_hourly_rate: sp.on_demand_hourly_rate || 75,
        // Booking advanced settings (display-only in Gallery Hub)
        booking_min_hours: sp.booking_min_hours || 1,
        charges_travel_fees: sp.charges_travel_fees || false,
        service_radius_miles: sp.service_radius_miles || 25,
        group_discount_2_plus: sp.group_discount_2_plus || 0,
        group_discount_3_plus: sp.group_discount_3_plus || 0,
        group_discount_5_plus: sp.group_discount_5_plus || 0,

        // ── On-Demand independent resolution pricing ──
        on_demand_price_web: od.photo_web || 5,
        on_demand_price_standard: od.photo_standard || 10,
        on_demand_price_high: od.photo_high || 18,
        on_demand_video_720p: od.video_720p || 12,
        on_demand_video_1080p: od.video_1080p || 20,
        on_demand_video_4k: od.video_4k || 40,

        // ── Live Session independent resolution pricing ──
        live_price_web: ls.photo_web || 3,
        live_price_standard: ls.photo_standard || 6,
        live_price_high: ls.photo_high || 12,
        live_video_720p: ls.video_720p || 8,
        live_video_1080p: ls.video_1080p || 15,
        live_video_4k: ls.video_4k || 30,

        // ── Booking independent resolution pricing ──
        booking_price_web: bk.photo_web || 3,
        booking_price_standard: bk.photo_standard || 5,
        booking_price_high: bk.photo_high || 10,
        booking_video_720p: bk.video_720p || 8,
        booking_video_1080p: bk.video_1080p || 15,
        booking_video_4k: bk.video_4k || 30,
      });
      setLastUpdated(Date.now());
    } catch (e) {
      logger.error('Error fetching gallery pricing:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.id, user?.role]);

  // Fetch active session pricing if photographer is live
  const fetchSessionPricing = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      const res = await apiClient.get(`/photographer/${user.id}/active-session`);
      if (res.data && res.data.id) {
        setSessionPricing({
          is_active: true,
          session_id: res.data.id,
          session_photo_price: res.data.session_photo_price,
          session_video_price: res.data.session_video_price
        });
      } else {
        setSessionPricing({ is_active: false });
      }
    } catch (e) {
      setSessionPricing({ is_active: false });
    }
  }, [user?.id]);

  useEffect(() => {
    fetchGeneralSettings();
    fetchSessionPricing();
  }, [fetchGeneralSettings, fetchSessionPricing]);

  // Update pricing settings (called after photographer saves new prices)
  const updateGeneralSettings = useCallback(async (newSettings) => {
    try {
      await apiClient.put(`/photographer/${user.id}/gallery-pricing`, newSettings);
      // Merge new settings into existing state
      setGeneralSettings(prev => ({ ...prev, ...newSettings }));
      setLastUpdated(Date.now());
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.detail || 'Failed to update pricing' };
    }
  }, [user?.id]);

  // Set custom price for a single item
  const setItemCustomPrice = useCallback(async (itemId, customPrice) => {
    try {
      const res = await apiClient.patch(
        `/gallery/item/${itemId}/custom-price?photographer_id=${user.id}`,
        { custom_price: customPrice }
      );
      setLastUpdated(Date.now());
      return { success: true, data: res.data };
    } catch (error) {
      return { success: false, error: error.response?.data?.detail || 'Failed to set custom price' };
    }
  }, [user?.id]);

  // Clear custom price (revert to general pricing)
  const clearItemCustomPrice = useCallback(async (itemId) => {
    return setItemCustomPrice(itemId, 0);
  }, [setItemCustomPrice]);

  // Calculate display price for an item
  const getDisplayPrice = useCallback((mediaItem, qualityTier = 'standard') => {
    return calculateDisplayPrice(mediaItem, sessionPricing, generalSettings, qualityTier);
  }, [sessionPricing, generalSettings]);

  // Force refresh all pricing
  const refreshPricing = useCallback(() => {
    fetchGeneralSettings();
    fetchSessionPricing();
  }, [fetchGeneralSettings, fetchSessionPricing]);

  const value = {
    generalSettings,
    sessionPricing,
    loading,
    lastUpdated,
    updateGeneralSettings,
    setItemCustomPrice,
    clearItemCustomPrice,
    getDisplayPrice,
    refreshPricing,
    _refreshPricing: refreshPricing,
    calculateDisplayPrice: (item, tier) => calculateDisplayPrice(item, sessionPricing, generalSettings, tier)
  };

  return (
    <PricingContext.Provider value={value}>
      {children}
    </PricingContext.Provider>
  );
};

export default PricingContext;
