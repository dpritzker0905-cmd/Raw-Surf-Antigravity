/**
 * ExclusiveAreaDrawer - Role-based exclusive club areas
 * 
 * - Groms: "The Inside" - Exclusive grom community area
 * - Comp Surfers: "The Impact Zone" - Competitive surfer hub
 * - Pro Surfers: "The Peak" - Elite pro surfer area
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { Trophy, Target, Users, Calendar, MessageSquare, 
  Video, Star, Zap, Gift, ArrowRight, X, Crown,
  GraduationCap, Gamepad2, Shield, Award, TrendingUp, Sparkles
} from 'lucide-react';
import { Button } from './ui/button';
import logger from '../utils/logger';
import { ROLES } from '../constants/roles';

const _API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Area configurations for each tier
 */
const AREA_CONFIG = {
  grom: {
    name: "The Inside",
    icon: Sparkles,  // Changed from Waves (now used for Home button)
    tagline: "Where young rippers connect",
    color: "cyan",
    gradient: "from-cyan-500/20 to-blue-500/20",
    borderColor: "border-cyan-500/30",
    textColor: "text-cyan-400",
    options: [
      { icon: Users, title: "Grom Squad", description: "Connect with local groms", route: "/explore?filter=groms", color: "cyan" },
      { icon: GraduationCap, title: "Surf Lessons", description: "Level up your skills", route: "/map?filter=lessons", color: "green" },
      { icon: Gamepad2, title: "Grom Games", description: "Fun competitions & prizes", route: "/grom-games", color: "purple" },
      { icon: Video, title: "Tutorial Videos", description: "Pro tips for young surfers", route: "/tutorials", color: "yellow" },
      { icon: Shield, title: "Safety Zone", description: "Ocean safety & etiquette", route: "/safety", color: "blue" },
      { icon: Zap, title: "Grom Stash", description: "Your earned credits", route: "/stoked", color: "yellow" },
      { icon: Gift, title: "Gear & Equipment", description: "Boards and wetsuits", route: "/gear-hub", color: "pink" },
    ]
  },
  grom_parent: {
    name: "Grom HQ",
    icon: Shield,
    tagline: "Your grom's command center",
    color: "cyan",
    gradient: "from-cyan-500/20 to-blue-500/20",
    borderColor: "border-cyan-500/30",
    textColor: "text-cyan-400",
    options: [
      { icon: Users, title: "Grom Squad", description: "See who your grom surfs with", route: "/explore?filter=groms", color: "cyan" },
      { icon: TrendingUp, title: "Progress Tracker", description: "Track skill development", route: "/grom-hq/progress", color: "green" },
      { icon: GraduationCap, title: "Find Lessons", description: "Book surf coaching nearby", route: "/map?filter=lessons", color: "blue" },
      { icon: Shield, title: "Safety Zone", description: "Ocean safety & etiquette", route: "/safety", color: "orange" },
      { icon: Gamepad2, title: "Grom Games", description: "Fun competitions & prizes", route: "/grom-games", color: "purple" },
      { icon: Gift, title: "Gear & Equipment", description: "Boards and wetsuits", route: "/gear-hub", color: "pink" },
    ]
  },
  comp: {
    name: "The Impact Zone",
    icon: Target,
    tagline: "Where competitors collide",
    color: "orange",
    gradient: "from-orange-500/20 to-red-500/20",
    borderColor: "border-orange-500/30",
    textColor: "text-orange-400",
    options: [
      { icon: Trophy, title: "Upcoming Contests", description: "Local & regional competitions", route: "/contests", color: "yellow" },
      { icon: TrendingUp, title: "Rankings", description: "Your competition standings", route: "/rankings", color: "orange" },
      { icon: Users, title: "Comp Crew", description: "Connect with fellow competitors", route: "/explore?filter=comp", color: "cyan" },
      { icon: Video, title: "Heat Analysis", description: "Study winning strategies", route: "/heat-analysis", color: "purple" },
      { icon: Calendar, title: "Contest Calendar", description: "Plan your comp season", route: "/contest-calendar", color: "green" },
    ]
  },
  pro: {
    name: "The Peak",
    icon: Crown,
    tagline: "Elite access for pros",
    color: "yellow",
    gradient: "from-yellow-500/20 to-amber-500/20",
    borderColor: "border-yellow-500/30",
    textColor: "text-yellow-400",
    options: [
      { icon: Star, title: "Pro Lounge", description: "Exclusive pro discussions", route: "/messages?folder=pro-lounge", color: "yellow" },
      { icon: Award, title: "Sponsorship Hub", description: "Brand partnerships & deals", route: "/sponsorships", color: "purple" },
      { icon: Trophy, title: "Tour Events", description: "WSL & elite competitions", route: "/tour-events", color: "orange" },
      { icon: Gift, title: "Pro Perks", description: "Exclusive gear & discounts", route: "/pro-perks", color: "pink" },
      { icon: MessageSquare, title: "Agent Connect", description: "Management & representation", route: "/agent-connect", color: "cyan" },
    ]
  }
};

