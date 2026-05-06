import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  DollarSign, Tag, X, Users, MapPin, Calendar, Sparkles, UserCheck, Loader2,
  Search, Filter, Check, MoreVertical, TrendingUp, ShoppingBag, BarChart3,
  Link2, Send, CheckCircle, AlertCircle, ArrowRight, UserPlus, RefreshCw,
  Image as ImageIcon, Video, Eye, Settings, Trash2, Upload
} from 'lucide-react';
import { getFullUrl } from '../../utils/media';

const TaggingAssignModal = ({
  showPricingModal, setShowPricingModal, showEditModal, setShowEditModal,
  showTaggingModal, setShowTaggingModal, showItemPricingModal, setShowItemPricingModal,
  showSalesDashboard, setShowSalesDashboard, showClientActivity, setShowClientActivity,
  showLinkSessionModal, setShowLinkSessionModal, showAssignDrawer, setShowAssignDrawer,
  selectedItem, setSelectedItem, aiTagSuggestions, setAiTagSuggestions,
  selectedTags, setSelectedTags, analyzingPhoto, gallery, setGallery,
  pricing, setPricing, editData, setEditData, itemCustomPrice, setItemCustomPrice,
  handleSavePricing, handleSaveEdit, handleAnalyzePhoto, toggleTagSelection,
  handleConfirmTags, handleSetCustomPrice, handleAssignItemToSurfer,
  assigningItem, salesData, clientsData, loadingSales, loadingSessions,
  sessionParticipants, distributing, recentSessions, handleLinkSession,
  fetchRecentSessions, user, galleryId, isLight, textPrimaryClass,
  textSecondaryClass, borderClass, inputBgClass, cardBgClass, navigate,
  totalGalleryItems, showPricing
}) => {
  return (
    <>
      {/* ============ PHASE 3: UNIFIED TAG & ASSIGN MODAL ============ */}
      <Dialog open={showTaggingModal} onOpenChange={setShowTaggingModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-w-2xl max-h-[90vh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <Sparkles className="w-5 h-5 text-purple-400" />
              Tag & Assign to Surfer
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-5">
            {/* Preview Image */}
            {selectedItem && (
              <div className="flex justify-center">
                <img loading="lazy" decoding="async" 
                  src={getFullUrl(selectedItem.preview_url)} 
                  alt="Photo to tag" 
                  className="max-h-48 rounded-lg object-contain"
                />
              </div>
            )}

            {/* --- AI Analysis Section --- */}
            <div className={`rounded-xl p-4 ${isLight ? 'bg-purple-50 border border-purple-200' : 'bg-purple-500/10 border border-purple-500/20'}`}>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <h4 className={`font-semibold text-sm ${textPrimaryClass}`}>AI Recognition</h4>
                {!analyzingPhoto && aiTagSuggestions.length === 0 && (
                  <Button aria-label="Sparkles"
                    size="sm"
                    onClick={handleAnalyzePhoto}
                    disabled={selectedItem?.media_type === 'video'}
                    className="ml-auto bg-gradient-to-r from-purple-400 to-pink-500 text-black h-7 px-3 text-xs"
                  >
                    <Sparkles className="w-3 h-3 mr-1" /> Scan Photo
                  </Button>
                )}
              </div>

              {analyzingPhoto && (
                <div className="text-center py-4">
                  <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin text-purple-400" />
                  <p className={`text-xs ${textSecondaryClass}`}>Analyzing photo with AI...</p>
                </div>
              )}

              {aiTagSuggestions.length > 0 && (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {aiTagSuggestions.map((suggestion) => (
                    <div
                      key={suggestion.profile_id}
                      onClick={() => toggleTagSelection(suggestion.profile_id)}
                      className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all ${
                        selectedTags.includes(suggestion.profile_id)
                          ? 'bg-purple-500/25 ring-2 ring-purple-500/50'
                          : isLight ? 'bg-white hover:bg-purple-50' : 'bg-zinc-800/70 hover:bg-zinc-700'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-full overflow-hidden bg-zinc-700 flex-shrink-0">
                        {suggestion.avatar_url ? (
                          <img loading="lazy" decoding="async" src={getFullUrl(suggestion.avatar_url)} alt={suggestion.name} className="w-full h-full object-cover" />
                        ) : (
                          <Users className="w-4 h-4 m-auto mt-2.5 text-zinc-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${textPrimaryClass}`}>{suggestion.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Badge variant="outline" className={
                            `text-[9px] ${
                              suggestion.confidence === 'high' ? 'border-green-500/50 text-green-400' :
                              suggestion.confidence === 'medium' ? 'border-yellow-500/50 text-yellow-400' :
                              'border-gray-500/50 text-gray-400'
                            }`
                          }>
                            {suggestion.confidence}
                          </Badge>
                          {suggestion.reasoning && (
                            <span className={`text-[10px] ${textSecondaryClass} truncate`}>{suggestion.reasoning}</span>
                          )}
                        </div>
                      </div>
                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                        selectedTags.includes(suggestion.profile_id)
                          ? 'bg-purple-500 border-purple-500'
                          : isLight ? 'border-gray-300' : 'border-zinc-600'
                      }`}>
                        {selectedTags.includes(suggestion.profile_id) && <Check className="w-3.5 h-3.5 text-white" />}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!analyzingPhoto && aiTagSuggestions.length === 0 && (
                <p className={`text-xs ${textSecondaryClass} text-center`}>
                  {selectedItem?.media_type === 'video' ? 'AI analysis unavailable for video' : 'Click "Scan Photo" to find matching surfers'}
                </p>
              )}
            </div>

            {/* --- Manual Assignment Section (Session Participants) --- */}
            <div className={`rounded-xl p-4 ${isLight ? 'bg-cyan-50 border border-cyan-200' : 'bg-cyan-500/10 border border-cyan-500/20'}`}>
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-cyan-400" />
                <h4 className={`font-semibold text-sm ${textPrimaryClass}`}>Session Participants</h4>
                <span className={`text-[10px] ${textSecondaryClass} ml-auto`}>{sessionParticipants.length} surfers</span>
              </div>

              {sessionParticipants.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {sessionParticipants.map((participant) => {
                    const isAiMatch = aiTagSuggestions.some(s => s.profile_id === participant.surfer_id);
                    return (
                      <div
                        key={participant.surfer_id}
                        onClick={() => toggleTagSelection(participant.surfer_id)}
                        className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all ${
                          selectedTags.includes(participant.surfer_id)
                            ? 'bg-cyan-500/25 ring-2 ring-cyan-500/50'
                            : isLight ? 'bg-white hover:bg-cyan-50' : 'bg-zinc-800/70 hover:bg-zinc-700'
                        }`}
                      >
                        <div className="w-9 h-9 rounded-full overflow-hidden bg-zinc-700 flex-shrink-0">
                          {participant.avatar_url ? (
                            <img loading="lazy" decoding="async" src={getFullUrl(participant.avatar_url)} alt={participant.full_name} className="w-full h-full object-cover" />
                          ) : (
                            <Users className="w-4 h-4 m-auto mt-2.5 text-zinc-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className={`text-sm font-medium ${textPrimaryClass}`}>{participant.full_name}</p>
                            {isAiMatch && (
                              <Badge className="bg-purple-500/20 text-purple-400 text-[8px] px-1 py-0">AI ?</Badge>
                            )}
                          </div>
                          <p className={`text-[10px] ${textSecondaryClass}`}>
                            {participant.items_distributed || 0} items in locker
                            {participant.status && ` ï¿½ ${participant.status}`}
                          </p>
                        </div>
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                          selectedTags.includes(participant.surfer_id)
                            ? 'bg-cyan-500 border-cyan-500'
                            : isLight ? 'border-gray-300' : 'border-zinc-600'
                        }`}>
                          {selectedTags.includes(participant.surfer_id) && <Check className="w-3.5 h-3.5 text-white" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-3">
                  <p className={`text-xs ${textSecondaryClass}`}>
                    No session participants. <button onClick={() => { setShowTaggingModal(false); setShowLinkSessionModal(true); fetchRecentSessions(); }} className="text-cyan-400 underline">Link a session</button> first.
                  </p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowTaggingModal(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                // Phase 3: Combined Tag + Assign flow
                if (selectedTags.length === 0) {
                  toast.warning('Select at least one surfer');
                  return;
                }
                try {
                  // 1. Confirm AI tags (if any AI suggestions were selected)
                  const aiIds = aiTagSuggestions.map(s => s.profile_id);
                  const selectedAiTags = selectedTags.filter(id => aiIds.includes(id));
                  if (selectedAiTags.length > 0) {
                    await apiClient.post(`/ai/confirm-tags?photographer_id=${user?.id}`, {
                      gallery_item_id: selectedItem.id,
                      surfer_ids: selectedAiTags
                    });
                  }
                  // 2. Assign item to each selected surfer's locker (silent mode for batch)
                  for (const surferId of selectedTags) {
                    try {
                      await handleAssignItemToSurfer(selectedItem.id, surferId, true);
                    } catch (e) {
                      // Silently skip duplicates (idempotent endpoint)
                    }
                  }
                  toast.success(`Tagged & assigned to ${selectedTags.length} surfer(s)!`);
                  setShowTaggingModal(false);
                  setSelectedItem(null);
                  setSelectedTags([]);
                  setAiTagSuggestions([]);
                  fetchGallery();
                  fetchSessionParticipants();
                } catch (error) {
                  toast.error('Failed to complete tag & assign');
                }
              }}
              disabled={selectedTags.length === 0}
              className="bg-gradient-to-r from-purple-400 via-cyan-500 to-emerald-500 text-black font-medium"
            >
              <Send className="w-4 h-4 mr-2" />
              Tag & Assign ({selectedTags.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default TaggingAssignModal;
