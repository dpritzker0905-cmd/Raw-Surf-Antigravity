import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../lib/apiClient';
import { Radio, MapPin, Calendar, ChevronRight, Users, Zap, Play, Activity, Lock, Sparkles } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { SpotSelector } from './SpotSelector';
import logger from '../utils/logger';
import { ROLES } from '../constants/roles';



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

// Session Hub Content for Surfers - Simplified with direct navigation
const SurferHubContent = ({ onClose, navigate, liveCount, upcomingBookings, aiMatchCount }) => {
  return (
    <div className="space-y-3">
      {/* ============ LIVE SESSIONS - Direct Link ============ */}
      <button
        onClick={() => {
          navigate('/bookings?tab=live_now');
          onClose?.();
        }}
        className="w-full flex items-center gap-3 p-4 bg-zinc-800/30 hover:bg-zinc-700/50 rounded-xl border border-zinc-700/50 transition-colors active:scale-[0.98]"
        data-testid="session-hub-live"
      >
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/30 to-green-600/30 flex items-center justify-center">
          <Radio className="w-6 h-6 text-emerald-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-white font-semibold">Live Sessions</p>
          <p className="text-gray-400 text-xs">Browse photographers shooting now</p>
        </div>
        <div className="flex items-center gap-2">
          {liveCount > 0 && (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
              {liveCount} live
            </Badge>
          )}
          <ChevronRight className="w-5 h-5 text-gray-400" />
        </div>
      </button>

      {/* ============ REQUEST A PRO / ON-DEMAND - Direct Link ============ */}
      <button
        onClick={() => {
          navigate('/bookings?tab=on_demand');
          onClose?.();
        }}
        className="w-full flex items-center gap-3 p-4 bg-zinc-800/30 hover:bg-zinc-700/50 rounded-xl border border-zinc-700/50 transition-colors active:scale-[0.98]"
        data-testid="session-hub-request-pro"
      >
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500/30 to-orange-600/30 flex items-center justify-center">
          <Zap className="w-6 h-6 text-amber-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-white font-semibold">Request a Pro</p>
          <p className="text-gray-400 text-xs">Find on-demand photographers near you</p>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-400" />
      </button>

      {/* ============ MY BOOKINGS ============ */}
      <button
        onClick={() => {
          navigate('/bookings?tab=scheduled');
          onClose?.();
        }}
        className="w-full flex items-center gap-3 p-4 bg-zinc-800/30 hover:bg-zinc-700/50 rounded-xl border border-zinc-700/50 transition-colors active:scale-[0.98]"
        data-testid="session-hub-bookings"
      >
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/30 to-violet-600/30 flex items-center justify-center">
          <Calendar className="w-6 h-6 text-purple-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-white font-semibold">My Bookings</p>
          <p className="text-gray-400 text-xs">Upcoming sessions & receipts</p>
        </div>
        <div className="flex items-center gap-2">
          {upcomingBookings > 0 && (
            <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
              {upcomingBookings}
            </Badge>
          )}
          <ChevronRight className="w-5 h-5 text-gray-400" />
        </div>
      </button>
    
      {/* ============ MY GALLERY with AI Match Badge ============ */}
      <button
        onClick={() => {
          navigate('/my-gallery');
          onClose?.();
        }}
        className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-colors active:scale-[0.98] ${
          aiMatchCount > 0 
            ? 'bg-gradient-to-r from-purple-500/20 to-cyan-500/20 border-purple-500/40 hover:border-purple-500/60' 
            : 'bg-zinc-800/30 hover:bg-zinc-700/50 border-zinc-700/50'
        }`}
        data-testid="session-hub-my-gallery"
      >
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center relative ${
          aiMatchCount > 0 
            ? 'bg-gradient-to-br from-purple-500/40 to-cyan-500/40' 
            : 'bg-gradient-to-br from-cyan-500/30 to-blue-600/30'
        }`}>
          <Lock className="w-6 h-6 text-cyan-400" />
          {aiMatchCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-purple-500 rounded-full text-[10px] font-bold flex items-center justify-center text-white animate-pulse">
              {aiMatchCount > 9 ? '9+' : aiMatchCount}
            </span>
          )}
        </div>
        <div className="flex-1 text-left">
          <p className="text-white font-semibold flex items-center gap-2">
            My Gallery
            {aiMatchCount > 0 && (
              <Badge className="bg-purple-500/30 text-purple-300 border-purple-500/40 text-[10px] px-1.5 py-0">
                <Sparkles className="w-3 h-3 mr-0.5" />
                AI Found You!
              </Badge>
            )}
          </p>
          <p className="text-gray-400 text-xs">
            {aiMatchCount > 0 
              ? `${aiMatchCount} AI-detected photo${aiMatchCount > 1 ? 's' : ''} to review` 
              : 'Your private media locker'
            }
          </p>
        </div>
        <ChevronRight className={`w-5 h-5 ${aiMatchCount > 0 ? 'text-purple-400' : 'text-gray-400'}`} />
      </button>
    </div>
  );
};

