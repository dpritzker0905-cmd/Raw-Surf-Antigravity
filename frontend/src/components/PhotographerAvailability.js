/**
 * PhotographerAvailability - Availability status and notification subscription
 * Shows: Live Active Shooting, On-Demand, Booking availability
 * "Notify Me" feature for unavailable services using OneSignal
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { 
  Radio, Calendar, Bell, BellOff, Loader2,
  MapPin, Camera, ChevronRight, Zap
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { 
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from './ui/drawer';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { toast } from 'sonner';
import { useMediaQuery } from '../hooks/useMediaQuery';
import logger from '../utils/logger';


// Availability status types
const AVAILABILITY_TYPES = {
  LIVE: 'live_shooting',
  ON_DEMAND: 'on_demand',
  BOOKING: 'scheduled_booking'
};

// Status display config
const STATUS_CONFIG = {
  [AVAILABILITY_TYPES.LIVE]: {
    label: 'Live Active Shooting',
    description: 'Photographer is currently shooting at a spot',
    icon: Radio,
    activeColor: 'text-red-400',
    activeBg: 'bg-red-500/20',
    inactiveColor: 'text-gray-400',
    inactiveBg: 'bg-zinc-800'
  },
  [AVAILABILITY_TYPES.ON_DEMAND]: {
    label: 'On-Demand',
    description: 'Available for immediate dispatch to your location',
    icon: Zap,
    activeColor: 'text-green-400',
    activeBg: 'bg-green-500/20',
    inactiveColor: 'text-gray-400',
    inactiveBg: 'bg-zinc-800'
  },
  [AVAILABILITY_TYPES.BOOKING]: {
    label: 'Scheduled Booking',
    description: 'Available for advance session booking',
    icon: Calendar,
    activeColor: 'text-cyan-400',
    activeBg: 'bg-cyan-500/20',
    inactiveColor: 'text-gray-400',
    inactiveBg: 'bg-zinc-800'
  }
};

/**
 * Availability status row with notification toggle
 */
