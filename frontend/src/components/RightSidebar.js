import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { usePersona } from '../contexts/PersonaContext';
import { Calendar, Camera, ChevronDown, ChevronRight, Image, CalendarCheck, Radio, Zap, TrendingUp, RefreshCw, MapPin, Target, Crown, Baby, Heart, Backpack, BookOpen, Stamp, CreditCard, BellRing, Lock } from 'lucide-react';
import { ROLES } from '../constants/roles';

export const RightSidebar = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { getEffectiveRole } = usePersona();
  const location = useLocation();
  const isMapOpen = location.pathname === '/map';
  
  const [photoToolsOpen, setPhotoToolsOpen] = useState(false);
  const [backpackOpen, setBackpackOpen] = useState(false);
  
  // Theme-specific classes
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  
  const sidebarBgClass = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-black border-zinc-900' : 'bg-zinc-900 border-zinc-800';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-gray-400';
  const hoverBgClass = isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-800';
  const borderClass = isLight ? 'border-gray-200' : isBeach ? 'border-zinc-900' : 'border-zinc-800';

  const effectiveRole = getEffectiveRole(user?.role);

  // Role Checks
  const isPhotographer = ['Grom Parent', 'Hobbyist', 'Photographer', 'Approved Pro'].includes(effectiveRole);
  const isGrom = effectiveRole === ROLES.GROM;
  const isCompSurfer = effectiveRole === ROLES.COMP_SURFER;
  const isPro = effectiveRole === ROLES.PRO;
  const isRegularSurfer = effectiveRole === ROLES.SURFER;
  const isGromParent = effectiveRole === ROLES.GROM_PARENT || user?.is_grom_parent === true;
  
  const isProSurferMode = user?.surf_mode === 'pro';
  const isCompetitiveSurferMode = user?.surf_mode === 'competitive';
  const isCompetitiveSurfer = isCompetitiveSurferMode || isProSurferMode;
  const hasStokesAccess = ['Comp Surfer', 'Pro'].includes(effectiveRole) || (isRegularSurfer && isCompetitiveSurfer);
  const isStokedLocked = isRegularSurfer && !isCompetitiveSurfer;

  // Photo Tools
  const isPhotoToolsPath = ['/gallery', '/photographer/bookings', '/photographer/sessions', '/photographer/on-demand', '/photographer/earnings', '/photographer/on-demand-settings', '/photographer/subscription-settings'].some(path => 
    location.pathname.startsWith(path)
  );

  useEffect(() => {
    if (isPhotoToolsPath) setPhotoToolsOpen(true);
  }, [isPhotoToolsPath]);

  const getPhotoToolsItems = () => {
    if (isGromParent) return [{ path: '/gallery', icon: Image, label: 'Grom Archive' }];
    if (effectiveRole === ROLES.HOBBYIST) return [{ path: '/gallery', icon: Image, label: 'Gallery Hub' }];
    return [
      { path: '/gallery', icon: Image, label: 'Gallery Hub' },
      { path: '/photographer/bookings', icon: CalendarCheck, label: 'Bookings Manager' },
      { path: '/photographer/sessions', icon: Radio, label: 'Live Sessions' },
      { path: '/photographer/on-demand', icon: Zap, label: 'On-Demand Hub' },
      { path: '/photographer/earnings', icon: TrendingUp, label: 'Earnings Dashboard' },
      { path: '/photographer/subscription-settings', icon: RefreshCw, label: 'Subscription Settings' },
    ];
  };

  const photoToolsItems = getPhotoToolsItems();
  
  const backpackItems = [
    { path: '/surf-log', icon: BookOpen, label: 'Surf Log', color: 'text-cyan-400' },
    { path: '/passport', icon: Stamp, label: 'Surf Passport', isPassportButton: true, color: 'text-emerald-400' },
    { path: '/wallet', icon: CreditCard, label: 'Credit Wallet', color: 'text-yellow-400' },
    { path: '/alerts', icon: BellRing, label: 'Surf Alerts', color: 'text-orange-400' },
  ];

  const canUseOnDemand = ['Photographer', 'Pro', 'Approved Pro'].includes(effectiveRole);
  const onDemandSettingsItem = canUseOnDemand 
    ? { path: '/photographer/on-demand-settings', icon: MapPin, label: 'On-Demand Settings' }
    : null;

  // Build items array
  const topItems = [
    ...(!isPhotographer ? [{ path: '/bookings', icon: Calendar, label: 'Bookings' }] : []),
    ...(isPro || (isRegularSurfer && isProSurferMode) ? [{ path: '/career/the-peak', icon: Crown, label: 'The Peak', highlight: true, highlightColor: 'amber' }] : []),
    ...(isCompSurfer || (isRegularSurfer && isCompetitiveSurferMode) ? [{ path: '/career/impact-zone', icon: Target, label: 'Impact Zone', highlight: true, highlightColor: 'orange' }] : []),
    ...(isGrom ? [{ path: '/career/the-inside', icon: Baby, label: 'The Inside', highlight: true, highlightColor: 'cyan' }] : []),
    ...(hasStokesAccess ? [{ path: '/stoked', icon: Zap, label: 'Stoked', highlight: true, highlightColor: 'yellow' }] : []),
    ...(isStokedLocked ? [{ path: '/stoked-locked', icon: Zap, label: 'Stoked', isLocked: true }] : []),
    ...(!isGromParent && isPhotographer ? [{ path: '/impacted', icon: Heart, label: 'Impacted', highlight: true, highlightColor: 'pink' }] : []),
  ];

  const getHighlightClasses = (color, isActive) => {
    const colors = {
      amber: isActive ? 'bg-amber-500 text-black font-medium' : 'text-amber-400 hover:bg-amber-500/10',
      cyan: isActive ? 'bg-cyan-500 text-black font-medium' : 'text-cyan-400 hover:bg-cyan-500/10',
      yellow: isActive ? 'bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-medium' : 'text-yellow-400 hover:bg-yellow-500/10',
      pink: isActive ? 'bg-pink-500 text-white font-medium' : 'text-pink-400 hover:bg-pink-500/10',
      orange: isActive ? 'bg-orange-500 text-black font-medium' : 'text-orange-400 hover:bg-orange-500/10'
    };
    return colors[color] || colors.amber;
  };

  return (
    <aside className={`fixed right-0 top-0 h-full ${sidebarBgClass} border-l flex flex-col z-40 transition-all duration-300 overflow-hidden hidden lg:flex sidebar-right relative ${isMapOpen ? 'w-0 opacity-0 border-l-0' : 'w-[200px] opacity-100'}`}>
      {/* Wraparound Animation Background */}
      <div className="sidebar-wave-container">
        <div className="sidebar-wave-bg"></div>
      </div>

      <div className={`p-4 border-b ${borderClass} flex-shrink-0 w-[200px] z-10 relative`}>
        <span className={`text-xs font-bold uppercase tracking-wider ${textSecondaryClass}`}>Workspace</span>
      </div>

      <nav className="flex-1 p-2 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent z-10 relative">
        {topItems.map((item) => {
          const Icon = item.icon;
          
          if (item.isLocked) {
            return (
              <div
                key={item.path}
                className="flex items-center gap-2 px-3 py-2 rounded-lg mb-0.5 text-gray-600 cursor-not-allowed text-sm"
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

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg mb-0.5 transition-all text-sm ${
                  isActive
                    ? item.highlight 
                      ? getHighlightClasses(item.highlightColor, true)
                      : 'bg-gradient-to-r from-lime-400 to-yellow-400 text-black font-medium'
                    : item.highlight
                      ? getHighlightClasses(item.highlightColor, false)
                      : `${textSecondaryClass} ${hoverBgClass} hover:${textPrimaryClass}`
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}

        {/* Backpack Menu */}
        <div className="mb-0.5 mt-2">
          <button
            onClick={() => setBackpackOpen(!backpackOpen)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-all text-sm text-amber-400 hover:bg-amber-500/10`}
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
                      onClick={() => window.dispatchEvent(new CustomEvent('open-passport'))}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm ${subItem.color} hover:bg-emerald-500/10`}
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
                  >
                    <SubIcon className="w-4 h-4" />
                    <span>{subItem.label}</span>
                  </NavLink>
                );
              })}
            </div>
          )}
        </div>

        {/* Photo Tools Menu */}
        {isPhotographer && (
          <div className="mt-2">
            <button
              onClick={() => setPhotoToolsOpen(!photoToolsOpen)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg mb-1 transition-all ${
                isPhotoToolsPath
                  ? 'bg-gradient-to-r from-cyan-400/20 to-blue-400/20 text-cyan-400'
                  : `${textSecondaryClass} ${hoverBgClass} hover:${textPrimaryClass}`
              }`}
            >
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4" />
                <span>Photo Tools</span>
              </div>
              {photoToolsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            
            {photoToolsOpen && (
              <div className="ml-3 pl-3 border-l border-cyan-500/20 mt-1 space-y-0.5">
                {photoToolsItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className={({ isActive }) =>
                        `flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm ${
                          isActive
                            ? 'bg-cyan-400/20 text-cyan-400 font-medium'
                            : `${textSecondaryClass} ${hoverBgClass} hover:${textPrimaryClass}`
                        }`
                      }
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
                
                {onDemandSettingsItem && (
                  <NavLink
                    to={onDemandSettingsItem.path}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm ${
                        isActive
                          ? 'bg-amber-400/20 text-amber-400 font-medium'
                          : `text-amber-400 ${hoverBgClass} hover:text-amber-300`
                      }`
                    }
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
    </aside>
  );
};
