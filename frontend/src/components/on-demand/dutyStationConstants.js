/**
 * DutyStation constants and geo utilities GÇö extracted from DutyStationDrawer (v81)
 */
import { Radio, Zap } from 'lucide-react';

// Distance constants
export const LIVE_PROXIMITY_MILES = 0.2; // Must be within 0.2 miles to go live
export const LIVE_PROXIMITY_METERS = LIVE_PROXIMITY_MILES * 1609.34;

// On-Demand radius by role (in miles)
export const ON_DEMAND_RADIUS = {
  standard: { min: 10, max: 20 },  // Regular Photographer
  pro: { min: 10, max: 50 }        // Approved Pro
};

// Mode configurations with theming
export const MODE_CONFIG = {
  live: {
    id: 'live',
    label: 'Live',
    icon: Radio,
    description: 'Actively shooting at a spot',
    activeText: 'Currently shooting',
    inactiveText: 'Ready to go live',
    colors: {
      primary: 'bg-blue-500',
      primaryHover: 'hover:bg-blue-400',
      text: 'text-blue-400',
      textLight: 'text-blue-300',
      border: 'border-blue-500/50',
      glow: 'shadow-[0_0_20px_rgba(59,130,246,0.4)]',
      gradient: 'from-blue-500/20 to-cyan-500/20',
      ring: 'bg-blue-500/20'
    }
  },
  onDemand: {
    id: 'onDemand',
    label: 'On-Demand',
    icon: Zap,
    description: 'Available for requests nearby',
    activeText: 'Accepting requests',
    inactiveText: 'Ready to activate',
    colors: {
      primary: 'bg-amber-500',
      primaryHover: 'hover:bg-amber-400',
      text: 'text-amber-400',
      textLight: 'text-amber-300',
      border: 'border-amber-500/50',
      glow: 'shadow-[0_0_20px_rgba(245,158,11,0.4)]',
      gradient: 'from-amber-500/20 to-orange-500/20',
      ring: 'bg-amber-500/20'
    }
  }
};

/**
 * Calculate distance between two coordinates in meters (Haversine formula)
 */
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export const metersToMiles = (meters) => meters / 1609.34;
