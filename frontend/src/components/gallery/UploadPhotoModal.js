/**
 * UploadPhotoModal - Photo/Video upload modal for photographers
 * Extracted from GalleryPage.js for better organization
 */
import React, { useState, useEffect, useRef } from 'react';
import { X, Image, Video, DollarSign, Loader2, Folder } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'sonner';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import logger from '../../utils/logger';


export const UploadPhotoModal = ({ 
  isOpen, 
  onClose, 
  onUploaded, 
  targetFolderId = null, 
  targetFolderName = null, 
  galleries = [] 
}) => {
  const { user } = useAuth();
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [mediaType, setMediaType] = useState('image');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('5.00');
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState(targetFolderId);
  const fileInputRef = useRef(null);
  
  // Update selected folder when targetFolderId changes
  useEffect(() => {
    setSelectedFolderId(targetFolderId);
  }, [targetFolderId]);
  
  // Check subscription for 4K support
  const isPaidPhotographer = user?.subscription_tier && ['basic', 'premium'].includes(user.subscription_tier);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');

    if (!isVideo && !isImage) {
      toast.error('Please select an image or video file');
      return;
    }

    // Check file size (100MB for video, 50MB for image)
    const maxSize = isVideo ? 100 * 1024 * 1024 : 50 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`File too large. Maximum size is ${maxSize / (1024 * 1024)}MB`);
      return;
    }

    setSelectedFile(file);
    setMediaType(isVideo ? 'video' : 'image');
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setLoading(true);
    setUploadProgress(0);

    try {
      // Upload file with watermarking (for images) or processing (for videos)
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('user_id', user.id);
      formData.append('add_watermark_preview', 'true');

      const isVideo = mediaType === 'video';
      const maxRes = isPaidPhotographer ? '4K' : '1080p';
      setProcessingStatus(isVideo ? `Uploading & processing video (${maxRes} max)...` : 'Uploading & adding watermark...');

      const uploadResponse = await apiClient.post(`/upload/photographer-gallery`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percent);
        }
      });

      setProcessingStatus('Creating gallery item...');

      // Create gallery item with the uploaded URLs
      const itemData = {
        photographer_id: user.id,
        title: title || selectedFile.name,
        description: description || '',
        media_type: mediaType,
        original_url: uploadResponse.data.original_url,
        preview_url: uploadResponse.data.preview_url || uploadResponse.data.original_url,
        thumbnail_url: uploadResponse.data.thumbnail_url || uploadResponse.data.preview_url,
        price: parseFloat(price) || 5.0,
        is_for_sale: true,
        gallery_id: selectedFolderId || null
      };

      await apiClient.post(`/gallery/items`, itemData);

      toast.success(`${mediaType === 'video' ? 'Video' : 'Photo'} uploaded successfully!`);
      
      // Reset form
      setSelectedFile(null);
      setPreviewUrl('');
      setTitle('');
      setDescription('');
      setPrice('5.00');
      setUploadProgress(0);
      setProcessingStatus('');
      
      onUploaded();
      onClose();

    } catch (error) {
      logger.error('Upload error:', error);
      toast.error(error.response?.data?.detail || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Image className="w-5 h-5 text-yellow-400" />
            Upload to Gallery
            {targetFolderName && (
              <span className="text-sm font-normal text-gray-400">→ {targetFolderName}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Destination Folder Selector */}
          {galleries && galleries.length > 0 && (
            <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
              <Label className="text-gray-400 text-sm mb-2 block">Upload to:</Label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedFolderId(null)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    !selectedFolderId 
                      ? 'bg-cyan-500 text-black' 
                      : 'bg-zinc-700 text-gray-300 hover:bg-zinc-600'
                  }`}
                >
                  All Photos (Root)
                </button>
                {galleries.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => setSelectedFolderId(folder.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${
                      selectedFolderId === folder.id 
                        ? 'bg-cyan-500 text-black' 
                        : 'bg-zinc-700 text-gray-300 hover:bg-zinc-600'
                    }`}
                  >
                    <Folder className="w-3 h-3" />
                    {folder.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* File Input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {!selectedFile ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full aspect-video rounded-lg border-2 border-dashed border-zinc-600 flex flex-col items-center justify-center gap-3 hover:border-yellow-400 transition-colors bg-zinc-800/50"
            >
              <div className="flex gap-4">
                <div className="flex flex-col items-center">
                  <Image className="w-10 h-10 text-gray-400" />
                  <span className="text-xs text-gray-500 mt-1">Photo</span>
                </div>
                <div className="flex flex-col items-center">
                  <Video className="w-10 h-10 text-gray-400" />
                  <span className="text-xs text-gray-500 mt-1">Video</span>
                </div>
              </div>
              <div className="text-center">
                <p className="text-white font-medium">Select media to upload</p>
                <p className="text-xs text-gray-500 mt-1">
                  {isPaidPhotographer 
                    ? 'Videos up to 4K • Images with watermark' 
                    : 'Videos up to 1080p • Upgrade for 4K'}
                </p>
              </div>
            </button>
          ) : (
            <div className="relative">
              {mediaType === 'video' ? (
                <video
                  src={previewUrl}
                  controls
                  className="w-full aspect-video object-cover rounded-lg"
                />
              ) : (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="w-full aspect-video object-cover rounded-lg"
                />
              )}
              <button
                onClick={() => {
                  URL.revokeObjectURL(previewUrl);
                  setSelectedFile(null);
                  setPreviewUrl('');
                }}
                className="absolute top-2 right-2 p-1.5 bg-black/70 rounded-full hover:bg-black"
              >
                <X className="w-4 h-4 text-white" />
              </button>
              <p className="text-xs text-gray-400 mt-2">
                {mediaType === 'video' 
                  ? `Video will be processed at ${isPaidPhotographer ? '4K' : '1080p'} max` 
                  : 'A watermarked preview will be created automatically'}
              </p>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">Title (optional)</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Dawn Patrol at Sebastian Inlet"
              className="bg-zinc-800 border-zinc-700 text-white"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">Description (optional)</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the shot..."
              className="bg-zinc-800 border-zinc-700 text-white"
              rows={2}
            />
          </div>

          {/* Price */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">Price (credits)</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="number"
                min="1"
                step="0.5"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-white pl-8"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              You earn 80% (${(parseFloat(price || 0) * 0.8).toFixed(2)}) per sale
            </p>
          </div>

          {/* Progress */}
          {loading && (
            <div className="space-y-2">
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-yellow-400 transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 text-center">{processingStatus || `Uploading... ${uploadProgress}%`}</p>
            </div>
          )}

          <Button
            onClick={handleUpload}
            disabled={loading || !selectedFile}
            className="w-full h-12 bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold"
            data-testid="upload-submit"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : `Upload ${mediaType === 'video' ? 'Video' : 'Photo'}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UploadPhotoModal;
