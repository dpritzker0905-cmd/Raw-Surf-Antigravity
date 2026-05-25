/**
 * GalleryPageModals.js
 * Extracted folder management modals from GalleryPage.js
 * Includes: GalleryPricingModal, CreateFolderModal, RenameFolderModal,
 *           DeleteFolderModal, MoveFolderModal, CopyFolderModal, AddToGalleryModal
 */
import React from 'react';
import { Plus, Loader2, Image, Upload, Camera,
  Settings, Edit3, Folder, MapPin,
  Calendar, Trash2, Copy, Radio, Droplet
} from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { getFullUrl } from '../../utils/media';
import { usePersona } from '../../contexts/PersonaContext';


/**
 * GalleryFolderModals - All folder management modals extracted from GalleryPage
 */
export const GalleryFolderModals = ({
  // Gallery Pricing
  showGalleryPricingModal, setShowGalleryPricingModal,
  galleryPricing, setGalleryPricing,
  handleSaveGalleryPricing,
  showWatermarkSettings, setShowWatermarkSettings,
  watermarkPreviewUrl,
  watermarkSettings,
  canSellPhotos,
  navigate,
  // Add to Gallery
  showAddToGalleryModal, setShowAddToGalleryModal,
  selectedGallery, gallery, galleryItems,
  handleAddToGallery, setShowUploadModal,
  // Folder Create/Rename/Delete
  showCreateFolderModal, setShowCreateFolderModal,
  showRenameFolderModal, setShowRenameFolderModal,
  showDeleteFolderModal, setShowDeleteFolderModal,
  newFolderName, setNewFolderName,
  folderToRename, folderToDelete, setFolderToDelete,
  folderActionLoading,
  handleCreateFolder, handleRenameFolder, confirmDeleteFolder,
  // Move/Copy
  showMoveToFolderModal, setShowMoveToFolderModal,
  showCopyToFolderModal, setShowCopyToFolderModal,
  galleries, selectedItems,
  handleMoveToFolder, handleCopyToFolder,
  user,
}) => {
  const { getEffectiveRole } = usePersona();
  const effectiveRole = getEffectiveRole(user?.role);

  // Get platform fee based on user role and subscription tier
  const getPlatformFeePercent = (u) => {
    if (!u) return 20;

    let savedRates = null;
    try {
      const stored = localStorage.getItem('admin_commission_rates');
      if (stored) {
        savedRates = JSON.parse(stored);
      }
    } catch (e) {
      // Ignore
    }

    const role = effectiveRole || u.role;
    const tier = u.subscription_tier?.toLowerCase();
    const isPremium = tier === 'premium' || tier === 'tier_3';

    if (role === 'Approved Pro' || role === 'Verified Pro Photographer') {
      if (savedRates) {
        if (isPremium && savedRates.tier_3) return parseInt(savedRates.tier_3);
        if (savedRates.tier_2) return parseInt(savedRates.tier_2);
      }
      return isPremium ? 10 : 12;
    } else if (role === 'Photographer') {
      if (savedRates) {
        if (isPremium && savedRates.tier_3) return parseInt(savedRates.tier_3);
        if (savedRates.tier_2) return parseInt(savedRates.tier_2);
      }
      return isPremium ? 15 : 20;
    } else if (role === 'Hobbyist') {
      if (savedRates && savedRates.free) return parseInt(savedRates.free);
      return 25;
    }
    return 20;
  };
  const feePercent = getPlatformFeePercent(user);

  return (
    <>
      {/* Gallery Pricing Edit Modal */}
      <Dialog open={showGalleryPricingModal} onOpenChange={setShowGalleryPricingModal}>
        <DialogContent className="bg-background border-border text-foreground max-h-[90vh] overflow-y-auto max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Gallery Pricing \u{2014} All Service Types</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Each service type has <strong>independent</strong> resolution pricing. Changes here update your photographer profile defaults.
            </p>

 {/* +GG+GG+GG GALLERY (General) +GG+GG+GG */}
            <div className="p-4 rounded-lg bg-card border border-border">
              <h4 className="font-medium text-foreground mb-3 flex items-center gap-2 text-sm">
                <Image className="w-4 h-4 text-cyan-400" /> Gallery \u{2014} General Pricing
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">{String.fromCodePoint(0x1F4F7)} Photos</p>
                  {[
                    { label: 'Web (800px)', field: 'photo_price_web' },
                    { label: 'Standard (1920px)', field: 'photo_price_standard' },
                    { label: 'High Res', field: 'photo_price_high' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">{String.fromCodePoint(0x1F3AC)} Videos</p>
                  {[
                    { label: '720p HD', field: 'video_price_720p' },
                    { label: '1080p Full HD', field: 'video_price_1080p' },
                    { label: '4K Ultra HD', field: 'video_price_4k' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

 {/* +GG+GG+GG LIVE SESSION +GG+GG+GG */}
            <div className="p-4 rounded-lg border" style={{ background: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.2)' }}>
              <h4 className="font-medium text-foreground mb-3 flex items-center gap-2 text-sm">
                <Radio className="w-4 h-4 text-red-400" /> Live Session Pricing
              </h4>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">{String.fromCodePoint(0x1F4F7)} Photos</p>
                  {[
                    { label: 'Web (800px)', field: 'live_price_web' },
                    { label: 'Standard (1920px)', field: 'live_price_standard' },
                    { label: 'High Res', field: 'live_price_high' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">{String.fromCodePoint(0x1F3AC)} Videos</p>
                  {[
                    { label: '720p HD', field: 'live_video_720p' },
                    { label: '1080p Full HD', field: 'live_video_1080p' },
                    { label: '4K Ultra HD', field: 'live_video_4k' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-3 border-t" style={{ borderColor: 'rgba(239,68,68,0.2)' }}>
                <div>
                  <Label className="text-muted-foreground text-xs">Photos Included in Buy-In</Label>
                  <Input type="number" min="0" value={galleryPricing.live_session_photos_included} onChange={(e) => setGalleryPricing({ ...galleryPricing, live_session_photos_included: parseInt(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-20" />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Videos Included in Buy-In</Label>
                  <Input type="number" min="0" value={galleryPricing.live_session_videos_included} onChange={(e) => setGalleryPricing({ ...galleryPricing, live_session_videos_included: parseInt(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-20" />
                </div>
              </div>
            </div>

 {/* +GG+GG+GG ON-DEMAND +GG+GG+GG */}
            <div className="p-4 rounded-lg border" style={{ background: 'rgba(16,185,129,0.05)', borderColor: 'rgba(16,185,129,0.2)' }}>
              <h4 className="font-medium text-foreground mb-3 flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-emerald-400" /> On-Demand Pricing
              </h4>
              <div className="mb-3">
                <Label className="text-muted-foreground text-xs">Hourly Rate ($)</Label>
                <Input type="number" value={galleryPricing.on_demand_hourly_rate} onChange={(e) => setGalleryPricing({ ...galleryPricing, on_demand_hourly_rate: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-28" />
              </div>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">{String.fromCodePoint(0x1F4F7)} Photos</p>
                  {[
                    { label: 'Web (800px)', field: 'on_demand_price_web' },
                    { label: 'Standard (1920px)', field: 'on_demand_price_standard' },
                    { label: 'High Res', field: 'on_demand_price_high' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">{String.fromCodePoint(0x1F3AC)} Videos</p>
                  {[
                    { label: '720p HD', field: 'on_demand_video_720p' },
                    { label: '1080p Full HD', field: 'on_demand_video_1080p' },
                    { label: '4K Ultra HD', field: 'on_demand_video_4k' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-3 border-t" style={{ borderColor: 'rgba(16,185,129,0.2)' }}>
                <div>
                  <Label className="text-muted-foreground text-xs">Photos Included</Label>
                  <Input type="number" min="0" value={galleryPricing.on_demand_photos_included} onChange={(e) => setGalleryPricing({ ...galleryPricing, on_demand_photos_included: parseInt(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-20" />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Videos Included</Label>
                  <Input type="number" min="0" value={galleryPricing.on_demand_videos_included} onChange={(e) => setGalleryPricing({ ...galleryPricing, on_demand_videos_included: parseInt(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-20" />
                </div>
              </div>
            </div>

 {/* +GG+GG+GG BOOKING +GG+GG+GG */}
            <div className="p-4 rounded-lg border" style={{ background: 'rgba(59,130,246,0.05)', borderColor: 'rgba(59,130,246,0.2)' }}>
              <h4 className="font-medium text-foreground mb-3 flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-blue-400" /> Booking Pricing
              </h4>
              <div className="mb-3">
                <Label className="text-muted-foreground text-xs">Hourly Rate ($)</Label>
                <Input type="number" value={galleryPricing.booking_hourly_rate} onChange={(e) => setGalleryPricing({ ...galleryPricing, booking_hourly_rate: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-28" />
              </div>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">{String.fromCodePoint(0x1F4F7)} Photos</p>
                  {[
                    { label: 'Web (800px)', field: 'booking_price_web' },
                    { label: 'Standard (1920px)', field: 'booking_price_standard' },
                    { label: 'High Res', field: 'booking_price_high' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">{String.fromCodePoint(0x1F3AC)} Videos</p>
                  {[
                    { label: '720p HD', field: 'booking_video_720p' },
                    { label: '1080p Full HD', field: 'booking_video_1080p' },
                    { label: '4K Ultra HD', field: 'booking_video_4k' },
                  ].map(r => (
                    <div key={r.field}>
                      <Label className="text-muted-foreground text-xs">{r.label}</Label>
                      <Input type="number" value={galleryPricing[r.field]} onChange={(e) => setGalleryPricing({ ...galleryPricing, [r.field]: parseFloat(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-3 border-t" style={{ borderColor: 'rgba(59,130,246,0.2)' }}>
                <div>
                  <Label className="text-muted-foreground text-xs">Photos Included</Label>
                  <Input type="number" min="0" value={galleryPricing.booking_photos_included} onChange={(e) => setGalleryPricing({ ...galleryPricing, booking_photos_included: parseInt(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-20" />
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Videos Included</Label>
                  <Input type="number" min="0" value={galleryPricing.booking_videos_included} onChange={(e) => setGalleryPricing({ ...galleryPricing, booking_videos_included: parseInt(e.target.value) || 0 })} className="bg-background text-foreground border-border h-8 w-20" />
                </div>
              </div>
            </div>

            {/* Watermark Settings */}
            <div className="p-4 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Droplet className="w-4 h-4 text-cyan-400" />
                  <h4 className="font-medium text-foreground text-sm">Watermark Settings</h4>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowWatermarkSettings(true)} className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10" data-testid="pricing-modal-watermark-btn" aria-label="Settings">
                  <Settings className="w-3 h-3 mr-1" /> Configure
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative w-24 h-16 rounded-lg overflow-hidden flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-cyan-500/50 transition-all bg-background" onClick={() => setShowWatermarkSettings(true)} data-testid="pricing-watermark-preview">
                  {watermarkPreviewUrl ? (
                    <img loading="lazy" decoding="async" src={watermarkPreviewUrl} alt="Watermark preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Droplet className="w-6 h-6 text-cyan-400/30" />
                    </div>
                  )}
                </div>
                <div className="text-sm">
                  <p className="text-muted-foreground">Style: <span className="text-foreground">{watermarkSettings.style === 'text' ? 'Text' : watermarkSettings.style === 'logo' ? 'Logo' : 'Logo + Text'}</span></p>
                  <p className="text-muted-foreground">Position: <span className="text-foreground capitalize">{watermarkSettings.position.replace('-', ' ')}</span></p>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-green-500/10">
              <p className="text-sm text-muted-foreground">
                <strong className="text-green-400">Platform fee:</strong> {feePercent}% is deducted from each sale. You receive {100 - feePercent}% of all gallery purchases.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGalleryPricingModal(false)} className="border-border">
              Cancel
            </Button>
            <Button
              onClick={handleSaveGalleryPricing}
              className="bg-gradient-to-r from-purple-400 to-pink-500 text-black"
            >
              Save All Pricing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Photo to Gallery Modal */}
      {/* Add Photo to Gallery Modal \u{2014} Upload New + Pick from Library */}
      <Dialog open={showAddToGalleryModal} onOpenChange={setShowAddToGalleryModal}>
        <DialogContent className="bg-background border-border text-foreground max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Plus className="w-5 h-5 text-cyan-400" />
              Add Media to {selectedGallery?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {/* Upload New \u{2014} Primary CTA */}
            <button aria-label="Upload"
              onClick={() => {
                setShowAddToGalleryModal(false);
                setShowUploadModal(true);
              }}
              className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-dashed border-yellow-400/40 hover:border-yellow-400 bg-yellow-400/5 hover:bg-yellow-400/10 transition-all group"
            >
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-yellow-400 to-orange-400 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                <Upload className="w-5 h-5 text-black" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground">Upload from Device</p>
                <p className="text-xs text-muted-foreground">Camera roll, files, or take a new photo/video</p>
              </div>
            </button>

            {/* Divider */}
            {gallery.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">or pick from library</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            )}
            
            {gallery.length === 0 ? (
              <div className="text-center py-6 bg-muted/50 rounded-lg">
                <Camera className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Your library is empty \u{2014} upload your first photo above!</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 max-h-[40vh] overflow-y-auto rounded-lg">
                {gallery.filter(item => !galleryItems.find(gi => gi.id === item.id)).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleAddToGallery(item.id)}
                    className="relative aspect-square rounded-lg overflow-hidden bg-muted hover:ring-2 hover:ring-cyan-400 transition-all"
                  >
                    <img loading="lazy" decoding="async"
                      src={getFullUrl(item.thumbnail_url || item.preview_url)}
                      alt={item.title || 'Photo'}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-colors flex items-center justify-center">
                      <Plus className="w-6 h-6 text-white opacity-0 hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddToGalleryModal(false)} className="border-border">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Folder Modal */}
      {/* Create Folder Modal */}
      <Dialog open={showCreateFolderModal} onOpenChange={setShowCreateFolderModal}>
        <DialogContent className="bg-background border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Folder className="w-5 h-5 text-cyan-400" />
              Create New Folder
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label className="text-muted-foreground">Folder Name</Label>
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g., Pipeline Session 2024"
              className="bg-card text-foreground border-border mt-2"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateFolderModal(false)} className="border-border">
              Cancel
            </Button>
            <Button aria-label="Loader2"
              onClick={handleCreateFolder}
              disabled={folderActionLoading || !newFolderName.trim()}
              className="bg-cyan-500 hover:bg-cyan-600 text-black"
            >
              {folderActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Folder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Folder Modal */}
      {/* Rename Folder Modal */}
      <Dialog open={showRenameFolderModal} onOpenChange={setShowRenameFolderModal}>
        <DialogContent className="bg-background border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Edit3 className="w-5 h-5 text-yellow-400" />
              Rename Folder
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label className="text-muted-foreground">New Folder Name</Label>
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Enter new name"
              className="bg-card text-foreground border-border mt-2"
              onKeyDown={(e) => e.key === 'Enter' && handleRenameFolder()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRenameFolderModal(false)} className="border-border">
              Cancel
            </Button>
            <Button aria-label="Loader2"
              onClick={handleRenameFolder}
              disabled={folderActionLoading || !newFolderName.trim()}
              className="bg-yellow-500 hover:bg-yellow-600 text-black"
            >
              {folderActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Rename'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Modal */}
      {/* Delete Folder Confirmation Modal */}
      <Dialog open={showDeleteFolderModal} onOpenChange={setShowDeleteFolderModal}>
        <DialogContent className="bg-background border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-400" />
              Delete Folder
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-foreground">
              Are you sure you want to delete <span className="font-semibold">"{folderToDelete?.name}"</span>?
            </p>
            <p className="text-muted-foreground text-sm mt-2">
              Photos will be moved back to your main gallery.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setShowDeleteFolderModal(false);
                setFolderToDelete(null);
              }} 
              className="border-border text-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button aria-label="Loader2"
              onClick={confirmDeleteFolder}
              disabled={folderActionLoading}
              className="bg-red-500 hover:bg-red-600 text-white"
              data-testid="confirm-delete-folder"
            >
              {folderActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete Folder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to Folder Modal */}
      {/* Move to Folder Modal */}
      <Dialog open={showMoveToFolderModal} onOpenChange={setShowMoveToFolderModal}>
        <DialogContent className="bg-background border-border text-foreground max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Folder className="w-5 h-5 text-cyan-400" />
              Move {selectedItems.size} item(s) to folder
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-2">
            {galleries.length === 0 ? (
              <div className="text-center py-8 bg-muted/50 rounded-lg">
                <Folder className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">No folders yet</p>
                <Button aria-label="Add"
                  onClick={() => {
                    setShowMoveToFolderModal(false);
                    setShowCreateFolderModal(true);
                  }}
                  className="mt-3 bg-cyan-500 hover:bg-cyan-600 text-black"
                  size="sm"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Create Folder First
                </Button>
              </div>
            ) : (
              galleries.map((folder) => (
                <button aria-label="Folder"
                  key={folder.id}
                  onClick={() => handleMoveToFolder(folder.id)}
                  disabled={folderActionLoading}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-muted transition-colors text-left border border-border"
                >
                  <Folder className="w-5 h-5 text-cyan-400" />
                  <div className="flex-1">
                    <p className="text-foreground font-medium">{folder.title}</p>
                    <p className="text-muted-foreground text-xs">{folder.item_count || 0} photos</p>
                  </div>
                </button>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMoveToFolderModal(false)} className="border-border">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Copy to Folder Modal */}
      {/* Copy to Folder Modal */}
      <Dialog open={showCopyToFolderModal} onOpenChange={setShowCopyToFolderModal}>
        <DialogContent className="bg-background border-border text-foreground max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Copy className="w-5 h-5 text-cyan-400" />
              Copy {selectedItems.size} item(s) to folder
            </DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">Original photos will remain in your main gallery.</p>
          <div className="py-4 space-y-2">
            {galleries.length === 0 ? (
              <div className="text-center py-8 bg-muted/50 rounded-lg">
                <Folder className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">No folders yet</p>
                <Button aria-label="Add"
                  onClick={() => {
                    setShowCopyToFolderModal(false);
                    setShowCreateFolderModal(true);
                  }}
                  className="mt-3 bg-cyan-500 hover:bg-cyan-600 text-black"
                  size="sm"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Create Folder First
                </Button>
              </div>
            ) : (
              galleries.map((folder) => (
                <button aria-label="Folder"
                  key={folder.id}
                  onClick={() => handleCopyToFolder(folder.id)}
                  disabled={folderActionLoading}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-card hover:bg-muted transition-colors text-left border border-border"
                >
                  <Folder className="w-5 h-5 text-cyan-400" />
                  <div className="flex-1">
                    <p className="text-foreground font-medium">{folder.title}</p>
                    <p className="text-muted-foreground text-xs">{folder.item_count || 0} photos</p>
                  </div>
                </button>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCopyToFolderModal(false)} className="border-border">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
