import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePersona } from '../contexts/PersonaContext';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { 
  Radio, Camera, Image, Calendar, DollarSign, MapPin, 
  ChevronRight, X, Zap, Award, Flame
} from 'lucide-react';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { ROLES } from '../constants/roles';


/**
 * Photo Tools Drawer - Root category menu for photographers
 * Opens from bottom nav Tab 2 for photographer roles
 */
export const PhotoToolsDrawer = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { theme } = useTheme();
  const { getEffectiveRole } = usePersona();
  const [onDemandActive, setOnDemandActive] = useState(false);
  const [_onDemandLoading, setOnDemandLoading] = useState(false);
  const [stats, setStats] = useState({
    activeSessions: 0,
    todayEarnings: 0,
    pendingBookings: 0,
    galleryPhotos: 0,
    xp: 0,
    streak: 0,
    badges: []
  });
  
  const isLight = theme === 'light';
  const bgClass = isLight ? 'bg-white' : 'bg-zinc-900';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-800';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  
  // Get effective role (respects God Mode)
  const effectiveRole = getEffectiveRole(user?.role);
  
  // ============ ROLE-BASED PERMISSION LOGIC (STRICT) ============
  // Grom Parent: NO Live Sessions, NO On-Demand (Gallery/Bookings only)
  // Hobbyist: Live Sessions ONLY (if no Pros nearby), NO On-Demand
  // Photographer & Pro: Full access to BOTH Live Sessions and On-Demand
  
  const isGromParent = effectiveRole === ROLES.GROM_PARENT;
  const isHobbyist = effectiveRole === ROLES.HOBBYIST;
  
  // Check if user can use Live Sessions
  const _canUseLiveSessions = !isGromParent; // Everyone except Grom Parent
  
  // Check if user can use On-Demand (Photographer, Pro, Approved Pro - NOT Hobbyist/Grom Parent)
  const canUseOnDemand = ['Photographer', 'Pro', 'Approved Pro'].includes(effectiveRole);
  
  // ============ GEOGRAPHIC RANGE LOGIC (Role-Based) ============
  // Standard Photographers: 10-20 mile GPS radius
  // Verified Pro Photographers: 30-50 mile radius
  const getGeographicRadius = () => {
    if (effectiveRole === ROLES.APPROVED_PRO) return { min: 30, max: 50, default: 40 };
    if (effectiveRole === ROLES.PRO) return { min: 30, max: 50, default: 40 };
    return { min: 10, max: 20, default: 15 }; // Standard Photographer/Hobbyist
  };
  
  const geoRadius = getGeographicRadius();
  
  // Fetch photographer stats and on-demand status
  useEffect(() => {
    if (isOpen && user?.id) {
      fetchStats();
      fetchNearbyShooters();
      if (canUseOnDemand) {
        fetchOnDemandStatus();
      }
    }
  }, [isOpen, user?.id, canUseOnDemand]);
  
  const [_nearbyShooters, setNearbyShooters] = useState(0);
  
  const fetchNearbyShooters = async () => {
    try {
      // Get user's location and fetch live photographers nearby
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
          const response = await apiClient.get(`/photographers/live`, {
            params: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              radius: 25
            }
          });
          // Filter out current user
          const others = (response.data || []).filter(p => p.id !== user?.id);
          setNearbyShooters(others.length);
        }, () => {
          // If geolocation fails, just get all live photographers
          apiClient.get(`/photographers/live`).then(res => {
            const others = (res.data || []).filter(p => p.id !== user?.id);
            setNearbyShooters(others.length);
          }).catch(() => {});
        });
      }
    } catch (error) {
      logger.error('Failed to fetch nearby shooters:', error);
    }
  };
  
  const fetchStats = async () => {
    try {
      const response = await apiClient.get(`/photographer/${user.id}/stats`);
      if (response.data) {
        setStats(prev => ({
          ...prev,
          ...response.data
        }));
      }
    } catch (error) {
      logger.error('Failed to fetch stats:', error);
    }
  };
  
  const fetchOnDemandStatus = async () => {
    try {
      const response = await apiClient.get(`/photographer/${user.id}/on-demand-status`);
      setOnDemandActive(response.data?.is_available || false);
    } catch (error) {
      logger.error('Failed to fetch on-demand status:', error);
    }
  };
  
  const _toggleOnDemand = async () => {
    if (!canUseOnDemand) {
      toast.error('On-Demand is only available for Pro photographers');
      return;
    }
    
    // If turning ON, redirect to settings page for spot selection sequence
    if (!onDemandActive) {
      onClose();
      navigate('/photographer/on-demand-settings?init=true');
      toast.info('Select your coverage spots to go On-Demand', {
        description: `Your range: ${geoRadius.min}-${geoRadius.max} miles based on your Pro status`
      });
      return;
    }
    
    // If turning OFF, just toggle off directly
    setOnDemandLoading(true);
    try {
      const _response = await apiClient.post(`/photographer/${user.id}/on-demand-toggle`, {
        is_available: false
      });
      
      setOnDemandActive(false);
      toast.info('On-Demand OFF - You\'re hidden from the request pool');
    } catch (error) {
      logger.error('Failed to toggle on-demand:', error);
      toast.error(error.response?.data?.detail || 'Failed to update On-Demand status');
    } finally {
      setOnDemandLoading(false);
    }
  };
  
  // ============ MOBILE PHOTO HUB - FINAL HIERARCHY (Clean Vertical Menu) ============
  // Order: Gallery Hub → Bookings Manager → Live Sessions → Earnings Dashboard → On-Demand Settings
  // GROM PARENT: ONLY sees "Grom Archive" - NO Bookings, Live Sessions, Earnings, On-Demand
  
  const getMenuItems = () => {
    // GROM PARENT RESTRICTION: Only "Grom Archive" is visible
    // NO Bookings, NO Live Sessions, NO Earnings, NO On-Demand
    if (isGromParent) {
      return [
        {
          id: 'gallery',
          icon: Image,
          label: 'Grom Archive',
          description: 'Manage your Grom\'s surf photos',
          path: '/gallery',
          color: 'text-cyan-400',
          bgColor: 'bg-cyan-500/10',
          badge: stats.galleryPhotos > 0 ? `${stats.galleryPhotos} photos` : null
        }
      ];
    }
    
    // HOBBYIST: Gallery only - no Bookings, no Earnings, no On-Demand
    if (isHobbyist) {
      return [
        {
          id: 'gallery',
          icon: Image,
          label: 'Gallery Hub',
          description: 'Upload, tag, and manage your photos',
          path: '/gallery',
          color: 'text-cyan-400',
          bgColor: 'bg-cyan-500/10',
          badge: stats.galleryPhotos > 0 ? `${stats.galleryPhotos} photos` : null
        },
        // Live Sessions - restricted for Hobbyist
        {
          id: 'live-sessions',
          icon: Radio,
          label: 'Live Sessions',
          description: 'Go live when no Pros nearby',
          path: '/photographer/sessions',
          color: 'text-red-400',
          bgColor: 'bg-red-500/10',
          badge: stats.activeSessions > 0 ? `${stats.activeSessions} LIVE` : null,
          badgeColor: 'bg-red-500',
          restricted: 'Hobbyist'
        }
      ];
    }
    
    // PROFESSIONAL PHOTOGRAPHERS: Full access
    return [
      // 1. MY GALLERY - CMS & Folders
      {
        id: 'gallery',
        icon: Image,
        label: 'Gallery Hub',
        description: 'Folders, sessions & distribution',
        path: '/gallery',
        color: 'text-cyan-400',
        bgColor: 'bg-cyan-500/10',
        badge: stats.galleryPhotos > 0 ? `${stats.galleryPhotos} photos` : null
      },
      
      // 2. BOOKINGS MANAGER - Tiered Pricing & Calendar
      {
        id: 'bookings',
        icon: Calendar,
        label: 'Bookings Manager',
        description: 'Calendar • Crew splits • Tiered pricing',
        path: '/photographer/bookings',
        color: 'text-purple-400',
        bgColor: 'bg-purple-500/10',
        badge: stats.pendingBookings > 0 ? `${stats.pendingBookings} pending` : null,
        badgeColor: 'bg-purple-500',
        hasNew: true
      },
      
      // 3. LIVE SESSIONS - Start & Manage
      {
        id: 'live-sessions',
        icon: Radio,
        label: 'Live Sessions',
        description: 'Start shooting, manage active sessions',
        path: '/photographer/sessions',
        color: 'text-red-400',
        bgColor: 'bg-red-500/10',
        badge: stats.activeSessions > 0 ? `${stats.activeSessions} LIVE` : null,
        badgeColor: 'bg-red-500'
      },
      
      // 4. EARNINGS DASHBOARD - Payouts
      {
        id: 'earnings',
        icon: DollarSign,
        label: 'Earnings Dashboard',
        description: 'Revenue, payouts, analytics',
        path: '/photographer/earnings',
        color: 'text-green-400',
        bgColor: 'bg-green-500/10',
        badge: stats.todayEarnings > 0 ? `$${stats.todayEarnings} today` : null,
        badgeColor: 'bg-green-500'
      },
      
      // 5. ON-DEMAND SETTINGS - Pro Only
      ...(canUseOnDemand ? [{
        id: 'on-demand-settings',
        icon: MapPin,
        label: 'On-Demand Settings',
        description: 'Spots, pricing & availability',
        path: '/photographer/on-demand-settings',
        color: 'text-amber-400',
        bgColor: 'bg-amber-500/10',
        isPro: true
      }] : [])
    ];
  };
  
  const menuItems = getMenuItems();
  
  // Removed separate onDemandSettingsItem - now integrated into menuItems
  
  const handleNavigation = (path) => {
    onClose();
    navigate(path);
  };
  
  if (!isOpen) return null;
  
  return (
    <>
      {/* Backdrop - doesn't cover bottom nav */}
      <div 
        className="fixed inset-x-0 top-0 bg-black/60 z-[999]"
        style={{ bottom: '80px' }}
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div 
        className={`fixed inset-x-0 z-[1000] ${bgClass} rounded-t-3xl border-t ${borderClass} shadow-2xl`}
        style={{ 
          bottom: '80px', // Account for bottom navigation height
          maxHeight: '70vh',
          paddingBottom: 'env(safe-area-inset-bottom, 8px)'
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className={`w-12 h-1.5 rounded-full ${isLight ? 'bg-gray-300' : 'bg-zinc-700'}`} />
        </div>
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className={`text-lg font-bold ${textPrimary}`}>
                {isGromParent ? 'Grom Archive' : 'Photo Tools'}
              </h2>
              <p className={`text-xs ${textSecondary}`}>
                {isGromParent ? 'Manage your Grom\'s memories' : 'Manage your photography business'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className={`p-2 ${textSecondary} hover:${textPrimary}`}>
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Scrollable Content */}
        <div 
          className="overflow-y-auto px-4 py-4 space-y-4"
          style={{ 
            maxHeight: 'calc(70vh - 100px)',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {/* GROM PARENT: Simple single-action view */}
          {isGromParent ? (
            <div className="py-4">
              {/* Single large button to go to Grom Archive */}
              <button
                onClick={() => handleNavigation('/gallery')}
                className="w-full p-6 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/40 hover:border-cyan-400 transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/30">
                    <Image className="w-7 h-7 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className={`text-lg font-bold ${textPrimary} group-hover:text-cyan-400 transition-colors`}>
                      Open Grom Archive
                    </p>
                    <p className={`text-sm ${textSecondary}`}>
                      View, organize & tag your Grom's surf photos
                    </p>
                    {stats.galleryPhotos > 0 && (
                      <span className="inline-block mt-2 px-2 py-0.5 bg-cyan-500/30 text-cyan-400 text-xs font-medium rounded">
                        {stats.galleryPhotos} photos
                      </span>
                    )}
                  </div>
                  <ChevronRight className="w-6 h-6 text-cyan-400 group-hover:translate-x-1 transition-transform" />
                </div>
              </button>
              
              {/* Helpful tip */}
              <p className={`text-center text-xs ${textSecondary} mt-4`}>
                Tag photos with your Grom's profile to share to their highlights
              </p>
            </div>
          ) : (
            <>
              {/* Gamification Stats - Only for non-Grom Parents */}
              <div className={`p-4 rounded-2xl ${isLight ? 'bg-gradient-to-r from-amber-50 to-orange-50' : 'bg-gradient-to-r from-amber-500/10 to-orange-500/10'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-amber-400" />
                    <span className={`font-bold ${textPrimary}`}>Your Stats</span>
                  </div>
                  <button 
                    onClick={() => handleNavigation('/leaderboard')}
                    className="text-xs text-amber-400 hover:text-amber-300"
                  >
                    View Leaderboard →
                  </button>
                </div>
            
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-amber-400">{stats.xp || 0}</div>
                    <div className={`text-xs ${textSecondary}`}>XP</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Flame className="w-4 h-4 text-orange-500" />
                      <span className="text-2xl font-bold text-orange-500">{stats.streak || 0}</span>
                    </div>
                    <div className={`text-xs ${textSecondary}`}>Month Streak</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Award className="w-4 h-4 text-purple-400" />
                      <span className="text-2xl font-bold text-purple-400">{stats.badges?.length || 0}</span>
                    </div>
                    <div className={`text-xs ${textSecondary}`}>Badges</div>
                  </div>
                </div>
            
                {/* Hot Streak Indicator */}
                {stats.streak >= 3 && (
                  <div className="mt-3 pt-3 border-t border-amber-500/30">
                    <div className="flex items-center gap-2 text-orange-400 animate-pulse">
                      <Flame className="w-4 h-4" />
                      <span className="text-sm font-medium">🔥 Hot Streak! 2x XP Active (3+ this month)</span>
                    </div>
                  </div>
                )}
              </div>
          
              {/* CLEAN VERTICAL MENU - Photo Hub (Non-Grom Parents only) */}
              <div className="space-y-2">
                {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleNavigation(item.path)}
                className={`w-full p-4 rounded-2xl ${isLight ? 'bg-gray-50 hover:bg-gray-100' : 'bg-zinc-800/50 hover:bg-zinc-800'} transition-all`}
                data-testid={`menu-item-${item.id}`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl ${item.bgColor} flex items-center justify-center`}>
                    <item.icon className={`w-6 h-6 ${item.color}`} />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${textPrimary}`}>{item.label}</span>
                      {item.badge && (
                        <Badge className={`${item.badgeColor || 'bg-zinc-600'} text-white text-xs`}>
                          {item.badge}
                        </Badge>
                      )}
                      {item.hasNew && (
                        <Badge className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black text-xs">
                          NEW
                        </Badge>
                      )}
                      {item.restricted && (
                        <Badge className="bg-amber-500/20 text-amber-400 text-xs border border-amber-500/30">
                          {item.restricted}
                        </Badge>
                      )}
                      {item.isPro && (
                        <Badge className="bg-amber-500 text-black text-xs">
                          PRO
                        </Badge>
                      )}
                    </div>
                    <p className={`text-xs ${textSecondary}`}>{item.description}</p>
                  </div>
                  <ChevronRight className={`w-5 h-5 ${textSecondary}`} />
                </div>
              </button>
            ))}
          </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default PhotoToolsDrawer;
