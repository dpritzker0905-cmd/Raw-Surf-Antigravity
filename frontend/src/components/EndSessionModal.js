import React from 'react';
import { AlertTriangle, Square, Clock, Users, DollarSign, Camera, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { formatTime } from './LiveStatusHUD';

/**
 * EndSessionModal - "Kill Switch" Confirmation Dialog
 * 
 * This modal provides a safety check before ending a live session:
 * - Confirms the photographer's intent to end
 * - Shows session summary (duration, surfers, earnings)
 * - Warns about the action being irreversible
 * - On confirm: ends session, clears HUD, redirects to "Impacted" tab
 */
const EndSessionModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  session,
  isLoading = false 
}) => {
  // Calculate session duration
  const getSessionDuration = () => {
    if (!session?.started_at) return 0;
    const start = new Date(session.started_at);
    const now = new Date();
    return Math.floor((now - start) / 1000);
  };
  
  const duration = getSessionDuration();
  const surferCount = session?.active_surfers || session?.participants?.length || 0;
  const earnings = session?.earnings || 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="bg-zinc-900 border-zinc-700 text-white max-w-sm"
        data-testid="end-session-modal"
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            End Live Session?
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Warning Message */}
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <p className="text-yellow-300 text-sm">
              This will remove you from the map and notify any surfers 
              currently in your session.
            </p>
          </div>

          {/* Session Summary */}
          <div className="bg-zinc-800/50 rounded-xl p-4">
            <h4 className="text-gray-400 text-xs uppercase tracking-wider mb-3">
              Session Summary
            </h4>
            
            <div className="grid grid-cols-3 gap-3 text-center">
              {/* Duration */}
              <div>
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Clock className="w-4 h-4 text-blue-400" />
                </div>
                <p className="text-white text-lg font-bold font-mono">
                  {formatTime(duration)}
                </p>
                <p className="text-gray-500 text-xs">Duration</p>
              </div>
              
              {/* Surfers */}
              <div>
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Users className="w-4 h-4 text-cyan-400" />
                </div>
                <p className="text-white text-lg font-bold">
                  {surferCount}
                </p>
                <p className="text-gray-500 text-xs">Surfers</p>
              </div>
              
              {/* Earnings */}
              <div>
                <div className="flex items-center justify-center gap-1 mb-1">
                  <DollarSign className="w-4 h-4 text-green-400" />
                </div>
                <p className="text-green-400 text-lg font-bold">
                  ${earnings.toFixed(2)}
                </p>
                <p className="text-gray-500 text-xs">Earned</p>
              </div>
            </div>
          </div>

          {/* Location Info */}
          {session?.location && (
            <div className="text-center text-gray-400 text-sm">
              Shooting at <span className="text-white">{session.location}</span>
            </div>
          )}

          {/* Gallery Info */}
          <div className="flex items-center gap-2 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
            <Camera className="w-4 h-4 text-cyan-400 shrink-0" />
            <p className="text-cyan-300 text-xs">
              A gallery will be created automatically. You can upload photos to it after ending.
            </p>
          </div>
        </div>

        <DialogFooter className="flex gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 border-zinc-700 text-white hover:bg-zinc-800"
            disabled={isLoading}
            data-testid="cancel-end-session-btn"
          >
            Keep Shooting
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold"
            data-testid="confirm-end-session-btn"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Square className="w-4 h-4 mr-2 fill-current" />
                End Session
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EndSessionModal;
