import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import logger from '../utils/logger';
import { ROLES, ROLE_SETS, isProLevel, isBusinessRole as _isBusinessRole } from '../constants/roles';

// All available personas/roles in the system
export const ALL_PERSONAS = [
  { id: ROLES.GOD, label: 'God Mode', icon: '🔴', description: 'Full admin access' },
  { id: ROLES.PRO, label: 'Verified Pro Surfer', icon: '⭐', description: 'Professional athlete' },
  { id: ROLES.APPROVED_PRO, label: 'Verified Pro Photographer', icon: '📸', description: 'Verified pro photographer' },
  { id: ROLES.PHOTOGRAPHER, label: 'Regular Photographer', icon: '📷', description: 'Standard photographer' },
  { id: ROLES.HOBBYIST, label: 'Hobbyist Photographer', icon: '🔍', description: 'Amateur/hobbyist' },
  { id: ROLES.SHOP, label: 'Surf Shop', icon: '🛍️', description: 'Retail business' },
  { id: ROLES.SURF_SCHOOL, label: 'Surf School / Coach', icon: '🌬️', description: 'Teaching/coaching' },
  { id: ROLES.SHAPER, label: 'Shaper', icon: '🛠️', description: 'Board shaper' },
  { id: ROLES.RESORT, label: 'Resort / Retreat', icon: '🌴', description: 'Hospitality' },
  { id: ROLES.SURFER, label: 'Regular Surfer', icon: '🏄', description: 'Standard surfer' },
  { id: ROLES.COMP_SURFER, label: 'Competition Surfer', icon: '🏆', description: 'Competition level' },
  { id: ROLES.GROM, label: 'Grom', icon: '🐣', description: 'Young surfer' },
  { id: ROLES.GROM_PARENT, label: 'Grom Parent', icon: '👨‍👧', description: 'Parent of grom' },
];

// Re-export for backward compatibility — consumers that import from PersonaContext still work
export { ROLES, ROLE_SETS };

// Get expanded role info with proper icons
export const getExpandedRoleInfo = (role, isAdmin = false) => {
  if (isAdmin && role !== ROLES.GOD) {
    // Admin viewing as another role - keep admin indicator
    return { ...getRoleDetails(role), isAdminMasked: true };
  }
  return getRoleDetails(role);
};

const getRoleDetails = (role) => {
  switch (role) {
    case ROLES.GOD:
      return { icon: '🔴', color: 'text-red-500', bgColor: 'bg-red-500/20', label: 'God Mode', priority: 0 };
    case ROLES.PRO:
      return { icon: '⭐', color: 'text-amber-400', bgColor: 'bg-amber-400/20', label: 'Pro Surfer', priority: 1 };
    case ROLES.APPROVED_PRO:
      return { icon: '📸', color: 'text-blue-400', bgColor: 'bg-blue-400/20', label: 'Pro Photographer', priority: 1 };
    case ROLES.PHOTOGRAPHER:
      return { icon: '📷', color: 'text-purple-400', bgColor: 'bg-purple-400/20', label: 'Photographer', priority: 2 };
    case ROLES.HOBBYIST:
      return { icon: '🔍', color: 'text-indigo-400', bgColor: 'bg-indigo-400/20', label: 'Hobbyist', priority: 3 };
    case ROLES.SHOP:
      return { icon: '🛍️', color: 'text-pink-400', bgColor: 'bg-pink-400/20', label: 'Surf Shop', priority: 2 };
    case ROLES.SURF_SCHOOL:
      return { icon: '🌬️', color: 'text-teal-400', bgColor: 'bg-teal-400/20', label: 'Surf School', priority: 2 };
    case ROLES.SHAPER:
      return { icon: '🛠️', color: 'text-orange-400', bgColor: 'bg-orange-400/20', label: 'Shaper', priority: 2 };
    case ROLES.RESORT:
      return { icon: '🌴', color: 'text-emerald-400', bgColor: 'bg-emerald-400/20', label: 'Resort', priority: 2 };
    case ROLES.COMP_SURFER:
      return { icon: '🏆', color: 'text-yellow-400', bgColor: 'bg-yellow-400/20', label: 'Comp Surfer', priority: 1 };
    case ROLES.GROM:
      return { icon: '🐣', color: 'text-lime-400', bgColor: 'bg-lime-400/20', label: 'Grom', priority: 4 };
    case ROLES.GROM_PARENT:
      return { icon: '👨‍👧', color: 'text-sky-400', bgColor: 'bg-sky-400/20', label: 'Grom Parent', priority: 3 };
    case ROLES.SURFER:
    default:
      return { icon: '🏄', color: 'text-cyan-400', bgColor: 'bg-cyan-400/20', label: 'Surfer', priority: 4 };
  }
};

// Check if role is Pro-level (for Pro Lounge access)
// Note: Only Verified Pro Surfers ('Pro') and God Mode have access to Pro Lounge
// 'Comp Surfer' (Competition Surfer) does NOT have Pro Lounge access
export const isProLevelRole = (role) => isProLevel(role);

// Check if role is Business/Photographer (for The Channel)
export const isBusinessRole = (role) => _isBusinessRole(role);

const PersonaContext = createContext();

