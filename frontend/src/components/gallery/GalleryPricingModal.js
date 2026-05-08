import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Image as ImageIcon, Video
} from 'lucide-react';

const GalleryPricingModal = ({
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
      {/* Pricing Modal */}
      <Dialog open={showPricingModal} onOpenChange={setShowPricingModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={textPrimaryClass}>Gallery Pricing</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className={`text-sm ${textSecondaryClass}`}>
              Set prices for this gallery. These prices apply to all items in this gallery.
            </p>
            
            {/* Photo Pricing */}
            <div className={`p-4 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
              <h4 className={`font-medium ${textPrimaryClass} mb-3 flex items-center gap-2`}>
                <ImageIcon className="w-4 h-4" /> Photo Pricing (Credits)
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className={textSecondaryClass}>Web</Label>
                  <Input
                    type="number"
                    value={pricing.price_web}
                    onChange={(e) => setPricing({ ...pricing, price_web: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                </div>
                <div>
                  <Label className={textSecondaryClass}>HD</Label>
                  <Input
                    type="number"
                    value={pricing.price_standard}
                    onChange={(e) => setPricing({ ...pricing, price_standard: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                </div>
                <div>
                  <Label className={textSecondaryClass}>4K</Label>
                  <Input
                    type="number"
                    value={pricing.price_high}
                    onChange={(e) => setPricing({ ...pricing, price_high: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                </div>
              </div>
            </div>
            
            {/* Video Pricing */}
            <div className={`p-4 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
              <h4 className={`font-medium ${textPrimaryClass} mb-3 flex items-center gap-2`}>
                <Video className="w-4 h-4" /> Video Pricing (Credits)
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className={textSecondaryClass}>720p</Label>
                  <Input
                    type="number"
                    value={pricing.price_720p}
                    onChange={(e) => setPricing({ ...pricing, price_720p: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                </div>
                <div>
                  <Label className={textSecondaryClass}>1080p</Label>
                  <Input
                    type="number"
                    value={pricing.price_1080p}
                    onChange={(e) => setPricing({ ...pricing, price_1080p: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                </div>
                <div>
                  <Label className={textSecondaryClass}>4K</Label>
                  <Input
                    type="number"
                    value={pricing.price_4k}
                    onChange={(e) => setPricing({ ...pricing, price_4k: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                </div>
              </div>
            </div>
            
            <div className={`p-3 rounded-lg ${isLight ? 'bg-green-50' : 'bg-green-500/10'}`}>
              <p className={`text-sm ${textSecondaryClass}`}>
                <strong className="text-green-400">Platform fee:</strong> 20% of each sale. You receive 80%.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPricingModal(false)}>Cancel</Button>
            <Button onClick={handleSavePricing} className="bg-gradient-to-r from-green-400 to-emerald-500 text-black">
              Save Pricing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default GalleryPricingModal;
