/**
 * UploadPhotoModal - Bulk Photo/Video upload modal for photographers
 * Supports multi-file selection, drag-and-drop, and session-aware auto-pricing.
 * No per-file price or caption — pricing is resolved from gallery/session context.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Image, Video, Loader2, Folder, Upload, CheckCircle2, AlertCircle, Clock, Camera, Film, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';


// File status constants
const STATUS = {
  QUEUED: 'queued',
  UPLOADING: 'uploading',
  DONE: 'done',
  ERROR: 'error'
};

// Resolve pricing based on gallery context
function resolveUploadPricing(gallery, galleryPricing) {
  const defaults = { photoPrice: 5, videoPrice: 15, source: 'Gallery Default' };
  if (!galleryPricing) return defaults;

  if (gallery?.live_session_id) {
    return {
      photoPrice: galleryPricing.live_session_photo_price || 5,
      videoPrice: galleryPricing.video_price_1080p || 15,
      source: 'Live Session'
    };
  }

  if (gallery?.booking_id) {
    return {
      photoPrice: galleryPricing.on_demand_photo_price || 10,
      videoPrice: galleryPricing.video_price_1080p || 15,
      source: 'Booking'
    };
  }

  return {
    photoPrice: galleryPricing.photo_price_standard || 5,
    videoPrice: galleryPricing.video_price_1080p || 15,
    source: 'Gallery Default'
  };
}


export const UploadPhotoModal = ({ 
  isOpen, 
  onClose, 
  onUploaded, 
  targetFolderId = null, 
  targetFolderName = null, 
  galleries = [],
  galleryPricing = null,
  selectedGallery = null
}) => {
  const { user } = useAuth();
  const [files, setFiles] = useState([]); // Array of { id, file, preview, type, status, progress, error }
  const [uploading, setUploading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [selectedFolderId, setSelectedFolderId] = useState(targetFolderId);
  const [dragOver, setDragOver] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);

  const isPaidPhotographer = user?.subscription_tier && ['basic', 'premium'].includes(user.subscription_tier);
  const pricing = resolveUploadPricing(selectedGallery, galleryPricing);

  // Reset when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setFiles([]);
      setUploading(false);
      setCurrentIndex(-1);
      setUploadComplete(false);
      setSelectedFolderId(targetFolderId);
    }
  }, [isOpen, targetFolderId]);

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      files.forEach(f => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
    };
  }, [files]);

  const addFiles = useCallback((newFiles) => {
    const validFiles = [];
    
    for (const file of newFiles) {
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      
      if (!isVideo && !isImage) continue;
      
      // Check file size (100MB for video, 50MB for image)
      const maxSize = isVideo ? 100 * 1024 * 1024 : 50 * 1024 * 1024;
      if (file.size > maxSize) {
        toast.error(`${file.name} is too large (max ${maxSize / (1024 * 1024)}MB)`);
        continue;
      }

      validFiles.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file,
        preview: URL.createObjectURL(file),
        type: isVideo ? 'video' : 'image',
        status: STATUS.QUEUED,
        progress: 0,
        error: null
      });
    }

    if (validFiles.length === 0 && newFiles.length > 0) {
      toast.error('No valid files selected');
      return;
    }

    setFiles(prev => [...prev, ...validFiles]);
    setUploadComplete(false);
  }, []);

  const removeFile = useCallback((id) => {
    setFiles(prev => {
      const file = prev.find(f => f.id === id);
      if (file?.preview) URL.revokeObjectURL(file.preview);
      return prev.filter(f => f.id !== id);
    });
  }, []);

  // Handle file input
  const handleFileSelect = (e) => {
    if (e.target.files?.length) {
      addFiles(Array.from(e.target.files));
    }
    // Reset input so re-selecting same files works
    e.target.value = '';
  };

  // Drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files?.length) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  // Upload all files sequentially
  const handleUploadAll = async () => {
    const queuedFiles = files.filter(f => f.status === STATUS.QUEUED);
    if (queuedFiles.length === 0) return;

    setUploading(true);
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < queuedFiles.length; i++) {
      const fileEntry = queuedFiles[i];
      setCurrentIndex(i);

      // Mark as uploading
      setFiles(prev => prev.map(f => 
        f.id === fileEntry.id ? { ...f, status: STATUS.UPLOADING, progress: 0 } : f
      ));

      try {
        // Step 1: Upload file
        const formData = new FormData();
        formData.append('file', fileEntry.file);
        formData.append('user_id', user.id);
        formData.append('add_watermark_preview', 'true');

        const uploadResponse = await apiClient.post('/upload/photographer-gallery', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (progressEvent) => {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setFiles(prev => prev.map(f => 
              f.id === fileEntry.id ? { ...f, progress: percent } : f
            ));
          }
        });

        // Step 2: Create gallery item with auto-resolved price
        const filePrice = fileEntry.type === 'video' ? pricing.videoPrice : pricing.photoPrice;
        
        const itemData = {
          photographer_id: user.id,
          title: fileEntry.file.name.replace(/\.[^/.]+$/, ''), // filename without extension
          description: '',
          media_type: fileEntry.type,
          original_url: uploadResponse.data.original_url,
          preview_url: uploadResponse.data.preview_url || uploadResponse.data.original_url,
          thumbnail_url: uploadResponse.data.thumbnail_url || uploadResponse.data.preview_url,
          price: filePrice,
          is_for_sale: true,
          gallery_id: selectedFolderId || null
        };

        await apiClient.post('/gallery/items', itemData);

        // Mark as done
        setFiles(prev => prev.map(f => 
          f.id === fileEntry.id ? { ...f, status: STATUS.DONE, progress: 100 } : f
        ));
        successCount++;

      } catch (error) {
        logger.error('Upload error:', error);
        const msg = error.response?.data?.detail || 'Upload failed';
        setFiles(prev => prev.map(f => 
          f.id === fileEntry.id ? { ...f, status: STATUS.ERROR, error: msg } : f
        ));
        errorCount++;
      }
    }

    setUploading(false);
    setCurrentIndex(-1);
    setUploadComplete(true);

    if (successCount > 0) {
      const photoCount = files.filter(f => f.status === STATUS.DONE && f.type === 'image').length;
      const videoCount = files.filter(f => f.status === STATUS.DONE && f.type === 'video').length;
      const parts = [];
      if (photoCount) parts.push(`${photoCount} photo${photoCount > 1 ? 's' : ''}`);
      if (videoCount) parts.push(`${videoCount} video${videoCount > 1 ? 's' : ''}`);
      toast.success(`Uploaded ${parts.join(' & ')} successfully!`);
      onUploaded();
    }

    if (errorCount > 0) {
      toast.error(`${errorCount} file${errorCount > 1 ? 's' : ''} failed to upload`);
    }
  };

  // Counts
  const queuedCount = files.filter(f => f.status === STATUS.QUEUED).length;
  const doneCount = files.filter(f => f.status === STATUS.DONE).length;
  const errorCount = files.filter(f => f.status === STATUS.ERROR).length;
  const photoCount = files.filter(f => f.type === 'image').length;
  const videoCount = files.filter(f => f.type === 'video').length;
  const totalCount = files.length;

  // Global progress
  const globalProgress = totalCount > 0 
    ? Math.round(files.reduce((sum, f) => sum + (f.status === STATUS.DONE ? 100 : f.progress), 0) / totalCount)
    : 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!uploading) onClose(); }}>
      <DialogContent className="bg-background border-border text-foreground max-w-lg max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Upload className="w-5 h-5 text-cyan-400" />
            Upload Media
            {targetFolderName && (
              <span className="text-sm font-normal text-muted-foreground">→ {targetFolderName}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-3">
          {/* Pricing Info Banner */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20">
            <Info className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
            <div className="text-xs space-y-1">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1">
                  <Camera className="w-3.5 h-3.5 text-cyan-400" />
                  Photos: <strong className="text-foreground">${pricing.photoPrice.toFixed(2)}</strong>
                </span>
                <span className="flex items-center gap-1">
                  <Film className="w-3.5 h-3.5 text-purple-400" />
                  Videos: <strong className="text-foreground">${pricing.videoPrice.toFixed(2)}</strong>
                </span>
              </div>
              <p className="text-muted-foreground">
                Auto-priced from <span className="text-cyan-400 font-medium">{pricing.source}</span> settings
              </p>
            </div>
          </div>

          {/* Destination Folder (compact) */}
          {galleries && galleries.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedFolderId(null)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  !selectedFolderId 
                    ? 'bg-cyan-500 text-black' 
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                Root
              </button>
              {galleries.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => setSelectedFolderId(folder.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${
                    selectedFolderId === folder.id 
                      ? 'bg-cyan-500 text-black' 
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  <Folder className="w-3 h-3" />
                  {folder.title}
                </button>
              ))}
            </div>
          )}

          {/* Hidden file input - accepts multiple + video */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Drop Zone / Add Files Area */}
          {files.length === 0 ? (
            <button
              ref={dropZoneRef}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`w-full py-10 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-3 transition-all ${
                dragOver 
                  ? 'border-cyan-400 bg-cyan-500/10 scale-[1.01]' 
                  : 'border-border hover:border-cyan-400/50 bg-card'
              }`}
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center">
                <Upload className="w-7 h-7 text-cyan-400" />
              </div>
              <div className="text-center">
                <p className="text-foreground font-medium text-sm">Tap to select photos & videos</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Select multiple files at once • Videos up to {isPaidPhotographer ? '4K' : '1080p'}
                </p>
              </div>
            </button>
          ) : (
            <>
              {/* File Count Summary */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {photoCount > 0 && (
                    <span className="flex items-center gap-1 bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded-full">
                      <Camera className="w-3 h-3" /> {photoCount}
                    </span>
                  )}
                  {videoCount > 0 && (
                    <span className="flex items-center gap-1 bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-full">
                      <Film className="w-3 h-3" /> {videoCount}
                    </span>
                  )}
                  <span>{totalCount} file{totalCount !== 1 ? 's' : ''}</span>
                </div>
                {!uploading && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-cyan-400 hover:text-cyan-300 font-medium"
                  >
                    + Add more
                  </button>
                )}
              </div>

              {/* Thumbnail Grid */}
              <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto rounded-lg p-1">
                {files.map((f) => (
                  <div key={f.id} className="relative aspect-square rounded-lg overflow-hidden bg-muted group">
                    {f.type === 'video' ? (
                      <div className="w-full h-full bg-gradient-to-br from-purple-900/50 to-purple-800/30 flex items-center justify-center">
                        <Film className="w-6 h-6 text-purple-300" />
                      </div>
                    ) : (
                      <img 
                        src={f.preview} 
                        alt="" 
                        className="w-full h-full object-cover"
                      />
                    )}

                    {/* Status overlay */}
                    {f.status === STATUS.UPLOADING && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <div className="relative w-8 h-8">
                          <svg className="w-8 h-8 -rotate-90" viewBox="0 0 36 36">
                            <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-white/20" />
                            <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-cyan-400"
                              strokeDasharray={`${f.progress * 0.94} 100`} strokeLinecap="round" />
                          </svg>
                        </div>
                      </div>
                    )}
                    {f.status === STATUS.DONE && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <CheckCircle2 className="w-6 h-6 text-green-400" />
                      </div>
                    )}
                    {f.status === STATUS.ERROR && (
                      <div className="absolute inset-0 bg-red-900/40 flex items-center justify-center">
                        <AlertCircle className="w-6 h-6 text-red-400" />
                      </div>
                    )}

                    {/* Remove button - only when not uploading */}
                    {!uploading && f.status === STATUS.QUEUED && (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}
                        className="absolute top-1 right-1 p-0.5 bg-black/70 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    )}

                    {/* Video badge */}
                    {f.type === 'video' && f.status === STATUS.QUEUED && (
                      <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-purple-500/80 rounded text-[10px] text-white font-medium">
                        VID
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Upload Progress Bar */}
              {uploading && (
                <div className="space-y-2">
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-300"
                      style={{ width: `${globalProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Uploading {currentIndex + 1} of {queuedCount + doneCount}… {globalProgress}%
                  </p>
                </div>
              )}

              {/* Done Summary */}
              {uploadComplete && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                  <p className="text-xs text-green-300">
                    {doneCount} uploaded{errorCount > 0 ? ` • ${errorCount} failed` : ''}
                  </p>
                </div>
              )}
            </>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {!uploadComplete ? (
              <Button
                onClick={handleUploadAll}
                disabled={uploading || files.length === 0 || queuedCount === 0}
                className="flex-1 h-12 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold rounded-xl"
                data-testid="upload-submit"
              >
                {uploading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Uploading…
                  </span>
                ) : (
                  `Upload ${totalCount} file${totalCount !== 1 ? 's' : ''}`
                )}
              </Button>
            ) : (
              <Button
                onClick={onClose}
                className="flex-1 h-12 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold rounded-xl"
              >
                Done
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UploadPhotoModal;