export const PersonaProvider = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  
  // CRITICAL: Check for user in localStorage BEFORE initializing state
  // This prevents flash of God Mode UI when user is not logged in
  const _hasStoredUser = typeof window !== 'undefined' && !!localStorage.getItem('raw-surf-user');
  
  const [activePersona, setActivePersona] = useState(null);
  const [isGodMode, setIsGodMode] = useState(false);
  const [isPersonaBarActive, setIsPersonaBarActive] = useState(false);

  // CRITICAL: On initial mount, clear God Mode localStorage if no user in localStorage
  // This runs synchronously before any render to prevent flash
  useEffect(() => {
    const storedUser = localStorage.getItem('raw-surf-user');
    if (!storedUser) {
      // No user stored - immediately clear all God Mode values
      localStorage.removeItem('godModeMinimized');
      localStorage.removeItem('godModeDesktopMinimized');
      localStorage.removeItem('isGodMode');
      localStorage.removeItem('isPersonaBarActive');
      localStorage.removeItem('activePersona');
      // Ensure state is also cleared
      setIsGodMode(false);
      setActivePersona(null);
      setIsPersonaBarActive(false);
    }
  }, []); // Run once on mount

  // Load persona from localStorage on mount - BUT ONLY if user is logged in AND is admin
  // CRITICAL: Wait for auth to finish loading before making decisions
  // IMPORTANT: God Mode should NOT auto-restore on login - user must explicitly enable it
  useEffect(() => {
    // Don't do anything while auth is still loading
    if (authLoading) {
      return;
    }
    
    // Auth finished loading - now check user state
    if (!user?.id || !user?.is_admin) {
      // Not logged in or not admin - clear any lingering state AND localStorage
      setIsGodMode(false);
      setActivePersona(null);
      setIsPersonaBarActive(false);
      
      // Also clear God Mode related localStorage to prevent any leakage
      localStorage.removeItem('godModeMinimized');
      localStorage.removeItem('godModeDesktopMinimized');
      localStorage.removeItem('isGodMode');
      localStorage.removeItem('isPersonaBarActive');
      localStorage.removeItem('activePersona');
      return;
    }
    
    // User is logged in AND is admin
    // RESTORE God Mode from localStorage if it was previously enabled
    const savedGodMode = localStorage.getItem('isGodMode') === 'true';
    const savedPersona = localStorage.getItem('activePersona');
    const savedBarActive = localStorage.getItem('isPersonaBarActive') === 'true';
    
    if (savedGodMode) {
      setIsGodMode(true);
      if (savedPersona) {
        setActivePersona(savedPersona);
      }
      if (savedBarActive) {
        setIsPersonaBarActive(true);
      }
    } else {
      // No saved God Mode - start clean
      setIsGodMode(false);
      setActivePersona(null);
      setIsPersonaBarActive(false);
    }
  }, [user?.id, user?.is_admin, authLoading]);

  // Clear God Mode state when user logs out (not during initial loading)
  useEffect(() => {
    // Only clear if auth finished loading AND user is not present
    if (!authLoading && !user?.id) {
      // User logged out - clear everything
      setIsGodMode(false);
      setActivePersona(null);
      setIsPersonaBarActive(false);
    }
  }, [user?.id, authLoading]);

  // Initialize God Mode (called when admin user visits admin page)
  // Only works if user is logged in AND is admin
  const enableGodMode = () => {
    if (!user?.id || !user?.is_admin) {
      logger.warn('Cannot enable God Mode: user is not logged in or not admin');
      return;
    }
    setIsGodMode(true);
    localStorage.setItem('isGodMode', 'true');
  };

  // Set active persona (only works in God Mode AND user is admin)
  // This also activates the persona bar
  const setPersona = (persona) => {
    if (!isGodMode || !user?.is_admin) return;
    setActivePersona(persona);
    setIsPersonaBarActive(true);
    localStorage.setItem('activePersona', persona);
    localStorage.setItem('isPersonaBarActive', 'true');
  };

  // Hard EXIT: Clear persona AND hide the bar completely
  const exitPersonaMode = () => {
    setActivePersona(null);
    setIsPersonaBarActive(false);
    localStorage.removeItem('activePersona');
    localStorage.removeItem('isPersonaBarActive');
  };

  // Clear just the persona selection (keep bar visible for re-selection)
  // Used when selecting "God Mode (Native)" from dropdown
  const clearPersona = () => {
    setActivePersona(null);
    localStorage.removeItem('activePersona');
    // Note: Bar stays visible if isPersonaBarActive is true
  };

  // Disable God Mode entirely (on logout)
  const disableGodMode = () => {
    setIsGodMode(false);
    setActivePersona(null);
    setIsPersonaBarActive(false);
    localStorage.removeItem('isGodMode');
    localStorage.removeItem('activePersona');
    localStorage.removeItem('isPersonaBarActive');
  };

  // Get the effective role for UI rendering
  const getEffectiveRole = (actualRole) => {
    // Only apply persona masking if user is authenticated admin with God Mode active
    if (isGodMode && activePersona && user?.is_admin) {
      return activePersona;
    }
    return actualRole;
  };

  // Check if currently masked (has a non-null persona selected AND user is admin)
  const isMasked = isGodMode && activePersona !== null && user?.is_admin;
  
  // Derived state: Is God Mode actually valid? (user must be logged in AND admin)
  const isGodModeValid = isGodMode && user?.id && user?.is_admin;
  const isPersonaBarValid = isPersonaBarActive && isGodModeValid;

  return (
    <PersonaContext.Provider value={{
      activePersona,
      isGodMode: isGodModeValid,  // Use validated state
      isMasked,
      isPersonaBarActive: isPersonaBarValid,  // Use validated state
      setPersona,
      clearPersona,
      exitPersonaMode,
      enableGodMode,
      disableGodMode,
      getEffectiveRole,
      getAllPersonas: () => ALL_PERSONAS,
      getRoleInfo: getExpandedRoleInfo,
    }}>
      {children}
    </PersonaContext.Provider>
  );
};

export const usePersona = () => {
  const context = useContext(PersonaContext);
  if (!context) {
    throw new Error('usePersona must be used within a PersonaProvider');
  }
  return context;
};

export default PersonaContext;
