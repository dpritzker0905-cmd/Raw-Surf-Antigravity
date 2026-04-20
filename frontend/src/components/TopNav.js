import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { MapPin, Search, Bell, Settings, ShoppingBag, Zap, Heart, Shield, Users, Compass, Backpack } from 'lucide-react';
import { SurferSessionHub } from './SurferSessionHub';
import { DutyStationIcon } from './DutyStationDrawer';
import { BackpackDrawer } from './BackpackDrawer';
import { StokedDrawer } from './StokedDrawer';
import { NotificationsDrawer } from './NotificationsDrawer';
import { ExclusiveAreaDrawer, hasExclusiveArea, getAreaType, getAreaIcon, getAreaColor } from './ExclusiveAreaDrawer';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { getNotifications, getUnreadCount, markRead, markAllRead, sendNotification, sendPhotographerAlert, createNotification, markAlertRead } from '../services/notificationService';
import logger from '../utils/logger';
import { ROLES } from '../constants/roles';


/**
 * TopNav - Global Header Navigation (Restructured April 2026)
 * 
 * NEW LAYOUT - Map-First with Backpack & Dynamic Persona Icon:
 * 
 * PHOTOGRAPHERS (Hobbyist/Photographer/Approved Pro) - 8 Icons:
 * 1. Duty Station Icon (Far Left) - Unified Live/On-Demand Drawer
 * 2. Map Icon - Primary navigation
 * 3. Backpack Icon - Opens drawer with Passport, Wallet, Surf Alerts
 * 4. Explore Icon - Browse trending, spots, broadcasts
 * 5. Session Hub Icon - Sessions drawer
 * 6. Search Icon
 * 7. Notification Bell
 * 8. Settings Icon (Far Right)
 * 
 * GROM PARENTS - 7 Icons:
 * 1. Map Icon (Far Left) - Primary navigation
 * 2. Backpack Icon - Opens drawer with Passport, Wallet, Surf Alerts
 * 3. Explore Icon - Browse trending, spots, broadcasts
 * 4. Dynamic Persona Icon - Opens Grom HQ
 * 5. Search Icon
 * 6. Notification Bell
 * 7. Settings Icon (Far Right)
 * 
 * SURFERS - 6 Icons:
 * 1. Map Icon (Far Left) - Primary navigation
 * 2. Backpack Icon - Opens drawer with Passport, Wallet, Surf Alerts
 * 3. Dynamic Persona Icon - Opens StokedDrawer or exclusive area
 * 4. Search Icon
 * 5. Notification Bell
 * 6. Settings Icon (Far Right)
 * 
 * Dynamic Persona Icon Logic:
 * - Groms: Waves Icon -> The Inside (ExclusiveAreaDrawer)
 * - Regular Surfers: Gear Icon -> StokedDrawer
 * - Competitive Surfers (Comp/Pro): Stoked Icon (Zap) -> StokedDrawer
 * - Photographers: Heart Icon -> /impacted (Impact Dashboard)
 * - Grom Parents: Shield Icon -> /grom-hq
 * 
 * NOTE: Messages moved to BottomNav for thumb-zone accessibility
 * NOTE: Explore added to TopNav for photographers/grom parents (not in their BottomNav)
 */