// Session Hub Content for Photographers - "Active Duty" Console
// Hierarchy: 1. Go On-Demand, 2. Go Live/Active Shooting, 3. Other Shooters, 4. Scheduled Sessions (Today only)
const PhotographerHubContent = ({ 
  onClose, 
  navigate, 
  liveCount, 
  onDemandActive, 
  onToggleOnDemand, 
  selectedSpot,
  onSelectSpot,
  photographerTier,
  showSpotSelector,
  setShowSpotSelector,
  _pendingToggle,
  onConfirmToggle,
  // Go Live state
  liveActive,
  selectedLiveSpot,
  onSelectLiveSpot,
  showLiveSpotSelector,
  setShowLiveSpotSelector,
  onGoLive
  // GPS state now handled ONLY in parent header - removed from here
}) => {
  // Toggle is DISABLED until a spot is selected (only when trying to activate)
  const canToggle = onDemandActive || selectedSpot;
  
  const handleToggleClick = () => {
    if (!onDemandActive && !selectedSpot) {
      // Show spot selector first if trying to enable without a spot
      setShowSpotSelector(true);
      return;
    }
    onToggleOnDemand();
  };

  return (
    <div className="space-y-3">
      {/* GPS Status REMOVED - Now shown ONLY in parent header (MobileSessionHub/DesktopSessionHub) */}
      
      {/* 1. Go On-Demand - Primary Action with Status */}
      <div className={`p-4 rounded-xl border-2 transition-all ${
        onDemandActive 
          ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-400/50' 
          : 'bg-zinc-800/50 border-zinc-700'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
              onDemandActive ? 'bg-yellow-500/30' : 'bg-zinc-700'
            }`}>
              <Zap className={`w-5 h-5 ${onDemandActive ? 'text-yellow-400' : 'text-gray-400'}`} />
            </div>
            <div>
              <p className="text-white font-medium text-sm">Go On-Demand</p>
              <p className={`text-xs ${onDemandActive ? 'text-yellow-300' : 'text-gray-400'}`}>
                {onDemandActive ? 'Accepting requests' : selectedSpot ? 'Ready to activate' : 'Select spot to enable'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Settings shortcut arrow */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate('/photographer/on-demand-settings');
                onClose?.();
              }}
              className="p-1.5 rounded-lg hover:bg-zinc-700/50 text-gray-400 hover:text-yellow-400 transition-colors"
              title="On-Demand Settings"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={handleToggleClick}
              disabled={!canToggle && !onDemandActive}
              className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${
                onDemandActive ? 'bg-yellow-500' : canToggle ? 'bg-zinc-600' : 'bg-zinc-700 opacity-50 cursor-not-allowed'
              }`}
              data-testid="on-demand-toggle"
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                onDemandActive ? 'left-[calc(100%-22px)]' : 'left-0.5'
              }`} />
            </button>
          </div>
        </div>
        
        {/* Selected Spot Display or SpotSelector */}
        {(showSpotSelector || (!onDemandActive && !selectedSpot)) && !onDemandActive && (
          <div className="mt-3 pt-3 border-t border-zinc-700">
            <SpotSelector
              selectedSpot={selectedSpot}
              onSelectSpot={(spot) => {
                onSelectSpot(spot);
                setShowSpotSelector(false);
              }}
              photographerTier={photographerTier}
              disabled={false}
              compact={false}
            />
            {/* Activate button after spot selection */}
            {selectedSpot && (
              <button
                onClick={onConfirmToggle}
                className="w-full mt-3 py-2.5 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-black font-medium text-sm flex items-center justify-center gap-2"
                data-testid="activate-on-demand-btn"
              >
                <Zap className="w-4 h-4" />
                Activate On-Demand
              </button>
            )}
          </div>
        )}
        
        {/* Show selected spot when on-demand is active */}
        {onDemandActive && selectedSpot && (
          <div className="mt-3 pt-3 border-t border-yellow-500/30 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-green-400" />
            <span className="text-sm text-green-300">Active at: {typeof selectedSpot === 'object' ? selectedSpot.name : selectedSpot}</span>
          </div>
        )}
        
        {/* Change spot option when active */}
        {onDemandActive && (
          <button
            onClick={() => setShowSpotSelector(true)}
            className="mt-2 text-xs text-yellow-400 hover:text-yellow-300 underline"
          >
            Change spot
          </button>
        )}
      </div>

    {/* 2. Go Live / Start Session - UNIFIED UI with toggle (matches On-Demand) */}
    <div className={`p-4 rounded-xl border-2 transition-all ${
      liveActive 
        ? 'bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border-emerald-400/50' 
        : 'bg-zinc-800/50 border-zinc-700'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
            liveActive ? 'bg-emerald-500/30' : 'bg-zinc-700'
          }`}>
            <Play className={`w-5 h-5 ${liveActive ? 'text-emerald-400' : 'text-gray-400'}`} />
          </div>
          <div>
            <p className="text-white font-medium text-sm">Go Live</p>
            <p className={`text-xs ${liveActive ? 'text-emerald-300' : 'text-gray-400'}`}>
              {liveActive ? 'Currently shooting' : selectedLiveSpot ? 'Ready to go live' : 'Select spot to enable'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Settings shortcut arrow - mirrors On-Demand */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate('/photographer/sessions');
              onClose?.();
            }}
            className="p-1.5 rounded-lg hover:bg-zinc-700/50 text-gray-400 hover:text-emerald-400 transition-colors"
            title="Live Settings"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {/* Toggle switch - identical to On-Demand */}
          <button
            onClick={() => {
              if (liveActive) {
                // End live session
                onGoLive(null);
              } else if (selectedLiveSpot) {
                // Start live at selected spot
                onGoLive(selectedLiveSpot);
              } else {
                // Show spot selector
                setShowLiveSpotSelector(true);
              }
            }}
            disabled={!liveActive && !selectedLiveSpot}
            className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${
              liveActive 
                ? 'bg-emerald-500' 
                : selectedLiveSpot 
                  ? 'bg-zinc-600' 
                  : 'bg-zinc-700 opacity-50 cursor-not-allowed'
            }`}
            data-testid="go-live-toggle"
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
              liveActive ? 'left-[calc(100%-22px)]' : 'left-0.5'
            }`} />
          </button>
        </div>
      </div>
      
      {/* Live Spot Selector - identical layout to On-Demand */}
      {(showLiveSpotSelector || (!liveActive && !selectedLiveSpot)) && !liveActive && (
        <div className="mt-3 pt-3 border-t border-zinc-700">
          <SpotSelector
            selectedSpot={selectedLiveSpot}
            onSelectSpot={(spot) => {
              onSelectLiveSpot(spot);
              setShowLiveSpotSelector(false);
            }}
            photographerTier={photographerTier}
            disabled={false}
            compact={false}
          />
          {/* Activate button after spot selection - matches On-Demand */}
          {selectedLiveSpot && (
            <button
              onClick={() => {
                onGoLive(selectedLiveSpot);
                setShowLiveSpotSelector(false);
              }}
              className="w-full mt-3 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-medium text-sm flex items-center justify-center gap-2"
              data-testid="activate-live-btn"
            >
              <Play className="w-4 h-4" />
              Go Live
            </button>
          )}
        </div>
      )}
      
      {/* Show current live spot - identical to On-Demand display */}
      {liveActive && selectedLiveSpot && (
        <div className="mt-3 pt-3 border-t border-emerald-500/30 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-green-400" />
          <span className="text-sm text-green-300">Live at: {typeof selectedLiveSpot === 'object' ? selectedLiveSpot.name : selectedLiveSpot}</span>
        </div>
      )}
      
      {/* Change spot option when active - matches On-Demand */}
      {liveActive && (
        <button
          onClick={() => setShowLiveSpotSelector(true)}
          className="mt-2 text-xs text-emerald-400 hover:text-emerald-300 underline"
        >
          Change spot
        </button>
      )}
    </div>

    {/* 3. Other Shooters Nearby */}
    <button
      onClick={() => {
        navigate('/map?filter=photographers');
        onClose?.();
      }}
      className="w-full flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl transition-colors"
      data-testid="session-hub-live"
    >
      <div className="w-11 h-11 rounded-xl bg-cyan-500/20 flex items-center justify-center">
        <Radio className="w-5 h-5 text-cyan-400" />
      </div>
      <div className="flex-1 text-left">
        <p className="text-white font-medium text-sm">Other Shooters</p>
        <p className="text-gray-400 text-xs">See who else is live nearby</p>
      </div>
      <div className="flex items-center gap-2">
        {liveCount > 0 && (
          <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-400 text-xs font-medium rounded-full">
            {liveCount}
          </span>
        )}
        <ChevronRight className="w-4 h-4 text-gray-500" />
      </div>
    </button>

    {/* 4. Scheduled Sessions (Today's Agenda Only) */}
    <button
      onClick={() => {
        navigate('/photographer/bookings?view=today');
        onClose?.();
      }}
      className="w-full flex items-center gap-3 p-4 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl transition-colors"
      data-testid="session-hub-bookings"
    >
      <div className="w-11 h-11 rounded-xl bg-purple-500/20 flex items-center justify-center">
        <Calendar className="w-5 h-5 text-purple-400" />
      </div>
      <div className="flex-1 text-left">
        <p className="text-white font-medium text-sm">Scheduled Sessions</p>
        <p className="text-gray-400 text-xs">Today's agenda</p>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-500" />
    </button>
  </div>
  );
};

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
        className="bg-zinc-900 border-zinc-700 rounded-t-3xl h-auto sheet-safe-bottom md:max-h-[85vh] md:!bottom-4 overflow-hidden flex flex-col"
      >
        <SheetHeader className="pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-white flex items-center gap-2 text-base">
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
                <span>🛰️</span>
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
        className="w-96 bg-zinc-900 border-zinc-700 p-3 max-h-[calc(100dvh-6rem)] md:max-h-[70vh] overflow-y-auto"
        align="end"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-medium flex items-center gap-2 text-sm">
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
              <span>🛰️</span>
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
