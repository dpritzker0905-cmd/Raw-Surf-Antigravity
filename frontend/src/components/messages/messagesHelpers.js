/**
 * messagesHelpers.js - Extracted from MessagesPage.js (v61)
 * Role-based folder system, icon helpers, and UI components for the messaging system.
 */
import { Star, Camera, Search, Store, Users, Briefcase, Smile, EyeOff, Shield } from 'lucide-react';
import { getExpandedRoleInfo, isProLevelRole, isBusinessRole as isBusinessRoleCheck } from '../../contexts/PersonaContext';
import { ROLES } from '../../constants/roles';

// Role-based icon helper - uses expanded PersonaContext
const getRoleIcon = (role, isAdmin = false) => {
  const _roleInfo = getExpandedRoleInfo(role, isAdmin);
  if (isAdmin) return { icon: Shield, color: 'text-red-500', label: 'God Mode', emoji: '\u{1F6E1}\u{FE0F}' };
  
  // Map to lucide icons for non-emoji contexts
  switch (role) {
    case 'Pro':
        case 'Comp Surfer':
      return { icon: Star, color: 'text-amber-400', label: 'Pro', emoji: '\u{2B50}' };
    case 'Approved Pro':
      return { icon: Camera, color: 'text-blue-400', label: 'Pro Photographer', emoji: '\u{1F4F8}' };
    case 'Photographer':
      return { icon: Camera, color: 'text-purple-400', label: 'Photographer', emoji: '\u{1F4F7}' };
    case 'Hobbyist':
      return { icon: Search, color: 'text-indigo-400', label: 'Hobbyist', emoji: '\u{1F3C4}' };
    case 'Shop':
      return { icon: Store, color: 'text-pink-400', label: 'Surf Shop', emoji: '\u{1F6CD}\u{FE0F}' };
    case 'Surf School':
      return { icon: Users, color: 'text-teal-400', label: 'Surf School', emoji: '\u{1F3EB}' };
    case 'Shaper':
      return { icon: Briefcase, color: 'text-orange-400', label: 'Shaper', emoji: '\u{1FA93}' };
    case 'Resort':
      return { icon: Store, color: 'text-emerald-400', label: 'Resort', emoji: '\u{1F3D6}\u{FE0F}' };
    default:
      return { icon: null, color: 'text-cyan-400', label: 'Surfer', emoji: '\u{1F30A}' };
  }
};

// Check if user is a Pro (for Pro Lounge access)
const isProRole = (role) => isProLevelRole(role);

// Check if user is Business/Photographer
const isBusinessRole = (role) => isBusinessRoleCheck(role);

// Updated folder system with Pro Lounge and The Channel
const getFolders = (userRole, _isAdmin = false, effectiveRole = null, _isMasked = false, isGromParentFlag = false) => {
  // Use effective role if God Mode is masking
  const roleToCheck = effectiveRole || userRole;
  // Pro Lounge access: ONLY for 'Pro' or 'God' roles
  // Admin status alone does NOT grant Pro Lounge access (e.g., Comp Surfer admin should NOT see Pro Lounge)
  // When masking, use the masked role; otherwise use the actual role
  const isPro = isProRole(roleToCheck);
  const _isBusiness = isBusinessRole(roleToCheck);
  const isGrom = roleToCheck === ROLES.GROM || roleToCheck === 'GROM';
  const isGromParent = roleToCheck === ROLES.GROM_PARENT || roleToCheck === 'GROM_PARENT' || roleToCheck === 'grom_parent' || isGromParentFlag;
  
  const folders = [];
  
  // PRIMARY - Standard surfer-to-surfer communication (visible to all)
  // This is the main inbox for direct messages between surfers
  folders.push({ 
    id: 'primary', 
    label: isGrom ? 'Grom Zone' : 'Primary', 
    icon: Users, 
    color: 'text-cyan-400', 
    description: isGrom ? 'Chat with other Groms' : 'Friends & surfers',
    emoji: '\u{1F4AC}'
  });
  
  // FAMILY CHAT - Grom Parents chat with their linked Groms
  if (isGromParent) {
    folders.push({ 
      id: 'family', 
      label: 'Family', 
      icon: Users, 
      color: 'text-cyan-400', 
      description: 'Chat with your linked Groms',
      emoji: '\u{1F46A}',
      isFamilyOnly: true
    });
  }
  
  // Family chat for Groms to chat with their parent
  if (isGrom) {
    folders.push({ 
      id: 'family', 
      label: 'Family', 
      icon: Users, 
      color: 'text-emerald-400', 
      description: 'Chat with your parent',
      emoji: '\u{1F46A}',
      isFamilyOnly: true
    });
  }
  
  // The Pro Lounge - Only visible to Pro users
  if (isPro) {
    folders.push({ 
      id: 'pro_lounge', 
      label: 'Pro Lounge', 
      icon: Star, 
      color: 'text-amber-400', 
      description: 'Private athlete ecosystem',
      emoji: '\u{1F451}'
    });
  }
  
  // The Channel - Business communication (always visible, but NOT for Groms)
  if (!isGrom) {
    folders.push({ 
      id: 'channel', 
      label: 'The Channel', 
      icon: Briefcase, 
      color: 'text-purple-400', 
      description: 'Business & photographer hub',
      emoji: '\u{1F4BC}'
    });
  }
  
  // Requests
  folders.push({ 
    id: 'requests', 
    label: 'Requests', 
    icon: Smile, 
    color: 'text-orange-400', 
    description: 'Message requests',
    emoji: '\u{1F4E9}'
  });
  
  // Hidden
  folders.push({ 
    id: 'hidden', 
    label: 'Hidden', 
    icon: EyeOff, 
    color: 'text-gray-500', 
    description: 'Muted conversations',
    emoji: '\u{1F648}'
  });
  
  return folders;
};

// GifPicker extracted to ./messages/GifPicker.js

// Shaka SVG Icon Component
const ShakaIcon = ({ className = "w-16 h-16" }) => (
  <svg className={className} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 44 C18 42 16 38 16 32 C16 26 18 22 22 20 L26 18 C28 17 30 18 30 20 L30 28" strokeLinecap="round" />
    <path d="M30 28 L30 16 C30 14 32 12 34 12 C36 12 38 14 38 16 L38 28" strokeLinecap="round" />
    <path d="M38 20 L38 14 C38 12 40 10 42 10 C44 10 46 12 46 14 L46 28" strokeLinecap="round" />
    <path d="M46 22 L46 18 C46 16 48 14 50 14 C52 14 54 16 54 18 L54 32 C54 42 48 50 38 52 L28 54 C24 54 20 52 18 48" strokeLinecap="round" />
    <path d="M30 28 L26 32 C24 34 22 38 22 42" strokeLinecap="round" />
  </svg>
);

export { getRoleIcon, isProRole, isBusinessRole, getFolders, ShakaIcon };
