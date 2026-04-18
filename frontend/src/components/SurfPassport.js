import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { 
  Stamp, Trophy, MapPin, Globe, Calendar, Flame, Award, ChevronRight, 
  X, Users, Target, Sparkles, Navigation, CheckCircle2, AlertCircle,
  Plane, Hotel
} from 'lucide-react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';


// Badge definitions with icons and descriptions
const BADGE_INFO = {
  first_checkin: { icon: '🎯', name: 'First Wave', description: 'Your first check-in!' },
  explorer_10: { icon: '🗺️', name: 'Explorer', description: 'Visited 10 unique spots' },
  globetrotter_5: { icon: '🌍', name: 'Globetrotter', description: 'Surfed in 5 countries' },
  streak_7: { icon: '🔥', name: 'On Fire', description: '7-day check-in streak' },
  dawn_patrol: { icon: '🌅', name: 'Dawn Patrol', description: 'Check-in before 7am' },
  storm_chaser: { icon: '⛈️', name: 'Storm Chaser', description: 'Surfed during large swell' },
};

// Level names
const LEVEL_NAMES = [
  '', 'Grommet', 'Wave Rider', 'Swell Seeker', 'Barrel Hunter', 
  'Reef Master', 'Point Captain', 'Tube Legend', 'Ocean Sage', 
  'Surf Oracle', 'Wave God'
];

