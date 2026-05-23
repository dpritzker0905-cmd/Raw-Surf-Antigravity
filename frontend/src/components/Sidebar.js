import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePersona, getExpandedRoleInfo } from '../contexts/PersonaContext';
import { Home, Compass, MapPin, MessageCircle, Bell, User, Settings, LogOut, Shield, ShoppingBag, Sun, Moon, Waves, Eye, Lock, Plus } from 'lucide-react';
import apiClient from '../lib/apiClient';
import { getUnreadCount } from '../services/notificationService';
import { SurfPassport } from './SurfPassport';
import { GlobalSearchBar } from './GlobalSearchBar';
import useActiveSession from '../hooks/useActiveSession';
import logger from '../utils/logger';
import { ROLES } from '../constants/roles';
import { AdaptiveBackground } from './AdaptiveBackground';

export const Sidebar = () => {
  const { user, logout } = useAuth();
  const { theme } = useTheme();
  const { getEffectiveRole, isMasked, _activePersona, _isGodMode } = usePersona();
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [passportOpen, setPassportOpen] = useState(false);
  const [logoSpinning, setLogoSpinning] = useState(false);
  const { activeSession } = useActiveSession();

  // Logo click: refresh current page in-place
  // On /feed: triggers full feed refresh + scroll to top
  // On any other page: just scrolls to top (universal refresh gesture)
  // The Home nav button is for actually navigating to /feed
  const handleLogoClick = useCallback(() => {
    if (location.pathname === '/feed') {
      window.dispatchEvent(new CustomEvent('feed:refresh'));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setLogoSpinning(true);
    setTimeout(() => setLogoSpinning(false), 600);
  }, [location.pathname]);
  
  // Get effective role for UI rendering (respects God Mode persona masking)
  const effectiveRole = getEffectiveRole(user?.role);
  const roleInfo = getExpandedRoleInfo(effectiveRole);

  // Dynamic theme icon based on active theme
  const getThemeIcon = () => {
    if (theme === 'light') return Sun;
    if (theme === 'beach') return Waves;
    return Moon; // dark mode
  };
  const ThemeIcon = getThemeIcon();

  // Theme-specific classes
  const isLight = theme === 'light';
  const _isDark = theme === 'dark';
  const isBeach = theme === 'beach';
  
  // Sidebar background: white for light, dark gray for dark, pure black for beach
  const sidebarBgClass = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-black border-zinc-900' : 'bg-zinc-900 border-zinc-800';
  const textPrimaryClass = isLight ? 'text-gray-900' : isBeach ? 'text-white' : 'text-white';
  // Beach mode gets brighter secondary text for better visibility
  const textSecondaryClass = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-gray-400';
  const hoverBgClass = isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-800';
  const borderClass = isLight ? 'border-gray-200' : isBeach ? 'border-zinc-900' : 'border-zinc-800';
  
  // Home button highlight: lime-to-yellow for light/beach, yellow-to-orange for dark
  const activeHighlightClass = isLight || isBeach 
    ? 'bg-gradient-to-r from-lime-400 to-yellow-400 text-black font-medium'
    : 'bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-medium';

  // Photographer checks removed as they are handled in RightSidebar
  
  // Check if user is a surfer (not photographer-only roles)
  const isSurfer = ['Grom', 'Surfer', 'Comp Surfer', 'Pro'].includes(effectiveRole);
  
  // Check if user is a hobbyist (shows Gear Hub) - Grom Parent is NOT a hobbyist (gets Grom HQ instead)
  const isHobbyist = effectiveRole === ROLES.HOBBYIST;
  
  // Check if user is a Grom Parent (shows Grom HQ)
  const isGromParent = effectiveRole === ROLES.GROM_PARENT || user?.is_grom_parent === true;

  useEffect(() => {
    if (user?.id) {
      fetchUnreadCount();
      fetchUnreadMessages();
      // Poll every 30 seconds for new notifications and messages (sidebar badges)
      const notifInterval = setInterval(() => {
        fetchUnreadCount();
        fetchUnreadMessages();
      }, 30000);
      // Auto-refresh feed every 60 seconds when on /feed (Twitter/Instagram pattern)
      const feedInterval = setInterval(() => {
        if (window.location.pathname === '/feed') {
          window.dispatchEvent(new CustomEvent('feed:refresh', { detail: { silent: true } }));
        }
      }, 60000);
      return () => {
        clearInterval(notifInterval);
        clearInterval(feedInterval);
      };
    }
  }, [user?.id]);

  // Listen for global open-passport events from RightSidebar
  useEffect(() => {
    const handleOpenPassport = () => {
      setPassportOpen(true);
    };
    window.addEventListener('open-passport', handleOpenPassport);
    return () => {
      window.removeEventListener('open-passport', handleOpenPassport);
    };
  }, []);

  const fetchUnreadCount = async () => {
    try {
      const response = await getUnreadCount(user.id);
      setUnreadCount(response.data.unread_count || 0);
    } catch (error) {
      logger.error('Failed to fetch notification count:', error);
    }
  };

  const fetchUnreadMessages = async () => {
    try {
      // Use the lightweight unread-counts endpoint instead of downloading
      // the full conversation list (which eagerly loads all messages).
      const response = await apiClient.get(`/messages/unread-counts/${user.id}`);
      setUnreadMessages(response.data.total || 0);
    } catch (error) {
      logger.error('Failed to fetch message count:', error);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  // Build nav items dynamically based on user role
  const navItems = [
    { path: '/feed', icon: Home, label: 'Home' },
    // Notifications moved up for engagement - right below Home
    { path: '/notifications', icon: Bell, label: 'Notifications', badge: unreadCount },
    { path: '/explore', icon: Compass, label: 'Explore' },
    { path: '/map', icon: MapPin, label: 'Map' },
    // Create button - special handling (not a NavLink)
    { id: 'create', icon: Plus, label: 'Create', isCreateButton: true },
    // Grom HQ for Grom Parents (Shield icon)
    ...(isGromParent ? [{ path: '/grom-hq', icon: Shield, label: 'Grom HQ', highlight: true, highlightColor: 'cyan' }] : []),
    ...(isHobbyist ? [{ path: '/gear-hub', icon: ShoppingBag, label: 'Gear Hub', highlight: true, highlightColor: 'emerald' }] : []),
    { path: '/messages', icon: MessageCircle, label: 'Messages', badge: unreadMessages },
    // My Gallery for Surfers - "The Locker" - positioned after Messages per Master Logic Sync
    ...(isSurfer ? [{ path: '/my-gallery', icon: Lock, label: 'My Gallery', highlight: true, highlightColor: 'cyan' }] : []),
    { path: '/profile', icon: User, label: 'Profile' },
  ];

  // Removed Backpack and Photo Tools configurations (Moved to RightSidebar)

  // Get role badge color
  const _getRoleBadgeColor = (role) => {
    const surferRoles = ['Grom', 'Surfer', 'Comp Surfer', 'Pro'];
    const photographerRoles = ['Grom Parent', 'Hobbyist', 'Photographer', 'Approved Pro'];
    
    if (surferRoles.includes(role)) return 'bg-yellow-400';
    if (photographerRoles.includes(role)) return 'bg-cyan-400';
    return 'bg-emerald-400'; // Business
  };

  return (
    <aside className={`fixed left-0 top-0 h-full w-[200px] ${sidebarBgClass} border-r flex flex-col z-[100] hidden md:flex transition-colors duration-300 overflow-hidden sidebar-left`}>
      <AdaptiveBackground />
      {/* Logo - Compact, clickable (Instagram-style refresh) */}
      <div className={`p-3 border-b ${borderClass} flex-shrink-0 z-10 relative`}>
        <button
          onClick={handleLogoClick}
          className="flex items-center gap-2 group cursor-pointer"
          title={location.pathname === '/feed' ? 'Refresh feed' : 'Go to Feed'}
          aria-label={location.pathname === '/feed' ? 'Refresh feed' : 'Go to Feed'}
        >
          <img loading="lazy" decoding="async"
            src="/logo.svg"
            alt="Raw Surf"
            className={`w-7 h-7 transition-transform duration-300 ${
              logoSpinning ? 'rotate-[360deg]' : ''
            } group-hover:scale-110`}
            style={{ transition: logoSpinning ? 'transform 0.6s cubic-bezier(0.34,1.56,0.64,1)' : 'transform 0.2s ease' }}
          />
          <span className={`text-base font-bold ${textPrimaryClass} group-hover:opacity-80 transition-opacity font-oswald`} >Raw Surf</span>
        </button>
        
        {/* Role badge - shows actual role or persona when masking */}
        {user && (
          <div className="mt-2">
            {isMasked ? (
              <>
                <span className={`text-[10px] ${textSecondaryClass} flex items-center gap-1`}>
                  <Eye className="w-3 h-3 text-cyan-400" />
                  Testing as
                </span>
                <div className="mt-0.5 flex items-center gap-1">
                  <span className="text-sm">{roleInfo.icon}</span>
                  <span className={`text-[11px] font-medium ${roleInfo.color}`}>
                    {roleInfo.label}
                  </span>
                </div>
                <span className="text-[9px] text-cyan-400 block">
                  (God Mode - Actual: {getExpandedRoleInfo(user.role)?.label || user.role})
                </span>
              </>
            ) : (
              <>
                <span className={`text-[10px] ${textSecondaryClass}`}>Your Role</span>
                <div className="mt-0.5 flex items-center gap-1">
 <span className="text-sm">{getExpandedRoleInfo(user.role)?.icon || '='}</span>
                  <span className={`text-[11px] font-medium ${getExpandedRoleInfo(user.role)?.color || 'text-cyan-400'}`}>
                    {getExpandedRoleInfo(user.role)?.label || user.role}
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Navigation - Scrollable section with minimum height */}
      <nav className="flex-1 p-2 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent z-10 relative" role="navigation" aria-label="Main navigation">
        {navItems.map((item, _index) => {
          const Icon = item.icon;
          
          // Dynamic highlight colors based on item.highlightColor
          const getHighlightClasses = (color, isActive) => {
            const colors = {
              amber: isActive ? 'bg-amber-500 text-black font-medium' : 'text-amber-400 hover:bg-amber-500/10',
              cyan: isActive ? 'bg-cyan-500 text-black font-medium' : 'text-cyan-400 hover:bg-cyan-500/10',
              yellow: isActive ? 'bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-medium' : 'text-yellow-400 hover:bg-yellow-500/10',
              pink: isActive ? 'bg-pink-500 text-white font-medium' : 'text-pink-400 hover:bg-pink-500/10',
              emerald: isActive ? 'bg-emerald-500 text-black font-medium' : 'text-emerald-400 hover:bg-emerald-500/10',
              red: isActive ? 'bg-red-500 text-white font-medium' : 'text-red-400 hover:bg-red-500/10'
            };
            return colors[color] || colors.red;
          };
          
          // Insert Search Bar after Map item
          const isMapItem = item.path === '/map';
          
          // Locked item - show placeholder instead of NavLink
          if (item.isLocked) {
            return (
              <div
                key={item.path}
                className="flex items-center gap-2 px-3 py-2 rounded-lg mb-0.5 text-gray-600 cursor-not-allowed text-sm"
                data-testid={`nav-${item.label.toLowerCase()}-locked`}
                title="Compete to unlock the Stoked Sponsorship Engine"
              >
                <div className="relative">
                  <Icon className="w-4 h-4 opacity-50" />
                  <Lock className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5 text-gray-500" />
                </div>
                <div className="flex flex-col">
                  <span className="opacity-50">{item.label}</span>
                  <span className="text-[9px] text-gray-500">Compete to unlock</span>
                </div>
              </div>
            );
          }

          // Create button - special handling, navigates to /create
          if (item.isCreateButton) {
            return (
              <button
                key="create"
                onClick={() => navigate('/create')}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg mb-0.5 transition-all text-sm ${textSecondaryClass} ${hoverBgClass} hover:${textPrimaryClass}`}
                data-testid="nav-create"
              >
                <Plus className="w-4 h-4" />
                <span>Create</span>
              </button>
            );
          }

          // Removed Backpack rendering (Moved to RightSidebar)
          
          return ([
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg mb-0.5 transition-all text-sm ${
                  isActive
                    ? item.highlight 
                      ? getHighlightClasses(item.highlightColor, true)
                      : activeHighlightClass
                    : item.highlight
                      ? getHighlightClasses(item.highlightColor, false)
                      : `${textSecondaryClass} ${hoverBgClass} hover:${textPrimaryClass}`
                }`
              }
              data-testid={`nav-${item.label.toLowerCase().replace(' ', '-')}`}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {item.badge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full" aria-live="polite" aria-atomic="true">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>
              <span>{item.label}</span>
            </NavLink>,
            // Insert search bar after Map item
            isMapItem && (
              <div key="search-bar" className="px-2 py-2">
                <GlobalSearchBar variant="desktop" className="w-full" />
              </div>
            ),
          ].filter(Boolean));
        })}

        {/* Active Session Indicator - standalone, visible to ALL roles */}
        {activeSession && (
          <button
            onClick={() => {
              if (['accepted', 'en_route', 'arrived', 'in_session'].includes(activeSession.status)) {
                navigate(`/dispatch/${activeSession.id}/lobby`);
              } else {
                navigate('/bookings?tab=on_demand');
              }
            }}
            className="w-full px-3 py-1.5 text-left transition-all hover:opacity-80"
            data-testid="sidebar-active-session"
          >
            <span
              className={`text-[11px] font-semibold animate-pulse ${
                activeSession.role === 'crew_member' ? 'text-cyan-400' : 'text-amber-400'
              }`}
            >
              {activeSession.status === 'in_session'
 ? '=+ Live Shooting Session Active'
                : activeSession.status === 'searching_for_pro'
 ? '= On-Demand Session Searching...'
                : activeSession.status === 'en_route'
 ? '= Photographer On The Way'
                : activeSession.status === 'arrived'
 ? '= Photographer Arrived'
                : '? On-Demand Session Active'
              }
            </span>
          </button>
        )}

        {/* Photo Tools Section extracted to RightSidebar */}
      </nav>

      {/* Bottom actions - Compact for smaller screens */}
      <div className={`p-2 border-t ${borderClass} flex-shrink-0 z-10 relative`}>
        {/* Settings - User preferences, notifications, billing */}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-2 rounded-lg mb-0.5 transition-all text-sm ${
              isActive
                ? activeHighlightClass
                : `${textSecondaryClass} ${hoverBgClass} hover:${textPrimaryClass}`
            }`
          }
          data-testid="nav-settings"
        >
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </NavLink>
        
        {/* Admin Console - Only visible to admins (Unified entry point) */}
        {user?.is_admin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2 rounded-lg mb-0.5 transition-all text-sm ${
                isActive
                  ? 'bg-gradient-to-r from-red-500 to-yellow-500 text-black font-medium'
                  : 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
              }`
            }
            data-testid="nav-admin-console"
          >
            <Shield className="w-4 h-4" />
            <span>Admin Console</span>
          </NavLink>
        )}
        
        {/* Theme & Logout in a row to save space */}
        <div className="flex items-center gap-1 mt-1">
          <NavLink
            to="/theme"
            className={({ isActive }) =>
              `flex-1 flex items-center justify-center gap-2 px-2 py-2 rounded-lg transition-all text-sm ${
                isActive
                  ? activeHighlightClass
                  : `${textSecondaryClass} ${hoverBgClass} hover:${textPrimaryClass}`
              }`
            }
            data-testid="nav-theme"
          >
            <ThemeIcon className="w-4 h-4" />
            <span className="hidden lg:inline">Theme</span>
          </NavLink>
          
          <button aria-label="Log Out"
            onClick={handleLogout}
            className={`flex-1 flex items-center justify-center gap-2 px-2 py-2 rounded-lg ${textSecondaryClass} ${hoverBgClass} hover:${textPrimaryClass} transition-all text-sm`}
            data-testid="nav-logout"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden lg:inline">Log out</span>
          </button>
        </div>
      </div>
      
      {/* Surf Passport Modal */}
      <SurfPassport isOpen={passportOpen} onClose={() => setPassportOpen(false)} />
    </aside>
  );
};
