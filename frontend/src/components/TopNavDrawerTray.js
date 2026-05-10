import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import {
  Search, Settings, Backpack, MapPin, Camera, Users, Trophy, Image
} from 'lucide-react';
import { BackpackDrawer } from './BackpackDrawer';
import { PhotoToolsDrawer } from './PhotoToolsDrawer';
import { SurferSessionHub } from './SurferSessionHub';
import { ROLES } from '../constants/roles';


/**
 * TopNavDrawerTray — 2-row pull-down tray for the v4.2 navigation.
 *
 * Row 1 (Universal):  Search | Settings | Backpack
 * Row 2 (Role-Based): varies per role (Map, Photo Tools, Sessions, Gallery, etc.)
 *
 * Staggered reveal: Row 1 appears first, Row 2 follows 80ms later.
 */
export const TopNavDrawerTray = ({ isOpen }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { getEffectiveRole } = usePersona();
  const [backpackOpen, setBackpackOpen] = useState(false);
  const [photoToolsOpen, setPhotoToolsOpen] = useState(false);
  
  // Close sub-drawers on route change
  useEffect(() => {
    setBackpackOpen(false);
    setPhotoToolsOpen(false);
  }, [location.pathname]);
  
  // Track screen width for layout density
  const [isWideScreen, setIsWideScreen] = useState(window.innerWidth >= 640);

  useEffect(() => {
    const handleResize = () => setIsWideScreen(window.innerWidth >= 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const effectiveRole = getEffectiveRole(user?.role);

  // Role categorization
  const photographerRoles = ['Hobbyist', 'Photographer', 'Approved Pro'];
  const isPhotographer = photographerRoles.includes(effectiveRole);
  const isGromParent = effectiveRole === ROLES.GROM_PARENT || user?.is_grom_parent === true;

  // ============ ROW 2 CONFIG (Role-Specific) ============
  const getRoleItems = () => {
    if (isPhotographer) {
      return [
        {
          id: 'map', icon: MapPin, label: 'Map',
          color: 'text-yellow-400',
          action: () => navigate('/map')
        },
        {
          id: 'photo-tools', icon: Camera, label: 'Photo Tools',
          color: 'text-cyan-400',
          action: () => setPhotoToolsOpen(true)
        }
      ];
    }

    if (isGromParent) {
      return [
        {
          id: 'map', icon: MapPin, label: 'Map',
          color: 'text-yellow-400',
          action: () => navigate('/map')
        },
        {
          id: 'photo-tools', icon: Camera, label: 'Photo Tools',
          color: 'text-cyan-400',
          action: () => setPhotoToolsOpen(true)
        },
        {
          id: 'sessions', icon: Users, label: 'Sessions',
          color: 'text-blue-400',
          isSessionHub: true
        }
      ];
    }

    // All surfer types (Regular, Comp, Pro, Grom)
    return [
      {
        id: 'sessions', icon: Users, label: 'Sessions',
        color: 'text-blue-400',
        isSessionHub: true
      },
      {
        id: 'gallery', icon: Image, label: 'My Gallery',
        color: 'text-purple-400',
        action: () => navigate('/gallery')
      }
    ];
  };

  const roleItems = getRoleItems();

  // ============ ROW 1 CONFIG (Universal) ============
  const universalItems = [
    {
      id: 'search', icon: Search, label: 'Search',
      color: 'text-gray-300',
      action: () => navigate('/search')
    },
    {
      id: 'settings', icon: Settings, label: 'Settings',
      color: 'text-gray-300',
      action: () => navigate('/settings')
    },
    {
      id: 'backpack', icon: Backpack, label: 'Backpack',
      color: 'text-amber-400',
      action: () => setBackpackOpen(true)
    }
  ];

  // Combine into a single array for dynamic chunking
  const allItems = [...universalItems, ...roleItems];

  // Render a single drawer item button
  const renderItem = (item) => {
    const Icon = item.icon;
    const itemWidth = isWideScreen ? '12.5%' : '16.666667%';
    const btnClass = "flex flex-col items-center justify-center gap-1 p-2 hover:scale-110 active:scale-95 transition-all duration-200 group";

    const wrapperClass = "flex-shrink-0 snap-start flex justify-center";
    const wrapperStyle = { width: itemWidth };

    // SurferSessionHub needs to wrap the button
    if (item.isSessionHub) {
      return (
        <div key={item.id} className={wrapperClass} style={wrapperStyle}>
          <SurferSessionHub isPhotographer={false}>
            <button
              className={btnClass}
              data-testid={`drawer-${item.id}`}
              aria-label={item.label}
            >
              <Icon className={`w-5 h-5 ${item.color} group-hover:brightness-125 transition-all`} />
              <span className={`text-[10px] font-medium ${item.color} opacity-90 group-hover:opacity-100 transition-opacity whitespace-nowrap`}>{item.label}</span>
            </button>
          </SurferSessionHub>
        </div>
      );
    }

    return (
      <div key={item.id} className={wrapperClass} style={wrapperStyle}>
        <button
          onClick={item.action}
          className={btnClass}
          data-testid={`drawer-${item.id}`}
          aria-label={item.label}
        >
          <Icon className={`w-5 h-5 ${item.color} group-hover:brightness-125 transition-all`} />
          <span className={`text-[10px] font-medium ${item.color} opacity-90 group-hover:opacity-100 transition-opacity whitespace-nowrap`}>{item.label}</span>
        </button>
      </div>
    );
  };

  return (
    <>
      {/* Drawer Tray — slides in with staggered animation */}
      <div
        className="overflow-hidden transition-all duration-300 ease-out"
        style={{
          maxHeight: isOpen ? '100px' : '0px',
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none'
        }}
        data-testid="topnav-drawer-tray"
      >
        <div className="pt-2 pb-3">
          {/* Single Row Carousel */}
          <div
            className="flex items-center overflow-x-auto snap-x snap-mandatory transition-all duration-200 [&::-webkit-scrollbar]:hidden"
            style={{
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? 'translateY(0)' : 'translateY(-8px)',
              transitionDelay: isOpen ? '50ms' : '0ms',
              msOverflowStyle: 'none',
              scrollbarWidth: 'none',
              WebkitOverflowScrolling: 'touch'
            }}
          >
            {allItems.map(renderItem)}
          </div>
        </div>
      </div>

      {/* Sub-drawers opened from tray items */}
      <BackpackDrawer
        isOpen={backpackOpen}
        onClose={() => setBackpackOpen(false)}
        onReopen={() => setBackpackOpen(true)}
      />

      {(isPhotographer || isGromParent) && (
        <PhotoToolsDrawer
          isOpen={photoToolsOpen}
          onClose={() => setPhotoToolsOpen(false)}
        />
      )}
    </>
  );
};

export default TopNavDrawerTray;
