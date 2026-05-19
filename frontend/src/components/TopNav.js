import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Bell, Shield, MapPin } from 'lucide-react';
import { DutyStationIcon } from './DutyStationDrawer';
import { NotificationsDrawer } from './NotificationsDrawer';
import { TopNavDrawerTray } from './TopNavDrawerTray';
import { getUnreadCount } from '../services/notificationService';
import useTopNavPullDown from '../hooks/useTopNavPullDown';
import logger from '../utils/logger';
import { ROLES } from '../constants/roles';
import { AdaptiveBackground } from './AdaptiveBackground';


/**
 * TopNav v4.2 -- Ultra-Clean 2-Icon Header + Pull-Down Drawer
 *
 * VISIBLE (collapsed -- ALL roles):
 *   [Logo]                    [Role-Critical]  [Bell]
 * --- --- (pull handle)
 *
 * EXPANDED (pull-down drawer -- 2 rows):
 *   Row 1 (Universal):  Search | Settings | Backpack
 *   Row 2 (Role-Based): Map | Photo Tools | Sessions | Gallery (varies)
 *
 * Role-Critical Icon:
 *   - Photographers:  DutyStation (go live / on-demand)
 *   - Surfers/Groms:  Map (find spots & photographers)
 *   - Grom Parents:   GromHQ Shield (child monitoring)
 */
export const TopNav = () => {
  const { user } = useAuth();
  const { getEffectiveRole, isGodMode, isPersonaBarActive } = usePersona();
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [logoSpinning, setLogoSpinning] = useState(false);

  // Pull-down drawer gesture hook
  const { headerRef, isOpen: drawerOpen, close: closeDrawer, toggle: toggleDrawer } = useTopNavPullDown();

  // Get effective role (respects God Mode persona masking)
  const effectiveRole = getEffectiveRole(user?.role);

  // Role categorization
  const isPhotographer = ['Hobbyist', 'Photographer', 'Approved Pro'].includes(effectiveRole);
  const isGromParent = effectiveRole === ROLES.GROM_PARENT || user?.is_grom_parent === true;

  // Logo click: refresh feed or scroll to top
  const handleLogoClick = useCallback(() => {
    if (location.pathname === '/feed') {
      window.dispatchEvent(new CustomEvent('feed:refresh'));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setLogoSpinning(true);
    setTimeout(() => setLogoSpinning(false), 600);
  }, [location.pathname]);

  // Close drawer and notifications on route change
  useEffect(() => {
    closeDrawer();
    setNotificationsOpen(false);
  }, [location.pathname, closeDrawer]);

  // Notification count polling
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
      const interval = setInterval(fetchUnreadCount, 30000);
      return () => clearInterval(interval);
    }
  }, [user?.id, fetchUnreadCount]);

  // Check if God Mode banner is active
  const _isGodModeBannerVisible = user?.is_admin && isGodMode && isPersonaBarActive;

  return (
    <>
      <header
        ref={headerRef}
        className="fixed left-0 right-0 z-[100] bg-background border-b border-border md:hidden transition-all duration-200 top-0"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
          touchAction: 'pan-x',
          overscrollBehavior: 'none'
        }}
        data-testid="top-nav"
      >
        <AdaptiveBackground />

        {/* Main TopNav Row: Logo + 2 Icons */}
        <div className="flex items-center justify-between px-3 py-1.5 relative z-10">
          {/* Left: Logo */}
          <div className="flex items-center shrink-0">
            <button
              onClick={handleLogoClick}
              className="group p-0.5 origin-top-left transition-transform duration-300"
              style={{
                transform: drawerOpen ? 'scale(1.25)' : 'scale(1)'
              }}
              title={location.pathname === '/feed' ? 'Refresh feed' : 'Go to Feed'}
              aria-label={location.pathname === '/feed' ? 'Refresh feed' : 'Go to Feed'}
            >
              <img loading="lazy" decoding="async"
                src="https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png"
                alt="Raw Surf"
                className={`w-7 h-7 origin-center transition-transform duration-300 ${!drawerOpen && 'group-hover:scale-110'}`}
                style={{
                  transform: logoSpinning ? 'rotate(360deg)' : undefined
                }}
              />
            </button>
          </div>

          {/* Right: Role-Critical Icon + Notifications Bell */}
          <div className="flex items-center gap-3">
            {/* Role-Critical Icon */}
            {isPhotographer ? (
              // Photographers: DutyStation (Go Live / On-Demand)
              <DutyStationIcon />
            ) : isGromParent ? (
              // Grom Parents: GromHQ Shield
              <button
                onClick={() => navigate('/grom-hq')}
                className="text-cyan-400 hover:text-cyan-300 transition-colors p-1"
                data-testid="topnav-gromhq"
                aria-label="Grom HQ"
              >
                <Shield className="w-5 h-5" />
              </button>
            ) : (
              // Surfers & Groms: Map
              <button
                onClick={() => navigate('/map')}
                className="text-yellow-400 hover:text-yellow-300 transition-colors p-1"
                data-testid="topnav-map"
                aria-label="Map"
              >
                <MapPin className="w-5 h-5" />
              </button>
            )}

 {/* Notifications Bell -- always visible */}
            <button
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              className={`transition-colors relative p-1 ${
                notificationsOpen ? 'text-yellow-400' : 'text-gray-400 hover:text-white'
              }`}
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
          </div>
        </div>

 {/* Pull Handle -- visual affordance for the drawer gesture */}
        <button
          onClick={toggleDrawer}
          className="flex justify-center pb-1 pt-0.5 -mt-2 w-full group"
          aria-label={drawerOpen ? 'Close tools drawer' : 'Open tools drawer'}
          aria-expanded={drawerOpen}
          data-testid="topnav-pull-handle"
        >
          {/* Surfboard-styled pull handle - SVG Side Profile with Water Physics */}
          <div className="relative flex items-center justify-center overflow-visible">
            <svg 
              viewBox="0 0 120 40" 
              className={`transition-all duration-300 origin-center ${
                drawerOpen 
                  ? 'w-16 h-auto drop-shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-float-board' 
                  : 'w-12 h-auto'
              }`} 
              fill="none" 
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Water Wave Physics (Visible when drawer is open) */}
              <path 
                d="M 15 30 Q 30 22 50 28 T 90 28 T 115 25" 
                className={`transition-all duration-700 ease-out blur-[1px] ${drawerOpen ? 'stroke-cyan-400 opacity-40' : 'stroke-transparent opacity-0'}`}
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
              <path 
                d="M 25 35 Q 45 28 65 33 T 105 33" 
                className={`transition-all duration-700 ease-out delay-100 blur-[1px] ${drawerOpen ? 'stroke-blue-500 opacity-30' : 'stroke-transparent opacity-0'}`}
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />

              {/* Fin (Upside down board means fin is on top!) */}
              <path 
                d="M 85 18 C 86 5, 95 2, 98 2 C 95 10, 95 16, 95 20 Z" 
                className={`transition-colors duration-300 ${drawerOpen ? 'fill-cyan-300' : 'fill-zinc-500 group-hover:fill-zinc-400'}`} 
              />
              
              {/* Longboard (Upside down: deck is concave bottom edge, hull is convex top edge) */}
              <path 
                d="M 10 24 C 30 14, 90 14, 110 24 C 113 25, 113 27, 110 28 C 90 20, 30 20, 10 28 C 7 27, 7 25, 10 24 Z" 
                className={`transition-colors duration-300 ${drawerOpen ? 'fill-blue-500' : 'fill-zinc-600 group-hover:fill-zinc-500'}`} 
              />
              
              {/* Center stringer (wood line down the middle) */}
              <path 
                d="M 10 26 C 30 17, 90 17, 110 26" 
                className={`transition-colors duration-300 ${drawerOpen ? 'stroke-amber-600' : 'stroke-zinc-800'}`}
                strokeWidth="0.5"
                fill="none"
              />
            </svg>
            <style>
              {`
                @keyframes floatBoard {
                  0%, 100% { transform: translateY(0px) rotate(0deg); }
                  50% { transform: translateY(3px) rotate(1.5deg); }
                }
                .animate-float-board {
                  animation: floatBoard 3s ease-in-out infinite;
                }
              `}
            </style>
          </div>
        </button>

        {/* Pull-Down Drawer Tray (2 rows: universal + role-specific) */}
        <TopNavDrawerTray isOpen={drawerOpen} />
      </header>

      {/* Backdrop when drawer is open */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[99] bg-black/30 md:hidden"
          onClick={closeDrawer}
          data-testid="topnav-drawer-backdrop"
        />
      )}

      {/* Notifications Drawer */}
      <NotificationsDrawer
        isOpen={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        onCountUpdate={fetchUnreadCount}
      />
    </>
  );
};

export default TopNav;
