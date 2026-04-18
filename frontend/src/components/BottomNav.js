import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Compass, Plus, Camera, MessageCircle, Waves } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { PhotoToolsDrawer } from './PhotoToolsDrawer';
import axios from 'axios';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Animated Wave Home Icon - Simple Lucide Waves with gentle animation
 */
const AnimatedWaveIcon = ({ isActive, isPressed, hasNewContent, className = '' }) => {
  const [frame, setFrame] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setFrame(prev => (prev + 1) % 40);
    }, 80);
    return () => clearInterval(interval);
  }, []);
  
  const scale = isPressed ? 0.85 : isActive ? 1.1 : 1;
  const t = frame / 40;
  
  // Gentle wave motion - subtle rotation and bob
  const rotate = Math.sin(t * Math.PI * 2) * 4;
  const translateY = Math.sin(t * Math.PI * 2) * 1.5;
  
  return (
    <div 
      className={`relative ${className}`}
      style={{
        transform: `scale(${scale}) rotate(${rotate}deg) translateY(${translateY}px)`,
        transition: 'transform 0.1s ease-out',
        filter: isActive ? 'drop-shadow(0 0 4px rgba(56, 189, 248, 0.6))' : 'none'
      }}
    >
      <Waves 
        size={24} 
        strokeWidth={2.5}
        className={isActive ? 'text-cyan-400' : 'text-gray-500'}
      />
      {hasNewContent && (
        <span className="absolute -top-1 -right-1 w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
      )}
    </div>
  );
};

/**
 * Home Wave Button - Wrapper component for proper hooks usage
 */
