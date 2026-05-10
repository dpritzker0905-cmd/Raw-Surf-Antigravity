import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  const { user } = useAuth();
  const { getEffectiveRole } = usePersona();
  const [backpackOpen, setBackpackOpen] = useState(false);
  const [photoToolsOpen, setPhotoToolsOpen] = useState(false);

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
          color: 'text-yellow-400', bgColor: 'bg-yellow-500/15',
          action: () => navigate('/map')
        },
        {
          id: 'photo-tools', icon: Camera, label: 'Photo Tools',
          color: 'text-cyan-400', bgColor: 'bg-cyan-500/15',
          action: () => setPhotoToolsOpen(true)
        }
      ];
    }

    if (isGromParent) {
      return [
        {
          id: 'map', icon: MapPin, label: 'Map',
          color: 'text-yellow-400', bgColor: 'bg-yellow-500/15',
          action: () => navigate('/map')
        },
        {
          id: 'grom-archive', icon: Camera, label: 'Grom Archive',
          color: 'text-cyan-400', bgColor: 'bg-cyan-500/15',
          action: () => setPhotoToolsOpen(true)
        },
        {
          id: 'sessions', icon: Users, label: 'Sessions',
          color: 'text-blue-400', bgColor: 'bg-blue-500/15',
          isSessionHub: true
        }
      ];
    }

    // All surfer types (Regular, Comp, Pro, Grom)
    return [
      {
        id: 'sessions', icon: Users, label: 'Sessions',
        color: 'text-blue-400', bgColor: 'bg-blue-500/15',
        isSessionHub: true
      },
      {
        id: 'gallery', icon: Image, label: 'My Gallery',
        color: 'text-purple-400', bgColor: 'bg-purple-500/15',
        action: () => navigate('/gallery')
      }
    ];
  };

  const roleItems = getRoleItems();

  // ============ ROW 1 CONFIG (Universal) ============
  const universalItems = [
    {
      id: 'search', icon: Search, label: 'Search',
      color: 'text-gray-300', bgColor: 'bg-white/10',
      action: () => navigate('/search')
    },
    {
      id: 'settings', icon: Settings, label: 'Settings',
      color: 'text-gray-300', bgColor: 'bg-white/10',
      action: () => navigate('/settings')
    },
    {
      id: 'backpack', icon: Backpack, label: 'Backpack',
      color: 'text-amber-400', bgColor: 'bg-amber-500/15',
      action: () => setBackpackOpen(true)
    }
  ];

  // Render a single drawer item button
  const renderItem = (item) => {
    const Icon = item.icon;

    // SurferSessionHub needs to wrap the button
    if (item.isSessionHub) {
      return (
        <SurferSessionHub key={item.id} isPhotographer={false}>
          <button
            className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl ${item.bgColor}
              hover:scale-105 active:scale-95 transition-all duration-200 min-w-[80px]`}
            data-testid={`drawer-${item.id}`}
            aria-label={item.label}
          >
            <Icon className={`w-5 h-5 ${item.color}`} />
            <span className={`text-[10px] font-medium ${item.color}`}>{item.label}</span>
          </button>
        </SurferSessionHub>
      );
    }

    return (
      <button
        key={item.id}
        onClick={item.action}
        className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl ${item.bgColor}
          hover:scale-105 active:scale-95 transition-all duration-200 min-w-[80px]`}
        data-testid={`drawer-${item.id}`}
        aria-label={item.label}
      >
        <Icon className={`w-5 h-5 ${item.color}`} />
        <span className={`text-[10px] font-medium ${item.color}`}>{item.label}</span>
      </button>
    );
  };

  return (
    <>
      {/* Drawer Tray — slides in with staggered animation */}
      <div
        className="overflow-hidden transition-all duration-300 ease-out"
        style={{
          maxHeight: isOpen ? '180px' : '0px',
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none'
        }}
        data-testid="topnav-drawer-tray"
      >
        <div className="px-4 pt-2 pb-3 space-y-2">
          {/* Row 1: Universal — Search | Settings | Backpack */}
          <div
            className="flex items-center justify-center gap-3 transition-all duration-200"
            style={{
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? 'translateY(0)' : 'translateY(-8px)',
              transitionDelay: isOpen ? '50ms' : '0ms'
            }}
          >
            {universalItems.map(renderItem)}
          </div>

          {/* Row 2: Role-Specific — staggered 80ms after Row 1 */}
          <div
            className="flex items-center justify-center gap-3 transition-all duration-200"
            style={{
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? 'translateY(0)' : 'translateY(-8px)',
              transitionDelay: isOpen ? '130ms' : '0ms'
            }}
          >
            {roleItems.map(renderItem)}
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
