/**
 * GalleryModals.js - Tag/Assign, Thumbnail Picker, and Link Session modals.
 * Extracted from GalleryPage.js.
 */
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import {
  Sparkles, Loader2, Users,
  ImagePlus, Link2, Camera,
  CheckCircle, Send, UserPlus, RotateCcw, Radio
} from 'lucide-react';
import { getFullUrl } from '../../utils/media';

export const TagAssignModal = ({
  showTagAssignModal, setShowTagAssignModal,
  selectedGallery, selectedItems, galleryItems,
  participantsLoading, participants, aiAutoTagLoading, handleAiAutoTag,
  batchTagLoading, distributeLoading, handleBatchTagToSurfer,
  distributeAllLoading, handleDistributeAll, sessionInfo,
  manualSurferSearch, setManualSurferSearch, handleSearchSurfers,
  searchLoading, searchResults
}) => {
  return (
    <>
          {/* ============ TAG & ASSIGN MODAL ============ */}
          <Dialog open={showTagAssignModal} onOpenChange={setShowTagAssignModal}>
            <DialogContent className="max-w-xl bg-background border-border max-h-[90vh] overflow-hidden flex flex-col">
              <DialogHeader>
                <DialogTitle className="text-foreground flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                  Tag & Assign — {selectedGallery?.title || 'Gallery'}
                </DialogTitle>
                <p className="text-xs text-muted-foreground">
                  {selectedItems.size > 0 
                    ? `Tagging ${selectedItems.size} selected items` 
                    : `Tagging all ${galleryItems.length} items in this folder`}
                </p>
              </DialogHeader>
              
              <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                {/* ── Item Preview Strip ── */}
                <div className="rounded-lg p-2.5" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] font-semibold text-purple-400">
                      📦 {selectedItems.size > 0 ? `${selectedItems.size} Selected` : `All ${galleryItems.length} Items`}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {galleryItems.filter(i => i.media_type !== 'video').length} 📷 • {galleryItems.filter(i => i.media_type === 'video').length} 🎬
                    </span>
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                    {(selectedItems.size > 0 
                      ? galleryItems.filter(i => selectedItems.has(i.id))
                      : galleryItems
                    ).slice(0, 12).map(item => (
                      <div key={item.id} className="w-11 h-11 rounded-lg overflow-hidden flex-shrink-0 relative" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                        {item.media_type === 'video' ? (
                          <video src={getFullUrl(item.preview_url)} className="w-full h-full object-cover" muted />
                        ) : (
                          <img loading="lazy" decoding="async" src={getFullUrl(item.preview_url || item.thumbnail_url)} alt="" className="w-full h-full object-cover" />
                        )}
                        {item.media_type === 'video' && (
                          <div className="absolute bottom-0 left-0 right-0 bg-purple-600/80 text-[6px] text-white text-center font-bold">VID</div>
                        )}
                      </div>
                    ))}
                    {(selectedItems.size > 0 ? selectedItems.size : galleryItems.length) > 12 && (
                      <div className="w-11 h-11 rounded-lg flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-muted-foreground" style={{ background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.15)' }}>
                        +{(selectedItems.size > 0 ? selectedItems.size : galleryItems.length) - 12}
                      </div>
                    )}
                  </div>
                </div>
    
                {/* ── Session Participants Section ── */}
                {participantsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
                    <span className="ml-2 text-muted-foreground text-sm">Loading participants...</span>
                  </div>
                ) : participants.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Users className="w-4 h-4 text-purple-400" />
                        Session Participants ({participants.length})
                      </h3>
                      {/* AI Auto-tag shortcut */}
                      <Button aria-label="Sparkles" size="sm" variant="ghost" className="text-xs text-cyan-400 hover:text-cyan-300 h-7 px-2"
                        onClick={() => { setShowTagAssignModal(false); handleAiAutoTag(); }}
                        disabled={aiAutoTagLoading}>
                        <Sparkles className="w-3 h-3 mr-1" /> AI Match All
                      </Button>
                    </div>
                    
                    {participants.map((p) => {
                      const isLoading = batchTagLoading[p.surfer_id] || distributeLoading[p.surfer_id];
                      const totalItems = selectedItems.size > 0 ? selectedItems.size : galleryItems.length;
                      const isFullyDistributed = p.items_distributed >= totalItems && totalItems > 0;
                      const hasCredits = p.photos_credit_remaining > 0;
                      const creditsToUse = Math.min(p.photos_credit_remaining || 0, totalItems - (p.items_distributed || 0));
                      const previewCount = Math.max(0, totalItems - (p.items_distributed || 0) - creditsToUse);
                      
                      return (
                        <div key={p.surfer_id}
                          className={`rounded-xl overflow-hidden transition-all ${
                            isFullyDistributed 
                              ? 'opacity-60' 
                              : 'hover:border-purple-500/40'
                          }`}
                          style={{
                            background: isFullyDistributed ? 'rgba(16,185,129,0.06)' : 'rgba(255,255,255,0.02)',
                            border: `1px solid ${isFullyDistributed ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.08)'}`
                          }}>
                          <div className="flex items-center gap-3 p-3">
                            {/* Avatar */}
                            <div className="relative flex-shrink-0">
                              {p.avatar_url || p.selfie_url ? (
                                <img loading="lazy" decoding="async" src={getFullUrl(p.selfie_url || p.avatar_url)} alt={p.full_name}
                                  className="w-11 h-11 rounded-xl object-cover"
                                  style={{ border: `2px solid ${isFullyDistributed ? '#10b981' : hasCredits ? '#f59e0b' : '#6b7280'}` }} />
                              ) : (
                                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold text-white"
                                  style={{ background: 'linear-gradient(135deg, #06b6d4, #3b82f6)', border: `2px solid ${isFullyDistributed ? '#10b981' : hasCredits ? '#f59e0b' : '#6b7280'}` }}>
                                  {(p.full_name || '?')[0]}
                                </div>
                              )}
                              {isFullyDistributed && (
                                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm">
                                  <CheckCircle className="w-3 h-3 text-white" />
                                </div>
                              )}
                            </div>
                            
                            {/* Name + delivery preview */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-semibold text-foreground truncate">{p.full_name || 'Unknown'}</span>
                                {p.username && <span className="text-[10px] text-muted-foreground">@{p.username}</span>}
                              </div>
                              {isFullyDistributed ? (
                                <p className="text-[11px] text-emerald-400 font-medium mt-0.5">
                                  ✅ All {p.items_distributed} items already delivered
                                </p>
                              ) : (
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {p.items_distributed > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}>
                                      📤 {p.items_distributed} sent
                                    </span>
                                  )}
                                  {creditsToUse > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399' }}>
                                      🎟️ {creditsToUse} included
                                    </span>
                                  )}
                                  {previewCount > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}>
                                      🔒 {previewCount} preview
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            
                            {/* Action */}
                            {isFullyDistributed ? (
                              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] flex-shrink-0">
                                ✓ Done
                              </Badge>
                            ) : (
                              <Button aria-label="Loader2" size="sm"
                                className="bg-purple-500 hover:bg-purple-600 text-white text-xs h-9 px-3 flex-shrink-0 shadow-sm"
                                onClick={() => handleBatchTagToSurfer(p.surfer_id, p.full_name || p.username)}
                                disabled={isLoading || galleryItems.length === 0}>
                                {isLoading ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <>
                                    <Send className="w-3.5 h-3.5 mr-1.5" />
                                    Tag & Send
                                  </>
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    
                    {/* Distribute All shortcut */}
                    {participants.length > 1 && participants.some(p => p.items_distributed < galleryItems.length) && (
                      <Button aria-label="Loader2" size="sm" variant="outline"
                        className="w-full border-emerald-600 text-emerald-400 hover:bg-emerald-500/10 text-xs h-9 mt-1"
                        onClick={handleDistributeAll}
                        disabled={distributeAllLoading || galleryItems.length === 0}>
                        {distributeAllLoading ? (
                          <Loader2 className="w-3 h-3 animate-spin mr-1" />
                        ) : (
                          <Send className="w-3 h-3 mr-1" />
                        )}
                        Tag All Items → All {participants.length} Participants
                      </Button>
                    )}
                  </div>
                ) : sessionInfo && !sessionInfo.is_linked ? null : (
                  <div className="text-center py-6">
                    <Users className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No session participants found</p>
                    <p className="text-xs text-muted-foreground mt-1">Use manual assignment below to send items to any surfer</p>
                  </div>
                )}
    
                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">or assign manually</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
    
                {/* Manual Surfer Search */}
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-amber-400" />
                    Manual Assignment
                  </h3>
                  <div className="relative">
                    <Input aria-label="Search surfer by name or username..."
                      placeholder="Search surfer by name or username..."
                      value={manualSurferSearch}
                      onChange={(e) => {
                        setManualSurferSearch(e.target.value);
                        handleSearchSurfers(e.target.value);
                      }}
                      className="bg-muted border-border text-foreground"
                    />
                    {searchLoading && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  
                  {/* Search Results */}
                  {searchResults.length > 0 && (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {searchResults.map((surfer) => {
                        const isLoading = batchTagLoading[surfer.id] || distributeLoading[surfer.id];
                        return (
                          <div key={surfer.id}
                            className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30 border border-border/50 hover:border-amber-500/50 transition-all">
                            {surfer.avatar_url ? (
                              <img loading="lazy" decoding="async" src={getFullUrl(surfer.avatar_url)} alt={surfer.full_name} className="w-9 h-9 rounded-full object-cover border border-border" />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-xs">
                                {(surfer.full_name || surfer.username || '?').charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{surfer.full_name || surfer.username}</p>
                              {surfer.username && <p className="text-[10px] text-muted-foreground">@{surfer.username}</p>}
                            </div>
                            <Button aria-label="Loader2" size="sm"
                              className="bg-amber-500 hover:bg-amber-600 text-black text-xs h-8 flex-shrink-0"
                              onClick={() => handleBatchTagToSurfer(surfer.id, surfer.full_name || surfer.username)}
                              disabled={isLoading}>
                              {isLoading ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <><Send className="w-3 h-3 mr-1" /> Tag & Send</>
                              )}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {manualSurferSearch.length >= 2 && !searchLoading && searchResults.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">No surfers found for "{manualSurferSearch}"</p>
                  )}
                </div>
                
                {/* Smart Delivery Info */}
                <div className="p-3 rounded-lg" style={{ background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.15)' }}>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    <strong className="text-cyan-400">How it works:</strong> Items tagged to surfers with remaining credits are delivered as <strong className="text-emerald-400">full-resolution included</strong> content. 
                    Once credits are used, additional items are delivered as <strong className="text-amber-400">watermarked previews</strong> that surfers can purchase.
                    Already-delivered items are automatically skipped.
                  </p>
                </div>
              </div>
              
              <DialogFooter className="pt-3 border-t border-border">
                <Button variant="outline" onClick={() => setShowTagAssignModal(false)} className="border-border">
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
    </>
  );
};

export const ThumbnailPickerModal = ({
  showThumbnailPicker, setShowThumbnailPicker,
  thumbnailPickerGallery, thumbnailPickerLoading, thumbnailPickerItems,
  handleSetThumbnail, settingThumbnail, handleClearThumbnail
}) => {
  return (
    <>
          {/* ============ THUMBNAIL PICKER MODAL ============ */}
          <Dialog open={showThumbnailPicker} onOpenChange={setShowThumbnailPicker}>
            <DialogContent className="bg-background border-border text-foreground max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-foreground flex items-center gap-2">
                  <ImagePlus className="w-5 h-5 text-cyan-400" />
                  Choose Folder Thumbnail
                </DialogTitle>
                <p className="text-xs text-muted-foreground">
                  Select any photo from <strong>{thumbnailPickerGallery?.title}</strong> to use as the folder cover.
                </p>
              </DialogHeader>
              <div className="py-3">
                {thumbnailPickerLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                  </div>
                ) : thumbnailPickerItems.length === 0 ? (
                  <div className="text-center py-8 bg-muted/50 rounded-lg">
                    <Camera className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-muted-foreground text-sm">No items in this folder yet.</p>
                    <p className="text-muted-foreground text-xs mt-1">Upload photos first, then set one as the cover.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {thumbnailPickerItems.filter(item => item.media_type !== 'video').map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleSetThumbnail(item.id)}
                        disabled={settingThumbnail}
                        className="relative aspect-square rounded-lg overflow-hidden bg-muted hover:ring-2 hover:ring-cyan-400 transition-all group/thumb disabled:opacity-50"
                        data-testid={`thumbnail-pick-${item.id}`}
                      >
                        <img loading="lazy" decoding="async"
                          src={getFullUrl(item.thumbnail_url || item.preview_url)}
                          alt={item.title || 'Photo'}
                          className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-200"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/40 transition-colors flex items-center justify-center">
                          <div className="opacity-0 group-hover/thumb:opacity-100 transition-opacity flex flex-col items-center gap-1">
                            <ImagePlus className="w-5 h-5 text-white" />
                            <span className="text-white text-[10px] font-medium">Set as Cover</span>
                          </div>
                        </div>
                        {/* Current cover indicator */}
                        {thumbnailPickerGallery?.cover_image_url && 
                         (item.preview_url === thumbnailPickerGallery.cover_image_url || 
                          item.thumbnail_url === thumbnailPickerGallery.cover_image_url) && (
                          <div className="absolute top-1 right-1">
                            <Badge className="bg-cyan-500 text-white text-[8px] px-1 py-0">Current</Badge>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <DialogFooter className="gap-2">
                {thumbnailPickerGallery?.cover_image_url && (
                  <Button aria-label="Undo"
                    variant="outline"
                    size="sm"
                    onClick={() => handleClearThumbnail(thumbnailPickerGallery.id)}
                    className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 mr-auto"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Reset to Auto
                  </Button>
                )}
                <Button variant="outline" onClick={() => setShowThumbnailPicker(false)} className="border-border">
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
    </>
  );
};

export const LinkSessionModal = ({
  showLinkSessionModal, setShowLinkSessionModal,
  linkSessionGallery, recentSessionsLoading, recentSessions,
  handleLinkSession, linkingSession
}) => {
  return (
    <>
          {/* ============ LINK SESSION MODAL ============ */}
          <Dialog open={showLinkSessionModal} onOpenChange={setShowLinkSessionModal}>
            <DialogContent className="bg-background border-border text-foreground max-w-md max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-foreground flex items-center gap-2">
                  <Link2 className="w-5 h-5 text-purple-400" />
                  Link to Session
                </DialogTitle>
                <p className="text-xs text-muted-foreground">
                  Connect <strong>{linkSessionGallery?.title}</strong> to a past session to enable participant tracking and auto-distribution.
                </p>
              </DialogHeader>
              <div className="py-3 space-y-2">
                {recentSessionsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
                    <span className="ml-2 text-muted-foreground text-sm">Loading recent sessions...</span>
                  </div>
                ) : recentSessions.length === 0 ? (
                  <div className="text-center py-8 bg-muted/50 rounded-lg">
                    <Radio className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-muted-foreground text-sm">No recent sessions found</p>
                    <p className="text-muted-foreground text-xs mt-1">Start a live session first, then come back to link it.</p>
                  </div>
                ) : (
                  recentSessions.filter(s => s.is_available).length === 0 ? (
                    <div className="text-center py-8 bg-muted/50 rounded-lg">
                      <CheckCircle className="w-10 h-10 text-emerald-400/40 mx-auto mb-2" />
                      <p className="text-muted-foreground text-sm">All sessions are already linked</p>
                      <p className="text-muted-foreground text-xs mt-1">Start a new live session, then come back to link it.</p>
                    </div>
                  ) : (
                  recentSessions.filter(s => s.is_available).map((session) => (
                    <button aria-label="div"
                      key={`${session.session_type}-${session.id}`}
                      onClick={() => handleLinkSession(session)}
                      disabled={linkingSession}
                      className="w-full flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-muted transition-colors text-left border border-border hover:border-purple-500/40 disabled:opacity-50"
                      data-testid={`link-session-option-${session.id}`}
                    >
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{
                        background: session.session_type === 'live'
                          ? (session.status === 'active' || session.status === 'shooting' ? 'rgba(16,185,129,0.15)' : 'rgba(139,92,246,0.1)')
                          : session.session_type === 'booking'
                          ? 'rgba(59,130,246,0.1)'
                          : 'rgba(249,115,22,0.1)',
                        border: `1px solid ${session.session_type === 'live'
                          ? (session.status === 'active' || session.status === 'shooting' ? 'rgba(16,185,129,0.3)' : 'rgba(139,92,246,0.2)')
                          : session.session_type === 'booking'
                          ? 'rgba(59,130,246,0.2)'
                          : 'rgba(249,115,22,0.2)'}`
                      }}>
                        <Radio className={`w-4 h-4 ${
                          session.session_type === 'live'
                            ? (session.status === 'active' || session.status === 'shooting' ? 'text-emerald-400' : 'text-purple-400')
                            : session.session_type === 'booking'
                            ? 'text-blue-400'
                            : 'text-orange-400'
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground font-medium text-sm truncate">
                          {session.location_name || 'Session'}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                          {session.started_at && (
                            <span>{new Date(session.started_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                          )}
                          {session.participant_count > 0 && (
                            <span className="flex items-center gap-0.5">
                              <Users className="w-3 h-3" />
                              {session.participant_count}
                            </span>
                          )}
                          <Badge className={`text-[8px] px-1 py-0 ${
                            session.session_type === 'live'
                              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                              : session.session_type === 'booking'
                              ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                              : 'bg-orange-500/20 text-orange-400 border-orange-500/30'
                          }`}>
                            {session.session_type === 'live' ? '🟢 Live' :
                             session.session_type === 'booking' ? '📅 Booking' :
                             '⚡ On-Demand'}
                          </Badge>
                          <Badge className={`text-[8px] px-1 py-0 ${
                            session.status === 'active' || session.status === 'shooting'
                              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                              : session.status === 'completed' || session.status === 'Completed'
                              ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                              : 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
                          }`}>
                            {session.status}
                          </Badge>
                        </div>
                      </div>
                      {linkingSession ? (
                        <Loader2 className="w-4 h-4 animate-spin text-purple-400 flex-shrink-0" />
                      ) : (
                        <Link2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      )}
                    </button>
                  ))
                  )
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowLinkSessionModal(false)} className="border-border">
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
    </>
  );
};