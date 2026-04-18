import React, { useState, useRef, useCallback } from 'react';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import apiClient from '../lib/apiClient';

import { 

  Upload, X, Check, Loader2, Sparkles, Video
} from 'lucide-react';
import { Button } from './ui/button';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';

import { Label } from './ui/label';

import { toast } from 'sonner';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';



// Photo Upload Component with Surfer Tagging
export const PhotoUploadModal = ({ 
  isOpen, 
  onClose, 
  sessionId, 
  galleryId,
  participants = [],
  sessionPricing = {},
  onSuccess 
}) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const fileInputRef = useRef(null);
  
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [taggedSurfers, setTaggedSurfers] = useState({});
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [step, setStep] = useState('select'); // select, tag, confirm
  
  // Theme
  const isLight = theme === 'light';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-700';
  const _inputBgClass = isLight ? 'bg-white' : 'bg-zinc-800';
  
  // Live Savings pricing
  const livePhotoPrice = sessionPricing.live_photo_price || 5;
  const generalPhotoPrice = sessionPricing.general_photo_price || 10;
  const hasSavings = generalPhotoPrice > livePhotoPrice;
  
  // Handle file selection (photos and videos)
  const handleFileSelect = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter(file => {
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      
      if (!isImage && !isVideo) {
        toast.error(`${file.name} is not a supported file type`);
        return false;
      }
      
      // Size limits: 20MB for images, 100MB for videos
      const maxSize = isVideo ? 100 * 1024 * 1024 : 20 * 1024 * 1024;
      if (file.size > maxSize) {
        toast.error(`${file.name} is too large (max ${isVideo ? '100MB' : '20MB'})`);
        return false;
      }
      return true;
    });
    
    // Create preview URLs
    const filesWithPreviews = validFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      id: `${file.name}-${Date.now()}-${Math.random()}`,
      mediaType: file.type.startsWith('video/') ? 'video' : 'image'
    }));
    
    setSelectedFiles(prev => [...prev, ...filesWithPreviews]);
  }, []);
  
  // Handle drag and drop
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const fakeEvent = { target: { files } };
    handleFileSelect(fakeEvent);
  }, [handleFileSelect]);
  
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);
  
  // Remove a file
  const removeFile = (fileId) => {
    setSelectedFiles(prev => {
      const file = prev.find(f => f.id === fileId);
      if (file) URL.revokeObjectURL(file.preview);
      return prev.filter(f => f.id !== fileId);
    });
    // Also remove tags
    setTaggedSurfers(prev => {
      const newTags = { ...prev };
      delete newTags[fileId];
      return newTags;
    });
  };
  
  // Toggle surfer tag for a photo
  const toggleSurferTag = (photoId, surferId) => {
    setTaggedSurfers(prev => {
      const photoTags = prev[photoId] || [];
      if (photoTags.includes(surferId)) {
        return {
          ...prev,
          [photoId]: photoTags.filter(id => id !== surferId)
        };
      } else {
        return {
          ...prev,
          [photoId]: [...photoTags, surferId]
        };
      }
    });
  };
  
  // Upload all photos
  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      toast.error('Please select at least one photo');
      return;
    }
    
    setUploading(true);
    const successCount = { count: 0 };
    const failCount = { count: 0 };
    
    try {
      for (const fileData of selectedFiles) {
        try {
          setUploadProgress(prev => ({ ...prev, [fileData.id]: 0 }));
          
          // Create form data
          const formData = new FormData();
          formData.append('file', fileData.file);
          formData.append('photographer_id', user.id);
          if (galleryId) formData.append('gallery_id', galleryId);
          if (sessionId) formData.append('session_id', sessionId);
          
          // Add tagged surfers
          const tags = taggedSurfers[fileData.id] || [];
          if (tags.length > 0) {
            formData.append('tagged_surfer_ids', JSON.stringify(tags));
          }
          
          // Add pricing info
          formData.append('price', livePhotoPrice.toString());
          formData.append('is_session_photo', 'true');
          formData.append('media_type', fileData.mediaType || 'image');
          
          // Upload with progress
          const _response = await apiClient.post(`/photos/upload`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress: (progressEvent) => {
              const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              setUploadProgress(prev => ({ ...prev, [fileData.id]: progress }));
            }
          });
          
          setUploadProgress(prev => ({ ...prev, [fileData.id]: 100 }));
          successCount.count++;
        } catch (error) {
          logger.error(`Error uploading ${fileData.file.name}:`, error);
          setUploadProgress(prev => ({ ...prev, [fileData.id]: -1 }));
          failCount.count++;
        }
      }
      
      if (successCount.count > 0) {
        toast.success(`Uploaded ${successCount.count} file${successCount.count > 1 ? 's' : ''}!`);
        onSuccess?.({ uploaded: successCount.count, failed: failCount.count });
      }
      
      if (failCount.count > 0) {
        toast.error(`Failed to upload ${failCount.count} file${failCount.count > 1 ? 's' : ''}`);
      }
      
      // Close modal after successful upload
      if (successCount.count > 0) {
        setTimeout(() => {
          onClose();
          // Cleanup
          selectedFiles.forEach(f => URL.revokeObjectURL(f.preview));
          setSelectedFiles([]);
          setTaggedSurfers({});
          setStep('select');
        }, 1500);
      }
    } catch (error) {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
    }
  };
  
  // Proceed to tagging step
  const proceedToTagging = () => {
    if (selectedFiles.length === 0) {
      toast.error('Please select at least one photo or video');
      return;
    }
    if (participants.length > 0) {
      setStep('tag');
    } else {
      setStep('confirm');
    }
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} sm:max-w-2xl`}>
        <DialogHeader className="shrink-0 border-b border-inherit px-4 sm:px-6 pt-4 pb-3">
          <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
            <Upload className="w-5 h-5 text-cyan-400" />
            Upload Session Media
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          {/* Step 1: File Selection */}
          {step === 'select' && (
            <div className="space-y-4">
              {/* Pricing Info */}
              {hasSavings && (
                <div className="p-3 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-green-400" />
                    <span className="text-green-400 font-medium text-sm">Live Session Pricing Active</span>
                  </div>
                  <p className="text-gray-400 text-xs mt-1">
                    Photos will be priced at ${livePhotoPrice}/photo (${generalPhotoPrice - livePhotoPrice} less than gallery price)
                  </p>
                </div>
              )}
              
              {/* Drop Zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className={`border-2 border-dashed ${borderClass} rounded-xl p-8 text-center cursor-pointer hover:border-cyan-500/50 transition-colors`}
              >
                <Upload className={`w-12 h-12 mx-auto mb-4 ${textSecondaryClass}`} />
                <p className={`text-lg ${textPrimaryClass} mb-2`}>
                  Drag & drop photos or videos here
                </p>
                <p className={`text-sm ${textSecondaryClass}`}>
                  or click to browse
                </p>
                <p className={`text-xs ${textSecondaryClass} mt-2`}>
                  Photos: JPG, PNG, HEIC (20MB) • Videos: MP4, MOV, WebM (100MB)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
              
              {/* Selected Files Preview */}
              {selectedFiles.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className={`text-sm font-medium ${textPrimaryClass}`}>
                      {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected
                      {selectedFiles.filter(f => f.mediaType === 'video').length > 0 && (
                        <span className="text-purple-400 ml-2">
                          ({selectedFiles.filter(f => f.mediaType === 'video').length} video{selectedFiles.filter(f => f.mediaType === 'video').length > 1 ? 's' : ''})
                        </span>
                      )}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        selectedFiles.forEach(f => URL.revokeObjectURL(f.preview));
                        setSelectedFiles([]);
                      }}
                      className="text-red-400 hover:text-red-300"
                    >
                      Clear All
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {selectedFiles.map((fileData) => (
                      <div key={fileData.id} className="relative aspect-square rounded-lg overflow-hidden group">
                        {fileData.mediaType === 'video' ? (
                          <div className="w-full h-full bg-zinc-800 flex items-center justify-center relative">
                            <video 
                              src={fileData.preview} 
                              className="w-full h-full object-cover"
                              muted
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <Video className="w-8 h-8 text-white" />
                            </div>
                          </div>
                        ) : (
                          <img 
                            src={fileData.preview} 
                            alt="" 
                            className="w-full h-full object-cover"
                          />
                        )}
                        <button
                          onClick={() => removeFile(fileData.id)}
                          className="absolute top-1 right-1 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-4 h-4 text-white" />
                        </button>
                        {fileData.mediaType === 'video' && (
                          <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-purple-500 text-white text-xs rounded">
                            Video
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Step 2: Surfer Tagging */}
          {step === 'tag' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className={textSecondaryClass}>
                  Tag surfers in {selectedFiles[currentPhotoIndex]?.mediaType === 'video' ? 'video' : 'photo'} {currentPhotoIndex + 1} of {selectedFiles.length}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPhotoIndex(prev => Math.max(0, prev - 1))}
                    disabled={currentPhotoIndex === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPhotoIndex(prev => Math.min(selectedFiles.length - 1, prev + 1))}
                    disabled={currentPhotoIndex === selectedFiles.length - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
              
              {/* Current Photo/Video */}
              {selectedFiles[currentPhotoIndex] && (
                <div className="aspect-video bg-black rounded-lg overflow-hidden relative">
                  {selectedFiles[currentPhotoIndex].mediaType === 'video' ? (
                    <video 
                      src={selectedFiles[currentPhotoIndex].preview}
                      className="w-full h-full object-contain"
                      controls
                    />
                  ) : (
                    <img 
                      src={selectedFiles[currentPhotoIndex].preview}
                      alt=""
                      className="w-full h-full object-contain"
                    />
                  )}
                </div>
              )}
              
              {/* Surfer Tags */}
              <div>
                <Label className={`${textSecondaryClass} mb-2 block`}>
                  Who's in this {selectedFiles[currentPhotoIndex]?.mediaType === 'video' ? 'video' : 'photo'}?
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {participants.map((surfer) => {
                    const currentPhotoId = selectedFiles[currentPhotoIndex]?.id;
                    const isTagged = (taggedSurfers[currentPhotoId] || []).includes(surfer.id);
                    
                    return (
                      <button
                        key={surfer.id}
                        onClick={() => toggleSurferTag(currentPhotoId, surfer.id)}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                          isTagged
                            ? 'border-cyan-500 bg-cyan-500/10'
                            : `${borderClass} hover:border-gray-500`
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-full ${isLight ? 'bg-gray-200' : 'bg-zinc-700'} overflow-hidden`}>
                          {surfer.avatar_url ? (
                            <img src={getFullUrl(surfer.avatar_url)} className="w-full h-full object-cover" alt="" />
                          ) : (
                            <span className="flex items-center justify-center h-full text-gray-400">
                              {surfer.name?.[0] || '?'}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 text-left">
                          <p className={textPrimaryClass}>{surfer.name || surfer.full_name}</p>
                        </div>
                        {isTagged && (
                          <Check className="w-5 h-5 text-cyan-400" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              
              {/* Skip tagging option */}
              <button
                onClick={() => setStep('confirm')}
                className={`w-full text-center text-sm ${textSecondaryClass} hover:text-gray-300`}
              >
                Skip tagging remaining photos →
              </button>
            </div>
          )}
          
          {/* Step 3: Confirm */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <div className={`p-4 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                <h4 className={`font-medium ${textPrimaryClass} mb-3`}>Upload Summary</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className={textSecondaryClass}>Files to upload</span>
                    <span className={textPrimaryClass}>{selectedFiles.length}</span>
                  </div>
                  {selectedFiles.filter(f => f.mediaType === 'video').length > 0 && (
                    <div className="flex justify-between">
                      <span className={textSecondaryClass}>Videos</span>
                      <span className="text-purple-400">{selectedFiles.filter(f => f.mediaType === 'video').length}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className={textSecondaryClass}>Price per photo</span>
                    <span className="text-green-400">${livePhotoPrice}</span>
                  </div>
                  {Object.keys(taggedSurfers).length > 0 && (
                    <div className="flex justify-between">
                      <span className={textSecondaryClass}>Files with tags</span>
                      <span className={textPrimaryClass}>{Object.keys(taggedSurfers).length}</span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Upload Progress */}
              {uploading && (
                <div className="space-y-2">
                  {selectedFiles.map((fileData) => {
                    const progress = uploadProgress[fileData.id] || 0;
                    return (
                      <div key={fileData.id} className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg overflow-hidden relative">
                          {fileData.mediaType === 'video' ? (
                            <div className="w-full h-full bg-zinc-700 flex items-center justify-center">
                              <Video className="w-4 h-4 text-purple-400" />
                            </div>
                          ) : (
                            <img src={fileData.preview} className="w-full h-full object-cover" alt="" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all ${
                                progress === -1 
                                  ? 'bg-red-500' 
                                  : progress === 100 
                                    ? 'bg-green-500' 
                                    : 'bg-cyan-500'
                              }`}
                              style={{ width: `${Math.max(progress, 0)}%` }}
                            />
                          </div>
                        </div>
                        <span className={`text-xs w-10 text-right ${
                          progress === -1 ? 'text-red-400' : progress === 100 ? 'text-green-400' : textSecondaryClass
                        }`}>
                          {progress === -1 ? 'Error' : `${progress}%`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        
        <DialogFooter className="flex gap-2">
          {step !== 'select' && (
            <Button 
              variant="outline" 
              onClick={() => setStep(step === 'tag' ? 'select' : 'tag')}
              disabled={uploading}
            >
              Back
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={uploading}>
            Cancel
          </Button>
          
          {step === 'select' && (
            <Button
              onClick={proceedToTagging}
              disabled={selectedFiles.length === 0}
              className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-medium"
            >
              {participants.length > 0 ? 'Next: Tag Surfers' : 'Continue'}
            </Button>
          )}
          
          {step === 'tag' && (
            <Button
              onClick={() => setStep('confirm')}
              className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-medium"
            >
              Continue to Upload
            </Button>
          )}
          
          {step === 'confirm' && (
            <Button
              onClick={handleUpload}
              disabled={uploading || selectedFiles.length === 0}
              className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-medium"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload {selectedFiles.length} File{selectedFiles.length > 1 ? 's' : ''}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PhotoUploadModal;
