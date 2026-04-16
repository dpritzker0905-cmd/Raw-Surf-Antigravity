import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePersona, getExpandedRoleInfo } from '../contexts/PersonaContext';
import { Home, Compass, MapPin, Calendar, MessageCircle, Bell, BellRing, User, Settings, LogOut, Camera, Shield, ChevronDown, ChevronRight, Image, CalendarCheck, Radio, Wallet, ShoppingBag, Heart, Sun, Moon, Waves, Eye, TrendingUp, Zap, Trophy, Crown, Baby, Lock, Plus, Stamp, Target, Backpack, CreditCard } from 'lucide-react';
import axios from 'axios';
import { SurfPassport } from './SurfPassport';
import { GlobalSearchBar } from './GlobalSearchBar';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const Sidebar = () => {
  const { user, logout } = useAuth();
  const { theme } = useTheme();
  const { getEffectiveRole, isMasked, activePersona, isGodMode } = usePersona();
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [photoToolsOpen, setPhotoToolsOpen] = useState(false);
  const [backpackOpen, setBackpackOpen] = useState(false);
  const [passportOpen, setPassportOpen] = useState(false);
  
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
  const isDark = theme === 'dark';
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

  // Check if user is a photographer (use effective role for God Mode)
  const isPhotographer = ['Grom Parent', 'Hobbyist', 'Photographer', 'Approved Pro'].includes(effectiveRole);
  
  // Check if user is a surfer (not photographer-only roles)
  const isSurfer = ['Grom', 'Surfer', 'Comp Surfer', 'Pro'].includes(effectiveRole);
  
  // Check if user is a Grom (shows The Inside hub - includes Stoked features)
  const isGrom = effectiveRole === 'Grom';
  
  // Check if user is a Comp Surfer (shows Impact Zone)
  const isCompSurfer = effectiveRole === 'Comp Surfer';
  
  // Check if user is a Pro (shows The Peak)
  const isPro = effectiveRole === 'Pro';
  
  // Check if user is a regular surfer (role = Surfer, not Comp Surfer/Pro/Grom)
  const isRegularSurfer = effectiveRole === 'Surfer';

  // Check if user qualifies for Stoked tab:
  // - Comp Surfer or Pro role always gets access
  // - Regular Surfer in any competitive/pro surf_mode also gets access
  const isProSurferMode = user?.surf_mode === 'pro';
  const isCompetitiveSurferMode = user?.surf_mode === 'competitive';
  const isCompetitiveSurfer = isCompetitiveSurferMode || isProSurferMode; // used for Stoked access + locking
  const hasStokesAccess = ['Comp Surfer', 'Pro'].includes(effectiveRole) || (isRegularSurfer && isCompetitiveSurfer);
  
  // Locked only if Surfer AND still in casual/non-competitive mode
  const isStokedLocked = isRegularSurfer && !isCompetitiveSurfer;
  
  // Check if user is a hobbyist (shows Gear Hub) - Grom Parent is NOT a hobbyist (gets Grom HQ instead)
  const isHobbyist = effectiveRole === 'Hobbyist';
  
  // Check if user is a Grom Parent (shows Grom HQ)
  const isGromParent = effectiveRole === 'Grom Parent' || user?.is_grom_parent === true;
  
  // Check if current path is a photo tools path
  const isPhotoToolsPath = ['/gallery', '/photographer/bookings', '/photographer/sessions', '/photographer/on-demand', '/photographer/earnings', '/photographer/on-demand-settings'].some(path => 
    location.pathname.startsWith(path)
  );
  
  // Auto-expand photo tools if on a photo tools path
  useEffect(() => {
    if (isPhotoToolsPath) {
      setPhotoToolsOpen(true);
    }
  }, [isPhotoToolsPath]);

  useEffect(() => {
    if (user?.id) {
      fetchUnreadCount();
      fetchUnreadMessages();
      // Poll every 30 seconds for new notifications and messages
      const interval = setInterval(() => {
        fetchUnreadCount();
        fetchUnreadMessages();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [user?.id]);

  const fetchUnreadCount = async () => {
    try {
      const response = await axios.get(`${API}/notifications/${user.id}/unread-count`);
      setUnreadCount(response.data.unread_count || 0);
    } catch (error) {
      logger.error('Failed to fetch notification count:', error);
    }
  };

  const fetchUnreadMessages = async () => {
    try {
      const response = await axios.get(`${API}/messages/conversations/${user.id}`);
      const convs = response.data.conversations || response.data || [];
      const total = convs.reduce((sum, c) => sum + (c.unread_count || 0), 0);
      setUnreadMessages(total);
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
    { path: '/bookings', icon: Calendar, label: 'Bookings' },
    // Create button - special handling (not a NavLink)
    { id: 'create', icon: Plus, label: 'Create', isCreateButton: true },
    // Career Hub: The Peak for Pro role OR Surfer in pro surf_mode
    ...(isPro || (isRegularSurfer && isProSurferMode) ? [{ path: '/career/the-peak', icon: Crown, label: 'The Peak', highlight: true, highlightColor: 'amber' }] : []),
    // Career Hub: Impact Zone for Comp Surfers OR Surfers in competitive surf_mode (NOT pro mode - they get The Peak)
    ...(isCompSurfer || (isRegularSurfer && isCompetitiveSurferMode) ? [{ path: '/career/impact-zone', icon: Target, label: 'Impact Zone', highlight: true, highlightColor: 'orange' }] : []),
    // Career Hub: The Inside for Groms (includes Stoked features - no separate Stoked for Groms)
    ...(isGrom ? [{ path: '/career/the-inside', icon: Baby, label: 'The Inside', highlight: true, highlightColor: 'cyan' }] : []),
    // Stoked tab ONLY for Comp Surfer, Pro - Groms use The Inside instead
    ...(hasStokesAccess ? [{ path: '/stoked', icon: Zap, label: 'Stoked', highlight: true, highlightColor: 'yellow' }] : []),
    // Regular Surfers see Locked placeholder only if in casual mode
    ...(isStokedLocked ? [{ path: '/stoked-locked', icon: Zap, label: 'Stoked', isLocked: true }] : []),
    // Impacted tab for ALL photographers (Hobbyist, Photographer, Approved Pro) - NOT Grom Parent
    ...(!isGromParent && isPhotographer ? [{ path: '/impacted', icon: Heart, label: 'Impacted', highlight: true, highlightColor: 'pink' }] : []),
    // Grom HQ for Grom Parents (Shield icon)
    ...(isGromParent ? [{ path: '/grom-hq', icon: Shield, label: 'Grom HQ', highlight: true, highlightColor: 'cyan' }] : []),
    ...(isHobbyist ? [{ path: '/gear-hub', icon: ShoppingBag, label: 'Gear Hub', highlight: true, highlightColor: 'emerald' }] : []),
    { path: '/messages', icon: MessageCircle, label: 'Messages', badge: unreadMessages },
    // My Gallery for Surfers - "The Locker" - positioned after Messages per Master Logic Sync
    ...(isSurfer ? [{ path: '/my-gallery', icon: Lock, label: 'My Gallery', highlight: true, highlightColor: 'cyan' }] : []),
    // Backpack - expandable menu with Passport, Wallet, Surf Alerts
    { id: 'backpack', icon: Backpack, label: 'Backpack', isBackpackMenu: true, highlight: true, highlightColor: 'amber' },
    { path: '/profile', icon: User, label: 'Profile' },
  ];

  // Photo tools sub-items for photographers - ROLE BASED
  // Grom Parent: Gallery ONLY (renamed to "Grom Archive"), NO commerce
  // Hobbyist: Gallery only - can spend but not earn
  // Photographer/Approved Pro: Full access
  const getPhotoToolsItems = () => {
    if (isGromParent) {
      // Grom Parent: Only archive gallery, zero commerce
      return [
        { path: '/gallery', icon: Image, label: 'Grom Archive' },
      ];
    }
    
    if (effectiveRole === 'Hobbyist') {
      // Hobbyist: Can spend but not earn - no earnings/bookings/sessions
      return [
        { path: '/gallery', icon: Image, label: 'My Gallery' },
      ];
    }
    
    // Professional photographers: Full access
    return [
      { path: '/gallery', icon: Image, label: 'My Gallery' },
      { path: '/photographer/bookings', icon: CalendarCheck, label: 'Bookings Manager' },
      { path: '/photographer/sessions', icon: Radio, label: 'Live Sessions' },
      { path: '/photographer/on-demand', icon: Zap, label: 'On-Demand Hub' },
      { path: '/photographer/earnings', icon: TrendingUp, label: 'Earnings Dashboard' },
    ];
  };
  
  const photoToolsItems = getPhotoToolsItems();
  
  // Backpack sub-items - Passport, Wallet, Surf Alerts
  const backpackItems = [
    { id: 'passport', icon: Stamp, label: 'Surf Passport', isPassportButton: true, color: 'text-emerald-400' },
    { path: '/wallet', icon: CreditCard, label: 'Credit Wallet', color: 'text-yellow-400' },
    { path: '/alerts', icon: BellRing, label: 'Surf Alerts', color: 'text-orange-400' },
  ];
  
  // On-Demand Settings - Available for Photographer and Approved Pro (NOT Hobbyist/Grom Parent)
  const canUseOnDemand = ['Photographer', 'Pro', 'Approved Pro'].includes(effectiveRole);
  const onDemandSettingsItem = canUseOnDemand 
    ? { path: '/photographer/on-demand-settings', icon: MapPin, label: 'On-Demand Settings' }
    : null;

  // Get role badge color
  const getRoleBadgeColor = (role) => {
    const surferRoles = ['Grom', 'Surfer', 'Comp Surfer', 'Pro'];
    const photographerRoles = ['Grom Parent', 'Hobbyist', 'Photographer', 'Approved Pro'];
    
    if (surferRoles.includes(role)) return 'bg-yellow-400';
    if (photographerRoles.includes(role)) return 'bg-cyan-400';
    return 'bg-emerald-400'; // Business
  };

  return (
    <aside className={`fixed left-0 top-0 h-full w-[200px] ${sidebarBgClass} border-r flex flex-col z-[100] hidden md:flex transition-colors duration-300`}>
      {/* Logo - Compact */}
      <div className={`p-3 border-b ${borderClass} flex-shrink-0`}>
        <div className="flex items-center gap-2">
          <img
            src="https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png"
            alt="Raw Surf"
            className="w-7 h-7"
          />
          <span className={`text-base font-bold ${textPrimaryClass}`} style={{ fontFamily: 'Oswald' }}>Raw Surf</span>
        </div>
        
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
                  <span className="text-sm">{getExpandedRoleInfo(user.role)?.icon || '🏄'}</span>
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
      <nav className="flex-1 p-2 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
        {navItems.map((item, index) => {
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

          // Backpack menu - expandable with Passport, Wallet, Alerts
          if (item.isBackpackMenu) {
            return (
              <div key="backpack-menu" className="mb-0.5">
                <button
                  onClick={() => setBackpackOpen(!backpackOpen)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-all text-sm text-amber-400 hover:bg-amber-500/10`}
                  data-testid="nav-backpack"
                >
                  <div className="flex items-center gap-2">
                    <Backpack className="w-4 h-4" />
                    <span>Backpack</span>
                  </div>
                  {backpackOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                {backpackOpen && (
                  <div className="ml-3 pl-3 border-l border-amber-500/20 mt-1 space-y-0.5">
                    {backpackItems.map((subItem) => {
                      const SubIcon = subItem.icon;
                      if (subItem.isPassportButton) {
                        return (
                          <button
                            key="passport"
                            onClick={() => setPassportOpen(true)}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm ${subItem.color} hover:bg-emerald-500/10`}
                            data-testid="nav-passport"
                          >
                            <SubIcon className="w-4 h-4" />
                            <span>{subItem.label}</span>
                          </button>
                        );
                      }
                      return (
                        <NavLink
                          key={subItem.path}
                          to={subItem.path}
                          className={({ isActive }) =>
                            `flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm ${
                              isActive
                                ? `${subItem.color} bg-${subItem.color.split('-')[1]}-500/20`
                                : `${subItem.color} hover:bg-${subItem.color.split('-')[1]}-500/10`
                            }`
                          }
                          data-testid={`nav-${subItem.label.toLowerCase().replace(' ', '-')}`}
                        >
                          <SubIcon className="w-4 h-4" />
                          <span>{subItem.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }
          
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
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full">
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
            )
          ].filter(Boolean));
        })}

        {/* Photo Tools Section - Only for Photographers */}
        {isPhotographer && (
          <div className="mt-2">
            <button
              onClick={() => setPhotoToolsOpen(!photoToolsOpen)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg mb-1 transition-all ${
                isPhotoToolsPath
                  ? 'bg-gradient-to-r from-cyan-400/20 to-blue-400/20 text-cyan-400'
                  : `${textSecondaryClass} ${hoverBgClass} hover:${textPrimaryClass}`
              }`}
              data-testid="nav-photo-tools"
            >
              <div className="flex items-center gap-3">
                <Camera className="w-5 h-5" />
                <span>Photo Tools</span>
              </div>
              {photoToolsOpen ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
            
            {/* Sub-items */}
            {photoToolsOpen && (
              <div className="ml-4 space-y-1">
                {photoToolsItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-4 py-2 rounded-lg transition-all text-sm ${
                          isActive
                            ? 'bg-cyan-400/20 text-cyan-400 font-medium'
                            : `${textSecondaryClass} ${hoverBgClass} hover:${textPrimaryClass}`
                        }`
                      }
                      data-testid={`nav-${item.label.toLowerCase().replace(' ', '-')}`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
                
                {/* On-Demand Settings - Photographer & Approved Pro */}
                {onDemandSettingsItem && (
                  <NavLink
                    to={onDemandSettingsItem.path}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-2 rounded-lg transition-all text-sm ${
                        isActive
                          ? 'bg-amber-400/20 text-amber-400 font-medium'
                          : `text-amber-400 ${hoverBgClass} hover:text-amber-300`
                      }`
                    }
                    data-testid="nav-on-demand-settings"
                  >
                    <onDemandSettingsItem.icon className="w-4 h-4" />
                    <span>{onDemandSettingsItem.label}</span>
                  </NavLink>
                )}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Bottom actions - Compact for smaller screens */}
      <div className={`p-2 border-t ${borderClass} flex-shrink-0`}>
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
          
          <button
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
