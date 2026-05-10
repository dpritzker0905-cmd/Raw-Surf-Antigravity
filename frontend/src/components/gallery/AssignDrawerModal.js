import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Users, ArrowRight, UserPlus
} from 'lucide-react';
import { getFullUrl } from '../../utils/media';

const AssignDrawerModal = ({
  showPricingModal, setShowPricingModal, showEditModal, setShowEditModal,
  showTaggingModal, setShowTaggingModal, showItemPricingModal, setShowItemPricingModal,
  showSalesDashboard, setShowSalesDashboard, showClientActivity, setShowClientActivity,
  showLinkSessionModal, setShowLinkSessionModal, showAssignDrawer, setShowAssignDrawer,
  selectedItem, setSelectedItem, aiTagSuggestions, setAiTagSuggestions,
  selectedTags, setSelectedTags, analyzingPhoto, gallery, setGallery,
  pricing, setPricing, editData, setEditData, itemCustomPrice, setItemCustomPrice,
  handleSavePricing, handleSaveEdit, handleAnalyzePhoto, toggleTagSelection,
  handleConfirmTags, handleSetCustomPrice, handleAssignItemToSurfer,
  assigningItem, setAssigningItem, salesData, clientsData, loadingSales, loadingSessions,
  sessionParticipants, distributing, recentSessions, handleLinkSession,
  fetchRecentSessions, user, galleryId, isLight, textPrimaryClass,
  textSecondaryClass, borderClass, inputBgClass, cardBgClass, navigate,
  totalGalleryItems, showPricing
}) => {
  return (
    <>
      {/* ============ ASSIGN DRAWER (Individual Item ? Surfer) ============ */}
      <Dialog open={showAssignDrawer} onOpenChange={setShowAssignDrawer}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-w-md`}>
          <DialogHeader>
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <UserPlus className="w-5 h-5 text-purple-400" />
              Assign to Surfer
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {assigningItem && (
              <div className="flex justify-center mb-4">
                <img loading="lazy" decoding="async" 
                  src={getFullUrl(assigningItem.preview_url)} 
                  alt="Item to assign" 
                  className="max-h-32 rounded-lg object-contain"
                />
              </div>
            )}
            
            <p className={`text-sm ${textSecondaryClass}`}>
              Select a session participant to assign this photo to their Locker:
            </p>
            
            {sessionParticipants.length > 0 ? (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {sessionParticipants.map((participant) => (
                  <div
                    key={participant.surfer_id}
                    onClick={() => assigningItem && handleAssignItemToSurfer(assigningItem.id, participant.surfer_id)}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      isLight ? 'bg-gray-50 hover:bg-purple-50 hover:ring-2 hover:ring-purple-500/30' : 'bg-zinc-800 hover:bg-zinc-700 hover:ring-2 hover:ring-purple-500/30'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full overflow-hidden bg-zinc-700 flex-shrink-0">
                      {participant.avatar_url ? (
                        <img loading="lazy" decoding="async" src={getFullUrl(participant.avatar_url)} alt={participant.full_name} className="w-full h-full object-cover" />
                      ) : (
                        <Users className="w-4 h-4 m-auto mt-2.5 text-zinc-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${textPrimaryClass}`}>{participant.full_name}</p>
                      <p className={`text-xs ${textSecondaryClass}`}>{participant.items_distributed} items in locker</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-purple-400" />
                  </div>
                ))}
              </div>
            ) : (
              <div className={`text-center py-6 ${textSecondaryClass}`}>
                <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No session participants available</p>
                <p className="text-xs mt-1">Link this gallery to a session first</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAssignDrawer(false); setAssigningItem(null); }}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AssignDrawerModal;
