import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../lib/apiClient';
import { Users, Activity } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { ROLES } from '../constants/roles';
import SurferHubContent from './session-hub/SurferHubContent';
import PhotographerHubContent from './session-hub/PhotographerHubContent';



/**
 * SurferSessionHub - Consolidated Session Hub for ALL Users
 * 
 * Mobile: Opens as a bottom drawer (Sheet)
 * Desktop: Opens as a popover
 * 
 * For Surfers:
 * - Live Sessions: Browse active photographers
 * - On-Demand: Request a Pro (GPS-based)
 * - Bookings: View upcoming sessions and receipts
 * 
 * For Photographers ("Active Duty" Console):
 * - Go On-Demand: Toggle availability with spot selection
 * - Go Live: Start active shooting session
 * - Other Shooters: See who's nearby
 * - Scheduled Sessions: Today's agenda only
 */




// Mobile Drawer Version
const MobileSessionHub = ({ 
  children, 
  liveCount, 
  upcomingBookings, 
  aiMatchCount,
  isPhotographer, 
  onDemandActive, 
  onToggleOnDemand, 
  selectedSpot,
  onSelectSpot,
  photographerTier,
  showSpotSelector,
  setShowSpotSelector,
  pendingToggle,
  onConfirmToggle,
  // Go Live props
  liveActive,
  selectedLiveSpot,
  onSelectLiveSpot,
  showLiveSpotSelector,
  setShowLiveSpotSelector,
  onGoLive,
  // GPS props
  gpsStatus,
  spotsLoaded
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {children}
      </SheetTrigger>
      <SheetContent 
        side="bottom" 
        className="bg-background border-border rounded-t-3xl h-auto sheet-safe-bottom overflow-hidden flex flex-col"
      >
        <SheetHeader className="pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-foreground flex items-center gap-2 text-base">
              {isPhotographer ? (
                <>
                  <Activity className="w-5 h-5 text-yellow-400" />
                  Active Duty
                </>
              ) : (
                <>
                  <Users className="w-5 h-5 text-cyan-400" />
                  Session Hub
                </>
              )}
            </SheetTitle>
            {/* GPS Status - Header aligned right */}
            {gpsStatus && !spotsLoaded && (
              <div className="flex items-center gap-1.5 text-xs text-cyan-400 animate-pulse">
                <span>{String.fromCodePoint(0x1F3C4)}</span>
                <span>{gpsStatus}</span>
              </div>
            )}
          </div>
        </SheetHeader>
        {/* Scrollable Content Area - with extra bottom padding for last item visibility */}
        <div className="overflow-y-auto flex-1 pb-8 -mx-6 px-6 overscroll-contain touch-pan-y">
          {isPhotographer ? (
            <PhotographerHubContent 
              onClose={() => setOpen(false)} 
              navigate={navigate}
              liveCount={liveCount}
              onDemandActive={onDemandActive}
              onToggleOnDemand={onToggleOnDemand}
              selectedSpot={selectedSpot}
              onSelectSpot={onSelectSpot}
              photographerTier={photographerTier}
              showSpotSelector={showSpotSelector}
              setShowSpotSelector={setShowSpotSelector}
              pendingToggle={pendingToggle}
              onConfirmToggle={onConfirmToggle}
              liveActive={liveActive}
              selectedLiveSpot={selectedLiveSpot}
              onSelectLiveSpot={onSelectLiveSpot}
              showLiveSpotSelector={showLiveSpotSelector}
              setShowLiveSpotSelector={setShowLiveSpotSelector}
              onGoLive={onGoLive}
            />
          ) : (
            <SurferHubContent 
              onClose={() => setOpen(false)} 
              navigate={navigate}
              liveCount={liveCount}
              upcomingBookings={upcomingBookings}
              aiMatchCount={aiMatchCount}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

// Desktop Popover Version
const DesktopSessionHub = ({ 
  children, 
  liveCount, 
  upcomingBookings, 
  aiMatchCount,
  isPhotographer, 
  onDemandActive, 
  onToggleOnDemand, 
  selectedSpot,
  onSelectSpot,
  photographerTier,
  showSpotSelector,
  setShowSpotSelector,
  pendingToggle,
  onConfirmToggle,
  // Go Live props
  liveActive,
  selectedLiveSpot,
  onSelectLiveSpot,
  showLiveSpotSelector,
  setShowLiveSpotSelector,
  onGoLive,
  // GPS props
  gpsStatus,
  spotsLoaded
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent 
        className="w-96 bg-background border-border p-3 max-h-[calc(100dvh-6rem)] md:max-h-[70vh] overflow-y-auto"
        align="end"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-foreground font-medium flex items-center gap-2 text-sm">
            {isPhotographer ? (
              <>
                <Activity className="w-4 h-4 text-yellow-400" />
                Active Duty
              </>
            ) : (
              <>
                <Users className="w-4 h-4 text-cyan-400" />
                Session Hub
              </>
            )}
          </h3>
          {/* GPS Status - Header aligned right */}
          {gpsStatus && !spotsLoaded && (
            <div className="flex items-center gap-1.5 text-xs text-cyan-400 animate-pulse">
                <span>{String.fromCodePoint(0x1F3C4)}</span>
              <span>{gpsStatus}</span>
            </div>
          )}
        </div>
        {isPhotographer ? (
          <PhotographerHubContent 
            onClose={() => setOpen(false)} 
            navigate={navigate}
            liveCount={liveCount}
            onDemandActive={onDemandActive}
            onToggleOnDemand={onToggleOnDemand}
            selectedSpot={selectedSpot}
            onSelectSpot={onSelectSpot}
            photographerTier={photographerTier}
            showSpotSelector={showSpotSelector}
            setShowSpotSelector={setShowSpotSelector}
            pendingToggle={pendingToggle}
            onConfirmToggle={onConfirmToggle}
            liveActive={liveActive}
            selectedLiveSpot={selectedLiveSpot}
            onSelectLiveSpot={onSelectLiveSpot}
            showLiveSpotSelector={showLiveSpotSelector}
            setShowLiveSpotSelector={setShowLiveSpotSelector}
            onGoLive={onGoLive}
          />
        ) : (
          <SurferHubContent 
            onClose={() => setOpen(false)} 
            navigate={navigate}
            liveCount={liveCount}
            upcomingBookings={upcomingBookings}
            aiMatchCount={aiMatchCount}
          />
        )}
      </PopoverContent>
    </Popover>
  );
};

// Main Export - Responsive Container
export const SurferSessionHub = ({ children, isPhotographer = false }) => {
  const { user } = useAuth();
  const [liveCount, setLiveCount] = useState(0);
  const [upcomingBookings, setUpcomingBookings] = useState(0);
  const [aiMatchCount, setAiMatchCount] = useState(0);
  const [onDemandActive, setOnDemandActive] = useState(false);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [showSpotSelector, setShowSpotSelector] = useState(false);
  const [pendingToggle, setPendingToggle] = useState(false);
  
  // Go Live state
  const [liveActive, setLiveActive] = useState(false);
  const [selectedLiveSpot, setSelectedLiveSpot] = useState(null);
  const [showLiveSpotSelector, setShowLiveSpotSelector] = useState(false);
  
  // GPS status for header display
  const [gpsStatus, setGpsStatus] = useState(null);
  const [spotsLoaded, setSpotsLoaded] = useState(false);
  
  // Determine photographer tier for radius filtering
  const photographerTier = user?.role === ROLES.APPROVED_PRO || user?.is_approved_pro 
    ? 'pro' 
    : user?.role === ROLES.PRO 
      ? 'pro' 
      : 'standard';

  useEffect(() => {
    fetchLiveCount();
    if (user?.id) {
      fetchUpcomingBookings();
      // Fetch AI match count for surfers (TICKET-007)
      if (!isPhotographer) {
        fetchAiMatchCount();
      }
      if (isPhotographer) {
        fetchOnDemandStatus();
        fetchLiveStatus();
        // Initialize GPS tracking
        initGpsTracking();
      }
    }
  }, [user?.id, isPhotographer]);

  // Fetch AI match count from claim queue (TICKET-007)
  const fetchAiMatchCount = async () => {
    try {
      const response = await apiClient.get(`/surfer-gallery/claim-queue-count/${user.id}`);
      setAiMatchCount(response.data.pending_count || 0);
    } catch (error) {
      logger.debug('Failed to fetch AI match count:', error);
    }
  };

  // GPS tracking for header status
  const initGpsTracking = () => {
    if (navigator.geolocation) {
      setGpsStatus('Getting location...');
      navigator.geolocation.getCurrentPosition(
        (_position) => {
          setGpsStatus(null);
          setSpotsLoaded(true);
        },
        (_error) => {
          setGpsStatus('Location unavailable');
          setTimeout(() => setGpsStatus(null), 3000);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  };

  const fetchLiveCount = async () => {
    try {
      const response = await apiClient.get(`/photographers/live`);
      setLiveCount(response.data.length || 0);
    } catch (error) {
      logger.error('Failed to fetch live count:', error);
    }
  };

  const fetchUpcomingBookings = async () => {
    try {
      // Correct backend route: /bookings/user/{id} (not /bookings/surfer/{id})
      const response = await apiClient.get(`/bookings/user/${user.id}`);
      const upcoming = (response.data || []).filter(b => 
        b.status === 'confirmed' && new Date(b.session_date) > new Date()
      );
      setUpcomingBookings(upcoming.length);
    } catch (error) {
      logger.error('Failed to fetch bookings:', error);
    }
  };

  const fetchOnDemandStatus = async () => {
    try {
      const response = await apiClient.get(`/photographer/${user.id}/on-demand-status`);
      const data = response.data;
      setOnDemandActive(data?.is_available || false);
      
      // Build spot object from response
      if (data?.spot_name || data?.spot_id) {
        setSelectedSpot({
          id: data.spot_id,
          name: data.spot_name || data.city,
          latitude: data.latitude,
          longitude: data.longitude
        });
      } else if (data?.city && data?.is_available) {
        // Fallback: use city as spot name
        setSelectedSpot({
          name: data.city,
          latitude: data.latitude,
          longitude: data.longitude
        });
      }
    } catch (error) {
      logger.error('Failed to fetch on-demand status:', error);
    }
  };

  const fetchLiveStatus = async () => {
    try {
      const response = await apiClient.get(`/photographer/${user.id}/status`);
      const data = response.data;
      setLiveActive(data?.is_shooting || false);
      if (data?.current_spot_name || data?.current_spot_id) {
        setSelectedLiveSpot({
          id: data.current_spot_id,
          name: data.current_spot_name
        });
      }
    } catch (error) {
      logger.error('Failed to fetch live status:', error);
    }
  };

  const handleSelectSpot = useCallback((spot) => {
    setSelectedSpot(spot);
    setPendingToggle(true);
  }, []);
  
  const handleSelectLiveSpot = useCallback((spot) => {
    setSelectedLiveSpot(spot);
  }, []);

  const handleGoLive = async (spot) => {
    // If spot is null, end the live session
    if (spot === null) {
      try {
        await apiClient.post(`/photographer/${user.id}/end-session`);
        setLiveActive(false);
        setSelectedLiveSpot(null);
        setShowLiveSpotSelector(false);
        toast.success('Live session ended');
        fetchLiveCount();
      } catch (error) {
        toast.error('Failed to end session');
      }
      return;
    }
    
    if (!spot) {
      toast.error('Please select a spot first');
      return;
    }
    
    try {
      // MUTUAL EXCLUSION: Turn off On-Demand if active
      if (onDemandActive) {
        await apiClient.post(`/photographer/${user.id}/on-demand-toggle`, {
          is_available: false
        });
        setOnDemandActive(false);
        setSelectedSpot(null);
        toast.info('Switching to Live mode. On-Demand disabled.');
      }
      
      await apiClient.post(`/photographer/${user.id}/go-live`, {
        spot_id: spot.id,
        spot_name: spot.name,
        latitude: spot.latitude,
        longitude: spot.longitude
      });
      setLiveActive(true);
      setShowLiveSpotSelector(false);
      toast.success(`Now live at ${spot.name}!`);
      // Refresh live count
      fetchLiveCount();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to go live');
    }
  };

  const handleToggleOnDemand = async () => {
    // If turning off, just toggle
    if (onDemandActive) {
      try {
        await apiClient.post(`/photographer/${user.id}/on-demand-toggle`, {
          is_available: false
        });
        setOnDemandActive(false);
        setSelectedSpot(null);
        toast.success('On-Demand mode deactivated');
      } catch (error) {
        toast.error(error.response?.data?.detail || 'Failed to update status');
      }
      return;
    }
    
    // If turning on without a spot, show selector
    if (!selectedSpot) {
      setShowSpotSelector(true);
      return;
    }
    
    // MUTUAL EXCLUSION: Turn off Live if active
    if (liveActive) {
      try {
        await apiClient.post(`/photographer/${user.id}/end-session`);
        setLiveActive(false);
        setSelectedLiveSpot(null);
        toast.info('Switching to On-Demand mode. Live session ended.');
      } catch (error) {
        // Continue anyway
      }
    }
    
    // Activate with selected spot
    handleConfirmToggle();
  };

  const handleConfirmToggle = async () => {
    if (!selectedSpot) {
      toast.error('Please select a spot first');
      return;
    }
    
    try {
      await apiClient.post(`/photographer/${user.id}/on-demand-toggle`, {
        is_available: true,
        spot_id: selectedSpot.id,
        spot_name: selectedSpot.name,
        latitude: selectedSpot.latitude,
        longitude: selectedSpot.longitude
      });
      setOnDemandActive(true);
      setPendingToggle(false);
      setShowSpotSelector(false);
      toast.success(`On-Demand activated at ${selectedSpot.name}!`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to activate On-Demand');
    }
  };

  const commonProps = {
    liveCount,
    upcomingBookings,
    aiMatchCount,
    isPhotographer,
    onDemandActive,
    onToggleOnDemand: handleToggleOnDemand,
    selectedSpot,
    onSelectSpot: handleSelectSpot,
    photographerTier,
    showSpotSelector,
    setShowSpotSelector,
    pendingToggle,
    onConfirmToggle: handleConfirmToggle,
    // Go Live props
    liveActive,
    selectedLiveSpot,
    onSelectLiveSpot: handleSelectLiveSpot,
    showLiveSpotSelector,
    setShowLiveSpotSelector,
    onGoLive: handleGoLive,
    // GPS status props
    gpsStatus,
    spotsLoaded
  };

  return (
    <>
      {/* Mobile: Use Sheet (Drawer) */}
      <div className="md:hidden">
        <MobileSessionHub {...commonProps}>
          {children}
        </MobileSessionHub>
      </div>
      
      {/* Desktop: Use Popover */}
      <div className="hidden md:block">
        <DesktopSessionHub {...commonProps}>
          {children}
        </DesktopSessionHub>
      </div>
    </>
  );
};

export default SurferSessionHub;
