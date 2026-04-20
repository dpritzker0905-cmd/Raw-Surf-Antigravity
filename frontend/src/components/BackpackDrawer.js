import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Backpack, Stamp, ChevronRight, X, CreditCard, BellRing } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { SurfPassport } from './SurfPassport';

/**
 * BackpackDrawer - Consolidated menu for Passport, Wallet, and Surf Alerts
 * Opens as a bottom sheet on mobile for better thumb accessibility
 * 
 * This drawer provides quick access to:
 * 1. Surf Passport - Travel stamps and surf journey
 * 2. Credit Wallet - Purchase credits and balance
 * 3. Surf Alerts - Wave condition notifications
 */
export const BackpackDrawer = ({ isOpen, onClose, onReopen }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [passportOpen, setPassportOpen] = useState(false);

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
              <button 
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground p-2"
              >
                <X className="w-5 h-5" />
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

      {/* Surf Passport Modal - Opens separately after drawer closes */}
      <SurfPassport 
        isOpen={passportOpen} 
        onClose={handlePassportClose} 
      />
    </>
  );
};

export default BackpackDrawer;