const AvailabilityRow = ({ 
  type, 
  isAvailable, 
  spotName,
  isSubscribed,
  onSubscribe,
  onAction,
  loading,
  isLight
}) => {
  const config = STATUS_CONFIG[type];
  const Icon = config.icon;
  
  return (
    <div 
      className={`p-4 rounded-xl ${isLight ? 'bg-gray-50' : 'bg-zinc-800/50'} ${
        isAvailable ? 'ring-2 ring-green-500/30' : ''
      }`}
      data-testid={`availability-${type}`}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`p-2 rounded-lg ${isAvailable ? config.activeBg : config.inactiveBg}`}>
          <Icon className={`w-5 h-5 ${isAvailable ? config.activeColor : config.inactiveColor}`} />
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className={`font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>
              {config.label}
            </h4>
            {isAvailable ? (
              <Badge className="bg-green-500/20 text-green-400 text-xs">
                Available
              </Badge>
            ) : (
              <Badge className={`${isLight ? 'bg-gray-200 text-gray-600' : 'bg-zinc-700 text-gray-400'} text-xs`}>
                Unavailable
              </Badge>
            )}
          </div>
          
          <p className={`text-sm ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
            {config.description}
          </p>
          
          {/* Live spot info */}
          {type === AVAILABILITY_TYPES.LIVE && isAvailable && spotName && (
            <div className="flex items-center gap-1 mt-2 text-sm text-red-400">
              <MapPin className="w-3 h-3" />
              <span>Currently at {spotName}</span>
            </div>
          )}
          
          {/* On-Demand spot info */}
          {type === AVAILABILITY_TYPES.ON_DEMAND && isAvailable && spotName && (
            <div className="flex items-center gap-1 mt-2 text-sm text-green-400">
              <MapPin className="w-3 h-3" />
              <span>Available near {spotName}</span>
            </div>
          )}
        </div>
        
        {/* Action Button */}
        <div className="shrink-0">
          {isAvailable ? (
            <Button
              size="sm"
              onClick={() => onAction(type)}
              className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white"
              data-testid={`action-${type}`}
            >
              {type === AVAILABILITY_TYPES.LIVE ? 'Watch' : 
               type === AVAILABILITY_TYPES.ON_DEMAND ? 'Request' : 'Book'}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant={isSubscribed ? "secondary" : "outline"}
              onClick={() => onSubscribe(type, !isSubscribed)}
              disabled={loading}
              className={isSubscribed 
                ? `${isLight ? 'bg-gray-200 text-gray-700' : 'bg-zinc-700 text-white'}`
                : `${isLight ? 'border-gray-300 text-gray-700' : 'border-zinc-600 text-white'}`
              }
              data-testid={`notify-${type}`}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isSubscribed ? (
                <>
                  <BellOff className="w-4 h-4 mr-1" />
                  Unsubscribe
                </>
              ) : (
                <>
                  <Bell className="w-4 h-4 mr-1" />
                  Notify Me
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Main Photographer Availability Component
 */
export const PhotographerAvailability = ({ 
  photographerId,
  photographerName,
  onWatchLive,
  onRequestOnDemand,
  onBook,
  trigger
}) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const isMobile = useMediaQuery('(max-width: 768px)');
  
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [subscribeLoading, setSubscribeLoading] = useState(null);
  
  // Availability states
  const [availability, setAvailability] = useState({
    [AVAILABILITY_TYPES.LIVE]: { available: false, spot_name: null },
    [AVAILABILITY_TYPES.ON_DEMAND]: { available: false },
    [AVAILABILITY_TYPES.BOOKING]: { available: true }  // Always available for booking
  });
  
  // Notification subscriptions
  const [subscriptions, setSubscriptions] = useState({
    [AVAILABILITY_TYPES.LIVE]: false,
    [AVAILABILITY_TYPES.ON_DEMAND]: false,
    [AVAILABILITY_TYPES.BOOKING]: false
  });
  
  // Fetch availability status
  useEffect(() => {
    if (open && photographerId) {
      fetchAvailability();
      if (user?.id) {
        fetchSubscriptions();
      }
    }
  }, [open, photographerId, user?.id]);
  
  const fetchAvailability = async () => {
    setLoading(true);
    try {
      // Check if photographer is live (using photographer status endpoint)
      const statusResponse = await apiClient.get(`/photographer/${photographerId}/status`);
      const isLive = statusResponse.data?.is_shooting || false;
      const spotName = statusResponse.data?.current_spot_name || null;
      
      // Check on-demand status using dedicated endpoint
      const onDemandResponse = await apiClient.get(`/photographer/${photographerId}/on-demand-status`);
      const isOnDemand = onDemandResponse.data?.is_available || false;
      const onDemandSpotName = onDemandResponse.data?.spot_name || onDemandResponse.data?.city || null;
      
      // Check booking availability from profile
      let acceptsBookings = true;
      try {
        const profileResponse = await apiClient.get(`/profile/${photographerId}`);
        acceptsBookings = profileResponse.data?.accepts_bookings !== false;
      } catch (e) {
        // Default to true if profile fetch fails
      }
      
      setAvailability({
        [AVAILABILITY_TYPES.LIVE]: { available: isLive, spot_name: spotName },
        [AVAILABILITY_TYPES.ON_DEMAND]: { available: isOnDemand, spot_name: onDemandSpotName },
        [AVAILABILITY_TYPES.BOOKING]: { available: acceptsBookings }
      });
    } catch (error) {
      logger.error('Error fetching availability:', error);
      // Default states on error
      setAvailability({
        [AVAILABILITY_TYPES.LIVE]: { available: false, spot_name: null },
        [AVAILABILITY_TYPES.ON_DEMAND]: { available: false },
        [AVAILABILITY_TYPES.BOOKING]: { available: true }
      });
    } finally {
      setLoading(false);
    }
  };
  
  const fetchSubscriptions = async () => {
    try {
      const response = await apiClient.get(
        `/notifications/photographer-alerts/${photographerId}?user_id=${user.id}`
      );
      setSubscriptions(response.data || {});
    } catch (error) {
      // Subscriptions endpoint may not exist yet
      logger.debug('Could not fetch subscriptions');
    }
  };
  
  const handleSubscribe = async (type, subscribe) => {
    if (!user?.id) {
      toast.error('Please log in to receive notifications');
      return;
    }
    
    setSubscribeLoading(type);
    try {
      if (subscribe) {
        // Subscribe to notifications
        await apiClient.post(`/notifications/photographer-alerts`, {
          user_id: user.id,
          photographer_id: photographerId,
          alert_type: type
        });
        toast.success(`You'll be notified when ${photographerName} is available for ${STATUS_CONFIG[type].label}`);
      } else {
        // Unsubscribe
        await apiClient.delete(
          `/notifications/photographer-alerts/${photographerId}?user_id=${user.id}&alert_type=${type}`
        );
        toast.success('Notification unsubscribed');
      }
      
      setSubscriptions(prev => ({
        ...prev,
        [type]: subscribe
      }));
    } catch (error) {
      toast.error('Failed to update notification preferences');
    } finally {
      setSubscribeLoading(null);
    }
  };
  
  const handleAction = (type) => {
    setOpen(false);
    switch (type) {
      case AVAILABILITY_TYPES.LIVE:
        onWatchLive?.();
        break;
      case AVAILABILITY_TYPES.ON_DEMAND:
        onRequestOnDemand?.();
        break;
      case AVAILABILITY_TYPES.BOOKING:
        onBook?.();
        break;
    }
  };
  
  // Content component (shared between Drawer and Dialog)
  const AvailabilityContent = () => (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      ) : (
        <>
          <AvailabilityRow
            type={AVAILABILITY_TYPES.LIVE}
            isAvailable={availability[AVAILABILITY_TYPES.LIVE].available}
            spotName={availability[AVAILABILITY_TYPES.LIVE].spot_name}
            isSubscribed={subscriptions[AVAILABILITY_TYPES.LIVE]}
            onSubscribe={handleSubscribe}
            onAction={handleAction}
            loading={subscribeLoading === AVAILABILITY_TYPES.LIVE}
            isLight={isLight}
          />
          
          <AvailabilityRow
            type={AVAILABILITY_TYPES.ON_DEMAND}
            isAvailable={availability[AVAILABILITY_TYPES.ON_DEMAND].available}
            spotName={availability[AVAILABILITY_TYPES.ON_DEMAND].spot_name}
            isSubscribed={subscriptions[AVAILABILITY_TYPES.ON_DEMAND]}
            onSubscribe={handleSubscribe}
            onAction={handleAction}
            loading={subscribeLoading === AVAILABILITY_TYPES.ON_DEMAND}
            isLight={isLight}
          />
          
          <AvailabilityRow
            type={AVAILABILITY_TYPES.BOOKING}
            isAvailable={availability[AVAILABILITY_TYPES.BOOKING].available}
            isSubscribed={subscriptions[AVAILABILITY_TYPES.BOOKING]}
            onSubscribe={handleSubscribe}
            onAction={handleAction}
            loading={subscribeLoading === AVAILABILITY_TYPES.BOOKING}
            isLight={isLight}
          />
        </>
      )}
    </div>
  );
  
  // Render Drawer on mobile, Dialog on desktop
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          {trigger}
        </DrawerTrigger>
        <DrawerContent className={isLight ? 'bg-white' : 'bg-zinc-900'}>
          <DrawerHeader>
            <DrawerTitle className={isLight ? 'text-gray-900' : 'text-white'}>
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-cyan-400" />
                {photographerName}'s Availability
              </div>
            </DrawerTitle>
            <DrawerDescription className={isLight ? 'text-gray-500' : 'text-gray-400'}>
              Check availability or subscribe to notifications
            </DrawerDescription>
          </DrawerHeader>
          
          <div className="px-4 pb-4">
            <AvailabilityContent />
          </div>
          
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline" className={isLight ? 'border-gray-300' : 'border-zinc-600'}>
                Close
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }
  
  // Desktop: Dialog
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger}
      </DialogTrigger>
      <DialogContent className={`${isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-800'} max-w-md`} aria-describedby="photographer-availability-description">
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${isLight ? 'text-gray-900' : 'text-white'}`}>
            <Camera className="w-5 h-5 text-cyan-400" />
            {photographerName}'s Availability
          </DialogTitle>
          <DialogDescription id="photographer-availability-description" className={isLight ? 'text-gray-500' : 'text-gray-400'}>
            Check availability or subscribe to notifications
          </DialogDescription>
        </DialogHeader>
        
        <div className="mt-4">
          <AvailabilityContent />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PhotographerAvailability;
