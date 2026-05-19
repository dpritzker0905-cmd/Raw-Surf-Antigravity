/**
 * GalleryFolderList -- Extracted from GalleryPage.js
 * Renders the grid of session/album folder cards with thumbnails,
 * session type badges, action buttons (rename/delete/thumbnail/link), and roster cards.
 */
import React, { useState } from 'react';
import {
  Camera, Image, MapPin, Calendar, Trash2, Edit3, ImagePlus, Link2, Plus, Folder
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { SessionRosterCard } from './SessionRosterCard';
import { getFullUrl } from '../../utils/media';

export const GalleryFolderList = ({
  galleries,
  isGromParent,
  user,
  openGalleryDetail,
  handleOpenThumbnailPicker,
  handleOpenLinkSession,
  handleDeleteFolder,
  fetchGalleries,
  setFolderToRename,
  setNewFolderName,
  setShowRenameFolderModal,
  setShowCreateFolderModal,
}) => {
  const [brokenCoverImages, setBrokenCoverImages] = useState(new Set());

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Folder className="w-5 h-5 text-cyan-400" />
          {isGromParent ? 'Grom Archive' : 'Folders & Albums'}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">{galleries.length} folders</span>
          <Button aria-label="Add"
            onClick={() => {
              setNewFolderName('');
              setShowCreateFolderModal(true);
            }}
            size="sm"
            className="bg-cyan-500 hover:bg-cyan-600 text-black"
            data-testid="create-folder-btn"
          >
            <Plus className="w-4 h-4 mr-1" />
            New Folder
          </Button>
        </div>
      </div>
      
      {galleries.length === 0 ? (
        <div className="text-center py-8 bg-muted/50 rounded-lg">
          <Folder className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">No folders yet. Create one to organize your photos & videos.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {galleries.map((gal) => (
            <div 
              key={gal.id}
              className="bg-card rounded-xl overflow-hidden cursor-pointer active:scale-[0.98] hover:shadow-lg transition-all group relative border border-border"
              data-testid={`session-gallery-${gal.id}`}
              onClick={() => openGalleryDetail(gal)}
            >
              {/* Folder thumbnail */}
              <div className="aspect-[16/10] relative overflow-hidden">
                {(() => {
                  const coverUrl = (!brokenCoverImages.has(gal.id) && gal.cover_image_url) 
                    ? getFullUrl(gal.cover_image_url) 
                    : null;
                  
                  if (coverUrl) {
                    return (
                      <img loading="lazy" decoding="async" 
                        src={coverUrl} 
                        alt={gal.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={() => setBrokenCoverImages(prev => new Set([...prev, gal.id]))}
                      />
                    );
                  }
                  
                  if (gal.first_item_preview && !brokenCoverImages.has(`${gal.id}_fallback`)) {
                    return (
                      <img loading="lazy" decoding="async" 
                        src={getFullUrl(gal.first_item_preview)} 
                        alt={gal.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={() => setBrokenCoverImages(prev => new Set([...prev, `${gal.id}_fallback`]))}
                      />
                    );
                  }
                  
                  if (gal.item_count > 0) {
                    return (
                      <div className="w-full h-full bg-gradient-to-br from-cyan-500/15 via-blue-500/10 to-purple-500/15 flex flex-col items-center justify-center gap-2">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/30 to-blue-500/30 flex items-center justify-center">
                          <Camera className="w-7 h-7 text-cyan-400" />
                        </div>
                        <span className="text-xs text-muted-foreground font-medium">{gal.item_count} {gal.item_count === 1 ? 'item' : 'items'} inside</span>
                      </div>
                    );
                  }
                  
                  return (
                    <div className="w-full h-full bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-purple-500/10 flex flex-col items-center justify-center gap-2">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                        <Camera className="w-7 h-7 text-cyan-500/60" />
                      </div>
                      <span className="text-xs text-muted-foreground/60 font-medium">No items yet</span>
                    </div>
                  );
                })()}
                {/* Session type badges */}
                <div className="absolute top-2 left-2 flex gap-1.5">
                  {gal.live_session_id && (
                    <Badge className="bg-emerald-500/90 text-white text-[10px] shadow-sm px-1.5">
                      {"\u{1F7E2}"} Live
                    </Badge>
                  )}
                  {gal.session_type === 'booking' && !gal.live_session_id && (
                    <Badge className="bg-blue-500/90 text-white text-[10px] shadow-sm px-1.5">
                      {"\u{1F4C5}"} Booking
                    </Badge>
                  )}
                  {gal.session_type === 'on_demand' && !gal.live_session_id && (
                    <Badge className="bg-orange-500/90 text-white text-[10px] shadow-sm px-1.5">
                      {"\u26A1"} On-Demand
                    </Badge>
                  )}
                  {gal.session_type === 'manual' && !gal.live_session_id && (
                    <Badge className="bg-zinc-600/90 text-white text-[10px] shadow-sm px-1.5">
                      {"\u{1F4CB}"} Manual
                    </Badge>
                  )}
                </div>
                <div className="absolute bottom-2 left-2 flex gap-1.5">
                  <Badge className="bg-black/60 backdrop-blur-sm text-white text-xs">
                    <Image className="w-3 h-3 mr-1" />
                    {gal.item_count || 0}
                  </Badge>
                  {(gal.purchase_count || 0) > 0 && (
                    <Badge className="bg-green-500/80 backdrop-blur-sm text-white text-[10px]">
                      {"\u{1F4B0}"} {gal.purchase_count} sold
                    </Badge>
                  )}
                </div>
                {/* Folder actions -- visible on hover */}
                <div className="absolute top-2 right-2 z-10">
                  <div className="hidden group-hover:flex gap-1">
                    <button aria-label="Image Plus"
                      className="h-8 w-8 rounded-full bg-black/50 backdrop-blur-sm hover:bg-cyan-500/70 text-white flex items-center justify-center transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenThumbnailPicker(gal);
                      }}
                      title="Change thumbnail"
                      data-testid={`change-thumbnail-${gal.id}`}
                    >
                      <ImagePlus className="w-3.5 h-3.5" />
                    </button>
                    {!gal.live_session_id && (
                      <button aria-label="Link2"
                        className="h-8 w-8 rounded-full bg-black/50 backdrop-blur-sm hover:bg-purple-500/70 text-white flex items-center justify-center transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenLinkSession(gal);
                        }}
                        title="Link to session"
                        data-testid={`link-session-${gal.id}`}
                      >
                        <Link2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button aria-label="Edit3"
                      className="h-8 w-8 rounded-full bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white flex items-center justify-center transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFolderToRename(gal);
                        setNewFolderName(gal.title);
                        setShowRenameFolderModal(true);
                      }}
                      data-testid={`rename-folder-${gal.id}`}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button aria-label="Delete"
                      className="h-8 w-8 rounded-full bg-red-500/60 backdrop-blur-sm hover:bg-red-500/80 text-white flex items-center justify-center transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFolder(gal.id, gal.title);
                      }}
                      data-testid={`delete-folder-${gal.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
              {/* Folder info */}
              <div className="p-3">
                <h3 className="text-foreground font-semibold text-sm truncate">{gal.title}</h3>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  {gal.surf_spot_name && (
                    <span className="flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{gal.surf_spot_name}</span>
                    </span>
                  )}
                  {gal.session_date && (
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <Calendar className="w-3 h-3" />
                      {new Date(gal.session_date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  )}
                </div>
              </div>
              {/* Session Roster */}
              {gal.session_roster && gal.session_roster.length > 0 && (
                <SessionRosterCard 
                  roster={gal.session_roster}
                  sessionType={gal.session_type}
                  itemCount={gal.item_count}
                  compact={true}
                  galleryId={gal.id}
                  photographerId={user?.id}
                  onRosterUpdate={fetchGalleries}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default GalleryFolderList;
