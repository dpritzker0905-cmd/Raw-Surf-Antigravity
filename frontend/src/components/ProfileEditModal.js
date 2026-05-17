import React from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

/**
 * Edit Profile modal - allows users to update their profile info.
 * Extracted from Profile.js to reduce god-component complexity.
 */
export var ProfileEditModal = ({
  isOpen,
  onClose,
  editData,
  setEditData,
  onSave,
  editLoading,
}) => (
  <Dialog open={isOpen} onOpenChange={onClose}>
    <DialogContent className="bg-zinc-900 border-zinc-800 border-t text-white max-w-md !fixed !bottom-[70px] !top-auto !translate-y-0 rounded-t-2xl rounded-b-none max-h-[calc(100dvh-6rem)] flex flex-col p-0">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800 flex-shrink-0">
        <button
          onClick={() => onClose(false)}
          className="text-gray-400 hover:text-white text-sm"
        >
          Cancel
        </button>
        <DialogTitle className="text-lg font-bold">Edit Profile</DialogTitle>
        <Button aria-label="Loader2"
          onClick={onSave}
          disabled={editLoading}
          size="sm"
          className="bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold px-4"
          data-testid="save-profile-btn"
        >
          {editLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
        </Button>
      </div>
      
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-6">
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-1.5 block">Name</label>
            <Input
              value={editData.full_name}
              onChange={(e) => setEditData(prev => ({ ...prev, full_name: e.target.value }))}
              className="bg-zinc-800 border-zinc-700 text-white h-11"
              data-testid="edit-name-input"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-1.5 block">Bio</label>
            <Textarea
              value={editData.bio}
              onChange={(e) => setEditData(prev => ({ ...prev, bio: e.target.value }))}
              className="bg-zinc-800 border-zinc-700 text-white min-h-[70px]"
              placeholder="Tell us about yourself..."
              data-testid="edit-bio-input"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-1.5 block">Home Break</label>
            <Input
              value={editData.location}
              onChange={(e) => setEditData(prev => ({ ...prev, location: e.target.value }))}
              className="bg-zinc-800 border-zinc-700 text-white h-11"
              placeholder="e.g., Cocoa Beach Pier"
              data-testid="edit-location-input"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-1.5 block">Instagram</label>
            <Input
              value={editData.instagram_url}
              onChange={(e) => setEditData(prev => ({ ...prev, instagram_url: e.target.value }))}
              className="bg-zinc-800 border-zinc-700 text-white h-11"
              placeholder="@yourusername"
              data-testid="edit-instagram-input"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-1.5 block">Website</label>
            <Input
              value={editData.website_url}
              onChange={(e) => setEditData(prev => ({ ...prev, website_url: e.target.value }))}
              className="bg-zinc-800 border-zinc-700 text-white h-11"
              placeholder="https://yourwebsite.com"
              data-testid="edit-website-input"
            />
          </div>
          
          {/* Surfer Identification Section */}
          <div className="pt-4 border-t border-zinc-700">
            <p className="text-sm text-cyan-400 font-medium mb-3 flex items-center gap-2">
              <Camera className="w-4 h-4" />
              Photographer Identification
            </p>
            <p className="text-xs text-gray-500 mb-4">
              Help photographers identify you in the water during live sessions
            </p>
            
            {/* Stance */}
            <div className="mb-4">
              <label className="text-sm text-gray-400 mb-1.5 block">Stance</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditData(prev => ({ ...prev, stance: 'regular' }))}
                  className={`flex-1 py-2.5 rounded-lg border transition-all ${
                    editData.stance === 'regular' 
                      ? 'bg-purple-500/20 border-purple-500 text-purple-400' 
                      : 'bg-zinc-800 border-zinc-700 text-gray-400 hover:border-zinc-600'
                  }`}
                >
                  Regular
                </button>
                <button
                  type="button"
                  onClick={() => setEditData(prev => ({ ...prev, stance: 'goofy' }))}
                  className={`flex-1 py-2.5 rounded-lg border transition-all ${
                    editData.stance === 'goofy' 
                      ? 'bg-purple-500/20 border-purple-500 text-purple-400' 
                      : 'bg-zinc-800 border-zinc-700 text-gray-400 hover:border-zinc-600'
                  }`}
                >
                  Goofy
                </button>
              </div>
            </div>
            
            {/* Wetsuit Color */}
            <div className="mb-4">
              <label className="text-sm text-gray-400 mb-1.5 block">Wetsuit Color</label>
              <Input
                value={editData.wetsuit_color}
                onChange={(e) => setEditData(prev => ({ ...prev, wetsuit_color: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-white h-11"
                placeholder="e.g., Full black, Blue/black, Black with red stripe"
                data-testid="edit-wetsuit-input"
              />
            </div>
            
            {/* Rash Guard Color */}
            <div>
              <label className="text-sm text-gray-400 mb-1.5 block">Rash Guard Color</label>
              <Input
                value={editData.rash_guard_color}
                onChange={(e) => setEditData(prev => ({ ...prev, rash_guard_color: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-white h-11"
                placeholder="e.g., White, Red, Blue with logo"
                data-testid="edit-rashguard-input"
              />
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
);
