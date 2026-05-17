/**
 * SurferHubContent GÇö Extracted from SurferSessionHub.js (v79)
 *
 * Navigation panel for surfer users:
 * - Live Sessions (browse active photographers)
 * - Request a Pro (on-demand)
 * - My Bookings (upcoming sessions & receipts)
 * - My Gallery (with AI match badge)
 */
import React from 'react';
import { Radio, Calendar, ChevronRight, Zap, Lock, Sparkles } from 'lucide-react';
import { Badge } from '../ui/badge';

const SurferHubContent = ({ onClose, navigate, liveCount, upcomingBookings, aiMatchCount }) => {
  return (
    <div className="space-y-3">
      {/* ============ LIVE SESSIONS - Direct Link ============ */}
      <button aria-label="div"
        onClick={() => {
          navigate('/bookings?tab=live_now');
          onClose?.();
        }}
        className="w-full flex items-center gap-3 p-4 bg-muted/30 hover:bg-muted/50 rounded-xl border border-border/50 transition-colors active:scale-[0.98]"
        data-testid="session-hub-live"
      >
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/30 to-green-600/30 flex items-center justify-center">
          <Radio className="w-6 h-6 text-emerald-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-foreground font-semibold">Live Sessions</p>
          <p className="text-muted-foreground text-xs">Browse photographers shooting now</p>
        </div>
        <div className="flex items-center gap-2">
          {liveCount > 0 && (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
              {liveCount} live
            </Badge>
          )}
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        </div>
      </button>

      {/* ============ REQUEST A PRO / ON-DEMAND - Direct Link ============ */}
      <button aria-label="div"
        onClick={() => {
          navigate('/bookings?tab=on_demand');
          onClose?.();
        }}
        className="w-full flex items-center gap-3 p-4 bg-muted/30 hover:bg-muted/50 rounded-xl border border-border/50 transition-colors active:scale-[0.98]"
        data-testid="session-hub-request-pro"
      >
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500/30 to-orange-600/30 flex items-center justify-center">
          <Zap className="w-6 h-6 text-amber-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-foreground font-semibold">Request a Pro</p>
          <p className="text-muted-foreground text-xs">Find on-demand photographers near you</p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground" />
      </button>

      {/* ============ MY BOOKINGS ============ */}
      <button aria-label="div"
        onClick={() => {
          navigate('/bookings?tab=scheduled');
          onClose?.();
        }}
        className="w-full flex items-center gap-3 p-4 bg-muted/30 hover:bg-muted/50 rounded-xl border border-border/50 transition-colors active:scale-[0.98]"
        data-testid="session-hub-bookings"
      >
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/30 to-violet-600/30 flex items-center justify-center">
          <Calendar className="w-6 h-6 text-purple-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-foreground font-semibold">My Bookings</p>
          <p className="text-muted-foreground text-xs">Upcoming sessions & receipts</p>
        </div>
        <div className="flex items-center gap-2">
          {upcomingBookings > 0 && (
            <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
              {upcomingBookings}
            </Badge>
          )}
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        </div>
      </button>
    
      {/* ============ MY GALLERY with AI Match Badge ============ */}
      <button
        onClick={() => {
          navigate('/my-gallery');
          onClose?.();
        }}
        className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-colors active:scale-[0.98] ${
          aiMatchCount > 0 
            ? 'bg-gradient-to-r from-purple-500/20 to-cyan-500/20 border-purple-500/40 hover:border-purple-500/60' 
            : 'bg-muted/30 hover:bg-muted/50 border-border/50'
        }`}
        data-testid="session-hub-my-gallery"
      >
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center relative ${
          aiMatchCount > 0 
            ? 'bg-gradient-to-br from-purple-500/40 to-cyan-500/40' 
            : 'bg-gradient-to-br from-cyan-500/30 to-blue-600/30'
        }`}>
          <Lock className="w-6 h-6 text-cyan-400" />
          {aiMatchCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-purple-500 rounded-full text-[10px] font-bold flex items-center justify-center text-white animate-pulse">
              {aiMatchCount > 9 ? '9+' : aiMatchCount}
            </span>
          )}
        </div>
        <div className="flex-1 text-left">
          <p className="text-foreground font-semibold flex items-center gap-2">
            My Gallery
            {aiMatchCount > 0 && (
              <Badge className="bg-purple-500/30 text-purple-300 border-purple-500/40 text-[10px] px-1.5 py-0">
                <Sparkles className="w-3 h-3 mr-0.5" />
                AI Found You!
              </Badge>
            )}
          </p>
          <p className="text-muted-foreground text-xs">
            {aiMatchCount > 0 
              ? `${aiMatchCount} AI-detected photo${aiMatchCount > 1 ? 's' : ''} to review` 
              : 'Your private media locker'
            }
          </p>
        </div>
        <ChevronRight className={`w-5 h-5 ${aiMatchCount > 0 ? 'text-purple-400' : 'text-gray-400'}`} />
      </button>
    </div>
  );
};

export default SurferHubContent;
