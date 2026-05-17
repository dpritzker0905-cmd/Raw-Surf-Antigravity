import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';

const QuickActionsPanel = ({ 
  lineup, 
  isCaptain, 
  isReady, 
  loading,
  onLock,
  onCloseToInvites,
  onCancelAll,
  onLeave,
  onClose,
  isLight 
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  const [showCancelRow, setShowCancelRow] = useState(false);

  // Non-captain: only Leave option
  if (!isCaptain) {
    return (
      <div className={`p-3 rounded-xl ${isLight ? 'bg-orange-50 border border-orange-200' : 'bg-orange-500/10 border border-orange-500/30'}`}>
        <Button aria-label="Loader2"
          onClick={onLeave}
          disabled={loading}
          variant="outline"
          className="w-full border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserMinus className="w-4 h-4 mr-2" />}
          Leave This Lineup
        </Button>
        <p className={`text-xs text-center mt-2 ${isLight ? 'text-orange-600' : 'text-orange-400/70'}`}>
          Your spot will open for someone else
        </p>
      </div>
    );
  }

  if (!isCaptain) return null;

  const ACTIVE_STATUSES = ['open', 'filling', 'ready'];
  const isActive = ACTIVE_STATUSES.includes(lineup.lineup_status);

  // -- LOCKED STATE ------------------------------------------------
  if (lineup.lineup_status === 'locked') {
    return (
      <div className="space-y-2">
        <div className={`p-3 rounded-xl text-center ${isLight ? 'bg-amber-50 border border-amber-200' : 'bg-amber-500/10 border border-amber-500/30'}`}>
          <Lock className="w-5 h-5 text-amber-400 mx-auto mb-1" />
          <p className={`text-sm font-medium ${textPrimary}`}>Lineup Locked</p>
          <p className={`text-xs ${textSecondary} mt-0.5`}>Awaiting crew payments. Session is confirmed once everyone pays.</p>
        </div>
        {!showCancelRow ? (
          <button
            onClick={() => setShowCancelRow(true)}
            className={`w-full text-xs text-center py-1.5 ${textSecondary} hover:text-red-400 transition-colors`}
          >
            Need to cancel this session?
          </button>
        ) : (
          <Button aria-label="Ban"
            onClick={onCancelAll}
            disabled={loading}
            variant="outline"
            className="w-full border-red-500/50 text-red-400 hover:bg-red-500/10"
            data-testid="cancel-lineup-btn"
          >
            <Ban className="w-4 h-4 mr-2" />
            Cancel Session & Refund All
          </Button>
        )}
      </div>
    );
  }

  // -- ACTIVE STATE (open / filling / ready) -----------------------
  return (
    <div className="space-y-2">

      {/* -- State A: Not enough crew yet -- */}
      {!isReady && isActive && (
        <div className={`p-3 rounded-xl ${isLight ? 'bg-cyan-50 border border-cyan-200' : 'bg-cyan-500/10 border border-cyan-500/30'}`}>
          <div className="flex items-center gap-2 mb-1">
            <Waves className="w-4 h-4 text-cyan-400" />
            <p className={`text-sm font-medium ${textPrimary}`}>Keeping a Spot in the Water</p>
          </div>
          <p className={`text-xs ${textSecondary}`}>
            Your lineup is open. Use the invite panel above to fill the remaining spots - the session stays open until you're ready to lock it.
          </p>
        </div>
      )}

      {/* -- State B: Ready to lock -- */}
      {isReady && isActive && (
        <>
          <div className={`p-3 rounded-xl ${isLight ? 'bg-green-50 border border-green-200' : 'bg-green-500/10 border border-green-500/30'}`}>
            <p className={`text-sm font-medium ${textPrimary} flex items-center gap-2`}>
              <CheckCircle className="w-4 h-4 text-green-400" />
              Crew is ready!
            </p>
            <p className={`text-xs ${textSecondary} mt-0.5`}>
              Lock to confirm the session, or keep it open to let more surfers join.
            </p>
          </div>

          {/* 1 - Lock (primary) */}
          <Button aria-label="Loader2"
            onClick={onLock}
            disabled={loading}
            className="w-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white py-5 text-sm font-bold"
            data-testid="lock-lineup-btn"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Lock className="w-5 h-5 mr-2" />Lock Lineup & Confirm Session</>}
          </Button>
        </>
      )}

      {/* 2 - Leave Open & Come Back Later (always shown when active) */}
      {isActive && (
        <Button aria-label="Waves"
          onClick={onClose}
          variant="outline"
          size="sm"
          className={`w-full ${isLight ? 'border-gray-300 text-gray-600 hover:bg-gray-50' : 'border-zinc-600 text-zinc-300 hover:bg-zinc-700'}`}
          data-testid="keep-open-close-btn"
        >
          <Waves className="w-4 h-4 mr-2 text-cyan-400" />
          Leave Open & Come Back Later
        </Button>
      )}

      {/* Close to new surfers (open status only) */}
      {lineup.lineup_status === 'open' && (
        <Button aria-label="Unlock"
          onClick={onCloseToInvites}
          disabled={loading}
          variant="outline"
          size="sm"
          className={`w-full ${isLight ? 'border-amber-300 text-amber-600 hover:bg-amber-50' : 'border-amber-500/50 text-amber-400 hover:bg-amber-500/10'}`}
          data-testid="close-to-invites-btn"
        >
          <Unlock className="w-4 h-4 mr-2" />
          <span className="text-xs">Stop Accepting New Surfers</span>
        </Button>
      )}

      {/* Cancel - tap to reveal, discourages accidental cancels */}
      {!showCancelRow ? (
        <button
          onClick={() => setShowCancelRow(true)}
          className={`w-full text-xs text-center py-1.5 ${textSecondary} hover:text-red-400 transition-colors`}
          data-testid="show-cancel-btn"
        >
          Need to cancel this lineup?
        </button>
      ) : (
        <Button aria-label="Ban"
          onClick={onCancelAll}
          disabled={loading}
          variant="outline"
          size="sm"
          className={`w-full ${isLight ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-red-500/50 text-red-400 hover:bg-red-500/10'}`}
          data-testid="cancel-lineup-btn"
        >
          <Ban className="w-4 h-4 mr-2" />
          Cancel Lineup & Refund All
        </Button>
      )}
    </div>
  );
};



// Countdown Timer Component

export default QuickActionsPanel;