const HomeWaveButton = ({ textActiveClass, textInactiveClass, onNavigate }) => {
  const [isPressed, setIsPressed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isActive = location.pathname === '/feed' || location.pathname === '/';
  
  const handleClick = (e) => {
    e.preventDefault();
    if (onNavigate) onNavigate('/feed');
    else navigate('/feed');
  };
  
  return (
    <button
      onClick={handleClick}
      className={`flex flex-col items-center gap-0.5 min-w-[56px] py-1 ${isActive ? textActiveClass : textInactiveClass}`}
      data-testid="bottomnav-home"
    >
      <div 
        className="flex flex-col items-center gap-0.5"
        onTouchStart={() => setIsPressed(true)}
        onTouchEnd={() => setIsPressed(false)}
        onMouseDown={() => setIsPressed(true)}
        onMouseUp={() => setIsPressed(false)}
        onMouseLeave={() => setIsPressed(false)}
      >
        <AnimatedWaveIcon 
          isActive={isActive}
          isPressed={isPressed}
          hasNewContent={false}
          className={`w-6 h-6 ${isActive ? 'text-cyan-400' : textInactiveClass}`}
        />
        <span className={`text-[10px] font-medium ${isActive ? textActiveClass : textInactiveClass}`}>Home</span>
      </div>
    </button>
  );
};

/**
 * Mobile Bottom Navigation - Restructured April 2026
 * 
 * NEW LAYOUT - Thumb-Zone Optimized with Messages:
 * 
 * Tab 1: Home - Global (Social Feed)
 * Tab 2: Action Center (Role-Based):
 *        - Surfers: Explore Tab
 *        - Photographers: Photo Tools Tab
 * Tab 3: Create Post - Center Action (prominent, high-contrast)
 * Tab 4: Messages - HIGH-FREQUENCY THUMB ACCESS (moved from TopNav)
 * Tab 5: Me - Universal Profile (Mini Photo)
 * 
 * NOTE: Results Center (Gear/Stoked/Impact/Grom HQ) moved to TopNav as Dynamic Persona Icon
 */
export const BottomNav = () => {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { getEffectiveRole } = usePersona();
  const navigate = useNavigate();
  const location = useLocation();
  
  // State for Photo Tools drawer and unread messages
  const [showPhotoTools, setShowPhotoTools] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [freshAvatarUrl, setFreshAvatarUrl] = useState(null);
  
  // Fetch fresh avatar URL from profile API to avoid stale cached data
  useEffect(() => {
    const fetchFreshAvatar = async () => {
      if (!user?.id) return;
      try {
        const response = await axios.get(`${API}/profiles/${user.id}`);
        const avatarFromApi = response.data.avatar_url;
        if (avatarFromApi) {
          // Add cache buster with current timestamp
          const separator = avatarFromApi.includes('?') ? '&' : '?';
          setFreshAvatarUrl(`${avatarFromApi}${separator}v=${Date.now()}`);
        } else {
          setFreshAvatarUrl(null);
        }
      } catch (error) {
        // Fallback to context avatar if API fails
        logger.error('Failed to fetch fresh avatar:', error);
      }
    };
    
    fetchFreshAvatar();
  }, [user?.id, user?.avatar_url, user?.updated_at]);
  
  // Use fresh avatar URL if available, otherwise fallback to context
  const avatarUrl = useMemo(() => {
    if (freshAvatarUrl) return freshAvatarUrl;
    if (!user?.avatar_url) return null;
    // Add cache buster using updated_at timestamp or current time hash
    const cacheBuster = user?.updated_at 
      ? new Date(user.updated_at).getTime() 
      : Date.now();
    const separator = user.avatar_url.includes('?') ? '&' : '?';
    return `${user.avatar_url}${separator}v=${cacheBuster}`;
  }, [user?.avatar_url, user?.updated_at, freshAvatarUrl]);
  
  // Get effective role for UI rendering (respects God Mode masking)
  const effectiveRole = getEffectiveRole(user?.role);
  
  // Role categorization
  const photographerRoles = ['Grom Parent', 'Hobbyist', 'Photographer', 'Approved Pro'];
  const isPhotographer = photographerRoles.includes(effectiveRole);
  const _isGromParent = effectiveRole === 'Grom Parent' || user?.is_grom_parent === true;
  
  // Theme-specific classes
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const navBgClass = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-black border-zinc-900' : 'bg-zinc-950 border-zinc-800';
  const textActiveClass = isLight ? 'text-gray-900' : 'text-white';
  const textInactiveClass = isLight ? 'text-gray-500' : 'text-zinc-500';

  // Fetch unread messages count
  const fetchUnreadMessages = useCallback(async () => {
    if (!user?.id) return;
    try {
      const response = await axios.get(`${API}/messages/unread-counts/${user.id}`);
      setUnreadMessages(response.data.total || 0);
    } catch (error) {
      logger.error('Failed to fetch message count:', error);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      fetchUnreadMessages();
      // Poll every 30 seconds for new messages
      const interval = setInterval(fetchUnreadMessages, 30000);
      return () => clearInterval(interval);
    }
  }, [user?.id, fetchUnreadMessages]);

  // Dynamically track BottomNav height and expose as --bottomnav-h CSS variable.
  // This drives the safe-bottom clearance system used by all modals and drawers.
  const navRef = React.useRef(null);
  useEffect(() => {
    const el = navRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      document.documentElement.style.setProperty('--bottomnav-h', `${h}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Close Photo Tools drawer when route changes (e.g., navigation from TopNav)
  useEffect(() => {
    setShowPhotoTools(false);
  }, [location.pathname]);


  // Tab 2: Action Center destination & icon (Role-Based)
  const getActionCenterConfig = () => {
    const isDedicatedGromParent = effectiveRole === 'Grom Parent';
    // DEDICATED Grom Parent accounts: Photo Tools (archive-only, no commerce)
    if (isDedicatedGromParent) {
      return {
        path: '/gallery',
        icon: Camera,
        label: 'Photo Tools',
        activeColor: 'text-cyan-400'
      };
    }
    
    if (isPhotographer) {
      return {
        path: '/photographer/sessions',
        icon: Camera,
        label: 'Photo Tools',
        activeColor: 'text-cyan-400'
      };
    }
    // Default for surfers (including surfer+Grom Parent): Explore
    return {
      path: '/explore',
      icon: Compass,
      label: 'Explore',
      activeColor: 'text-yellow-400'
    };
  };

  // Tab 5: Me - Profile destination (ALWAYS goes to personal profile page)
  const getProfileDestination = () => {
    return '/profile';
  };

  const actionConfig = getActionCenterConfig();
  const ActionIcon = actionConfig.icon;

  // Check if current path matches
  const isPathActive = (path) => {
    if (path === '/feed') {
      return location.pathname === '/feed' || location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  // Handler to close any open drawers and navigate
  const handleNavigation = (path) => {
    setShowPhotoTools(false); // Close Photo Tools drawer if open
    navigate(path);
  };

  return (
    <nav 
      ref={navRef}
      className={`fixed bottom-0 left-0 right-0 z-[100] ${navBgClass} border-t md:hidden`}
      style={{ 
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        backgroundColor: isLight ? '#ffffff' : isBeach ? '#000000' : '#09090b'
      }}
      data-testid="bottom-nav"
    >
      <div className="flex items-center justify-around py-2 px-1">
        {/* Tab 1: Home - Animated Wave Icon */}
        <HomeWaveButton 
          textActiveClass={textActiveClass}
          textInactiveClass={textInactiveClass}
          onNavigate={handleNavigation}
        />

        {/* Tab 2: Action Center - Role-Based (Explore / Photo Tools) */}
        {isPhotographer ? (
          // Photographers get Photo Tools Drawer
          <button
            onClick={() => setShowPhotoTools(true)}
            className={`flex flex-col items-center gap-0.5 min-w-[56px] py-1 ${
              showPhotoTools ? actionConfig.activeColor : textInactiveClass
            }`}
            data-testid="bottomnav-action-center"
          >
            <ActionIcon className={`w-6 h-6 ${showPhotoTools ? actionConfig.activeColor : textInactiveClass}`} />
            <span className={`text-[10px] font-medium ${showPhotoTools ? actionConfig.activeColor : textInactiveClass}`}>
              {actionConfig.label}
            </span>
          </button>
        ) : (
          // Surfers get Explore navigation
          <button
            onClick={() => handleNavigation(actionConfig.path)}
            className={`flex flex-col items-center gap-0.5 min-w-[56px] py-1 ${isPathActive(actionConfig.path) ? actionConfig.activeColor : textInactiveClass}`}
            data-testid="bottomnav-action-center"
          >
            <ActionIcon className={`w-6 h-6 ${isPathActive(actionConfig.path) ? actionConfig.activeColor : textInactiveClass}`} />
            <span className={`text-[10px] font-medium ${isPathActive(actionConfig.path) ? actionConfig.activeColor : textInactiveClass}`}>
              {actionConfig.label}
            </span>
          </button>
        )}

        {/* Tab 3: Create Post - Center Action Button */}
        <button
          onClick={() => handleNavigation('/create')}
          className="flex flex-col items-center gap-0.5 -mt-4 relative"
          data-testid="bottomnav-create"
          style={{ zIndex: 110 }}
        >
          <div className="w-14 h-14 rounded-full bg-gradient-to-r from-yellow-400 via-orange-400 to-pink-500 flex items-center justify-center shadow-lg shadow-orange-500/30 border-4 border-zinc-950">
            <Plus className="w-7 h-7 text-black stroke-[3]" />
          </div>
          <span className={`text-[10px] font-bold text-yellow-400 mt-0.5`}>Create</span>
        </button>

        {/* Tab 4: Messages - HIGH-FREQUENCY THUMB ACCESS (moved from TopNav) */}
        <button
          onClick={() => handleNavigation('/messages')}
          className={`flex flex-col items-center gap-0.5 min-w-[56px] py-1 relative ${isPathActive('/messages') ? 'text-blue-400' : textInactiveClass}`}
          data-testid="bottomnav-messages"
        >
          <div className="relative">
            <MessageCircle className={`w-6 h-6 ${isPathActive('/messages') ? 'text-blue-400' : textInactiveClass}`} />
            {unreadMessages > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-0.5 flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full">
                {unreadMessages > 99 ? '99+' : unreadMessages}
              </span>
            )}
          </div>
          <span className={`text-[10px] font-medium ${isPathActive('/messages') ? 'text-blue-400' : textInactiveClass}`}>
            Messages
          </span>
        </button>

        {/* Tab 5: Me - Universal Profile with Mini Photo */}
        <button
          onClick={() => handleNavigation(getProfileDestination())}
          className="flex flex-col items-center gap-0.5 min-w-[56px] py-1"
          data-testid="bottomnav-me"
        >
          <Avatar className="w-7 h-7 border-2 border-zinc-700">
            <AvatarImage src={avatarUrl} key={avatarUrl} />
            <AvatarFallback className="text-[10px] bg-zinc-800 text-white">
              {user?.full_name?.charAt(0) || user?.email?.charAt(0) || 'U'}
            </AvatarFallback>
          </Avatar>
          <span className={`text-[10px] font-medium ${textInactiveClass}`}>
            Me
          </span>
        </button>
      </div>
      
      {/* Photo Tools Drawer - Only rendered for photographers */}
      {isPhotographer && (
        <PhotoToolsDrawer 
          isOpen={showPhotoTools} 
          onClose={() => setShowPhotoTools(false)} 
        />
      )}
    </nav>
  );
};

export default BottomNav;
