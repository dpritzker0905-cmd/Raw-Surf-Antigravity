import React from 'react';
import { Users, Clock, DollarSign, ImageIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export const SessionPricingModal = ({
  isOpen, onClose, pricing, setPricing, handleSavePricing,
  isLight, textPrimaryClass, textSecondaryClass, borderClass, inputBgClass
}) => {
  return (
      <Dialog open={showPricingModal} onOpenChange={setShowPricingModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={textPrimaryClass}>Live Session Pricing</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className={`text-sm ${textSecondaryClass}`}>
              Set your default pricing for live sessions. All prices are in credits (1 credit = $1).
            </p>
            
            <div className={`p-4 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
              <h4 className={`font-medium ${textPrimaryClass} mb-3`}>Live Session Pricing</h4>
              <div className="space-y-3">
                <div>
                  <Label className={textSecondaryClass}>Buy-in Price (credits)</Label>
                  <Input
                    type="number"
                    value={pricing.live_buyin_price}
                    onChange={(e) => setPricing({ ...pricing, live_buyin_price: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                  <p className={`text-xs ${textSecondaryClass} mt-1`}>Price for surfers to join your live session</p>
                </div>
                <div>
                  <Label className={textSecondaryClass}>Price per Photo (credits)</Label>
                  <Input
                    type="number"
                    value={pricing.live_photo_price}
                    onChange={(e) => setPricing({ ...pricing, live_photo_price: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                  <p className={`text-xs ${textSecondaryClass} mt-1`}>Additional cost per photo after buy-in</p>
                </div>
                <div>
                  <Label className={textSecondaryClass}>Photos Included in Buy-in</Label>
                  <Input
                    type="number"
                    value={pricing.photo_package_size}
                    onChange={(e) => setPricing({ ...pricing, photo_package_size: parseInt(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                  <p className={`text-xs ${textSecondaryClass} mt-1`}>Number of free photos included with session buy-in (0 = none)</p>
                </div>
              </div>
            </div>
            
            <div className={`p-3 rounded-lg ${isLight ? 'bg-blue-50' : 'bg-blue-500/10'}`}>
              <p className={`text-sm ${isLight ? 'text-blue-800' : 'text-blue-400'}`}>
                <strong>Note:</strong> Booking rates are managed in the <a href="/photographer/bookings" className="underline">Bookings Manager</a>.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPricingModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSavePricing}
              className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black"
            >
              Save Pricing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
};

export const GalleryCreatedModal = ({
  isOpen, onClose, lastCreatedGallery, navigate,
  isLight, textPrimaryClass, textSecondaryClass, borderClass
}) => {
  return (
      <Dialog open={showGalleryCreatedModal} onOpenChange={setShowGalleryCreatedModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <ImageIcon className="w-5 h-5 text-green-400" />
              Gallery Created!
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className={`p-4 rounded-lg ${isLight ? 'bg-green-50' : 'bg-green-500/10'} border border-green-500/30`}>
              <p className={textPrimaryClass}>
                Your live session has ended and a new gallery has been automatically created:
              </p>
              <h3 className="text-xl font-bold text-green-400 mt-2">
                {lastCreatedGallery?.title}
              </h3>
            </div>
            
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                <Users className={`w-5 h-5 mx-auto mb-1 ${textSecondaryClass}`} />
                <p className={`text-lg font-bold ${textPrimaryClass}`}>{lastCreatedGallery?.total_surfers || 0}</p>
                <p className={`text-xs ${textSecondaryClass}`}>Surfers</p>
              </div>
              <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                <Clock className={`w-5 h-5 mx-auto mb-1 ${textSecondaryClass}`} />
                <p className={`text-lg font-bold ${textPrimaryClass}`}>{lastCreatedGallery?.duration_mins || 0}m</p>
                <p className={`text-xs ${textSecondaryClass}`}>Duration</p>
              </div>
              <div className={`p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                <DollarSign className={`w-5 h-5 mx-auto mb-1 text-green-400`} />
                <p className={`text-lg font-bold text-green-400`}>${lastCreatedGallery?.total_earnings?.toFixed(2) || '0.00'}</p>
                <p className={`text-xs ${textSecondaryClass}`}>Earned</p>
              </div>
            </div>
            
            <p className={`text-sm ${textSecondaryClass}`}>
              Upload your photos to this gallery and set per-gallery pricing to sell them to surfers who attended.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGalleryCreatedModal(false)}>
              Close
            </Button>
            <Button aria-label="Image Icon"
              onClick={() => {
                setShowGalleryCreatedModal(false);
                navigate(`/photographer/galleries/${lastCreatedGallery?.id}`);
              }}
              className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black"
            >
              <ImageIcon className="w-4 h-4 mr-2" />
              Upload Photos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
};