export const TopNav = () => {
  const { user } = useAuth();
  const { getEffectiveRole, isGodMode, isPersonaBarActive } = usePersona();
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);
  const [backpackOpen, setBackpackOpen] = useState(false);
  const [stokedOpen, setStokedOpen] = useState(false);
  const [exclusiveAreaOpen, setExclusiveAreaOpen] = useState(false);
  const [gromHQDrawerOpen, setGromHQDrawerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [logoSpinning, setLogoSpinning] = useState(false);

  // Logo click: refresh current page in-place (same as Sidebar)
  const handleLogoClick = useCallback(() => {
    if (location.pathname === '/feed') {
      window.dispatchEvent(new CustomEvent('feed:refresh'));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setLogoSpinning(true);
    setTimeout(() => setLogoSpinning(false), 600);
  }, [location.pathname]);

  // Close all drawers when route changes (e.g., when BottomNav item is clicked)
  useEffect(() => {
    setBackpackOpen(false);
    setStokedOpen(false);
    setExclusiveAreaOpen(false);
    setGromHQDrawerOpen(false);
    setNotificationsOpen(false);
  }, [location.pathname]);

  // Check if God Mode banner is active (need to shift TopNav down)
  const _isGodModeBannerVisible = user?.is_admin && isGodMode && isPersonaBarActive;

  // Get effective role (respects God Mode persona masking)
  const effectiveRole = getEffectiveRole(user?.role);
  
  // All photographer roles get the Duty Station icon (Hobbyist, Photographer, Approved Pro)
  const isPhotographer = ['Hobbyist', 'Photographer', 'Approved Pro'].includes(effectiveRole);
  
  // Check if user has exclusive area access (Grom, Comp Surfer, Pro)
  // Surfers in competitive/pro surf_mode get the matching exclusive area
  const isProSurferMode = user?.surf_mode === 'pro';
  const isCompetitiveSurferMode = user?.surf_mode === 'competitive';
  const isCompetitiveSurfer = isCompetitiveSurferMode || isProSurferMode;
  // Map surf_mode to the equivalent role for icon/drawer resolution
  const resolvedRole = effectiveRole === ROLES.SURFER
    ? (isProSurferMode ? 'Pro' : isCompetitiveSurferMode ? 'Comp Surfer' : effectiveRole)
    : effectiveRole;
  const hasExclusiveAccess = hasExclusiveArea(resolvedRole);
  const exclusiveAreaType = getAreaType(resolvedRole);
  const ExclusiveIcon = getAreaIcon(resolvedRole);
  const exclusiveIconColor = getAreaColor(resolvedRole);
  
  // Role categorization for Dynamic Persona Icon
  const isGromParent = effectiveRole === ROLES.GROM_PARENT || user?.is_grom_parent === true;
  // isCompetitive: true for Comp Surfer/Pro roles OR regular Surfer in competitive/pro surf_mode
  const isCompetitive = ['Comp Surfer', 'Pro'].includes(effectiveRole) || (effectiveRole === ROLES.SURFER && isCompetitiveSurfer);
  // Note: isPhotographer already defined above for Duty Station icon
  const _isGromOrRegularSurfer = ['Grom', 'Surfer'].includes(effectiveRole);

  // Get Dynamic Persona Icon configuration based on role
  const getPersonaIconConfig = () => {
    if (isPhotographer) {
      return {
        icon: Heart,
        label: 'Impact',
        color: 'text-pink-400',
        hoverColor: 'hover:text-pink-300'
      };
    }
    if (isCompetitive) {
      return {
        icon: Zap,
        label: 'Stoked',
        color: 'text-yellow-400',
        hoverColor: 'hover:text-yellow-300'
      };
    }
    if (effectiveRole === ROLES.GROM) {
      return {
        icon: null,  // Groms use ExclusiveArea button, no separate persona icon needed
        label: null,
        color: '',
        hoverColor: ''
      };
    }
    // Default: Regular Surfers get Gear
    return {
      icon: ShoppingBag,
      label: 'Gear',
      color: 'text-emerald-400',
      hoverColor: 'hover:text-emerald-300'
    };
  };

  const personaConfig = getPersonaIconConfig();
  const PersonaIcon = personaConfig.icon;

  const fetchUnreadCount = useCallback(async () => {
    if (!user?.id) return;
    try {
      const response = await getUnreadCount(user.id);
      setUnreadCount(response.data.unread_count || 0);
    } catch (error) {
      logger.error('Failed to fetch notification count:', error);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      fetchUnreadCount();
      // Poll every 30 seconds for new notifications
      const interval = setInterval(() => {
        fetchUnreadCount();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [user?.id, fetchUnreadCount]);

  return (
    <>
      <header 
        className="fixed left-0 right-0 z-[100] bg-background border-b border-border md:hidden transition-all duration-200 top-0"
        style={{ 
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)'
        }}
        data-testid="top-nav"
      >
        <div className="flex items-center justify-between px-3 py-2.5">
          {/* Left Side - Logo (tap = refresh feed or go to feed) */}
          <div className="flex items-center shrink-0">
            <button
              onClick={handleLogoClick}
              className="group p-0.5"
              title={location.pathname === '/feed' ? 'Refresh feed' : 'Go to Feed'}
              aria-label={location.pathname === '/feed' ? 'Refresh feed' : 'Go to Feed'}
            >
              <img
                src="https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png"
                alt="Raw Surf"
                className="w-7 h-7 group-hover:scale-110"
                style={{
                  transition: logoSpinning
                    ? 'transform 0.6s cubic-bezier(0.34,1.56,0.64,1)'
                    : 'transform 0.2s ease',
                  transform: logoSpinning ? 'rotate(360deg)' : 'rotate(0deg)'
                }}
              />
            </button>
          </div>

          {/* Icon Layout - Search First, then Map-First with Passport & Persona */}
          <div className="flex items-center gap-2.5">
            
            {/* Position 0: Search Icon - First in the row */}
            <button 
              onClick={() => navigate('/search')}
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
              data-testid="topnav-search"
              aria-label="Search"
            >
              <Search className="w-5 h-5" />
            </button>
            
            {/* Position 1: Duty Station Icon (PHOTOGRAPHERS ONLY) */}
            {isPhotographer && (
              <DutyStationIcon />
            )}
            
            {/* Position 2 (or 1): Map Icon - PRIMARY NAVIGATION */}
            <button 
              onClick={() => navigate('/map')}
              className="text-yellow-400 hover:text-yellow-300 transition-colors p-1"
              data-testid="topnav-map"
              aria-label="Map"
            >
              <MapPin className="w-5 h-5" />
            </button>
            
            {/* Position 3 (or 2): Exclusive Area Icon - Grom/Grom Parent/Comp/Pro only */}
            {hasExclusiveAccess && ExclusiveIcon && (
              <button 
                onClick={() => setExclusiveAreaOpen(!exclusiveAreaOpen)}
                className={`${exclusiveIconColor} hover:opacity-80 transition-colors p-1`}
                data-testid="topnav-exclusive-area"
                aria-label={
                  exclusiveAreaType === 'grom' ? 'The Inside' :
                  exclusiveAreaType === 'comp' ? 'The Impact Zone' :
                  exclusiveAreaType === 'pro' ? 'The Peak' : 'Exclusive Area'
                }
              >
                <ExclusiveIcon className="w-5 h-5" />
              </button>
            )}
            
            {/* Position 4 (or 3): Backpack Icon - Opens Backpack Drawer (Passport, Wallet, Alerts) */}
            <button 
              onClick={() => setBackpackOpen(!backpackOpen)}
              className="text-amber-400 hover:text-amber-300 transition-colors p-1"
              data-testid="topnav-backpack"
              aria-label="Backpack"
            >
              <Backpack className="w-5 h-5" />
            </button>
            
            {/* Position 4.5: Explore Icon - For PHOTOGRAPHERS & GROM PARENTS (they don't have it in BottomNav) */}
            {(isPhotographer || isGromParent) && (
              <button 
                onClick={() => navigate('/explore')}
                className="text-orange-400 hover:text-orange-300 transition-colors p-1"
                data-testid="topnav-explore"
                aria-label="Explore"
              >
                <Compass className="w-5 h-5" />
              </button>
            )}
            
            {/* Position 5 (or 4): Session Hub Icon - For SURFERS only (Photographers use Duty Station) */}
            {!isPhotographer && (
              <SurferSessionHub isPhotographer={false}>
                <button 
                  className="text-cyan-400 hover:text-cyan-300 transition-colors p-1"
                  data-testid="topnav-sessions"
                  aria-label="Session Hub"
                >
                  <Users className="w-5 h-5" />
                </button>
              </SurferSessionHub>
            )}
            
            {/* Position 5.5: Grom HQ Shield Icon - for Grom Parents */}
            {isGromParent && (
              <button 
                onClick={() => setGromHQDrawerOpen(!gromHQDrawerOpen)}
                className="text-cyan-400 hover:text-cyan-300 transition-colors p-1"
                data-testid="topnav-grom-hq"
                aria-label="Grom HQ"
              >
                <Shield className="w-5 h-5" />
              </button>
            )}

            {/* Position 6 (or 5): Stoked/Persona Icon - Role-Based Navigation */}
            {/* Note: Groms skip this - they use the ExclusiveArea button instead */}
            {effectiveRole !== ROLES.GROM && (
              <button 
                onClick={() => {
                  if (effectiveRole === ROLES.GROM_PARENT) {
                    // Fallback for purely dedicated Grom Parents if they tap Gear
                    setStokedOpen(!stokedOpen);
                  } else if (isPhotographer) {
                    navigate('/impacted');  // Photographers → Impact Dashboard
                  } else if (isCompetitive) {
                    setStokedOpen(!stokedOpen);  // Comp/Pro → Stoked Drawer
                  } else {
                    setStokedOpen(!stokedOpen);  // Regular Surfers → Stoked/Gear Drawer
                  }
                }}
                className={`${personaConfig.color} ${personaConfig.hoverColor} transition-colors p-1`}
                data-testid="topnav-stoked"
                aria-label={personaConfig.label}
              >
                <PersonaIcon className="w-5 h-5" />
              </button>
            )}
            
            {/* Position 6 (or 5): Notifications Bell - Toggles Drawer */}
            <button 
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              className={`transition-colors relative p-1 ${notificationsOpen ? 'text-yellow-400' : 'text-gray-400 hover:text-white'}`}
              data-testid="topnav-notifications"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-0.5 flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            
            {/* Position 7 (or 6): Settings Icon */}
            <button 
              onClick={() => navigate('/settings')}
              className="text-gray-400 hover:text-white transition-colors p-1"
              data-testid="topnav-settings"
              aria-label="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Backpack Drawer - Contains Passport, Wallet, Surf Alerts */}
      <BackpackDrawer 
        isOpen={backpackOpen} 
        onClose={() => setBackpackOpen(false)}
        onReopen={() => setBackpackOpen(true)}
      />
      
      {/* Notifications Drawer */}
      <NotificationsDrawer
        isOpen={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        onCountUpdate={fetchUnreadCount}
      />
      
      {/* Stoked Drawer */}
      <StokedDrawer
        isOpen={stokedOpen}
        onClose={() => setStokedOpen(false)}
      />
      
      {/* Exclusive Area Drawer - Grom (The Inside) / Comp (The Impact Zone) / Pro (The Peak) */}
      {hasExclusiveAccess && (
        <ExclusiveAreaDrawer
          isOpen={exclusiveAreaOpen}
          onClose={() => setExclusiveAreaOpen(false)}
          areaType={exclusiveAreaType}
        />
      )}

      {/* Grom HQ Drawer - always available if isGromParent is true */}
      {isGromParent && (
        <ExclusiveAreaDrawer
          isOpen={gromHQDrawerOpen}
          onClose={() => setGromHQDrawerOpen(false)}
          areaType="grom_parent"
        />
      )}
    </>
  );
};

export default TopNav;
