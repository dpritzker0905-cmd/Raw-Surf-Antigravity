import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import {
  Backpack, Stamp, ChevronRight, X, CreditCard, BellRing, BookOpen,
  Heart, Zap, ShoppingBag, Sparkles, Crown, Target, Shield
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { SurfPassport } from './SurfPassport';
import { StokedDrawer } from './StokedDrawer';
import { ExclusiveAreaDrawer, hasExclusiveArea, getAreaType } from './ExclusiveAreaDrawer';
import { ROLES } from '../constants/roles';

/**
 * BackpackDrawer - Consolidated menu for Passport, Wallet, and Surf Alerts
 * Opens as a bottom sheet on mobile for better thumb accessibility
 * 
 * This drawer provides quick access to:
 * 1. Surf Passport - Travel stamps and surf journey
 * 2. Credit Wallet - Purchase credits and balance
 * 3. Surf Alerts - Wave condition notifications
 */
export var BackpackDrawer = ({ isOpen, onClose, onReopen }) => {
  const { user } = useAuth();
  const { getEffectiveRole } = usePersona();
  const navigate = useNavigate();
  const [passportOpen, setPassportOpen] = useState(false);
  const [stokedOpen, setStokedOpen] = useState(false);
  const [exclusiveAreaOpen, setExclusiveAreaOpen] = useState(false);
  const [gromHQOpen, setGromHQOpen] = useState(false);

  // Role resolution
  const effectiveRole = getEffectiveRole(user?.role);
  const isPhotographer = ['Hobbyist', 'Photographer', 'Approved Pro'].includes(effectiveRole);
  const isGromParent = effectiveRole === ROLES.GROM_PARENT || user?.is_grom_parent === true;
  const isProSurferMode = user?.surf_mode === 'pro';
  const isCompetitiveSurferMode = user?.surf_mode === 'competitive';
  const resolvedRole = effectiveRole === ROLES.SURFER
    ? (isProSurferMode ? 'Pro' : isCompetitiveSurferMode ? 'Comp Surfer' : effectiveRole)
    : effectiveRole;
  const hasExclusiveAccess = hasExclusiveArea(resolvedRole);
  const exclusiveAreaType = getAreaType(resolvedRole);
  const isCompetitive = ['Comp Surfer', 'Pro'].includes(effectiveRole) ||
    (effectiveRole === ROLES.SURFER && (isProSurferMode || isCompetitiveSurferMode));

  const handlePassportClick = () => {
    onClose(); // Close backpack first
    setTimeout(() => {
      setPassportOpen(true); // Then open passport after drawer closes
    }, 150);
  };

  const handlePassportClose = () => {
    setPassportOpen(false);
    // Reopen backpack after passport closes
    setTimeout(() => {
      if (onReopen) {
        onReopen();
      }
    }, 150);
  };

  const handleNavigation = (path) => {
    onClose();
    navigate(path);
  };

  const menuItems = [
    {
      id: 'surf-log',
      icon: BookOpen,
      label: 'Surf Log',
      description: 'Track your sessions & progress',
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-500/20',
      borderColor: 'border-cyan-500/30',
      action: () => handleNavigation('/surf-log')
    },
    {
      id: 'passport',
      icon: Stamp,
      label: 'Surf Passport',
      description: 'Your surf journey & stamps',
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/20',
      borderColor: 'border-emerald-500/30',
      action: handlePassportClick
    },
    {
      id: 'wallet',
      icon: CreditCard,
      label: 'Credit Wallet',
      description: 'Purchase credits & balance',
      color: 'text-yellow-400',
      bgColor: 'bg-yellow-500/20',
      borderColor: 'border-yellow-500/30',
      action: () => handleNavigation('/wallet')
    },
    {
      id: 'alerts',
      icon: BellRing,
      label: 'Surf Alerts',
      description: 'Wave condition notifications',
      color: 'text-orange-400',
      bgColor: 'bg-orange-500/20',
      borderColor: 'border-orange-500/30',
      action: () => handleNavigation('/alerts')
    }
  ];

  // Role-specific perks that appear in the "Your Perks" section
  const handlePerkOpen = (drawerSetter) => {
    onClose(); // Close backpack first
    setTimeout(() => drawerSetter(true), 150);
  };

  const getRolePerks = () => {
    const perks = [];

    // Grom: The Inside
    if (effectiveRole === ROLES.GROM) {
      perks.push({
        id: 'the-inside', icon: Sparkles, label: 'The Inside',
        description: 'Your exclusive grom community',
        color: 'text-purple-400', bgColor: 'bg-purple-500/20', borderColor: 'border-purple-500/30',
        action: () => handlePerkOpen(setExclusiveAreaOpen)
      });
    }

    // Competitive Surfers: Impact Zone + Stoked
    if (isCompetitive && isCompetitiveSurferMode) {
      perks.push({
        id: 'impact-zone', icon: Target, label: 'The Impact Zone',
        description: 'Competition hub & rankings',
        color: 'text-red-400', bgColor: 'bg-red-500/20', borderColor: 'border-red-500/30',
        action: () => handlePerkOpen(setExclusiveAreaOpen)
      });
    }

    // Pro Surfers: The Peak + Stoked
    if (isCompetitive && isProSurferMode) {
      perks.push({
        id: 'the-peak', icon: Crown, label: 'The Peak',
        description: 'Pro lounge & rankings',
        color: 'text-amber-400', bgColor: 'bg-amber-500/20', borderColor: 'border-amber-500/30',
        action: () => handlePerkOpen(setExclusiveAreaOpen)
      });
    }

    // All surfer types (including comp/pro) get Stoked
    if (!isPhotographer && !isGromParent && effectiveRole !== ROLES.GROM) {
      perks.push({
        id: 'stoked', icon: isCompetitive ? Zap : ShoppingBag,
        label: isCompetitive ? 'Stoked' : 'Stoked / Gear',
        description: isCompetitive ? 'Community picks & stoke' : 'Gear deals & community picks',
        color: isCompetitive ? 'text-yellow-400' : 'text-emerald-400',
        bgColor: isCompetitive ? 'bg-yellow-500/20' : 'bg-emerald-500/20',
        borderColor: isCompetitive ? 'border-yellow-500/30' : 'border-emerald-500/30',
        action: () => handlePerkOpen(setStokedOpen)
      });
    }

    // Photographers: Impact Dashboard
    if (isPhotographer) {
      perks.push({
        id: 'impact', icon: Heart, label: 'Impact Dashboard',
        description: 'Your earnings & community impact',
        color: 'text-pink-400', bgColor: 'bg-pink-500/20', borderColor: 'border-pink-500/30',
        action: () => handleNavigation('/impacted')
      });
    }

    // Grom Parents: Grom HQ Quick View
    if (isGromParent) {
      perks.push({
        id: 'grom-hq', icon: Shield, label: 'Grom HQ',
        description: 'Monitor your grom\u2019s activity',
        color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', borderColor: 'border-cyan-500/30',
        action: () => handlePerkOpen(setGromHQOpen)
      });
    }

    return perks;
  };

  return (
    <>
      <Sheet open={isOpen} modal={false} onOpenChange={(open) => { if (!open) onClose(); }}>
        <SheetContent 
          side="bottom"
          hideCloseButton
          className="bg-background border-border rounded-t-3xl sheet-safe-bottom overflow-hidden flex flex-col"
        >
          <SheetHeader className="pb-3 shrink-0 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
                  <Backpack className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <SheetTitle className="text-lg font-bold text-foreground">Backpack</SheetTitle>
                  <p className="text-xs text-muted-foreground">Your surf essentials</p>
                </div>
              </div>
              <button aria-label="Close" 
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground p-2"
              ><X className="w-5 h-5" />
              </button>
            </div>
          </SheetHeader>

          <div className="overflow-y-auto flex-1 pb-6 space-y-3 px-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={item.action}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border ${item.borderColor} ${item.bgColor} hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 group`}
                  data-testid={`backpack-${item.id}`}
                >
                  <div className={`w-12 h-12 rounded-xl ${item.bgColor} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-6 h-6 ${item.color}`} />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className={`font-semibold ${item.color}`}>{item.label}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:translate-x-1 transition-transform shrink-0" />
                </button>
              );
            })}

            {/* ── YOUR PERKS ── Role-Specific Section */}
            {getRolePerks().length > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">Your Perks</p>
                <div className="space-y-2">
                  {getRolePerks().map((perk) => {
                    const PerkIcon = perk.icon;
                    return (
                      <button
                        key={perk.id}
                        onClick={perk.action}
                        className={`w-full flex items-center gap-4 p-3.5 rounded-xl border ${perk.borderColor} ${perk.bgColor} hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 group`}
                        data-testid={`backpack-perk-${perk.id}`}
                      >
                        <div className={`w-10 h-10 rounded-lg ${perk.bgColor} flex items-center justify-center shrink-0`}>
                          <PerkIcon className={`w-5 h-5 ${perk.color}`} />
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <p className={`font-semibold text-sm ${perk.color}`}>{perk.label}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{perk.description}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-1 transition-transform shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Quick Stats Section */}
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">Quick Stats</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <Stamp className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
                  <p className="text-lg font-bold text-foreground">{user?.stamps_count || 0}</p>
                  <p className="text-[10px] text-muted-foreground">Stamps</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <CreditCard className="w-4 h-4 text-yellow-400 mx-auto mb-1" />
                  <p className="text-lg font-bold text-foreground">{user?.credits || 0}</p>
                  <p className="text-[10px] text-muted-foreground">Credits</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <BellRing className="w-4 h-4 text-orange-400 mx-auto mb-1" />
                  <p className="text-lg font-bold text-foreground">{user?.alerts_count || 0}</p>
                  <p className="text-[10px] text-muted-foreground">Alerts</p>
                </div>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Surf Passport Modal */}
      <SurfPassport 
        isOpen={passportOpen} 
        onClose={handlePassportClose} 
      />

      {/* Stoked Drawer (surfer perks) */}
      <StokedDrawer
        isOpen={stokedOpen}
        onClose={() => setStokedOpen(false)}
      />

      {/* Exclusive Area Drawer (Grom/Comp/Pro) */}
      {hasExclusiveAccess && (
        <ExclusiveAreaDrawer
          isOpen={exclusiveAreaOpen}
          onClose={() => setExclusiveAreaOpen(false)}
          onOpenChange={setExclusiveAreaOpen}
          areaType={exclusiveAreaType}
        />
      )}

      {/* Grom HQ Drawer (Grom Parents) */}
      {isGromParent && (
        <ExclusiveAreaDrawer
          isOpen={gromHQOpen}
          onClose={() => setGromHQOpen(false)}
          onOpenChange={setGromHQOpen}
          areaType="grom_parent"
        />
      )}
    </>
  );
};

export default BackpackDrawer;
