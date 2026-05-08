import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Badge } from '../ui/badge';
import { Loader2, ShoppingBag, BarChart3
} from 'lucide-react';

const SalesDashboardModal = ({
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
      {/* Phase 3: Sales Dashboard Modal */}
      <Dialog open={showSalesDashboard} onOpenChange={setShowSalesDashboard}>
        <DialogContent className={`max-w-3xl max-h-[80vh] overflow-y-auto ${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${textPrimaryClass}`}>
              <BarChart3 className="w-5 h-5 text-cyan-400" />
              Sales Dashboard
            </DialogTitle>
          </DialogHeader>
          
          {loadingSales ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Stats Summary */}
              <div className="grid grid-cols-3 gap-4">
                <Card className={cardBgClass}>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-400">${salesData.stats?.total_revenue?.toFixed(2) || '0.00'}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Total Revenue</p>
                  </CardContent>
                </Card>
                <Card className={cardBgClass}>
                  <CardContent className="p-4 text-center">
                    <p className={`text-2xl font-bold ${textPrimaryClass}`}>{salesData.stats?.total_purchases || 0}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Total Sales</p>
                  </CardContent>
                </Card>
                <Card className={cardBgClass}>
                  <CardContent className="p-4 text-center">
                    <p className={`text-2xl font-bold text-amber-400`}>${salesData.stats?.avg_sale?.toFixed(2) || '0.00'}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Avg Sale</p>
                  </CardContent>
                </Card>
              </div>
              
              {/* Sales List */}
              <div>
                <h4 className={`text-sm font-medium mb-3 ${textSecondaryClass}`}>Recent Sales</h4>
                {salesData.sales?.length > 0 ? (
                  <div className="space-y-2">
                    {salesData.sales.map(sale => (
                      <div key={sale.id} className={`flex items-center gap-3 p-3 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-zinc-800/50'}`}>
                        <img loading="lazy" decoding="async" src={sale.item_thumbnail} alt="" className="w-12 h-12 rounded object-cover" />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${textPrimaryClass}`}>{sale.item_title || 'Untitled'}</p>
                          <div className="flex items-center gap-2 text-xs">
                            <img loading="lazy" decoding="async" src={sale.buyer_avatar || '/default-avatar.png'} alt="" className="w-4 h-4 rounded-full" />
                            <span className={textSecondaryClass}>{sale.buyer_name}</span>
                            <Badge variant="outline" className="text-[10px]">{sale.quality_tier}</Badge>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-green-400 font-medium">${sale.amount?.toFixed(2)}</p>
                          <p className={`text-[10px] ${textSecondaryClass}`}>
                            {sale.purchased_at ? new Date(sale.purchased_at).toLocaleDateString() : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`text-center py-8 ${textSecondaryClass}`}>
                    <ShoppingBag className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No sales yet</p>
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

export default SalesDashboardModal;
