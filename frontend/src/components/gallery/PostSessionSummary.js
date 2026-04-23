/**
 * PostSessionSummary — Photographer post-session action dashboard
 * 
 * Shows for session galleries that ended recently (< 48 hours).
 * One-click distribute, AI match status, and distribution progress.
 */
import React, { useState, useMemo } from 'react';
import {
  Camera, MapPin, Calendar, Users, Sparkles, Send,
  CheckCircle, AlertTriangle, Loader2, ChevronDown, ChevronUp,
  Image as ImageIcon
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';

export const PostSessionSummary = ({
  gallery,
  participants = [],
  onDistributeAll,
  onOpenTagAssign,
  onAiAutoTag,
  isDistributing = false,
  distributeProgress = null, // { current, total }
  isAiTagging = false,
}) => {
  const [collapsed, setCollapsed] = useState(false);

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
    <div className="mb-6 overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-900/20 via-zinc-900/80 to-cyan-900/20">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <Camera className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-left">
            <h3 className="text-white font-semibold flex items-center gap-2">
              Session Complete
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
            <p className="text-zinc-400 text-sm flex items-center gap-2">
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
          <ChevronDown className="w-5 h-5 text-zinc-400" />
        ) : (
          <ChevronUp className="w-5 h-5 text-zinc-400" />
        )}
      </button>

      {/* Expandable content */}
      {!collapsed && (
        <div className="px-4 pb-4 space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-4 gap-3">
            <div className="text-center p-3 rounded-lg bg-zinc-800/50">
              <ImageIcon className="w-5 h-5 text-cyan-400 mx-auto mb-1" />
              <p className="text-xl font-bold text-white">{stats.totalItems}</p>
              <p className="text-[10px] text-zinc-400">Photos</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-zinc-800/50">
              <Users className="w-5 h-5 text-purple-400 mx-auto mb-1" />
              <p className="text-xl font-bold text-white">{stats.totalSurfers}</p>
              <p className="text-[10px] text-zinc-400">Surfers</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-zinc-800/50">
              <Sparkles className="w-5 h-5 text-emerald-400 mx-auto mb-1" />
              <p className="text-xl font-bold text-white">{stats.aiMatched}</p>
              <p className="text-[10px] text-zinc-400">AI Matched</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-zinc-800/50">
              <Send className="w-5 h-5 text-amber-400 mx-auto mb-1" />
              <p className="text-xl font-bold text-white">{stats.totalDistributed}</p>
              <p className="text-[10px] text-zinc-400">Delivered</p>
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
            <Button
              onClick={onDistributeAll}
              disabled={isDistributing || stats.totalSurfers === 0}
              className="flex-1 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white font-semibold"
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

            <Button
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

            <Button
              onClick={onOpenTagAssign}
              variant="outline"
              className="border-zinc-600 text-zinc-300 hover:bg-zinc-800"
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
