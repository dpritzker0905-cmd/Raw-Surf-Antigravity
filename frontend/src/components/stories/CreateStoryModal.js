import React, { useState, useRef } from 'react';
import { X, Camera, Plus, Video, Image, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../lib/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import logger from '../../utils/logger';

export const CreateStoryModal = ({ isOpen, onClose, onCreated }) => {
  const { user } = useAuth();
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState('image');
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploadMode, setUploadMode] = useState('file'); // 'file' or 'url'
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file type
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    
    if (!isImage && !isVideo) {
      toast.error('Please select an image or video file');
      return;
    }

    // Check file size (50MB limit)
    if (file.size > 50 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 50MB');
      return;
    }

    setSelectedFile(file);
    setMediaType(isVideo ? 'video' : 'image');
    
    // Create preview URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setMediaUrl(''); // Clear URL mode
  };

  const uploadFile = async () => {
    if (!selectedFile) return null;

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('user_id', user.id);

    try {
      const response = await apiClient.post(`/upload/story`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percent);
        }
      });
      return response.data;
    } catch (error) {
      logger.error('Upload error:', error);
      throw error;
    }
  };

  const handleCreate = async () => {
    setLoading(true);
    setUploadProgress(0);
    
    try {
      let finalMediaUrl = mediaUrl;
      let finalMediaType = mediaType;

      // If file mode, upload first
      if (uploadMode === 'file' && selectedFile) {
        const uploadResult = await uploadFile();
        finalMediaUrl = uploadResult.media_url;
        finalMediaType = uploadResult.media_type;
      }

      if (!finalMediaUrl) {
        toast.error('Please select a file or enter a URL');
        setLoading(false);
        return;
      }

      await apiClient.post(`/stories?author_id=${user.id}`, {
        media_url: finalMediaUrl,
        media_type: finalMediaType,
        caption: caption || null
      });
      
      toast.success('Story posted! ' + String.fromCodePoint(0x1F919));
      onCreated?.();
      handleClose();
    } catch (error) {
      toast.error('Failed to create story');
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  const handleClose = () => {
    // Clean up preview URL
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setMediaUrl('');
    setSelectedFile(null);
    setPreviewUrl('');
    setCaption('');
    setUploadProgress(0);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Camera className="w-5 h-5 text-yellow-400" />
            Create Story
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          {/* Upload Mode Toggle */}
          <div className="flex gap-2 p-1 bg-zinc-800 rounded-lg">
            <button aria-label="Add"
              onClick={() => setUploadMode('file')}
              className={`flex-1 py-2 rounded-md flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
                uploadMode === 'file' ? 'bg-yellow-400 text-black' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Plus className="w-4 h-4" />
              Upload File
            </button>
            <button
              onClick={() => setUploadMode('url')}
              className={`flex-1 py-2 rounded-md flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
                uploadMode === 'url' ? 'bg-yellow-400 text-black' : 'text-gray-400 hover:text-white'
              }`}
            >
              Link URL
            </button>
          </div>

          {/* File Upload Mode */}
          {uploadMode === 'file' && (
            <div>
              <input aria-label="Upload file"
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
                  <div className="w-16 h-16 rounded-full bg-zinc-700 flex items-center justify-center">
                    <Plus className="w-8 h-8 text-gray-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-white font-medium">Tap to select file</p>
                    <p className="text-xs text-gray-500 mt-1">Photos & videos up to 50MB</p>
                  </div>
                </button>
              ) : (
                <div className="relative">
                  <div className="aspect-video rounded-lg overflow-hidden bg-black">
                    {mediaType === 'video' ? (
                      <video src={previewUrl} className="w-full h-full object-cover" controls />
                    ) : (
                      <img loading="lazy" decoding="async" src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                    )}
                  </div>
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
                  <div className="mt-2 flex items-center gap-2 text-sm text-gray-400">
                    {mediaType === 'video' ? <Video className="w-4 h-4" /> : <Image className="w-4 h-4" />}
                    <span className="truncate">{selectedFile.name}</span>
                    <span className="text-xs">({(selectedFile.size / (1024 * 1024)).toFixed(1)}MB)</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* URL Mode */}
          {uploadMode === 'url' && (
            <>
              {/* Media Type Toggle */}
              <div className="flex gap-2">
                <button aria-label="Image"
                  onClick={() => setMediaType('image')}
                  className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 ${
                    mediaType === 'image' ? 'bg-yellow-400 text-black' : 'bg-zinc-800 text-gray-400'
                  }`}
                >
                  <Image className="w-4 h-4" />
                  Photo
                </button>
                <button aria-label="Video"
                  onClick={() => setMediaType('video')}
                  className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 ${
                    mediaType === 'video' ? 'bg-yellow-400 text-black' : 'bg-zinc-800 text-gray-400'
                  }`}
                >
                  <Video className="w-4 h-4" />
                  Video
                </button>
              </div>

              {/* Media URL Input */}
              <div>
                <label className="text-sm text-gray-400 mb-2 block">Media URL *</label>
                <input
                  type="url"
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                  placeholder={`Enter ${mediaType} URL...`}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-white placeholder-gray-500 focus:border-yellow-400 focus:outline-none"
                />
              </div>

              {/* Preview */}
              {mediaUrl && (
                <div className="aspect-video rounded-lg overflow-hidden bg-black">
                  {mediaType === 'video' ? (
                    <video src={mediaUrl} className="w-full h-full object-cover" controls />
                  ) : (
                    <img loading="lazy" decoding="async" src={mediaUrl} alt="Preview" className="w-full h-full object-cover" />
                  )}
                </div>
              )}
            </>
          )}

          {/* Caption */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">Caption (optional)</label>
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add a caption..."
              className="bg-zinc-800 border-zinc-700 text-white"
              rows={2}
            />
          </div>

          {/* Upload Progress */}
          {loading && uploadProgress > 0 && uploadProgress < 100 && (
            <div className="space-y-1">
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-yellow-400 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 text-center">Uploading... {uploadProgress}%</p>
            </div>
          )}

          <Button aria-label="Loader2"
            onClick={handleCreate}
            disabled={loading || (uploadMode === 'file' ? !selectedFile : !mediaUrl.trim())}
            className="w-full h-12 bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Share Story'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateStoryModal;
