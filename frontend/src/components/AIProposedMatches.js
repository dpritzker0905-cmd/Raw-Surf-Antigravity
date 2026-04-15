/**
 * AIProposedMatches - "Proposed Matches" Queue with Paid/Free Account Differentiation
 * 
 * Logic Override: Account Tier (Paid vs Free) controls the Review UX:
 * 
 * 💎 PAID SURFER (is_ad_supported = false):
 *    - "Full Session Insight" - Can scroll, enlarge, and play ALL clips before claiming
 *    - Compare similar shots to pick "Hero Shot"
 *    - Batch selection enabled
 * 
 * 🌊 FREE SURFER (is_ad_supported = true):
 *    - "Sequential Claiming" - Blurred/restricted list
 *    - Must claim/dismiss one by one
 *    - Cannot see full gallery in high detail until transaction
 * 
 * Credit System:
 *    - Logic A: All-Inclusive (is_all_inclusive = true) → All clips unlocked
 *    - Logic B: Partial Inclusion (included_media_count > 0) → Credit-based
 *    - Logic C: Zero Inclusion → Pay-per-clip with watermarks
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Card, CardContent } from './ui/card';
import { 
  Check, X, Image, Video, Clock, AlertCircle, Loader2, 
  Crown, Lock, Unlock, Eye, EyeOff, ChevronLeft, ChevronRight,
  Sparkles, Zap, DollarSign, Camera, Play, Pause, Volume2, VolumeX,
  ArrowUpDown, CheckCircle, Ban, Gift, CreditCard, Star, Shield
} from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Session Entitlement Info Component
 * Shows credits remaining, tier info, and package type
 */
const SessionEntitlementBanner = ({ 
  sessionInfo, 
  isPaidAccount,
  creditsRemaining,
  isAllInclusive
}) => {
  if (isAllInclusive) {
    return (
      <div className="bg-gradient-to-r from-emerald-500/20 to-green-500/20 border border-emerald-500/30 rounded-lg p-3 mb-4">
        <div className="flex items-center gap-2">
          <Gift className="w-5 h-5 text-emerald-400" />
          <div>
            <p className="font-medium text-emerald-400">All-Inclusive Package</p>
            <p className="text-xs text-emerald-300/70">All AI-tagged clips from this session are unlocked in HD</p>
          </div>
        </div>
      </div>
    );
  }
  
  if (creditsRemaining > 0) {
    return (
      <div className="bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 rounded-lg p-3 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-cyan-400" />
            <div>
              <p className="font-medium text-cyan-400">Credit Package</p>
              <p className="text-xs text-cyan-300/70">Included with your session booking</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-cyan-400">{creditsRemaining}</p>
            <p className="text-xs text-cyan-300/70">clips remaining</p>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 rounded-lg p-3 mb-4">
      <div className="flex items-center gap-2">
        <DollarSign className="w-5 h-5 text-amber-400" />
        <div>
          <p className="font-medium text-amber-400">Pay-Per-Clip</p>
          <p className="text-xs text-amber-300/70">Each claim will be deducted from your wallet</p>
        </div>
      </div>
    </div>
  );
};

/**
 * Match Confidence Badge
 */
const ConfidenceBadge = ({ confidence, matchMethod }) => {
  const getConfidenceColor = (conf) => {
    if (conf >= 0.9) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    if (conf >= 0.7) return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
    if (conf >= 0.5) return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    return 'bg-red-500/20 text-red-400 border-red-500/30';
  };
  
  const getMethodIcon = (method) => {
    switch (method) {
      case 'face_match': return '👤';
      case 'board_color': return '🏄';
      case 'wetsuit': return '🦈';
      case 'profile_photo': return '📷';
      default: return '🤖';
    }
  };
  
  return (
    <Badge className={`${getConfidenceColor(confidence)} border text-xs`}>
      {getMethodIcon(matchMethod)} {Math.round(confidence * 100)}% match
    </Badge>
  );
};

/**
 * Single Match Card - Different views for Paid vs Free
 */
const MatchCard = ({ 
  match, 
  isPaidAccount, 
  isSelected,
  onSelect,
  onClaim,
  onDismiss,
  onPreview,
  index,
  isRevealed,
  onReveal,
  sessionCreditsRemaining,
  pricePerClip
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const isVideo = match.media_type === 'video';
  
  // Free account: Show blurred unless revealed (costs a reveal or is being claimed)
  const showBlurred = !isPaidAccount && !isRevealed && !isSelected;
  
  return (
    <Card 
      className={`overflow-hidden transition-all ${
        isSelected 
          ? 'ring-2 ring-cyan-500 bg-cyan-500/10' 
          : 'bg-card hover:bg-muted/50'
      }`}
      data-testid={`match-card-${match.id}`}
    >
      <div className="relative aspect-[4/3]">
        {/* Media Preview */}
        <div 
          className={`w-full h-full ${showBlurred ? 'filter blur-lg' : ''}`}
          onClick={() => isPaidAccount && onPreview?.(match)}
        >
          {isVideo ? (
            <video
              src={match.preview_url}
              poster={match.thumbnail_url}
              className="w-full h-full object-cover"
              loop
              muted
              playsInline
              onMouseEnter={(e) => isPaidAccount && e.target.play()}
              onMouseLeave={(e) => e.target.pause()}
            />
          ) : (
            <img
              src={isPaidAccount ? match.preview_url : match.thumbnail_url}
              alt=""
              className="w-full h-full object-cover"
            />
          )}
        </div>
        
        {/* Lock Overlay for Free Users */}
        {showBlurred && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
            <Lock className="w-8 h-8 text-zinc-400" />
            <p className="text-xs text-zinc-400 text-center px-4">
              Upgrade to paid to preview all clips
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReveal?.(match.id)}
              className="mt-2 border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
            >
              <Eye className="w-3 h-3 mr-1" /> Reveal This
            </Button>
          </div>
        )}
        
        {/* Media Type Badge */}
        <div className="absolute top-2 left-2">
          {isVideo ? (
            <Badge className="bg-purple-500/80 text-white">
              <Video className="w-3 h-3 mr-1" /> Video
            </Badge>
          ) : (
            <Badge className="bg-blue-500/80 text-white">
              <Image className="w-3 h-3 mr-1" /> Photo
            </Badge>
          )}
        </div>
        
        {/* AI Confidence Badge */}
        <div className="absolute top-2 right-2">
          <ConfidenceBadge 
            confidence={match.ai_confidence} 
            matchMethod={match.ai_match_method}
          />
        </div>
        
        {/* Selection Checkbox (Paid accounts only) */}
        {isPaidAccount && (
          <button
            onClick={() => onSelect?.(match.id)}
            className={`absolute bottom-2 left-2 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
              isSelected 
                ? 'bg-cyan-500 text-black' 
                : 'bg-black/50 text-white hover:bg-cyan-500/50'
            }`}
          >
            {isSelected ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          </button>
        )}
        
        {/* Resolution Badge */}
        <div className="absolute bottom-2 right-2">
          <Badge className="bg-black/60 text-white text-xs">
            {match.resolution_tier === 'pro' ? '4K RAW' : '1080p'}
          </Badge>
        </div>
      </div>
      
      {/* Card Footer - Actions */}
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2">
          {/* Claim/Dismiss buttons for sequential mode (Free) */}
          {!isPaidAccount && isRevealed && (
            <>
              <Button
                size="sm"
                className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white"
                onClick={() => onClaim?.(match.id)}
              >
                <Check className="w-4 h-4 mr-1" />
                Claim {sessionCreditsRemaining > 0 ? '' : `$${pricePerClip}`}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                onClick={() => onDismiss?.(match.id)}
              >
                <X className="w-4 h-4" />
              </Button>
            </>
          )}
          
          {/* Batch selection info for Paid */}
          {isPaidAccount && (
            <div className="flex-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                #{index + 1} • {match.ai_match_method?.replace('_', ' ')}
              </span>
              {isSelected && (
                <Badge className="bg-cyan-500/20 text-cyan-400">Selected</Badge>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * Main AI Proposed Matches Component
 */
const AIProposedMatches = ({ 
  sessionId,
  open, 
  onOpenChange, 
  onClaimComplete 
}) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState([]);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [revealedIds, setRevealedIds] = useState(new Set());
  const [processing, setProcessing] = useState(false);
  const [previewMatch, setPreviewMatch] = useState(null);
  
  // Account tier - from user profile
  const isPaidAccount = user && !user.is_ad_supported;
  
  // Session entitlements
  const isAllInclusive = sessionInfo?.is_all_inclusive || false;
  const includedMediaCount = sessionInfo?.included_media_count || 0;
  const claimedCount = sessionInfo?.claimed_count || 0;
  const creditsRemaining = Math.max(0, includedMediaCount - claimedCount);
  const pricePerClip = sessionInfo?.price_per_clip || 5;
  
  // Fetch proposed matches
  const fetchMatches = useCallback(async () => {
    if (!sessionId || !user?.id) return;
    
    setLoading(true);
    try {
      const [matchesRes, sessionRes] = await Promise.all([
        axios.get(`${API}/surfer-gallery/proposed-matches/${sessionId}`),
        axios.get(`${API}/surfer-gallery/session-entitlements/${sessionId}`)
      ]);
      
      setMatches(matchesRes.data.matches || []);
      setSessionInfo(sessionRes.data);
    } catch (error) {
      logger.error('Error fetching proposed matches:', error);
      toast.error('Failed to load proposed matches');
    } finally {
      setLoading(false);
    }
  }, [sessionId, user?.id]);
  
  useEffect(() => {
    if (open && sessionId) {
      fetchMatches();
    }
  }, [open, sessionId, fetchMatches]);
  
  // Toggle selection (Paid accounts - batch mode)
  const toggleSelection = (matchId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(matchId)) {
        next.delete(matchId);
      } else {
        next.add(matchId);
      }
      return next;
    });
  };
  
  // Reveal a single item (Free accounts)
  const revealItem = (matchId) => {
    setRevealedIds(prev => new Set([...prev, matchId]));
  };
  
  // Claim single item (Free accounts - sequential)
  const claimSingle = async (matchId) => {
    setProcessing(true);
    try {
      await axios.post(`${API}/surfer-gallery/claim-match`, {
        match_id: matchId,
        session_id: sessionId,
        use_credit: creditsRemaining > 0
      });
      
      // Remove from matches, update session info
      setMatches(prev => prev.filter(m => m.id !== matchId));
      if (creditsRemaining > 0) {
        setSessionInfo(prev => ({
          ...prev,
          claimed_count: (prev?.claimed_count || 0) + 1
        }));
      }
      
      toast.success('Clip claimed to your gallery!');
    } catch (error) {
      toast.error('Failed to claim clip');
    } finally {
      setProcessing(false);
    }
  };
  
  // Dismiss single item
  const dismissSingle = async (matchId) => {
    setProcessing(true);
    try {
      await axios.post(`${API}/surfer-gallery/dismiss-match`, {
        match_id: matchId,
        session_id: sessionId
      });
      
      setMatches(prev => prev.filter(m => m.id !== matchId));
      setRevealedIds(prev => {
        const next = new Set(prev);
        next.delete(matchId);
        return next;
      });
      
      toast.success('Match dismissed');
    } catch (error) {
      toast.error('Failed to dismiss');
    } finally {
      setProcessing(false);
    }
  };
  
  // Batch claim selected (Paid accounts)
  const claimSelected = async () => {
    if (selectedIds.size === 0) return;
    
    setProcessing(true);
    try {
      await axios.post(`${API}/surfer-gallery/claim-matches-batch`, {
        match_ids: Array.from(selectedIds),
        session_id: sessionId,
        use_credits: creditsRemaining > 0
      });
      
      // Remove claimed from matches
      setMatches(prev => prev.filter(m => !selectedIds.has(m.id)));
      setSelectedIds(new Set());
      
      toast.success(`${selectedIds.size} clips claimed to your gallery!`);
      onClaimComplete?.();
    } catch (error) {
      toast.error('Failed to claim selected clips');
    } finally {
      setProcessing(false);
    }
  };
  
  // Confirm identity (AI suggested, user confirms)
  const confirmIdentity = async (matchId, isMe) => {
    setProcessing(true);
    try {
      await axios.post(`${API}/surfer-gallery/confirm-identity`, {
        match_id: matchId,
        is_confirmed: isMe
      });
      
      if (isMe) {
        toast.success('Identity confirmed!');
        // Refresh matches
        fetchMatches();
      } else {
        // Remove from queue
        setMatches(prev => prev.filter(m => m.id !== matchId));
        toast.success('Thanks for the feedback');
      }
    } catch (error) {
      toast.error('Failed to confirm');
    } finally {
      setProcessing(false);
    }
  };
  
  // Calculate cost for selected items
  const calculateSelectionCost = () => {
    const count = selectedIds.size;
    const freeClaims = Math.min(count, creditsRemaining);
    const paidClaims = Math.max(0, count - creditsRemaining);
    return {
      freeClaims,
      paidClaims,
      totalCost: paidClaims * pricePerClip
    };
  };
  
  const selectionCost = calculateSelectionCost();
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b border-zinc-700 px-4 sm:px-6 pt-4 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            AI Proposed Matches
            {isPaidAccount && (
              <Badge className="ml-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white">
                <Crown className="w-3 h-3 mr-1" /> Full Session Insight
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {/* Entitlement Banner */}
        <SessionEntitlementBanner
          sessionInfo={sessionInfo}
          isPaidAccount={isPaidAccount}
          creditsRemaining={creditsRemaining}
          isAllInclusive={isAllInclusive}
        />
        
        {/* Account Tier Info */}
        {!isPaidAccount && (
          <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 mb-4">
            <div className="flex items-start gap-2">
              <Shield className="w-5 h-5 text-amber-400 mt-0.5" />
              <div>
                <p className="font-medium text-amber-400">Sequential Claiming Mode</p>
                <p className="text-xs text-zinc-400 mt-1">
                  Free accounts review clips one at a time. 
                  <button className="text-cyan-400 ml-1 underline">
                    Upgrade to compare all clips side-by-side
                  </button>
                </p>
              </div>
            </div>
          </div>
        )}
        
        {/* Loading State */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
          </div>
        ) : matches.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle className="w-12 h-12 text-emerald-400 mb-4" />
            <p className="text-lg font-medium text-foreground">All caught up!</p>
            <p className="text-sm text-muted-foreground">No pending matches to review</p>
          </div>
        ) : (
          /* Matches Grid */
          <div className="flex-1 overflow-y-auto pr-2">
            {isPaidAccount ? (
              /* Paid: Full Grid View */
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {matches.map((match, index) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    isPaidAccount={true}
                    isSelected={selectedIds.has(match.id)}
                    onSelect={toggleSelection}
                    onPreview={setPreviewMatch}
                    index={index}
                    isRevealed={true}
                    sessionCreditsRemaining={creditsRemaining}
                    pricePerClip={pricePerClip}
                  />
                ))}
              </div>
            ) : (
              /* Free: Sequential View */
              <div className="space-y-4">
                {matches.map((match, index) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    isPaidAccount={false}
                    isSelected={false}
                    onClaim={claimSingle}
                    onDismiss={dismissSingle}
                    onReveal={revealItem}
                    index={index}
                    isRevealed={revealedIds.has(match.id)}
                    sessionCreditsRemaining={creditsRemaining}
                    pricePerClip={pricePerClip}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        
        {/* Footer Actions */}
        {isPaidAccount && selectedIds.size > 0 && (
          <DialogFooter className="border-t border-border pt-4 mt-4">
            <div className="flex items-center justify-between w-full">
              <div className="text-sm text-muted-foreground">
                {selectedIds.size} selected
                {selectionCost.freeClaims > 0 && (
                  <span className="ml-2 text-emerald-400">
                    ({selectionCost.freeClaims} included)
                  </span>
                )}
                {selectionCost.paidClaims > 0 && (
                  <span className="ml-2 text-amber-400">
                    + ${selectionCost.totalCost.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear Selection
                </Button>
                <Button
                  className="bg-cyan-500 hover:bg-cyan-600 text-white"
                  onClick={claimSelected}
                  disabled={processing}
                >
                  {processing ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  Claim Selected
                </Button>
              </div>
            </div>
          </DialogFooter>
        )}
        
        {/* Identity Confirmation Prompt */}
        {matches.length > 0 && matches[0]?.needs_identity_confirmation && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mt-4">
            <p className="font-medium text-amber-400 mb-2">
              <AlertCircle className="w-4 h-4 inline mr-2" />
              Confirm Your Identity
            </p>
            <p className="text-sm text-zinc-400 mb-3">
              Is this you in the photo? AI matched based on your Passport data.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="bg-emerald-500 hover:bg-emerald-600"
                onClick={() => confirmIdentity(matches[0].id, true)}
                disabled={processing}
              >
                <Check className="w-4 h-4 mr-1" /> Yes, that's me
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => confirmIdentity(matches[0].id, false)}
                disabled={processing}
              >
                <X className="w-4 h-4 mr-1" /> Not me
              </Button>
            </div>
          </div>
        )}
        </div>
      </DialogContent>
      
      {/* Full Preview Modal (Paid accounts) */}
      {previewMatch && (
        <Dialog open={!!previewMatch} onOpenChange={() => setPreviewMatch(null)}>
          <DialogContent className="max-w-5xl p-0 overflow-hidden">
            {previewMatch.media_type === 'video' ? (
              <video
                src={previewMatch.original_url || previewMatch.preview_url}
                className="w-full h-auto max-h-[80vh]"
                controls
                autoPlay
              />
            ) : (
              <img
                src={previewMatch.original_url || previewMatch.preview_url}
                alt=""
                className="w-full h-auto max-h-[80vh] object-contain"
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
};

// Add the Plus icon import that was used but not imported
const Plus = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export default AIProposedMatches;
