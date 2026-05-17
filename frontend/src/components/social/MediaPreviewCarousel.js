/**
 * MediaPreviewCarousel — Extracted from CreatePostModal.js (v82)
 * Handles image/video preview display with swipe, carousel navigation,
 * and thumbnail strip for multi-image posts.
 */
import React from 'react';
import { X } from 'lucide-react';

var MediaPreviewCarousel = ({
  previewUrls,
  currentPreviewIndex,
  setCurrentPreviewIndex,
  mediaType,
  selectedFiles,
  removeImage,
  onClearAll,
  photoInputRef,
}) => {
  return (
    <div className="space-y-3">
      <div className="relative">
        {mediaType === 'video' ? (
          <video
            src={previewUrls[0]}
            controls
            className="w-full aspect-video object-cover rounded-lg"
          />
        ) : (
          <div
            onTouchStart={(e) => {
              if (e.touches?.length === 1) {
                e.currentTarget._touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
              }
            }}
            onTouchEnd={(e) => {
              if (e.changedTouches?.length !== 1) return;
              const start = e.currentTarget._touchStart;
              if (!start) return;
              const dx = e.changedTouches[0].clientX - start.x;
              const dy = Math.abs(e.changedTouches[0].clientY - start.y);
              if (Math.abs(dx) > 40 && dy < 80 && previewUrls.length > 1) {
                if (dx < 0 && currentPreviewIndex < previewUrls.length - 1) {
                  setCurrentPreviewIndex(prev => prev + 1);
                } else if (dx > 0 && currentPreviewIndex > 0) {
                  setCurrentPreviewIndex(prev => prev - 1);
                }
              }
            }}
            onMouseDown={(e) => {
              e.currentTarget._dragStart = e.clientX;
              e.currentTarget._dragging = true;
            }}
            onMouseUp={(e) => {
              if (!e.currentTarget._dragging) return;
              e.currentTarget._dragging = false;
              const dx = e.clientX - (e.currentTarget._dragStart || 0);
              if (Math.abs(dx) > 40 && previewUrls.length > 1) {
                if (dx < 0 && currentPreviewIndex < previewUrls.length - 1) {
                  setCurrentPreviewIndex(prev => prev + 1);
                } else if (dx > 0 && currentPreviewIndex > 0) {
                  setCurrentPreviewIndex(prev => prev - 1);
                }
              }
            }}
            onMouseLeave={(e) => { e.currentTarget._dragging = false; }}
            style={{ touchAction: 'pan-y', cursor: previewUrls.length > 1 ? 'grab' : 'default' }}
          >
          <img loading="lazy" decoding="async"
            src={previewUrls[currentPreviewIndex]}
            alt={`Preview ${currentPreviewIndex + 1}`}
            className="w-full aspect-video object-cover rounded-lg"
            draggable={false}
          />
        
        {previewUrls.length > 1 && (
          <>
            <button aria-label="Previous image"
              onClick={() => setCurrentPreviewIndex(prev => (prev - 1 + previewUrls.length) % previewUrls.length)}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/70 rounded-full hover:bg-black"
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button aria-label="Next image"
              onClick={() => setCurrentPreviewIndex(prev => (prev + 1) % previewUrls.length)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/70 rounded-full hover:bg-black"
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
              {previewUrls.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentPreviewIndex(idx)}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    idx === currentPreviewIndex ? 'bg-white' : 'bg-white/50'
                  }`}
                />
              ))}
            </div>
          </>
        )}
        
        {previewUrls.length > 1 && (
          <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded text-xs text-white">
            {currentPreviewIndex + 1} / {previewUrls.length}
          </div>
        )}
        </div>
      )}
      </div>
      
      {/* Thumbnail strip */}
      {previewUrls.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {previewUrls.map((url, idx) => (
            <div key={idx} className="relative flex-shrink-0">
              <button
                onClick={() => setCurrentPreviewIndex(idx)}
                className={`w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                  idx === currentPreviewIndex ? 'border-blue-500' : 'border-transparent'
                }`}
              >
                <img loading="lazy" decoding="async" src={url} alt={`Thumb ${idx + 1}`} className="w-full h-full object-cover" />
              </button>
              <button
                onClick={() => removeImage(idx)}
                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
          {previewUrls.length < 10 && mediaType === 'image' && (
            <button aria-label="Add more photos"
              onClick={() => photoInputRef.current?.click()}
              className="w-16 h-16 rounded-lg border-2 border-dashed border-zinc-600 flex items-center justify-center hover:border-zinc-500 transition-colors flex-shrink-0"
            >
              <svg className="w-6 h-6 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}
        </div>
      )}
      
      {/* Single image controls */}
      {previewUrls.length === 1 && (
        <div className="flex justify-between items-center">
          <button
            onClick={onClearAll}
            className="text-sm text-red-400 hover:text-red-300"
          >
            Remove
          </button>
          {mediaType === 'image' && (
            <button
              onClick={() => photoInputRef.current?.click()}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              + Add more photos
            </button>
          )}
        </div>
      )}
      
      {/* Video optimization notice */}
      {mediaType === 'video' && (
        <p className="text-xs text-blue-400">
          Videos over 1080p will be automatically optimized
        </p>
      )}
    </div>
  );
};

export default MediaPreviewCarousel;
