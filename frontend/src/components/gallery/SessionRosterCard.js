import React, { useState, useCallback } from 'react';
import { Users, ChevronDown, ChevronUp, CheckCircle2, ImageIcon, Video, X, ZoomIn, Tag, Minus, Sparkles, Clock, Shield, Camera, Film } from 'lucide-react';
import apiClient from '../../lib/apiClient';
import { getFullUrl } from '../../utils/media';
import { toast } from 'sonner';

/**
 * SessionRosterCard — Enhanced Surfer Delivery Tracker
 * 
 * Features:
 *   - Expandable surfer panels with selfie reference photo (zoomable)
 *   - Tagged item thumbnails with untag capability
 *   - Separate photo/video credit tracking
 *   - AI match confidence indicators
 * 
 * Props:
 *   roster: Array of participant objects from session_roster
 *   sessionType: 'live' | 'booking' | 'on_demand' | 'manual'
 *   itemCount: Total items in gallery
 *   compact: boolean — if true, show mini avatars inline (for folder cards)
 *   galleryId: string — gallery ID for API calls
 *   photographerId: string — photographer ID for auth
 *   onRosterUpdate: () => void — callback to refresh parent data after changes
 */
export const SessionRosterCard = ({ 
  roster = [], 
  sessionType, 
  itemCount = 0, 
  compact = false,
  galleryId,
  photographerId,
  onRosterUpdate
}) => {
  const [expanded, setExpanded] = useState(false);

  if (!roster || roster.length === 0) return null;

  const sessionLabel = {
    live: { text: 'Live Session', color: '#10b981', emoji: '🟢' },
    booking: { text: 'Booking', color: '#3b82f6', emoji: '📅' },
    on_demand: { text: 'On-Demand', color: '#f59e0b', emoji: '⚡' },
    manual: { text: 'Manual', color: '#6b7280', emoji: '📁' }
  }[sessionType] || { text: 'Session', color: '#6b7280', emoji: '📸' };

  // ── COMPACT MODE: Mini avatars inline on folder cards ──
  if (compact) {
    const totalDelivered = roster.reduce((sum, r) => sum + (r.items_delivered || 0), 0);
    const totalPhotos = roster.reduce((sum, r) => sum + (r.photos_included || 0), 0);
    const totalVideos = roster.reduce((sum, r) => sum + (r.videos_included || 0), 0);
    const totalSlots = totalPhotos + totalVideos;
    const allDone = totalDelivered >= totalSlots && totalSlots > 0;
    
    return (
      <div className="flex items-center gap-1.5 px-3 pb-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex -space-x-2">
          {roster.slice(0, 4).map((surfer, i) => (
            <div key={surfer.surfer_id} className="relative" style={{ zIndex: 4 - i }}>
              {surfer.avatar_url ? (
                <img src={surfer.avatar_url} alt={surfer.full_name}
                  className="w-6 h-6 rounded-full border-2 object-cover"
                  style={{ borderColor: surfer.credits_remaining > 0 ? '#f59e0b' : '#10b981' }} />
              ) : (
                <div className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-[8px] font-bold text-white"
                  style={{ borderColor: surfer.credits_remaining > 0 ? '#f59e0b' : '#10b981', background: 'linear-gradient(135deg, #06b6d4, #3b82f6)' }}>
                  {(surfer.full_name || '?')[0]}
                </div>
              )}
              {surfer.items_delivered > 0 && surfer.credits_remaining === 0 && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 flex items-center justify-center">
                  <CheckCircle2 className="w-2 h-2 text-white" />
                </div>
              )}
            </div>
          ))}
          {roster.length > 4 && (
            <div className="w-6 h-6 rounded-full border-2 border-muted bg-muted flex items-center justify-center text-[8px] font-bold text-muted-foreground">
              +{roster.length - 4}
            </div>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground font-medium ml-1">
          {allDone ? (
            <span className="text-emerald-500">✓ All delivered</span>
          ) : (
            <span>{totalDelivered}/{totalSlots} sent</span>
          )}
        </span>
      </div>
    );
  }

  // ── EXPANDED MODE: Full roster with interactive panels ──
  const totalDelivered = roster.reduce((s, r) => s + (r.items_delivered || 0), 0);
  const totalPhotos = roster.reduce((s, r) => s + (r.photos_included || 0), 0);
  const totalVideos = roster.reduce((s, r) => s + (r.videos_included || 0), 0);
  const totalSlots = totalPhotos + totalVideos;
  const allComplete = totalDelivered >= totalSlots && totalSlots > 0;

  return (
    <div className="rounded-xl overflow-hidden" style={{
      background: 'linear-gradient(135deg, rgba(6,182,212,0.06), rgba(59,130,246,0.04))',
      border: '1px solid rgba(6,182,212,0.15)'
    }}>
      {/* Header */}
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: `${sessionLabel.color}20` }}>
            <Users className="w-4 h-4" style={{ color: sessionLabel.color }} />
          </div>
          <div className="text-left">
            <h4 className="text-sm font-semibold text-foreground">Session Roster</h4>
            <p className="text-[11px] text-muted-foreground">
              {roster.length} surfer{roster.length !== 1 ? 's' : ''} • {sessionLabel.emoji} {sessionLabel.text}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{
            background: allComplete ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
            color: allComplete ? '#10b981' : '#f59e0b'
          }}>
            {totalDelivered}/{totalSlots} delivered
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded roster */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {roster.map((surfer) => (
            <SurferPanel
              key={surfer.surfer_id}
              surfer={surfer}
              itemCount={itemCount}
              galleryId={galleryId}
              photographerId={photographerId}
              onRosterUpdate={onRosterUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * SurferPanel — Expandable surfer card with selfie, thumbnails, and actions
 */
const SurferPanel = ({ surfer, itemCount, galleryId, photographerId, onRosterUpdate }) => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [selfieZoom, setSelfieZoom] = useState(false);
  const [taggedItems, setTaggedItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [untagging, setUntagging] = useState(null);

  const {
    full_name, username, avatar_url, selfie_url,
    amount_paid, photos_included = 3, videos_included = 1,
    photos_delivered = 0, videos_delivered = 0,
    photos_credits_remaining = 0, videos_credits_remaining = 0,
    items_delivered = 0, credits_remaining = 0, progress_pct = 0,
    payment_method
  } = surfer;

  const totalSlots = photos_included + videos_included;
  const isComplete = credits_remaining === 0 && items_delivered > 0;
  const hasCredits = credits_remaining > 0;
  const displayPhoto = selfie_url || avatar_url;

  // Load tagged items when panel expands
  const loadTaggedItems = useCallback(async () => {
    if (!galleryId || !photographerId || itemsLoaded) return;
    setLoadingItems(true);
    try {
      const resp = await apiClient.get(
        `/gallery/${galleryId}/surfer-items/${surfer.surfer_id}?photographer_id=${photographerId}`
      );
      setTaggedItems(resp.data.tagged_items || []);
      setItemsLoaded(true);
    } catch (err) {
      console.error('Failed to load tagged items:', err);
      toast.error('Failed to load tagged items');
    } finally {
      setLoadingItems(false);
    }
  }, [galleryId, photographerId, surfer.surfer_id, itemsLoaded]);

  const togglePanel = () => {
    const willOpen = !panelOpen;
    setPanelOpen(willOpen);
    if (willOpen && !itemsLoaded) loadTaggedItems();
  };

  // Untag item — restores correct credit pool automatically
  const handleUntag = async (item) => {
    if (untagging) return;
    setUntagging(item.gallery_item_id);
    try {
      await apiClient.post(
        `/gallery/${galleryId}/untag-item?photographer_id=${photographerId}`,
        { surfer_id: surfer.surfer_id, item_id: item.gallery_item_id }
      );
      setTaggedItems(prev => prev.filter(i => i.gallery_item_id !== item.gallery_item_id));
      const creditType = item.media_type === 'video' ? 'video' : 'photo';
      toast.success(`Untagged ${creditType} from ${full_name}${item.access_type === 'included' ? ' — credit restored' : ''}`);
      if (onRosterUpdate) onRosterUpdate();
    } catch (err) {
      toast.error('Failed to untag item');
    } finally {
      setUntagging(null);
    }
  };

  return (
    <>
      <div className="rounded-xl overflow-hidden transition-all" style={{
        background: isComplete ? 'rgba(16,185,129,0.06)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${isComplete ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.08)'}`
      }}>
        {/* Surfer Header Row */}
        <button onClick={togglePanel} className="w-full flex items-center gap-3 p-3 hover:bg-white/5 transition-colors">
          {/* Avatar / Selfie */}
          <div className="relative flex-shrink-0">
            {displayPhoto ? (
              <img src={displayPhoto} alt={full_name}
                className="w-11 h-11 rounded-xl object-cover"
                style={{ border: `2px solid ${isComplete ? '#10b981' : hasCredits ? '#f59e0b' : '#6b7280'}` }} />
            ) : (
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold text-white"
                style={{ background: 'linear-gradient(135deg, #06b6d4, #3b82f6)', border: `2px solid ${isComplete ? '#10b981' : hasCredits ? '#f59e0b' : '#6b7280'}` }}>
                {(full_name || '?')[0]}
              </div>
            )}
            {isComplete && (
              <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm">
                <CheckCircle2 className="w-2.5 h-2.5 text-white" />
              </div>
            )}
          </div>

          {/* Name + progress */}
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-foreground truncate">{full_name || 'Unknown'}</span>
              {username && <span className="text-[10px] text-muted-foreground">@{username}</span>}
            </div>
            {/* Progress bar */}
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <div className="h-full rounded-full transition-all duration-500" style={{
                  width: `${Math.min(100, progress_pct || 0)}%`,
                  background: isComplete ? 'linear-gradient(90deg, #10b981, #34d399)' : 'linear-gradient(90deg, #06b6d4, #3b82f6)'
                }} />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
                {items_delivered}/{totalSlots}
              </span>
            </div>
          </div>

          {/* Right side — status + expand */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {isComplete ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>✓ Done</span>
            ) : hasCredits ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>🎟️ {credits_remaining} left</span>
            ) : items_delivered === 0 ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(107,114,128,0.15)', color: '#9ca3af' }}>Waiting</span>
            ) : null}
            {panelOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </div>
        </button>

        {/* ── Expanded Panel ── */}
        {panelOpen && (
          <div className="px-3 pb-3 space-y-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            {/* Row 1: Selfie Reference + Credit Breakdown */}
            <div className="flex gap-3 pt-3">
              {/* Selfie Reference Photo */}
              {(selfie_url || avatar_url) && (
                <div className="flex-shrink-0 relative group cursor-pointer" onClick={() => setSelfieZoom(true)}>
                  <img src={selfie_url || avatar_url} alt={`${full_name} reference`}
                    className="w-20 h-20 rounded-xl object-cover shadow-lg"
                    style={{ border: '2px solid rgba(6,182,212,0.3)' }} />
                  <div className="absolute inset-0 rounded-xl bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <ZoomIn className="w-5 h-5 text-white" />
                  </div>
                  <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 whitespace-nowrap">
                    {selfie_url ? '📷 Selfie' : '👤 Avatar'}
                  </div>
                </div>
              )}

              {/* Credit Breakdown — Photo + Video separate */}
              <div className="flex-1 space-y-1.5">
                {/* Photo Credits */}
                <CreditRow
                  icon={<Camera className="w-3 h-3" />}
                  label="Photos"
                  delivered={photos_delivered}
                  included={photos_included}
                  remaining={photos_credits_remaining}
                  color="#06b6d4"
                />
                {/* Video Credits */}
                <CreditRow
                  icon={<Film className="w-3 h-3" />}
                  label="Videos"
                  delivered={videos_delivered}
                  included={videos_included}
                  remaining={videos_credits_remaining}
                  color="#8b5cf6"
                />
                {/* Payment Info */}
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <span className="text-[10px]">{payment_method === 'credits' ? '✨' : '💳'}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {amount_paid > 0 ? `$${amount_paid} paid` : 'Free'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <Shield className="w-3 h-3" style={{ color: isComplete ? '#10b981' : '#f59e0b' }} />
                    <span className="text-[10px] text-muted-foreground">
                      {isComplete ? 'Fully delivered' : hasCredits ? `${credits_remaining} credit${credits_remaining !== 1 ? 's' : ''} left` : 'Awaiting'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Row 2: Tagged Items Thumbnails */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                  <Tag className="w-3 h-3" /> Tagged Items
                </span>
                {taggedItems.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {taggedItems.filter(i => i.media_type !== 'video').length} 📷 • {taggedItems.filter(i => i.media_type === 'video').length} 🎬
                  </span>
                )}
              </div>

              {loadingItems ? (
                <div className="flex gap-2">
                  {[1,2,3].map(i => (
                    <div key={i} className="w-16 h-16 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
                  ))}
                </div>
              ) : taggedItems.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                  {taggedItems.map((item) => (
                    <TaggedItemThumb key={item.gallery_item_id} item={item}
                      onUntag={() => handleUntag(item)} isUntagging={untagging === item.gallery_item_id} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.1)' }}>
                  <ImageIcon className="w-5 h-5 text-muted-foreground/40 mx-auto mb-1" />
                  <p className="text-[10px] text-muted-foreground">No items tagged yet</p>
                  <p className="text-[9px] text-muted-foreground/60 mt-0.5">Use "Tag to Surfer" on photos to assign</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Selfie Zoom Modal ── */}
      {selfieZoom && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setSelfieZoom(false)}>
          <div className="relative max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelfieZoom(false)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-black/60 border border-white/20 flex items-center justify-center z-10 hover:bg-white/20 transition-colors">
              <X className="w-4 h-4 text-white" />
            </button>
            <img src={selfie_url || avatar_url} alt={`${full_name} reference`}
              className="w-full rounded-2xl shadow-2xl object-cover" style={{ maxHeight: '70vh' }} />
            <div className="absolute bottom-0 left-0 right-0 p-4 rounded-b-2xl" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.8))' }}>
              <p className="text-white font-semibold text-base">{full_name}</p>
              {username && <p className="text-white/60 text-xs">@{username}</p>}
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                  style={{ background: 'rgba(6,182,212,0.3)', color: '#67e8f9' }}>
                  {selfie_url ? '📷 Session Selfie' : '👤 Profile Photo'}
                </span>
                <span className="text-[10px] text-white/50">
                  📷 {photos_delivered}/{photos_included} • 🎬 {videos_delivered}/{videos_included}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/** Credit Row — Shows one credit pool (photo or video) with mini progress */
const CreditRow = ({ icon, label, delivered, included, remaining, color }) => {
  const pct = included > 0 ? Math.min(100, (delivered / included) * 100) : 0;
  const isDone = remaining === 0 && delivered > 0;
  
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex-shrink-0" style={{ color }}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-foreground">{label}</span>
          <span className="text-[10px] font-mono" style={{ color: isDone ? '#10b981' : color }}>
            {delivered}/{included}
            {remaining > 0 && <span className="text-muted-foreground ml-1">({remaining} left)</span>}
            {isDone && ' ✓'}
          </span>
        </div>
        <div className="mt-0.5 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div className="h-full rounded-full transition-all duration-500" style={{
            width: `${pct}%`,
            background: isDone ? '#10b981' : color
          }} />
        </div>
      </div>
    </div>
  );
};

/** Tagged Item Thumbnail — with untag overlay */
const TaggedItemThumb = ({ item, onUntag, isUntagging }) => {
  const isVideo = item.media_type === 'video';
  const thumbUrl = getFullUrl(item.thumbnail_url || item.preview_url);
  const accessColor = item.access_type === 'included' ? '#10b981' : item.access_type === 'pending_selection' ? '#f59e0b' : '#6b7280';

  return (
    <div className="relative flex-shrink-0 group">
      <div className="w-16 h-16 rounded-lg overflow-hidden relative" style={{ border: `2px solid ${accessColor}30` }}>
        {thumbUrl ? (
          <img src={thumbUrl} alt="Tagged" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.06)' }}>
            {isVideo ? <Video className="w-4 h-4 text-muted-foreground" /> : <ImageIcon className="w-4 h-4 text-muted-foreground" />}
          </div>
        )}
        {isVideo && (
          <div className="absolute bottom-0.5 left-0.5 text-[8px] px-1 py-0.5 rounded bg-purple-500/80 text-white font-medium">🎬 Vid</div>
        )}
        {!isVideo && (
          <div className="absolute bottom-0.5 left-0.5 text-[8px] px-1 py-0.5 rounded bg-cyan-500/80 text-white font-medium">📷</div>
        )}
        {/* Access type indicator */}
        <div className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full" style={{ background: accessColor, boxShadow: `0 0 4px ${accessColor}` }} />
        {item.ai_suggested && (
          <div className="absolute top-0.5 left-0.5">
            <Sparkles className="w-2.5 h-2.5 text-purple-400" />
          </div>
        )}
      </div>

      {/* Untag overlay on hover */}
      <button onClick={(e) => { e.stopPropagation(); onUntag(); }}
        disabled={isUntagging}
        className="absolute inset-0 rounded-lg bg-red-500/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
        title={`Untag ${isVideo ? 'video' : 'photo'} from surfer`}>
        {isUntagging ? (
          <div className="w-4 h-4 border-2 border-white/60 border-t-white rounded-full animate-spin" />
        ) : (
          <Minus className="w-5 h-5 text-white" />
        )}
      </button>
    </div>
  );
};

export default SessionRosterCard;