const colorMap = {
  cyan: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30', hover: 'hover:bg-cyan-500/10' },
  green: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30', hover: 'hover:bg-green-500/10' },
  purple: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30', hover: 'hover:bg-purple-500/10' },
  yellow: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30', hover: 'hover:bg-yellow-500/10' },
  orange: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30', hover: 'hover:bg-orange-500/10' },
  pink: { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30', hover: 'hover:bg-pink-500/10' },
  blue: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30', hover: 'hover:bg-blue-500/10' },
  red: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', hover: 'hover:bg-red-500/10' },
};

/**
 * Get area type based on role
 */
export const getAreaType = (role) => {
  if (role === ROLES.GROM) return 'grom';
  if (role === ROLES.COMP_SURFER) return 'comp';
  if (role === ROLES.PRO) return 'pro';
  if (role === ROLES.GROM_PARENT) return 'grom_parent';
  return null;
};

/**
 * Check if role has exclusive area access
 */
export const hasExclusiveArea = (role) => {
  return ['Grom', 'Comp Surfer', 'Pro', 'Grom Parent'].includes(role);
};

/**
 * Get icon component for the area
 */
export const getAreaIcon = (role) => {
  const areaType = getAreaType(role);
  if (!areaType) return null;
  return AREA_CONFIG[areaType].icon;
};

/**
 * Get area color for the icon
 */
export const getAreaColor = (role) => {
  const areaType = getAreaType(role);
  if (!areaType) return 'text-gray-400';
  return AREA_CONFIG[areaType].textColor;
};

export const ExclusiveAreaDrawer = ({ isOpen, onClose, areaType }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [memberCount, setMemberCount] = useState(0);
  
  const config = AREA_CONFIG[areaType];
  
  useEffect(() => {
    // Fetch member count for this area
    const fetchMemberCount = async () => {
      try {
        // This would be a real API call in production
        // For now, simulate different counts per area
        const counts = { grom: 1247, comp: 892, pro: 156 };
        setMemberCount(counts[areaType] || 0);
      } catch (e) {
        logger.error('Failed to fetch member count');
      }
    };
    
    if (isOpen && areaType) {
      fetchMemberCount();
    }
  }, [isOpen, areaType]);
  
  if (!config) return null;
  
  const AreaIcon = config.icon;

  const handleOptionClick = (route) => {
    onClose();
    navigate(route);
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent 
        side="bottom" 
        hideCloseButton
        className="bg-zinc-900 border-zinc-700 rounded-t-3xl max-h-[80vh] sheet-safe-bottom md:max-h-[65vh] md:!bottom-4 overflow-hidden flex flex-col"
      >
        <SheetHeader className="pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-white flex items-center gap-2 text-base">
              <AreaIcon className={`w-5 h-5 ${config.textColor}`} />
              {config.name}
            </SheetTitle>
            <button 
              onClick={onClose}
              className="text-gray-400 hover:text-white p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </SheetHeader>
        
        <div className="overflow-y-auto flex-1 pb-6 space-y-4">
          {/* Area Header Card */}
          <div className={`bg-gradient-to-br ${config.gradient} border ${config.borderColor} rounded-xl p-4`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={`${config.textColor} text-sm font-semibold`}>{config.tagline}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {memberCount.toLocaleString()} members online
                </p>
              </div>
              <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${config.gradient} flex items-center justify-center border ${config.borderColor}`}>
                <AreaIcon className={`w-6 h-6 ${config.textColor}`} />
              </div>
            </div>
            
            {/* Welcome message */}
            <div className="mt-3 pt-3 border-t border-white/10">
              <p className="text-xs text-gray-300">
                Welcome to <span className={config.textColor}>{config.name}</span>, {user?.full_name?.split(' ')[0] || 'surfer'}! 
                This is your exclusive space.
              </p>
            </div>
          </div>
          
          {/* Area Options */}
          <div className="space-y-2">
            {config.options.map((option, idx) => {
              const colors = colorMap[option.color] || colorMap.cyan;
              const Icon = option.icon;
              
              return (
                <Button
                  key={idx}
                  variant="outline"
                  className={`w-full justify-start h-auto py-3 ${colors.border} ${colors.hover}`}
                  onClick={() => handleOptionClick(option.route)}
                  data-testid={`area-option-${idx}`}
                >
                  <div className={`w-9 h-9 rounded-full ${colors.bg} flex items-center justify-center mr-3`}>
                    <Icon className={`w-4 h-4 ${colors.text}`} />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-semibold text-white text-sm">{option.title}</div>
                    <div className="text-xs text-gray-400">{option.description}</div>
                  </div>
                  <ArrowRight className={`w-4 h-4 ${colors.text}`} />
                </Button>
              );
            })}
          </div>
          
          {/* Coming Soon Note */}
          <div className="text-center pt-2">
            <p className="text-xs text-gray-500">
              More exclusive features coming soon
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ExclusiveAreaDrawer;
