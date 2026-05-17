/**
 * PhotographerLightbox - Simple full-screen lightbox for photographer gallery manager
 * Extracted from PhotographerGalleryManager.js for modularization (v74)
 */
import React from 'react';
import { X, ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';

var PhotographerLightbox = ({
  lightboxItem, setLightboxItem, filteredItems,
  handleOpenTagging,
}) => {
  if (!lightboxItem) return null;

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
      onClick={() => setLightboxItem(null)}
    >
      <button
        className="absolute top-4 right-4 text-white/70 hover:text-white p-2"
        onClick={() => setLightboxItem(null)}
      >
        <X className="w-8 h-8" />
      </button>
      
      {/* Navigation arrows */}
      {filteredItems.findIndex(i => i.id === lightboxItem.id) > 0 && (
        <button aria-label="Previous"
          className="absolute left-4 text-white/70 hover:text-white p-2"
          onClick={(e) => {
            e.stopPropagation();
            const idx = filteredItems.findIndex(i => i.id === lightboxItem.id);
            setLightboxItem(filteredItems[idx - 1]);
          }}
        >
          <ArrowLeft className="w-10 h-10" />
        </button>
      )}
      {filteredItems.findIndex(i => i.id === lightboxItem.id) < filteredItems.length - 1 && (
        <button aria-label="Next"
          className="absolute right-4 text-white/70 hover:text-white p-2"
          onClick={(e) => {
            e.stopPropagation();
            const idx = filteredItems.findIndex(i => i.id === lightboxItem.id);
            setLightboxItem(filteredItems[idx + 1]);
          }}
        >
          <ArrowLeft className="w-10 h-10 rotate-180" />
        </button>
      )}
      
      {/* Image */}
      <img loading="lazy" decoding="async"
        src={lightboxItem.preview_url || lightboxItem.original_url}
        alt={lightboxItem.title || 'Gallery item'}
        className="max-w-[90vw] max-h-[85vh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      
      {/* Bottom info bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <div>
            <p className="text-white font-medium">{lightboxItem.title || 'Untitled'}</p>
            <p className="text-white/60 text-sm">{new Date(lightboxItem.created_at).toLocaleDateString()}</p>
          </div>
          <div className="flex gap-2">
            <Button aria-label="AI Tag"
              size="sm"
              variant="ghost"
              className="text-white"
              onClick={(e) => { e.stopPropagation(); handleOpenTagging(lightboxItem); setLightboxItem(null); }}
            >
              <Sparkles className="w-5 h-5 mr-1" /> AI Tag
            </Button>
          </div>
        </div>
        <p className="text-center text-white/40 text-xs mt-2">&larr; &rarr; Navigate &middot; Esc Close</p>
      </div>
    </div>
  );
};

export default PhotographerLightbox;
