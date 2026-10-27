/**
 * PostSessionSummary +-+-+ Photographer post-session action dashboard
 * 
 * Shows for session galleries that ended recently (< 48 hours).
 * One-click distribute, AI match status, and distribution progress.
 */
import React, { useState, useMemo } from 'react';
import {
  Camera, MapPin, Users, Sparkles, Send,
  CheckCircle, AlertTriangle, Loader2, ChevronDown, ChevronUp,
  Image as ImageIcon,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { useThemeName } from '../../contexts/ThemeContext';

export const PostSessionSummary = ({
  gallery,
  heading = 'Session Complete',
  participants = [],
  onDistributeAll,
  onOpenTagAssign,
  onAiAutoTag,
  isDistributing = false,
  distributeProgress = null, // { current, total }
  isAiTagging = false,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const isLight = useThemeName() === 'light';
  const secondaryText = isLight ? 'text-muted-foreground' : 'text-zinc-400';
  const statClass = `text-center p-3 rounded-lg ${isLight ? 'bg-muted' : 'bg-zinc-800/50'}`;
  const valueClass = `text-xl font-bold ${isLight ? 'text-foreground' : 'text-white'}`;

  // Don't show if gallery is older than 48 hours
  const isRecent = useMemo(() => {
    if (!gallery?.created_at) return false;
    const age = Date.now() - new Date(gallery.created_at).getTime();
    return age < 48 * 60 * 60 * 1000; // 48 hours
  }, [gallery?.created_at]);

  // Calculate stats
  const stats = useMemo(() => {
    const totalItems = gallery?.item_count || 0;
    const totalSurfers = participants.length;
    const aiMatched = participants.filter(p => p.items_distributed > 0).length;
    const totalDistributed = participants.reduce((sum, p) => sum + (p.items_distributed || 0), 0);
    const needsTagging = totalItems > 0 && totalDistributed === 0;

    return { totalItems, totalSurfers, aiMatched, totalDistributed, needsTagging };
  }, [gallery, participants]);

  if (!isRecent || !gallery) return null;

  const progressPercent = distributeProgress
    ? Math.round((distributeProgress.current / distributeProgress.total) * 100)
    : 0;

  return (
    <div className={`mb-6 overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-r ${isLight ? 'from-emerald-50 via-white to-cyan-50' : 'from-emerald-900/20 via-zinc-900/80 to-cyan-900/20'}`}>
      {/* Header */}
      <button
        aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
            <Camera className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-left min-w-0 flex-1">
            <h3 className={`${isLight ? 'text-foreground' : 'text-white'} font-semibold flex flex-wrap items-center gap-2`}>
              {heading}
              {stats.needsTagging && (
                <Badge className="bg-amber-500/20 text-amber-400 text-[10px]">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Needs Distribution
                </Badge>
              )}
              {!stats.needsTagging && stats.totalDistributed > 0 && (
                <Badge className="bg-emerald-500/20 text-emerald-400 text-[10px]">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Distributed
                </Badge>
              )}
            </h3>
            <p className={`${secondaryText} text-sm flex flex-wrap items-center gap-2 break-words`}>
              {gallery.title || 'Session'} 
              {gallery.spot_name && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {gallery.spot_name}
                </span>
              )}
            </p>
          </div>
        </div>
        {collapsed ? (
          <ChevronDown className="w-5 h-5 text-zinc-400 shrink-0" />
        ) : (
          <ChevronUp className="w-5 h-5 text-zinc-400 shrink-0" />
        )}
      </button>

      {/* Expandable content */}
      {!collapsed && (
        <div className="px-4 pb-4 space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={statClass}>
              <ImageIcon className="w-5 h-5 text-cyan-400 mx-auto mb-1" />
              <p className={valueClass}>{stats.totalItems}</p>
              <p className={`text-[10px] ${secondaryText}`}>Photos</p>
            </div>
            <div className={statClass}>
              <Users className="w-5 h-5 text-purple-400 mx-auto mb-1" />
              <p className={valueClass}>{stats.totalSurfers}</p>
              <p className={`text-[10px] ${secondaryText}`}>Surfers</p>
            </div>
            <div className={statClass}>
              <Sparkles className="w-5 h-5 text-emerald-400 mx-auto mb-1" />
              <p className={valueClass}>{stats.aiMatched}</p>
              <p className={`text-[10px] ${secondaryText}`}>With deliveries</p>
            </div>
            <div className={statClass}>
              <Send className="w-5 h-5 text-amber-400 mx-auto mb-1" />
              <p className={valueClass}>{stats.totalDistributed}</p>
              <p className={`text-[10px] ${secondaryText}`}>Delivered</p>
            </div>
          </div>

          {/* Distribution progress bar (when actively distributing) */}
          {isDistributing && distributeProgress && (
            <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-cyan-400 text-sm font-medium flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Distributing...
                </span>
                <span className="text-cyan-400 text-sm font-mono">
                  {distributeProgress.current}/{distributeProgress.total}
                </span>
              </div>
              <Progress value={progressPercent} className="h-2 bg-zinc-700" />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <Button aria-label="Distribute All to Lockers"
              onClick={onDistributeAll}
              disabled={isDistributing || stats.totalSurfers === 0}
              className="flex-1 min-w-full sm:min-w-0 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white font-semibold"
            >
              {isDistributing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Distributing...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Distribute All to Lockers
                </>
              )}
            </Button>

            <Button aria-label="AI Tag"
              onClick={onAiAutoTag}
              disabled={isAiTagging}
              variant="outline"
              className="border-purple-500/50 text-purple-400 hover:bg-purple-500/10"
            >
              {isAiTagging ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-1" />
              )}
              AI Tag
            </Button>

            <Button aria-label="Manual Tag"
              onClick={onOpenTagAssign}
              variant="outline"
              className={isLight ? 'border-border text-foreground hover:bg-muted' : 'border-zinc-600 text-zinc-300 hover:bg-zinc-800'}
            >
              <Users className="w-4 h-4 mr-1" />
              Manual Tag
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PostSessionSummary;
