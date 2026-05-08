import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Users, Loader2
} from 'lucide-react';

const ClientActivityModal = ({
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
      {/* Phase 3: Client Activity Modal */}
      <Dialog open={showClientActivity} onOpenChange={setShowClientActivity}>
        <DialogContent className={`max-w-2xl max-h-[80vh] overflow-y-auto ${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${textPrimaryClass}`}>
              <Users className="w-5 h-5 text-green-400" />
              Client Activity
            </DialogTitle>
          </DialogHeader>
          
          {loadingSales ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-green-400" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Activity Stats */}
              <div className="grid grid-cols-3 gap-4">
                <Card className={cardBgClass}>
                  <CardContent className="p-4 text-center">
                    <p className={`text-2xl font-bold ${textPrimaryClass}`}>{clientsData.stats?.unique_viewers || 0}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Unique Viewers</p>
                  </CardContent>
                </Card>
                <Card className={cardBgClass}>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-red-400">{clientsData.stats?.total_favorites || 0}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Total Favorites</p>
                  </CardContent>
                </Card>
                <Card className={cardBgClass}>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-400">{clientsData.stats?.total_purchases || 0}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Purchases</p>
                  </CardContent>
                </Card>
              </div>
              
              {/* Clients List */}
              <div>
                <h4 className={`text-sm font-medium mb-3 ${textSecondaryClass}`}>Recent Clients</h4>
                {clientsData.clients?.length > 0 ? (
                  <div className="space-y-2">
                    {clientsData.clients.map(client => (
                      <div key={client.id} className={`flex items-center gap-3 p-3 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-zinc-800/50'}`}>
                        <img loading="lazy" decoding="async" src={client.avatar || '/default-avatar.png'} alt="" className="w-10 h-10 rounded-full object-cover" />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${textPrimaryClass}`}>{client.name}</p>
                          <p className={`text-xs ${textSecondaryClass}`}>
                            {client.last_activity ? `Last active: ${new Date(client.last_activity).toLocaleDateString()}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <div className="text-center">
                            <p className={textPrimaryClass}>{client.items_count}</p>
                            <p className={`text-[10px] ${textSecondaryClass}`}>Items</p>
                          </div>
                          <div className="text-center">
                            <p className="text-red-400">{client.favorites_count}</p>
                            <p className={`text-[10px] ${textSecondaryClass}`}>Favs</p>
                          </div>
                          <div className="text-center">
                            <p className="text-green-400">{client.purchased_count}</p>
                            <p className={`text-[10px] ${textSecondaryClass}`}>Bought</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`text-center py-8 ${textSecondaryClass}`}>
                    <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No client activity yet</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ClientActivityModal;
