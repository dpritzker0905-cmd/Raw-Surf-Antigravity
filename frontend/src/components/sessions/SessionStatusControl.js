/**
 * SessionStatusControl G Extracted from PhotographerSessionManager.js (v77)
 * Session open/close toggle, visibility settings, reservation controls,
 * and lock/cancel action buttons.
 */
import React from 'react';
import {
  Users, Lock, Unlock,
  Globe, UserCheck, Timer, Ban, Settings, Hand
} from 'lucide-react';
import { Button } from '../ui/button';
import { Loader2 } from 'lucide-react';

const SessionStatusControl = ({ 
  booking, 
  isLight, 
  loading,
  localSplitMode,
  localAutoConfirm,
  localLineupStatus,
  onToggleOpen,
  onToggleSplitMode,
  onToggleAutoConfirm,
  onUpdateReservationSettings,
  onLockSession,
  onCancelSession 
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const sectionBg = isLight ? 'bg-gray-50' : 'bg-zinc-800/50';
  
  // Session is "open" if status is open, filling, or ready (any state that accepts bookings)
  // Session is "closed" only if status is 'closed' or null
  const isOpen = localLineupStatus && !['closed', 'locked'].includes(localLineupStatus);
  const isLocked = localLineupStatus === 'locked';
  
  return (
    <div className="space-y-4">
      {/* Session Open/Close Toggle */}
      <div className={`p-4 rounded-xl ${
        isLight 
          ? 'bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-200' 
          : 'bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isOpen ? 'bg-cyan-500/20' : 'bg-amber-500/20'
            }`}>
              {isOpen ? <Unlock className="w-5 h-5 text-cyan-400" /> : <Lock className="w-5 h-5 text-amber-400" />}
            </div>
            <div>
              <span className={`font-medium ${textPrimary}`}>
                {isOpen ? 'Session Open for Bookings' : 'Session Closed'}
              </span>
              <p className={`text-xs ${textSecondary}`}>
                {isOpen 
                  ? 'Surfers can discover and join this session' 
                  : 'No new bookings allowed'
                }
              </p>
            </div>
          </div>
          <button
            onClick={onToggleOpen}
            disabled={loading || isLocked}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              isOpen ? 'bg-cyan-500' : 'bg-zinc-600'
            } ${(loading || isLocked) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
              isOpen ? 'translate-x-7' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>
      
      {/* Settings Section - Only show when open and not locked */}
      {isOpen && !isLocked && (
        <div className={`p-4 rounded-lg ${sectionBg} space-y-4`}>
          <div className="flex items-center gap-2 mb-2">
            <Settings className="w-4 h-4 text-cyan-400" />
            <span className={`font-medium ${textPrimary}`}>Session Settings</span>
          </div>
          
          {/* Open to Nearby Surfers Toggle */}
          <div className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-white border border-gray-200' : 'bg-zinc-800 border border-zinc-700'}`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center">
                <Globe className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className={`font-medium ${textPrimary}`}>Open to Nearby Surfers</p>
                <p className={`text-xs ${textSecondary}`}>
                  {localSplitMode === 'open_nearby' 
                    ? `Visible within ${booking.proximity_radius || 5} miles` 
                    : 'Friends & invite code only'}
                </p>
              </div>
            </div>
            <button
              onClick={onToggleSplitMode}
              disabled={loading}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                localSplitMode === 'open_nearby' ? 'bg-cyan-500' : 'bg-zinc-600'
              } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              data-testid="toggle-open-nearby"
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                localSplitMode === 'open_nearby' ? 'translate-x-7' : 'translate-x-1'
              }`} />
            </button>
          </div>
          
          {/* Auto-Confirm When Ready Toggle */}
          <div className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-white border border-gray-200' : 'bg-zinc-800 border border-zinc-700'}`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                <UserCheck className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className={`font-medium ${textPrimary}`}>Auto-Lock When Full</p>
                <p className={`text-xs ${textSecondary}`}>
                  {localAutoConfirm ? 'Session locks automatically when crew is full' : 'Manual lock required'}
                </p>
              </div>
            </div>
            <button
              onClick={onToggleAutoConfirm}
              disabled={loading}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                localAutoConfirm ? 'bg-green-500' : 'bg-zinc-600'
              } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              data-testid="toggle-auto-confirm"
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                localAutoConfirm ? 'translate-x-7' : 'translate-x-1'
              }`} />
            </button>
          </div>
        </div>
      )}
      
      {/* Seat Reservation Settings - Poker-Style */}
      {isOpen && !isLocked && (
        <div className={`p-4 rounded-lg ${sectionBg} space-y-4`}>
          <div className="flex items-center gap-2 mb-2">
            <Timer className="w-4 h-4 text-amber-400" />
            <span className={`font-medium ${textPrimary}`}>Seat Reservation Settings</span>
          </div>
          
          {/* Invite Expiry Window */}
          <div className={`p-3 rounded-lg ${isLight ? 'bg-white border border-gray-200' : 'bg-zinc-800 border border-zinc-700'}`}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className={`font-medium ${textPrimary}`}>Invite Expiry Window</p>
                <p className={`text-xs ${textSecondary}`}>How long invites last before spot opens up</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { label: '4hr', value: 4 },
                { label: '12hr', value: 12 },
                { label: '24hr', value: 24 },
                { label: '48hr', value: 48 }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => onUpdateReservationSettings?.({ invite_expiry_hours: opt.value })}
                  disabled={loading}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    (booking.invite_expiry_hours || 24) === opt.value
                      ? 'bg-amber-500 text-black'
                      : `${isLight ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-zinc-700 text-gray-300 hover:bg-zinc-600'}`
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              {/* Custom input */}
              <div className="flex items-center gap-1">
                <input aria-label="Custom"
                  type="number"
                  min="1"
                  max="168"
                  placeholder="Custom"
                  className={`w-16 px-2 py-1.5 rounded-lg text-sm ${
                    isLight ? 'bg-gray-100 border border-gray-200' : 'bg-zinc-700 border border-zinc-600'
                  } ${textPrimary}`}
                  onBlur={(e) => {
                    const val = parseFloat(e.target.value);
                    if (val >= 1 && val <= 168) {
                      onUpdateReservationSettings?.({ invite_expiry_hours: val });
                    }
                  }}
                />
                <span className={`text-xs ${textSecondary}`}>hrs</span>
              </div>
            </div>
          </div>
          
          {/* Waitlist Toggle */}
          <div className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-white border border-gray-200' : 'bg-zinc-800 border border-zinc-700'}`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-indigo-500 flex items-center justify-center">
                <Users className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className={`font-medium ${textPrimary}`}>Enable Waitlist</p>
                <p className={`text-xs ${textSecondary}`}>Auto-notify next in line when spots open</p>
              </div>
            </div>
            <button
              onClick={() => onUpdateReservationSettings?.({ waitlist_enabled: !(booking.waitlist_enabled ?? true) })}
              disabled={loading}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                (booking.waitlist_enabled ?? true) ? 'bg-purple-500' : 'bg-zinc-600'
              } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                (booking.waitlist_enabled ?? true) ? 'translate-x-7' : 'translate-x-1'
              }`} />
            </button>
          </div>
          
          {/* Keep Seat Toggle */}
          <div className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-white border border-gray-200' : 'bg-zinc-800 border border-zinc-700'}`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
                <Hand className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className={`font-medium ${textPrimary}`}>Allow "Keep My Seat"</p>
                <p className={`text-xs ${textSecondary}`}>
                  Let pending surfers extend their hold ({booking.max_keep_seat_extensions || 2} times max)
                </p>
              </div>
            </div>
            <button
              onClick={() => onUpdateReservationSettings?.({ allow_keep_seat: !(booking.allow_keep_seat ?? true) })}
              disabled={loading}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                (booking.allow_keep_seat ?? true) ? 'bg-amber-500' : 'bg-zinc-600'
              } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                (booking.allow_keep_seat ?? true) ? 'translate-x-7' : 'translate-x-1'
              }`} />
            </button>
          </div>
        </div>
      )}
      
      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2">
        {!isLocked && isOpen && (
          <Button aria-label="Loader2"
            onClick={onLockSession}
            disabled={loading}
            className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white"
            data-testid="lock-session-btn"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Lock className="w-4 h-4 mr-1" />}
            Lock & Finalize
          </Button>
        )}
        
        <Button aria-label="Loader2"
          onClick={onCancelSession}
          disabled={loading}
          variant="outline"
          className={`border-red-500/50 text-red-400 hover:bg-red-500/10 ${!isLocked && isOpen ? '' : 'col-span-2'}`}
          data-testid="cancel-session-btn"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Ban className="w-4 h-4 mr-1" />}
          Cancel & Refund
        </Button>
      </div>
      
      {/* Locked State Notice */}
      {isLocked && (
        <div className={`p-3 rounded-lg ${isLight ? 'bg-amber-50 border border-amber-200' : 'bg-amber-500/10 border border-amber-500/30'}`}>
          <div className="flex items-center gap-2 text-amber-500">
            <Lock className="w-4 h-4" />
            <span className="font-medium">Session Locked</span>
          </div>
          <p className={`text-sm ${textSecondary} mt-1`}>
            This session is finalized. No changes can be made.
          </p>
        </div>
      )}
    </div>
  );
};

export default SessionStatusControl;