export const SurfPassport = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState('stamps');
  const [stats, setStats] = useState(null);
  const [visitedSpots, setVisitedSpots] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardCategory, setLeaderboardCategory] = useState('spots');
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [nearbySpot, setNearbySpot] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);

  // Theme classes
  const isLight = theme === 'light';
  const bgClass = isLight ? 'bg-white' : 'bg-zinc-900';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-800';
  const cardBgClass = isLight ? 'bg-gray-50' : 'bg-zinc-800';

  // Fetch passport stats
  const fetchStats = useCallback(async () => {
    if (!user?.id) return;
    try {
      const response = await apiClient.get(`/passport/stats?user_id=${user.id}`);
      setStats(response.data);
    } catch (error) {
      logger.error('Failed to fetch passport stats:', error);
    }
  }, [user?.id]);

  // Fetch visited spots
  const fetchVisitedSpots = useCallback(async () => {
    if (!user?.id) return;
    try {
      const response = await apiClient.get(`/passport/visited-spots?user_id=${user.id}`);
      setVisitedSpots(response.data.visited_spots || []);
    } catch (error) {
      logger.error('Failed to fetch visited spots:', error);
    }
  }, [user?.id]);

  // Fetch leaderboard
  const fetchLeaderboard = useCallback(async () => {
    try {
      const response = await apiClient.get(`/passport/leaderboard?category=${leaderboardCategory}&limit=20`);
      setLeaderboard(response.data.leaderboard || []);
    } catch (error) {
      logger.error('Failed to fetch leaderboard:', error);
    }
  }, [leaderboardCategory]);

  // Get user's current location
  const getUserLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
        setLocationError(null);
      },
      (error) => {
        setLocationError('Unable to get location. Please enable GPS.');
        logger.error('Geolocation error:', error);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  // Check for nearby spots
  const checkNearbySpots = useCallback(async () => {
    if (!userLocation) return;
    
    try {
      // Get all spots and find the closest one
      const response = await apiClient.get(`/surf-spots`);
      const spots = response.data;
      
      let closestSpot = null;
      let minDistance = Infinity;
      
      for (const spot of spots) {
        const distance = calculateDistance(
          userLocation.latitude, userLocation.longitude,
          parseFloat(spot.latitude), parseFloat(spot.longitude)
        );
        
        if (distance < minDistance) {
          minDistance = distance;
          closestSpot = { ...spot, distance: Math.round(distance) };
        }
      }
      
      if (closestSpot && closestSpot.distance <= 500) {
        setNearbySpot(closestSpot);
      } else if (closestSpot) {
        setNearbySpot({ ...closestSpot, tooFar: true });
      }
    } catch (error) {
      logger.error('Failed to check nearby spots:', error);
    }
  }, [userLocation]);

  // Calculate distance using Haversine formula
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371000; // Earth's radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
  };

  // Handle check-in
  const handleCheckIn = async () => {
    if (!nearbySpot || nearbySpot.tooFar || !userLocation || !user?.id) return;
    
    setCheckingIn(true);
    try {
      const response = await apiClient.post(`/passport/checkin?user_id=${user.id}`, {
        spot_id: nearbySpot.id,
        latitude: userLocation.latitude,
        longitude: userLocation.longitude
      });
      
      if (response.data.success) {
        // Refresh stats
        await fetchStats();
        await fetchVisitedSpots();
        
        // Show success message (could use toast)
        alert(`${response.data.message}\n\n+${response.data.xp_earned} XP earned!${response.data.badge_earned ? `\n\nBadge earned: ${BADGE_INFO[response.data.badge_earned]?.name || response.data.badge_earned}` : ''}`);
      }
    } catch (error) {
      logger.error('Check-in failed:', error);
      alert('Check-in failed. Please try again.');
    } finally {
      setCheckingIn(false);
    }
  };

  // Initial data fetch
  useEffect(() => {
    if (isOpen && user?.id) {
      setLoading(true);
      Promise.all([fetchStats(), fetchVisitedSpots(), fetchLeaderboard()])
        .finally(() => setLoading(false));
      getUserLocation();
    }
  }, [isOpen, user?.id, fetchStats, fetchVisitedSpots, fetchLeaderboard, getUserLocation]);

  // Check nearby spots when location updates
  useEffect(() => {
    if (userLocation) {
      checkNearbySpots();
    }
  }, [userLocation, checkNearbySpots]);

  // Refetch leaderboard when category changes
  useEffect(() => {
    if (isOpen) {
      fetchLeaderboard();
    }
  }, [leaderboardCategory, isOpen, fetchLeaderboard]);

  if (!isOpen) return null;

  const xpProgress = stats ? (stats.total_xp_earned / (stats.total_xp_earned + (stats.xp_to_next_level || 1))) * 100 : 0;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 pb-24 md:pb-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className={`relative w-full max-w-2xl max-h-[85vh] md:max-h-[90vh] ${bgClass} rounded-2xl shadow-2xl overflow-hidden flex flex-col`}>
        {/* Header */}
        <div className={`p-6 border-b ${borderClass} bg-gradient-to-r from-emerald-500/20 to-yellow-500/20`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-r from-emerald-400 to-yellow-400 flex items-center justify-center">
                <Stamp className="w-6 h-6 text-black" />
              </div>
              <div>
                <h2 className={`text-xl font-bold ${textClass}`}>Surf Passport</h2>
                <p className={`text-sm ${textSecondaryClass}`}>Collect stamps from spots around the world</p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className={`p-2 rounded-lg ${isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-800'} transition-colors`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          {/* Level & XP Bar */}
          {stats && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-medium ${textClass}`}>
                  Level {stats.passport_level}: {LEVEL_NAMES[stats.passport_level] || 'Legend'}
                </span>
                <span className={`text-sm ${textSecondaryClass}`}>
                  {stats.total_xp_earned.toLocaleString()} XP
                </span>
              </div>
              <div className={`h-2 rounded-full ${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`}>
                <div 
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-yellow-400 transition-all duration-500"
                  style={{ width: `${xpProgress}%` }}
                />
              </div>
              <p className={`text-xs ${textSecondaryClass} mt-1`}>
                {stats.xp_to_next_level?.toLocaleString() || 0} XP to next level
              </p>
            </div>
          )}
        </div>

        {/* GPS Check-In Banner */}
        <div className={`px-6 py-4 border-b ${borderClass} ${cardBgClass}`}>
          {locationError ? (
            <div className="flex items-center gap-3 text-amber-500">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm">{locationError}</span>
              <button 
                onClick={getUserLocation}
                className="ml-auto text-xs bg-amber-500/20 px-3 py-1 rounded-full hover:bg-amber-500/30"
              >
                Retry
              </button>
            </div>
          ) : nearbySpot ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${nearbySpot.tooFar ? 'bg-amber-500/20' : 'bg-emerald-500/20'}`}>
                  <Navigation className={`w-5 h-5 ${nearbySpot.tooFar ? 'text-amber-500' : 'text-emerald-500'}`} />
                </div>
                <div>
                  <p className={`text-sm font-medium ${textClass}`}>{nearbySpot.name}</p>
                  <p className={`text-xs ${textSecondaryClass}`}>
                    {nearbySpot.distance}m away • {nearbySpot.country}
                  </p>
                </div>
              </div>
              {nearbySpot.tooFar ? (
                <span className="text-xs text-amber-500 bg-amber-500/20 px-3 py-1.5 rounded-full">
                  Get within 500m
                </span>
              ) : (
                <button
                  onClick={handleCheckIn}
                  disabled={checkingIn}
                  className="flex items-center gap-2 bg-gradient-to-r from-emerald-400 to-yellow-400 text-black text-sm font-medium px-4 py-2 rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {checkingIn ? 'Checking in...' : 'Check In'}
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center animate-pulse">
                <Navigation className="w-5 h-5 text-blue-500" />
              </div>
              <span className={`text-sm ${textSecondaryClass}`}>Scanning for nearby surf spots...</span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${borderClass}`}>
          {[
            { id: 'stamps', label: 'My Stamps', icon: Stamp },
            { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
            { id: 'travel', label: 'Travel', icon: Plane },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id 
                  ? 'text-emerald-500 border-b-2 border-emerald-500' 
                  : `${textSecondaryClass} hover:text-emerald-400`
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : activeTab === 'stamps' ? (
            <div className="space-y-6">
              {/* Stats Grid */}
              {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className={`${cardBgClass} rounded-xl p-4 text-center`}>
                    <MapPin className="w-6 h-6 mx-auto mb-2 text-emerald-400" />
                    <p className={`text-2xl font-bold ${textClass}`}>{stats.unique_spots_visited}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Spots Visited</p>
                  </div>
                  <div className={`${cardBgClass} rounded-xl p-4 text-center`}>
                    <Globe className="w-6 h-6 mx-auto mb-2 text-blue-400" />
                    <p className={`text-2xl font-bold ${textClass}`}>{stats.unique_countries_visited}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Countries</p>
                  </div>
                  <div className={`${cardBgClass} rounded-xl p-4 text-center`}>
                    <Calendar className="w-6 h-6 mx-auto mb-2 text-purple-400" />
                    <p className={`text-2xl font-bold ${textClass}`}>{stats.total_checkins}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Total Check-ins</p>
                  </div>
                  <div className={`${cardBgClass} rounded-xl p-4 text-center`}>
                    <Flame className="w-6 h-6 mx-auto mb-2 text-orange-400" />
                    <p className={`text-2xl font-bold ${textClass}`}>{stats.current_streak_days}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Day Streak</p>
                  </div>
                </div>
              )}

              {/* Badges */}
              {stats?.badges_earned?.length > 0 && (
                <div>
                  <h3 className={`text-sm font-medium ${textClass} mb-3 flex items-center gap-2`}>
                    <Award className="w-4 h-4 text-yellow-400" />
                    Badges Earned
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {stats.badges_earned.map(badge => (
                      <div 
                        key={badge}
                        className={`${cardBgClass} px-3 py-2 rounded-lg flex items-center gap-2`}
                        title={BADGE_INFO[badge]?.description}
                      >
                        <span className="text-xl">{BADGE_INFO[badge]?.icon || '🏅'}</span>
                        <span className={`text-sm ${textClass}`}>{BADGE_INFO[badge]?.name || badge}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Stamps */}
              <div>
                <h3 className={`text-sm font-medium ${textClass} mb-3 flex items-center gap-2`}>
                  <Stamp className="w-4 h-4 text-emerald-400" />
                  Recent Stamps ({visitedSpots.length} spots)
                </h3>
                {visitedSpots.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {visitedSpots.slice(0, 10).map(spot => (
                      <div 
                        key={spot.spot_id}
                        className={`${cardBgClass} rounded-xl p-4 flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity`}
                        onClick={() => {
                          onClose();
                          navigate(`/map?spot=${spot.spot_id}`);
                        }}
                      >
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400/30 to-yellow-400/30 flex items-center justify-center flex-shrink-0">
                          <span className="text-2xl">🏄</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${textClass} truncate`}>{spot.spot_name}</p>
                          <p className={`text-xs ${textSecondaryClass}`}>{spot.country} • {spot.region}</p>
                          <p className={`text-xs text-emerald-500`}>
                            {spot.visit_count}x visited • +{spot.total_xp_earned} XP
                          </p>
                        </div>
                        <ChevronRight className={`w-4 h-4 ${textSecondaryClass}`} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`${cardBgClass} rounded-xl p-8 text-center`}>
                    <Stamp className={`w-12 h-12 mx-auto mb-3 ${textSecondaryClass}`} />
                    <p className={`${textClass} font-medium`}>No stamps yet</p>
                    <p className={`text-sm ${textSecondaryClass} mt-1`}>
                      Visit a surf spot and check in to collect your first stamp!
                    </p>
                  </div>
                )}
              </div>

              {/* Country Breakdown */}
              {stats?.countries_breakdown && Object.keys(stats.countries_breakdown).length > 0 && (
                <div>
                  <h3 className={`text-sm font-medium ${textClass} mb-3 flex items-center gap-2`}>
                    <Globe className="w-4 h-4 text-blue-400" />
                    Countries Visited
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(stats.countries_breakdown)
                      .sort((a, b) => b[1] - a[1])
                      .map(([country, count]) => (
                        <div 
                          key={country}
                          className={`${cardBgClass} px-3 py-1.5 rounded-full flex items-center gap-2`}
                        >
                          <span className={`text-sm ${textClass}`}>{country}</span>
                          <span className={`text-xs ${textSecondaryClass}`}>({count})</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'leaderboard' ? (
            <div className="space-y-4">
              {/* Category Tabs */}
              <div className={`flex gap-2 p-1 rounded-lg ${cardBgClass}`}>
                {[
                  { id: 'spots', label: 'Spots' },
                  { id: 'countries', label: 'Countries' },
                  { id: 'xp', label: 'XP' },
                  { id: 'streak', label: 'Streak' },
                ].map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setLeaderboardCategory(cat.id)}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                      leaderboardCategory === cat.id 
                        ? 'bg-emerald-500 text-black' 
                        : `${textSecondaryClass} hover:text-emerald-400`
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Leaderboard List */}
              <div className="space-y-2">
                {leaderboard.length > 0 ? (
                  leaderboard.map((entry, index) => (
                    <div 
                      key={entry.user_id}
                      className={`${cardBgClass} rounded-xl p-4 flex items-center gap-4 ${entry.user_id === user?.id ? 'ring-2 ring-emerald-500' : ''}`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                        index === 0 ? 'bg-yellow-500 text-black' :
                        index === 1 ? 'bg-gray-400 text-black' :
                        index === 2 ? 'bg-amber-600 text-white' :
                        `${isLight ? 'bg-gray-200 text-gray-600' : 'bg-zinc-700 text-gray-400'}`
                      }`}>
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${textClass} truncate`}>{entry.full_name}</p>
                        <p className={`text-xs ${textSecondaryClass}`}>
                          Level {entry.passport_level} • {entry.unique_spots_visited} spots • {entry.unique_countries_visited} countries
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-lg font-bold ${textClass}`}>
                          {leaderboardCategory === 'spots' && entry.unique_spots_visited}
                          {leaderboardCategory === 'countries' && entry.unique_countries_visited}
                          {leaderboardCategory === 'xp' && entry.total_xp_earned.toLocaleString()}
                          {leaderboardCategory === 'streak' && entry.longest_streak_days}
                        </p>
                        <p className={`text-xs ${textSecondaryClass}`}>
                          {leaderboardCategory === 'spots' && 'spots'}
                          {leaderboardCategory === 'countries' && 'countries'}
                          {leaderboardCategory === 'xp' && 'XP'}
                          {leaderboardCategory === 'streak' && 'days'}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className={`${cardBgClass} rounded-xl p-8 text-center`}>
                    <Trophy className={`w-12 h-12 mx-auto mb-3 ${textSecondaryClass}`} />
                    <p className={`${textClass} font-medium`}>No rankings yet</p>
                    <p className={`text-sm ${textSecondaryClass} mt-1`}>
                      Be the first to check in and claim the top spot!
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Travel Tab - Coming Soon */
            <div className={`${cardBgClass} rounded-xl p-8 text-center`}>
              <div className="w-16 h-16 rounded-full bg-gradient-to-r from-emerald-400/20 to-yellow-400/20 mx-auto mb-4 flex items-center justify-center">
                <Plane className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className={`text-lg font-bold ${textClass} mb-2`}>Surf Travel Hub</h3>
              <p className={`text-sm ${textSecondaryClass} mb-4`}>
                Book surf retreats, lodges, and guided trips from verified hosts around the world.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-700'}`}>
                  <Hotel className="w-4 h-4 text-emerald-400" />
                  <span className={`text-sm ${textSecondaryClass}`}>Surf Lodges</span>
                </div>
                <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-700'}`}>
                  <Users className="w-4 h-4 text-blue-400" />
                  <span className={`text-sm ${textSecondaryClass}`}>Group Retreats</span>
                </div>
                <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-700'}`}>
                  <Target className="w-4 h-4 text-purple-400" />
                  <span className={`text-sm ${textSecondaryClass}`}>Guided Trips</span>
                </div>
              </div>
              <p className={`text-xs ${textSecondaryClass} mt-6`}>
                <Sparkles className="w-3 h-3 inline mr-1" />
                Coming Soon
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SurfPassport;
