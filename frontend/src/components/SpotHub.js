import React, { useState, useEffect, useRef } from 'react';

import { useParams, useNavigate } from 'react-router-dom';

import { 

  MapPin, Waves, Camera, Clock, Users, X, TrendingUp, Loader2, Radio, Calendar, MessageCircle, Compass,
  Sun, Lock, Crown, ChevronLeft,
  Navigation, AlertCircle, Zap,
  Bell
} from 'lucide-react';

import SpotHubConditionsTab from './spot-hub/SpotHubConditionsTab';
import SpotHubIntelTab from './spot-hub/SpotHubIntelTab';
import SpotHubMediaTab from './spot-hub/SpotHubMediaTab';
import SpotHubPhotographers from './spot-hub/SpotHubPhotographers';
import SpotHubLivePulse from './spot-hub/SpotHubLivePulse';
import { Button } from './ui/button';

import { Badge } from './ui/badge';

import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';



import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import apiClient from '../lib/apiClient';

import { toast } from 'sonner';

import { ScheduledBookingDrawer } from './ScheduledBookingDrawer';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import useSpotHubActions from '../hooks/useSpotHubActions';
import { getThemeTokens } from '../utils/themeTokens';
import { ROLES } from '../constants/roles';
import { SpotCardSkeleton, AlertCardSkeleton } from './ui/SkeletonVariants';



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
      <div data-testid="spot-hub-page" className={`flex flex-col items-center p-2 rounded-lg min-w-[55px] ${lockBg}`}>
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

// MediaItem moved to spot-hub/SpotHubMediaTab.js

import BookingTypeModal from './spot-hub/BookingTypeModal';
import PhotographerRequestModal from './spot-hub/PhotographerRequestModal';

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
  
  // Intelligence state - crowd prediction + optimal time
  const [crowdPrediction, setCrowdPrediction] = useState(null);
  const [optimalTime, setOptimalTime] = useState(null);
  const [intelLoading, setIntelLoading] = useState(false);
  
  const userTier = user?.subscription_tier || 'free';
  const forecastDaysAllowed = ['premium', 'pro', 'gold'].includes(userTier) ? 10 : ['paid', 'basic'].includes(userTier) ? 7 : 3;
  
  // ============ HANDLERS FROM useSpotHubActions ============
  const {
    fetchAllSpotData,
    fetchLivePulse,
    fetchIntelData,
    handleReportConditionReport,
    handleClose,
    handleBookingTypeSelect,
    handleOpenBookingModal,
  } = useSpotHubActions({
    user,
    spotId,
    navigate,
    userTier,
    setSpot,
    setSpotDetails,
    setActivePhotographers,
    setConditionReports,
    setSurfReports,
    setPhotographerPosts,
    setUserPosts,
    setLoading,
    setUserLocation,
    setIsWithinProximity,
    setLivePulse,
    setPulseLoading,
    setCrowdPrediction,
    setOptimalTime,
    setIntelLoading,
    setShowBookingModal,
    setSelectedPhotographer,
    setShowScheduledDrawer,
    setShowRequestModal,
  });

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
  
  // IntersectionObserver for collapsible header \u{2013} detects when hero scrolls out of view
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

  if (loading) {
    return (
      <div className="max-w-xl mx-auto p-4 space-y-3">
      {/* JSON-LD BreadcrumbList for SEO */}
      {spot && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          'itemListElement': [
            { '@type': 'ListItem', position: 1, name: 'Explore', item: window.location.origin + '/explore' },
            { '@type': 'ListItem', position: 2, name: spot.region || 'Region' },
            { '@type': 'ListItem', position: 3, name: spot.name }
          ]
        })}} />
      )}
        <SpotCardSkeleton />
        <AlertCardSkeleton />
        <AlertCardSkeleton />
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
      {/* ===== COMPACT STICKY BAR - appears when hero scrolls out ===== */}
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
            <button aria-label="Previous" 
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

      {/* ===== FULL HERO HEADER - scrolls away naturally ===== */}
      <div ref={heroRef} className="relative overflow-hidden min-h-[180px] flex items-end">
        {/* Background: try spot image ? map ? gradient */}
        <div className="absolute inset-0">
          <img loading="lazy" decoding="async" 
            src={spot.image_url || (spot.longitude && spot.latitude ? `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${spot.longitude},${spot.latitude}&z=12&l=sat&size=400,300` : '')}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              // If map also fails, hide img and let gradient show through
              e.target.style.display = 'none';
            }}
          />
          {/* Gradient base layer behind img - always visible as ultimate fallback */}
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-700 to-blue-900 -z-10" />
        </div>
        {/* Dark gradient overlay to guarantee text legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20" />
        
        {/* Close Button top-right */}
        <button aria-label="Close" 
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 bg-black/30 hover:bg-black/50 backdrop-blur-md rounded-full transition-colors text-white z-30"
          data-testid="close-spothub-btn"
        ><X className="w-5 h-5" />
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

      {/* Live Shooting Pulse Banner */}
      <SpotHubLivePulse livePulse={livePulse} navigate={navigate} spotId={spotId} />

      {/* Active Photographers at this Spot */}
      <SpotHubPhotographers
        activePhotographers={activePhotographers}
        navigate={navigate}
        handleOpenBookingModal={handleOpenBookingModal}
        isWithinProximity={isWithinProximity}
        userTier={userTier}
        cardBg={cardBg}
        rowBg={rowBg}
        textPrimary={textPrimary}
        textSecondary={textSecondary}
      />

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
              <p className={`text-lg font-bold ${textPrimary}`}>{currentConditions.wave_direction || '-'}-</p>
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
              <button aria-label="Crown" 
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
          { id: 'intel', label: 'Intel', icon: Brain, count: 0 },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              if (tab.id === 'intel') fetchIntelData();
            }}
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
          <SpotHubConditionsTab
            conditionReports={conditionReports}
            surfReports={surfReports}
            spot={spot}
            isLight={isLight}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
            onReportConditionReport={handleReportConditionReport}
            onLightboxOpen={(url) => setLightboxUrl(url)}
          />
        )}

        {/* Photographer Tagged Posts Tab */}
        {activeTab === 'pro' && (
          <SpotHubMediaTab type="pro" posts={photographerPosts} navigate={navigate} />
        )}

        {/* User Tagged Posts Tab */}
        {activeTab === 'community' && (
          <SpotHubMediaTab type="community" posts={userPosts} navigate={navigate} />
        )}

        {/* Intelligence Tab */}
        {activeTab === 'intel' && (
          <SpotHubIntelTab
            intelLoading={intelLoading}
            crowdPrediction={crowdPrediction}
            optimalTime={optimalTime}
            spot={spot}
            isLight={isLight}
            navigate={navigate}
          />
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
          <img loading="lazy" decoding="async" 
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
