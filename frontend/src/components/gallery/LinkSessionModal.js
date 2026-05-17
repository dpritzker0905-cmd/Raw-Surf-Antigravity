import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Users, MapPin, Calendar, Loader2,
  Link2
} from 'lucide-react';

var LinkSessionModal = ({
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
      {/* ============ LINK SESSION MODAL ============ */}
      <Dialog open={showLinkSessionModal} onOpenChange={setShowLinkSessionModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-w-lg`}>
          <DialogHeader>
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <Link2 className="w-5 h-5 text-amber-400" />
              Link Gallery to Session
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className={`text-sm ${textSecondaryClass}`}>
              Select a recent session to link to this gallery. This enables automatic distribution of photos to surfers who participated.
            </p>
            
            {loadingSessions ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
              </div>
            ) : recentSessions.length > 0 ? (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {recentSessions.map((session) => (
                  <div
                    key={`${session.session_type || 'live'}-${session.id}`}
                    onClick={() => session.is_available && handleLinkSession(session)}
                    className={`flex items-center gap-3 p-3 rounded-lg transition-colors cursor-pointer ${
                      session.is_available
                        ? isLight ? 'bg-gray-50 hover:bg-gray-100 hover:ring-2 hover:ring-amber-500/30' : 'bg-zinc-800 hover:bg-zinc-700 hover:ring-2 hover:ring-amber-500/30'
                        : isLight ? 'bg-gray-100 opacity-50 cursor-not-allowed' : 'bg-zinc-800/30 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      !session.is_available ? 'bg-zinc-700' :
                      session.session_type === 'booking' ? 'bg-blue-500/20' :
                      session.session_type === 'on_demand' ? 'bg-orange-500/20' :
                      'bg-amber-500/20'
                    }`}>
                      <MapPin className={`w-5 h-5 ${
                        !session.is_available ? 'text-zinc-500' :
                        session.session_type === 'booking' ? 'text-blue-400' :
                        session.session_type === 'on_demand' ? 'text-orange-400' :
                        'text-amber-400'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${textPrimaryClass}`}>
                        {session.location_name || 'Unknown Location'}
                      </p>
                      <div className="flex items-center gap-2 text-xs">
                        <Calendar className="w-3 h-3" />
                        <span className={textSecondaryClass}>
                          {session.started_at ? new Date(session.started_at).toLocaleDateString('en-US', { 
                            month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
                          }) : 'Unknown date'}
                        </span>
                        {session.session_type && (
                          <Badge variant="outline" className={`text-[9px] px-1 py-0 ${
                            session.session_type === 'live' ? 'border-emerald-500/50 text-emerald-400' :
                            session.session_type === 'booking' ? 'border-blue-500/50 text-blue-400' :
                            'border-orange-500/50 text-orange-400'
                          }`}>
                            {session.session_type === 'live' ? '📸 Live' :
                             session.session_type === 'booking' ? '📅 Booking' :
                             '⚡ On-Demand'}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1">
                        <Users className="w-3 h-3 text-cyan-400" />
                        <span className={`text-xs ${textPrimaryClass}`}>{session.participant_count}</span>
                      </div>
                      {session.is_available ? (
                        <Badge variant="outline" className="border-amber-500/50 text-amber-400 text-[10px] mt-1">
                          Available
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-zinc-600 text-zinc-500 text-[10px] mt-1">
                          Linked
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`text-center py-8 ${textSecondaryClass}`}>
                <Calendar className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No recent sessions found</p>
                <p className="text-xs mt-1">Start a live session or create a booking first</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLinkSessionModal(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default LinkSessionModal;
