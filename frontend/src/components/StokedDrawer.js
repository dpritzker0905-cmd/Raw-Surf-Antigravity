/**
 * StokedDrawer - Mobile bottom sheet drawer for Stoked credits/impact
 * Opens from the lightning bolt icon in mobile TopNav
 */

import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { Zap, Gift, Plane, ShoppingBag, GraduationCap, ArrowRight, X } from 'lucide-react';
import { Button } from './ui/button';
import { ROLES } from '../constants/roles';

/**
 * Get credit usage options based on role
 */
const getCreditOptions = (effectiveRole) => {
  if (effectiveRole === ROLES.PRO) {
    return [
      { icon: Gift, title: "Pay It Forward", description: "Support other surfers", color: "pink", route: "/stoked" },
      { icon: ShoppingBag, title: "Premium Gear", description: "Top-tier equipment", color: "cyan", route: "/gear-hub" },
    ];
  }
  if (effectiveRole === ROLES.COMP_SURFER) {
    return [
      { icon: Plane, title: "Travel & Contests", description: "Competition expenses", color: "purple", route: "/explore" },
      { icon: ShoppingBag, title: "Pro Equipment", description: "High-performance gear", color: "cyan", route: "/gear-hub" },
    ];
  }
  if (effectiveRole === ROLES.GROM) {
    return [
      { icon: ShoppingBag, title: "Gear & Equipment", description: "Boards and wetsuits", color: "cyan", route: "/gear-hub" },
      { icon: GraduationCap, title: "Surf Lessons", description: "Level up your skills", color: "green", route: "/map" },
    ];
  }
  // Regular Surfer
  return [
    { icon: ShoppingBag, title: "Gear & Equipment", description: "Boards and wetsuits", color: "cyan", route: "/gear-hub" },
    { icon: GraduationCap, title: "Coaching", description: "Level up your skills", color: "green", route: "/map" },
  ];
};

const colorMap = {
  pink: { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30', hover: 'hover:bg-pink-500/10' },
  cyan: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30', hover: 'hover:bg-cyan-500/10' },
  purple: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30', hover: 'hover:bg-purple-500/10' },
  green: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30', hover: 'hover:bg-green-500/10' },
  yellow: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30', hover: 'hover:bg-yellow-500/10' },
};

export const StokedDrawer = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const { getEffectiveRole } = usePersona();
  
  // Refresh user data when drawer opens
  React.useEffect(() => {
    if (isOpen && refreshUser) {
      refreshUser();
    }
  }, [isOpen, refreshUser]);
  
  const effectiveRole = getEffectiveRole(user?.role);
  const creditOptions = getCreditOptions(effectiveRole);
  const creditBalance = user?.credit_balance || 0;
  
  // Determine title based on role
  const getTitle = () => {
    if (['Comp Surfer', 'Pro'].includes(effectiveRole)) return 'Stoked';
    if (effectiveRole === ROLES.GROM) return 'Grom Stash';
    return 'Surf Credits';
  };

  const handleOptionClick = (route) => {
    onClose();
    navigate(route);
  };

  const handleViewFull = () => {
    onClose();
    navigate('/profile?tab=stoked');
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent 
        side="bottom" 
        hideCloseButton
        className="bg-zinc-900 border-zinc-700 rounded-t-3xl max-h-[75vh] sheet-safe-bottom md:max-h-[65vh] md:!bottom-4 overflow-hidden flex flex-col !p-4 !pt-5"
      >
        <SheetHeader className="pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-white flex items-center gap-2 text-base">
              <Zap className="w-5 h-5 text-yellow-400" />
              {getTitle()}
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
          {/* Credit Balance Card */}
          <div className="bg-gradient-to-br from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-wider">Your Balance</p>
                <p className="text-2xl font-bold text-white">${creditBalance.toFixed(2)}</p>
                <p className="text-xs text-gray-400">Stoked Credits</p>
              </div>
              <div className="w-12 h-12 rounded-full bg-yellow-500/30 flex items-center justify-center">
                <Zap className="w-6 h-6 text-yellow-400" />
              </div>
            </div>
            <p className="text-xs text-yellow-400/80 mt-2">
              Powered by photographers & brands who believe in you
            </p>
          </div>
          
          {/* Credit Options */}
          <div className="space-y-2">
            <p className="text-xs text-gray-400 uppercase tracking-wider px-1">Use Your Credits</p>
            
            {creditOptions.map((option, idx) => {
              const colors = colorMap[option.color] || colorMap.cyan;
              const Icon = option.icon;
              
              return (
                <Button
                  key={idx}
                  variant="outline"
                  className={`w-full justify-start h-auto py-3 ${colors.border} ${colors.hover}`}
                  onClick={() => handleOptionClick(option.route)}
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
          
          {/* View Full Dashboard Link */}
          <div className={!['Pro', 'Comp Surfer', 'Grom'].includes(effectiveRole) ? 'hidden md:block' : 'block'}>
            <Button
              variant="ghost"
              className="w-full text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10"
              onClick={handleViewFull}
            >
              View Full Stoked Dashboard
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default StokedDrawer;
