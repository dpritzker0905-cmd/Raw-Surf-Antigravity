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
 * TopNav v4.2 — Ultra-Clean 2-Icon Header + Pull-Down Drawer
 *
 * VISIBLE (collapsed — ALL roles):
 *   [Logo]                    [Role-Critical]  [Bell]
 *                   ═══════  (pull handle)
 *
 * EXPANDED (pull-down drawer — 2 rows):
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
        <div className="flex items-center justify-between px-3 py-2.5 relative z-10">
          {/* Left: Logo */}
          <div className="flex items-center shrink-0">
            <button
              onClick={handleLogoClick}
              className="group p-0.5"
              title={location.pathname === '/feed' ? 'Refresh feed' : 'Go to Feed'}
              aria-label={location.pathname === '/feed' ? 'Refresh feed' : 'Go to Feed'}
            >
              <img loading="lazy" decoding="async"
                src="https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png"
                alt="Raw Surf"
                className={`w-7 h-7 origin-left transition-transform duration-300 ${!drawerOpen && 'group-hover:scale-110'}`}
                style={{
                  transform: `${logoSpinning ? 'rotate(360deg) ' : ''}${drawerOpen ? 'scale(1.25)' : ''}`.trim() || undefined
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

            {/* Notifications Bell — always visible */}
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

        {/* Pull Handle — visual affordance for the drawer gesture */}
        <button
          onClick={toggleDrawer}
          className="flex justify-center pb-2 pt-1 -mt-1 w-full group"
          aria-label={drawerOpen ? 'Close tools drawer' : 'Open tools drawer'}
          aria-expanded={drawerOpen}
          data-testid="topnav-pull-handle"
        >
          {/* Surfboard-styled pull handle - uses ellipse border radius and a center stringer */}
          <div
            className={`relative flex items-center justify-center overflow-visible transition-all duration-300 ${
              drawerOpen
                ? 'w-16 h-2 rounded-[50%] bg-gradient-to-r from-cyan-400 to-blue-500 shadow-[0_0_8px_rgba(34,211,238,0.4)]'
                : 'w-12 h-1.5 rounded-[50%] bg-zinc-600 group-hover:bg-zinc-500'
            }`}
          >
            {/* The Stringer (center line down the board) */}
            <div className={`w-full h-[1px] ${drawerOpen ? 'bg-white/40' : 'bg-black/40'}`} />
            
            {/* The Fin Skeg (single fin) */}
            <div 
              className={`absolute -top-1 right-2.5 w-1.5 h-1.5 rounded-tr-[2px] -z-10 transition-all duration-300 ${
                drawerOpen ? 'bg-blue-500' : 'bg-zinc-600 group-hover:bg-zinc-500'
              }`} 
              style={{ transform: 'skewX(-20deg)' }}
            />
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
