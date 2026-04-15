/**
 * Permission Nudge Drawer
 * Shown when user attempts to "Book Now" or "Go Live" with GPS disabled.
 * Provides visual 2-step instructions for enabling GPS on iOS/Android.
 */
import React from 'react';
import { MapPin, Settings, Navigation, ChevronRight, X, Smartphone } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';

export const PermissionNudgeDrawer = ({ 
  isOpen, 
  onClose, 
  onRetryLocation,
  action = 'booking' // 'booking' or 'go_live'
}) => {
  const isBooking = action === 'booking';
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-white w-[95vw] max-w-md max-h-[85vh] overflow-hidden flex flex-col p-0 z-[1100]">
        {/* Header with close button */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Navigation className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-semibold">Location Required</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Value Prop */}
          <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 rounded-lg p-4">
            <p className="text-cyan-300 text-sm">
              {isBooking 
                ? 'Precise GPS location is required for "On-Beach" Photographer-to-Surfer handshakes. This ensures your Pro can find you quickly.'
                : 'GPS location is required to go live at this spot. This helps surfers find you and verifies your exact shooting position.'
              }
            </p>
          </div>
          
          {/* Instructions */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-gray-300 uppercase tracking-wide">Enable Location Access</h4>
            
            {/* iOS Instructions */}
            <div className="bg-zinc-800 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center">
                  <Smartphone className="w-3 h-3 text-gray-300" />
                </div>
                <span className="text-white font-medium">iPhone / iOS</span>
              </div>
              
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-xs font-bold shrink-0">1</div>
                  <div className="text-gray-300">
                    Open <span className="text-white font-medium">Settings</span> <ChevronRight className="inline w-3 h-3" /> <span className="text-white font-medium">Privacy & Security</span>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-xs font-bold shrink-0">2</div>
                  <div className="text-gray-300">
                    Tap <span className="text-white font-medium">Location Services</span> <ChevronRight className="inline w-3 h-3" /> Find <span className="text-white font-medium">Safari/Chrome</span> <ChevronRight className="inline w-3 h-3" /> Select <span className="text-cyan-400 font-medium">While Using</span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Android Instructions */}
            <div className="bg-zinc-800 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-green-700 flex items-center justify-center">
                  <Smartphone className="w-3 h-3 text-green-300" />
                </div>
                <span className="text-white font-medium">Android</span>
              </div>
              
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-xs font-bold shrink-0">1</div>
                  <div className="text-gray-300">
                    Open <span className="text-white font-medium">Settings</span> <ChevronRight className="inline w-3 h-3" /> <span className="text-white font-medium">Location</span>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-xs font-bold shrink-0">2</div>
                  <div className="text-gray-300">
                    Enable <span className="text-white font-medium">Location</span>, then go to <span className="text-white font-medium">App permissions</span> <ChevronRight className="inline w-3 h-3" /> <span className="text-white font-medium">Browser</span> <ChevronRight className="inline w-3 h-3" /> <span className="text-green-400 font-medium">Allow</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border-zinc-600 text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                onRetryLocation?.();
                onClose();
              }}
              className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 text-black font-bold"
            >
              <Navigation className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
          
          <p className="text-center text-gray-500 text-xs">
            After enabling, return here and tap "Try Again"
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PermissionNudgeDrawer;
