/**
 * UploadPhotoModal - Bulk Photo/Video upload for photographers
 * 
 * Best practices implemented:
 * - Multi-file selection with native file picker (mobile-friendly)
 * - Drag-and-drop on desktop
 * - Sequential upload with per-file progress + global progress bar
 * - Session-aware auto-pricing (no manual price/caption fields)
 * - Per-file retry on failure with specific error messages
 * - Dropdown folder selector (not inline buttons)
 * - Client-side pre-validation (type, size) before upload starts
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  X, Image, Video, Loader2, Folder, Upload, CheckCircle2, 
  AlertCircle, Camera, Film, Info, ChevronDown, RotateCcw, Plus
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';


const STATUS = {
  QUEUED: 'queued',
  UPLOADING: 'uploading',
  DONE: 'done',
  ERROR: 'error'
};

// Max sizes
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_IMAGE_SIZE = 50 * 1024 * 1024;  // 50MB

// Accepted MIME types matching backend ALLOWED_VIDEO_TYPES / ALLOWED_IMAGE_TYPES
const ACCEPTED_VIDEO = ['video/mp4', 'video/quicktime', 'video/webm', 'video/mpeg', 'video/x-m4v'];
const ACCEPTED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

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

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function validateFile(file) {
  const isVideo = file.type.startsWith('video/') || ACCEPTED_VIDEO.includes(file.type);
  const isImage = file.type.startsWith('image/') || ACCEPTED_IMAGE.includes(file.type);

  if (!isVideo && !isImage) {
    return { valid: false, error: `Unsupported format: ${file.type || 'unknown'}` };
  }

  const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
  if (file.size > maxSize) {
    return { valid: false, error: `Too large (${formatFileSize(file.size)}, max ${formatFileSize(maxSize)})` };
  }

  return { valid: true, type: isVideo ? 'video' : 'image' };
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
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [currentUploadId, setCurrentUploadId] = useState(null);
  const [selectedFolderId, setSelectedFolderId] = useState(targetFolderId);
  const [dragOver, setDragOver] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [folderDropdownOpen, setFolderDropdownOpen] = useState(false);
  const fileInputRef = useRef(null);
  const abortRef = useRef(false);

  const isPaidPhotographer = user?.subscription_tier && ['basic', 'premium'].includes(user.subscription_tier);
  const pricing = resolveUploadPricing(selectedGallery, galleryPricing);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setFiles([]);
      setUploading(false);
      setCurrentUploadId(null);
      setUploadComplete(false);
      setSelectedFolderId(targetFolderId);
      setFolderDropdownOpen(false);
      abortRef.current = false;
    }
  }, [isOpen, targetFolderId]);

  // Cleanup previews on unmount
  useEffect(() => {
    return () => files.forEach(f => f.preview && URL.revokeObjectURL(f.preview));
  }, [files]);

  // Get selected folder name for dropdown label
  const selectedFolderLabel = selectedFolderId 
    ? galleries.find(g => g.id === selectedFolderId)?.title || 'Selected Folder'
    : 'All Media (Root)';

  const addFiles = useCallback((newFiles) => {
    const entries = [];
    const errors = [];
    
    for (const file of newFiles) {
      const validation = validateFile(file);
      if (validation.valid) {
        entries.push({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          file,
          name: file.name,
          size: file.size,
          preview: validation.type === 'image' ? URL.createObjectURL(file) : null,
          type: validation.type,
          status: STATUS.QUEUED,
          progress: 0,
          error: null
        });
      } else {
        errors.push(`${file.name}: ${validation.error}`);
      }
    }

    if (errors.length > 0) {
      toast.error(`${errors.length} file${errors.length > 1 ? 's' : ''} rejected`, {
        description: errors.slice(0, 3).join('\n')
      });
    }

    if (entries.length > 0) {
      setFiles(prev => [...prev, ...entries]);
      setUploadComplete(false);
    }
  }, []);

  const removeFile = useCallback((id) => {
    setFiles(prev => {
      const file = prev.find(f => f.id === id);
      if (file?.preview) URL.revokeObjectURL(file.preview);
      return prev.filter(f => f.id !== id);
    });
  }, []);

  const handleFileSelect = (e) => {
    if (e.target.files?.length) addFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(Array.from(e.dataTransfer.files));
  };

  // Retry a single failed file
  const retryFile = useCallback((id) => {
    setFiles(prev => prev.map(f => 
      f.id === id ? { ...f, status: STATUS.QUEUED, progress: 0, error: null } : f
    ));
    setUploadComplete(false);
  }, []);

  // Upload single file
  const uploadSingleFile = async (fileEntry) => {
    setCurrentUploadId(fileEntry.id);
    setFiles(prev => prev.map(f => 
      f.id === fileEntry.id ? { ...f, status: STATUS.UPLOADING, progress: 0 } : f
    ));

    try {
      // Step 1: Upload file to storage
      const formData = new FormData();
      formData.append('file', fileEntry.file);
      formData.append('user_id', user.id);
      formData.append('add_watermark_preview', 'true');

      const uploadResponse = await apiClient.post('/upload/photographer-gallery', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: fileEntry.type === 'video' ? 300000 : 120000, // 5min for video, 2min for image
        onUploadProgress: (evt) => {
          const pct = Math.round((evt.loaded * 100) / evt.total);
          setFiles(prev => prev.map(f => 
            f.id === fileEntry.id ? { ...f, progress: Math.min(pct, 95) } : f // cap at 95% until server responds
          ));
        }
      });

      // Step 2: Create gallery item with auto pricing
      const filePrice = fileEntry.type === 'video' ? pricing.videoPrice : pricing.photoPrice;
      const createRes = await apiClient.post(`/gallery?photographer_id=${encodeURIComponent(user.id)}`, {
        title: fileEntry.name.replace(/\.[^/.]+$/, ''),
        description: '',
        media_type: fileEntry.type,
        original_url: uploadResponse.data.original_url,
        preview_url: uploadResponse.data.preview_url || uploadResponse.data.original_url,
        thumbnail_url: uploadResponse.data.thumbnail_url || uploadResponse.data.preview_url,
        price: filePrice,
        is_for_sale: true
      });

      // Step 3: Move item to selected folder if one is chosen
      if (selectedFolderId && createRes.data?.id) {
        try {
          await apiClient.patch(`/gallery/item/${createRes.data.id}/move?photographer_id=${encodeURIComponent(user.id)}`, {
            target_gallery_id: selectedFolderId
          });
        } catch (moveErr) {
          logger.warn('Could not move item to folder:', moveErr);
        }
      }

      setFiles(prev => prev.map(f => 
        f.id === fileEntry.id ? { ...f, status: STATUS.DONE, progress: 100 } : f
      ));
      return true;

    } catch (error) {
      logger.error('Upload error:', error);
      const detail = error.response?.data?.detail;
      const status = error.response?.status;
      let msg = 'Upload failed';
      if (typeof detail === 'string') msg = detail;
      else if (detail?.msg) msg = detail.msg;
      else if (status === 503) msg = 'Server starting up — tap retry in 30s';
      else if (status === 413) msg = 'File too large for server';
      else if (error.code === 'ECONNABORTED') msg = 'Upload timed out — try a smaller file or retry';
      else if (!error.response && error.message?.includes('Network')) msg = 'Server may be restarting — tap retry in 30s';
      else if (!error.response) msg = `Connection failed (${error.code || 'network'}) — retry shortly`;

      setFiles(prev => prev.map(f => 
        f.id === fileEntry.id ? { ...f, status: STATUS.ERROR, error: msg } : f
      ));
      return false;
    }
  };

  // Upload all queued files
  const handleUploadAll = async () => {
    const queued = files.filter(f => f.status === STATUS.QUEUED);
    if (queued.length === 0) return;

    setUploading(true);
    abortRef.current = false;
    let successCount = 0;

    for (const fileEntry of queued) {
      if (abortRef.current) break;
      const ok = await uploadSingleFile(fileEntry);
      if (ok) successCount++;
    }

    setUploading(false);
    setCurrentUploadId(null);
    setUploadComplete(true);

    if (successCount > 0) {
      onUploaded();
    }
  };

  // Counts
  const queuedFiles = files.filter(f => f.status === STATUS.QUEUED);
  const doneFiles = files.filter(f => f.status === STATUS.DONE);
  const errorFiles = files.filter(f => f.status === STATUS.ERROR);
  const totalCount = files.length;

  const globalProgress = totalCount > 0 
    ? Math.round(files.reduce((sum, f) => sum + (f.status === STATUS.DONE ? 100 : f.progress), 0) / totalCount)
    : 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!uploading && !open) onClose(); }}>
      <DialogContent className="bg-background border-border text-foreground max-w-lg max-h-[92vh] overflow-y-auto p-0">
        
        {/* Header */}
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Upload className="w-5 h-5 text-cyan-400" />
            Upload to Gallery
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 pb-4 space-y-3">

          {/* ── Folder Dropdown ── */}
          {galleries && galleries.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setFolderDropdownOpen(!folderDropdownOpen)}
                disabled={uploading}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground hover:border-cyan-500/40 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Folder className="w-4 h-4 text-yellow-400" />
                  {selectedFolderLabel}
                </span>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${folderDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {folderDropdownOpen && (
                <>
                  {/* Invisible overlay to close dropdown */}
                  <div className="fixed inset-0 z-10" onClick={() => setFolderDropdownOpen(false)} />
                  
                  <div className="absolute z-20 mt-1 w-full bg-card border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto">
                    <button
                      onClick={() => { setSelectedFolderId(null); setFolderDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-2.5 text-sm hover:bg-muted/60 transition-colors flex items-center gap-2 ${
                        !selectedFolderId ? 'text-cyan-400 bg-cyan-500/5' : 'text-foreground'
                      }`}
                    >
                      <Image className="w-4 h-4" />
                      All Media (Root)
                    </button>
                    {galleries.map((folder) => (
                      <button
                        key={folder.id}
                        onClick={() => { setSelectedFolderId(folder.id); setFolderDropdownOpen(false); }}
                        className={`w-full text-left px-3 py-2.5 text-sm hover:bg-muted/60 transition-colors flex items-center gap-2 border-t border-border/50 ${
                          selectedFolderId === folder.id ? 'text-cyan-400 bg-cyan-500/5' : 'text-foreground'
                        }`}
                      >
                        <Folder className="w-4 h-4 text-yellow-400" />
                        {folder.title}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Pricing Banner ── */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500/8 to-blue-500/8 border border-cyan-500/15">
            <Info className="w-4 h-4 text-cyan-400 shrink-0" />
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Camera className="w-3.5 h-3.5 text-cyan-400" />
                Photo: <strong className="text-foreground">${pricing.photoPrice.toFixed(2)}</strong>
              </span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <Film className="w-3.5 h-3.5 text-purple-400" />
                Video: <strong className="text-foreground">${pricing.videoPrice.toFixed(2)}</strong>
              </span>
              <span className="text-muted-foreground/60">
                ({pricing.source})
              </span>
            </div>
          </div>

          {/* ── Hidden File Input ── */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,.mp4,.mov,.webm,.m4v,.mpeg,.jpg,.jpeg,.png,.gif,.webp"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* ── Empty State / Drop Zone ── */}
          {files.length === 0 ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`w-full py-12 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-3 transition-all active:scale-[0.98] ${
                dragOver 
                  ? 'border-cyan-400 bg-cyan-500/10' 
                  : 'border-border hover:border-cyan-400/40 bg-card'
              }`}
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center">
                <Upload className="w-7 h-7 text-cyan-400" />
              </div>
              <div className="text-center px-4">
                <p className="text-foreground font-semibold text-sm">Select photos & videos</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Select multiple files • Images up to 50MB • Videos up to 100MB ({isPaidPhotographer ? '4K' : '1080p'})
                </p>
              </div>
            </button>
          ) : (
            <>
              {/* ── File Count + Add More ── */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs">
                  {files.filter(f => f.type === 'image').length > 0 && (
                    <span className="flex items-center gap-1 bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded-full font-medium">
                      <Camera className="w-3 h-3" /> {files.filter(f => f.type === 'image').length}
                    </span>
                  )}
                  {files.filter(f => f.type === 'video').length > 0 && (
                    <span className="flex items-center gap-1 bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-full font-medium">
                      <Film className="w-3 h-3" /> {files.filter(f => f.type === 'video').length}
                    </span>
                  )}
                  {doneFiles.length > 0 && (
                    <span className="flex items-center gap-1 bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full font-medium">
                      <CheckCircle2 className="w-3 h-3" /> {doneFiles.length}
                    </span>
                  )}
                </div>
                {!uploading && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-medium px-2 py-1 rounded-md hover:bg-cyan-500/10 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add more
                  </button>
                )}
              </div>

              {/* ── File List ── */}
              <div className="space-y-1.5 max-h-56 overflow-y-auto rounded-lg">
                {files.map((f) => (
                  <div
                    key={f.id}
                    className={`flex items-center gap-2.5 p-2 rounded-lg border transition-colors ${
                      f.status === STATUS.ERROR ? 'bg-red-500/5 border-red-500/20' :
                      f.status === STATUS.DONE ? 'bg-green-500/5 border-green-500/20' :
                      f.status === STATUS.UPLOADING ? 'bg-cyan-500/5 border-cyan-500/20' :
                      'bg-card border-border'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="w-10 h-10 rounded-md overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                      {f.type === 'video' ? (
                        <Film className="w-5 h-5 text-purple-400" />
                      ) : f.preview ? (
                        <img src={f.preview} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Camera className="w-5 h-5 text-cyan-400" />
                      )}
                    </div>

                    {/* Name + Status */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground truncate font-medium">
                        {f.name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground">
                          {formatFileSize(f.size)} • {f.type === 'video' ? 'Video' : 'Photo'}
                        </span>
                        {f.status === STATUS.UPLOADING && (
                          <span className="text-[10px] text-cyan-400 font-medium">{f.progress}%</span>
                        )}
                        {f.status === STATUS.ERROR && (
                          <span className="text-[10px] text-red-400 truncate max-w-[140px]">{f.error}</span>
                        )}
                      </div>
                      {/* Progress bar for uploading */}
                      {f.status === STATUS.UPLOADING && (
                        <div className="h-1 bg-muted rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-cyan-400 transition-all duration-300 rounded-full" style={{ width: `${f.progress}%` }} />
                        </div>
                      )}
                    </div>

                    {/* Action */}
                    <div className="shrink-0">
                      {f.status === STATUS.QUEUED && !uploading && (
                        <button onClick={() => removeFile(f.id)} className="p-1 hover:bg-muted rounded-md transition-colors">
                          <X className="w-4 h-4 text-muted-foreground" />
                        </button>
                      )}
                      {f.status === STATUS.UPLOADING && (
                        <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                      )}
                      {f.status === STATUS.DONE && (
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                      )}
                      {f.status === STATUS.ERROR && (
                        <button onClick={() => retryFile(f.id)} className="p-1 hover:bg-muted rounded-md transition-colors" title="Retry">
                          <RotateCcw className="w-4 h-4 text-red-400" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Global Progress ── */}
              {uploading && (
                <div className="space-y-1.5">
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-300 rounded-full"
                      style={{ width: `${globalProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Uploading… {globalProgress}%
                  </p>
                </div>
              )}

              {/* ── Upload Complete Summary ── */}
              {uploadComplete && (
                <div className={`flex items-center gap-2 p-3 rounded-lg border ${
                  errorFiles.length > 0 && doneFiles.length > 0 
                    ? 'bg-yellow-500/5 border-yellow-500/20' 
                    : errorFiles.length > 0 
                      ? 'bg-red-500/5 border-red-500/20' 
                      : 'bg-green-500/5 border-green-500/20'
                }`}>
                  {doneFiles.length > 0 ? (
                    <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <p className="text-xs text-foreground">
                    {doneFiles.length > 0 && `${doneFiles.length} uploaded`}
                    {doneFiles.length > 0 && errorFiles.length > 0 && ' • '}
                    {errorFiles.length > 0 && (
                      <span className="text-red-400">{errorFiles.length} failed — tap <RotateCcw className="w-3 h-3 inline" /> to retry</span>
                    )}
                  </p>
                </div>
              )}
            </>
          )}

          {/* ── Actions ── */}
          <div className="flex gap-2 pt-1">
            {!uploadComplete ? (
              <Button
                onClick={handleUploadAll}
                disabled={uploading || queuedFiles.length === 0}
                className="flex-1 h-12 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold rounded-xl disabled:opacity-50"
                data-testid="upload-submit"
              >
                {uploading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Uploading…
                  </span>
                ) : (
                  `Upload ${queuedFiles.length} file${queuedFiles.length !== 1 ? 's' : ''}`
                )}
              </Button>
            ) : (
              <div className="flex gap-2 flex-1">
                {errorFiles.length > 0 && queuedFiles.length > 0 && (
                  <Button
                    onClick={handleUploadAll}
                    className="flex-1 h-12 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-black font-bold rounded-xl"
                  >
                    Retry {queuedFiles.length}
                  </Button>
                )}
                <Button
                  onClick={onClose}
                  className="flex-1 h-12 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold rounded-xl"
                >
                  Done
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UploadPhotoModal;
