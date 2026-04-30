import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';
import { toast } from 'sonner';

/**
 * Manages Quick Book (on-demand + scheduled) booking flow.
 * Extracted from Profile.js to reduce god-component complexity.
 *
 * @param {Object|null} user - Authenticated user object
 * @param {string|null} profileUserId - The photographer's profile ID
 * @param {Object|null} profile - The photographer's profile data
 */
export function useProfileQuickBook(user, profileUserId, profile) {
  const navigate = useNavigate();

  const [showQuickBookModal, setShowQuickBookModal] = useState(false);
  const [quickBookType, setQuickBookType] = useState('on-demand');
  const [quickBookDuration, setQuickBookDuration] = useState(1);
  const [quickBookLoading, setQuickBookLoading] = useState(false);
  const [photographerPricing, setPhotographerPricing] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [showScheduledBookingDrawer, setShowScheduledBookingDrawer] = useState(false);

  const fetchPhotographerPricing = async () => {
    if (!profileUserId) return;
    try {
      const res = await apiClient.get(`/photographer/${profileUserId}/pricing`);
      setPhotographerPricing(res.data);
    } catch (e) {
      logger.error('Error fetching photographer pricing:', e);
    }
  };

  const getUserLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        (error) => {
          logger.debug('Geolocation error:', error);
        }
      );
    }
  };

  const handleQuickBookOpen = (type) => {
    if (type === 'scheduled') {
      fetchPhotographerPricing();
      setShowScheduledBookingDrawer(true);
    } else {
      setQuickBookType(type);
      setQuickBookDuration(1);
      fetchPhotographerPricing();
      getUserLocation();
      setShowQuickBookModal(true);
    }
  };

  const handleQuickBookSubmit = async () => {
    if (!user) {
      toast.error('Please log in to book');
      return;
    }

    setQuickBookLoading(true);
    try {
      if (quickBookType === 'on-demand') {
        await apiClient.post(`/dispatch/request?requester_id=${user.id}`, {
          latitude: userLocation?.latitude || 0,
          longitude: userLocation?.longitude || 0,
          estimated_duration_hours: quickBookDuration,
          is_immediate: true,
          target_photographer_id: profileUserId
        });
        toast.success('On-Demand request sent!');
        setShowQuickBookModal(false);
      } else {
        navigate('/bookings', {
          state: {
            selectedPhotographer: profileUserId,
            bookingDuration: quickBookDuration,
            fromQuickBook: true
          }
        });
        setShowQuickBookModal(false);
      }
    } catch (error) {
      const detail = error.response?.data?.detail;
      if (detail && detail.includes('not currently available')) {
        toast.error('Photographer is currently off-duty. Try scheduling a session instead.');
      } else {
        toast.error(detail || 'Failed to process booking');
      }
    } finally {
      setQuickBookLoading(false);
    }
  };

  // Computed pricing
  const quickBookHourlyRate = quickBookType === 'on-demand'
    ? (photographerPricing?.on_demand_hourly_rate || profile?.on_demand_hourly_rate || 75)
    : (photographerPricing?.booking_hourly_rate || 75);
  const quickBookTotal = quickBookHourlyRate * quickBookDuration;

  return {
    showQuickBookModal, setShowQuickBookModal,
    quickBookType,
    quickBookDuration, setQuickBookDuration,
    quickBookLoading,
    photographerPricing,
    showScheduledBookingDrawer, setShowScheduledBookingDrawer,
    quickBookHourlyRate,
    quickBookTotal,
    handleQuickBookOpen,
    handleQuickBookSubmit,
    fetchPhotographerPricing,
  };
}
