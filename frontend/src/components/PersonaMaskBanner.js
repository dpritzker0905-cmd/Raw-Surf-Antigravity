import React, { useState, useEffect } from 'react';
import { usePersona, ALL_PERSONAS, getExpandedRoleInfo } from '../contexts/PersonaContext';
import { useAuth } from '../contexts/AuthContext';
import { X, Eye, ChevronDown, Check, Minimize2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';

/**
 * PersonaMaskBanner - God Mode Persona Switcher
 * 
 * Completely rewritten for reliable mobile rendering:
 * - Uses Sheet component for mobile persona selection
 * - Fixed positioning with proper safe area handling
 * - Strict auth checks to prevent unauthorized access
 * - Minimizable mobile banner with tab showing persona name
 */
const PersonaMaskBanner = () => {
  const { user, loading: authLoading } = useAuth();
  const { 
    _isMasked, 
    activePersona, 
    setPersona, 
    exitPersonaMode,
    isGodMode,
    isPersonaBarActive 
  } = usePersona();
  
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const [isMobileMinimized, setIsMobileMinimized] = useState(false);
  const [isDesktopMinimized, setIsDesktopMinimized] = useState(false);

  // CRITICAL: Check BOTH React state AND localStorage for user
  // This prevents any flash during hydration/refresh
  const hasLocalStorageUser = typeof window !== 'undefined' && !!localStorage.getItem('raw-surf-user');
  
  // Authorization check moved before hooks but computed as variable
  const isAuthorized = !authLoading && hasLocalStorageUser && user?.id && user?.is_admin && isGodMode && isPersonaBarActive;
  
  // All hooks must be called unconditionally (before any returns)
  useEffect(() => {
    if (isAuthorized) {
      const savedMobileMinimized = localStorage.getItem('godModeMinimized') === 'true';
      const savedDesktopMinimized = localStorage.getItem('godModeDesktopMinimized') === 'true';
      setIsMobileMinimized(savedMobileMinimized);
      setIsDesktopMinimized(savedDesktopMinimized);
    } else {
      // Clear minimize state when not authorized
      setIsMobileMinimized(false);
      setIsDesktopMinimized(false);
    }
  }, [isAuthorized]);

  // Update localStorage when minimize state changes (only if authorized)
  useEffect(() => {
    if (isAuthorized) {
      localStorage.setItem('godModeMinimized', isMobileMinimized.toString());
    }
  }, [isMobileMinimized, isAuthorized]);
  
  useEffect(() => {
    if (isAuthorized) {
      localStorage.setItem('godModeDesktopMinimized', isDesktopMinimized.toString());
    }
  }, [isDesktopMinimized, isAuthorized]);

  // EARLY EXITS AFTER ALL HOOKS
  // If no user in localStorage, don't render anything
  if (!hasLocalStorageUser) return null;
  
  // CRITICAL: Return null for unauthorized users - NO UI should render
  if (!isAuthorized) return null;
  
  const currentRoleInfo = activePersona 
    ? getExpandedRoleInfo(activePersona) 
    : { icon: '🔴', label: 'God Mode', color: 'text-red-500' };

  const handleSelectPersona = (personaId) => {
    if (personaId !== 'God') {
      setPersona(personaId);
    }
    setIsExpanded(false);
    setIsMobileSheetOpen(false);
  };

  const handleHardExit = () => {
    setIsExpanded(false);
    setIsMobileSheetOpen(false);
    setIsMobileMinimized(false);
    setIsDesktopMinimized(false);
    localStorage.removeItem('godModeMinimized');
    localStorage.removeItem('godModeDesktopMinimized');
    exitPersonaMode();
  };

  // Persona options grouped
  const proAthletes = ALL_PERSONAS.filter(p => ['Pro', 'Comp Surfer'].includes(p.id));
  const photographers = ALL_PERSONAS.filter(p => ['Approved Pro', 'Photographer', 'Hobbyist', 'Grom Parent'].includes(p.id));
  const surfers = ALL_PERSONAS.filter(p => ['Surfer', 'Grom'].includes(p.id));
  const businesses = ALL_PERSONAS.filter(p => ['Shop', 'Surf School', 'Shaper', 'Resort'].includes(p.id));

  const PersonaOption = ({ persona }) => {
    const roleInfo = getExpandedRoleInfo(persona.id);
    const isSelected = activePersona === persona.id;
    
    return (
      <button
        onClick={() => handleSelectPersona(persona.id)}
        className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors ${
          isSelected ? 'bg-zinc-800 border-l-2 border-cyan-400' : ''
        }`}
      >
        <span className="text-xl">{roleInfo.icon}</span>
        <div className="flex-1 text-left">
          <span className="text-white font-medium">{persona.label}</span>
          <p className="text-gray-500 text-xs">{persona.description}</p>
        </div>
        {isSelected && <Check className="w-5 h-5 text-cyan-400" />}
      </button>
    );
  };

  const PersonaList = () => (
    <div className="space-y-1">
      {/* God Mode Reset */}
      <button
        onClick={() => handleSelectPersona('God')}
        className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors ${
          !activePersona ? 'bg-zinc-800 border-l-2 border-red-400' : ''
        }`}
      >
        <span className="text-xl">🔴</span>
        <div className="flex-1 text-left">
          <span className="text-white font-medium">God Mode (Default)</span>
          <p className="text-gray-500 text-xs">Full admin access</p>
        </div>
        {!activePersona && <Check className="w-5 h-5 text-red-400" />}
      </button>

      <div className="h-px bg-zinc-700 my-2" />
      
      {/* Pro Athletes */}
      <p className="px-4 py-1 text-xs text-gray-500 font-semibold uppercase">Pro Athletes</p>
      {proAthletes.map(p => <PersonaOption key={p.id} persona={p} />)}
      
      <div className="h-px bg-zinc-700 my-2" />
      
      {/* Photographers */}
      <p className="px-4 py-1 text-xs text-gray-500 font-semibold uppercase">Photographers</p>
      {photographers.map(p => <PersonaOption key={p.id} persona={p} />)}
      
      <div className="h-px bg-zinc-700 my-2" />
      
      {/* Surfers */}
      <p className="px-4 py-1 text-xs text-gray-500 font-semibold uppercase">Surfers</p>
      {surfers.map(p => <PersonaOption key={p.id} persona={p} />)}
      
      <div className="h-px bg-zinc-700 my-2" />
      
      {/* Businesses */}
      <p className="px-4 py-1 text-xs text-gray-500 font-semibold uppercase">Businesses</p>
      {businesses.map(p => <PersonaOption key={p.id} persona={p} />)}
      
      <div className="h-px bg-zinc-700 my-2" />
      
      {/* Exit Button */}
      <button
        onClick={handleHardExit}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
      >
        <X className="w-4 h-4" />
        <span className="font-medium">Exit God Mode</span>
      </button>
    </div>
  );

  return (
    <>
      {/* ========== MOBILE: Overlay God Mode (doesn't push content) ========== */}
      <div className="md:hidden">
        {/* MINIMIZED STATE: Small icon overlaying the logo area (top-left) */}
        {isMobileMinimized ? (
          <button
            onClick={() => setIsMobileMinimized(false)}
            className="fixed z-[9999] w-9 h-9 rounded-full shadow-lg flex items-center justify-center border-2 border-white/30"
            style={{ 
              top: 'calc(env(safe-area-inset-top, 0px) + 6px)',
              left: '6px',
              background: 'linear-gradient(135deg, #06b6d4 0%, #22d3ee 100%)',
            }}
            data-testid="persona-mask-banner-mobile-minimized"
            title={`Viewing as: ${currentRoleInfo.label}`}
          >
            <Eye className="w-4 h-4 text-black" />
          </button>
        ) : (
          /* EXPANDED STATE: Horizontal overlay - eye icon toggles minimize */
          <Sheet open={isMobileSheetOpen} onOpenChange={setIsMobileSheetOpen}>
            <div 
              className="fixed z-[9999] flex items-center rounded-full shadow-lg border border-white/20"
              style={{ 
                top: 'calc(env(safe-area-inset-top, 0px) + 6px)',
                left: '6px',
                background: 'linear-gradient(90deg, #06b6d4 0%, #22d3ee 100%)',
              }}
              data-testid="persona-mask-banner-mobile"
            >
              {/* Eye Icon - Click to MINIMIZE */}
              <button
                onClick={() => setIsMobileMinimized(true)}
                className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/10"
                data-testid="persona-mask-minimize-btn"
              >
                <Eye className="w-4 h-4 text-black" />
              </button>
              
              {/* Persona Info - Click to open sheet */}
              <SheetTrigger asChild>
                <button className="flex items-center gap-1.5 pr-3">
                  <span className="text-lg">{currentRoleInfo.icon}</span>
                  <span className="text-black font-bold text-xs whitespace-nowrap">{currentRoleInfo.label.toUpperCase()}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-black" />
                </button>
              </SheetTrigger>
            </div>
            
            <SheetContent 
              side="bottom" 
              className="bg-zinc-900 border-zinc-700 rounded-t-3xl max-h-[80vh] overflow-hidden flex flex-col"
            >
              <SheetHeader className="pb-2 shrink-0">
                <SheetTitle className="text-white flex items-center gap-2">
                  <Eye className="w-5 h-5 text-cyan-400" />
                  God Mode - Switch Persona
                </SheetTitle>
              </SheetHeader>
              <div className="overflow-y-auto flex-1 pb-8 -mx-6 px-6">
                <PersonaList />
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>

      {/* ========== DESKTOP: Expandable Banner with Minimize ========== */}
      <div className="hidden md:block">
        {isDesktopMinimized ? (
          /* MINIMIZED: Small icon tab in top-left corner */
          <button
            onClick={() => setIsDesktopMinimized(false)}
            className="fixed top-2 left-2 z-[9999] w-9 h-9 rounded-full shadow-lg flex items-center justify-center border-2 border-white/30"
            style={{ 
              background: 'linear-gradient(135deg, #06b6d4 0%, #22d3ee 100%)',
            }}
            data-testid="persona-mask-banner-desktop-minimized"
            title={`Viewing as: ${currentRoleInfo.label} - Click to expand`}
          >
            <Eye className="w-4 h-4 text-black" />
          </button>
        ) : (
          /* EXPANDED: Full top banner */
          <div 
            className="fixed top-0 left-0 right-0 z-[9999]"
            style={{ 
              background: 'linear-gradient(90deg, #06b6d4 0%, #22d3ee 50%, #06b6d4 100%)',
            }}
            data-testid="persona-mask-banner-desktop"
          >
            <div className="flex items-center justify-center gap-3 py-2 px-4">
              <Eye className="w-5 h-5 text-black" />
              <span className="text-black font-bold">VIEWING AS:</span>
              
              {/* Dropdown trigger */}
              <div className="relative">
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="flex items-center gap-2 px-3 py-1 bg-black/20 hover:bg-black/30 rounded-full font-bold transition-colors"
                >
                  <span className="text-lg">{currentRoleInfo.icon}</span>
                  <span className="text-black">{currentRoleInfo.label.toUpperCase()}</span>
                  <ChevronDown className={`w-4 h-4 text-black transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
                
                {/* Desktop dropdown */}
                {isExpanded && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-h-[70vh] overflow-y-auto">
                    <PersonaList />
                  </div>
                )}
              </div>
              
              {/* Minimize button */}
              <button
                onClick={() => setIsDesktopMinimized(true)}
                className="ml-2 p-1.5 bg-black/20 hover:bg-black/30 rounded-full transition-colors"
                title="Minimize God Mode bar"
                data-testid="desktop-minimize-btn"
              >
                <Minimize2 className="w-4 h-4 text-black" />
              </button>
              
              {/* Exit button */}
              <button
                onClick={handleHardExit}
                className="p-1.5 bg-black/20 hover:bg-red-500/50 rounded-full transition-colors"
                title="Exit God Mode"
              >
                <X className="w-4 h-4 text-black" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Click outside to close desktop dropdown */}
      {isExpanded && (
        <div 
          className="hidden md:block fixed inset-0 z-[9998]" 
          onClick={() => setIsExpanded(false)}
        />
      )}
    </>
  );
};

export default PersonaMaskBanner;
