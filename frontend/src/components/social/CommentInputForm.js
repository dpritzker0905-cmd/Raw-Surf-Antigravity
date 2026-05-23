import React, { useState, useRef } from 'react';
import { Camera, Smile, Send, X, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import EmojiPicker from '../EmojiPicker';

const CommentInputForm = ({ 
  user, 
  placeholder = "Add a comment...",
  onSubmit, 
  isLight = false,
  replyingToName = null,
  onCancelReply = null,
  className = ""
}) => {
  const [inputText, setInputText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [mediaAttachment, setMediaAttachment] = useState(null); // { media_url, media_type, local_preview }
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check size limit (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      toast.error("File is too large (max 50MB)");
      return;
    }

    const isVideo = file.type.startsWith('video/');
    const isGif = file.type === 'image/gif';
    const isImage = file.type.startsWith('image/');

    if (!isVideo && !isImage) {
      toast.error("Unsupported file type. Please choose an image, GIF, or video.");
      return;
    }

    // Client-side video duration check
    if (isVideo) {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        if (video.duration > 60) {
          toast.error("Video comments must be 60 seconds or less! Your video is " + Math.round(video.duration) + "s.");
          e.target.value = ''; // Clear file input
        } else {
          uploadFile(file, 'video');
        }
      };
      video.src = URL.createObjectURL(file);
    } else {
      uploadFile(file, isGif ? 'gif' : 'image');
    }
  };

  const uploadFile = async (file, type) => {
    setUploading(true);
    
    // Create optimistic local preview
    const previewUrl = URL.createObjectURL(file);
    setMediaAttachment({
      media_url: null,
      media_type: type,
      local_preview: previewUrl
    });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_id', user?.id || '');

    try {
      const response = await apiClient.post('/upload/comment', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      setMediaAttachment({
        media_url: response.data.media_url,
        media_type: response.data.media_type,
        local_preview: previewUrl
      });
      toast.success("Attachment uploaded successfully!");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to upload file");
      setMediaAttachment(null);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = () => {
    if (mediaAttachment?.local_preview) {
      URL.revokeObjectURL(mediaAttachment.local_preview);
    }
    setMediaAttachment(null);
  };

  const handleFormSubmit = async (e) => {
    if (e) e.preventDefault();
    
    const text = inputText.trim();
    const hasMedia = mediaAttachment && mediaAttachment.media_url;
    
    if (!text && !hasMedia) return;
    if (uploading) {
      toast.error("Please wait for the attachment to finish uploading");
      return;
    }

    try {
      await onSubmit({
        content: text,
        media_url: mediaAttachment?.media_url || null,
        media_type: mediaAttachment?.media_type || null
      });

      // Clear state on success
      setInputText('');
      if (mediaAttachment?.local_preview) {
        URL.revokeObjectURL(mediaAttachment.local_preview);
      }
      setMediaAttachment(null);
    } catch (err) {
      // Errors handled by parent submit handler
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFormSubmit();
    }
  };

  return (
    <div className={`w-full flex flex-col gap-2 ${className}`}>
      {/* Active Reply Header */}
      {replyingToName && (
        <div className="flex items-center justify-between px-3 py-1.5 rounded-t-lg bg-zinc-900/30 border-b border-white/5 text-xs text-cyan-400">
          <span>Replying to @{replyingToName}</span>
          <button onClick={onCancelReply} className="text-gray-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Floating Staging Preview Bubble */}
      {mediaAttachment && (
        <div className="relative self-start ml-2 p-1 bg-zinc-800/80 backdrop-blur-md border border-white/10 rounded-xl shadow-lg flex items-center gap-2 group animate-in slide-in-from-bottom-2 duration-200">
          <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-black/40 flex items-center justify-center">
            {mediaAttachment.local_preview ? (
              mediaAttachment.media_type === 'video' ? (
                <div className="relative w-full h-full flex items-center justify-center">
                  <video src={mediaAttachment.local_preview} className="w-full h-full object-cover opacity-60" muted />
                  <Play className="absolute w-4 h-4 text-white fill-white/20" />
                </div>
              ) : (
                <img src={mediaAttachment.local_preview} alt="Attachment Preview" className="w-full h-full object-cover" />
              )
            ) : null}

            {uploading && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
              </div>
            )}
          </div>
          
          <div className="flex flex-col pr-8 pl-1">
            <span className="text-[11px] font-semibold text-white">
              {uploading ? "Staging Upload..." : "Attachment Ready"}
            </span>
            <span className="text-[10px] text-gray-400 capitalize">
              {mediaAttachment.media_type}
            </span>
          </div>

          <button 
            onClick={handleRemoveAttachment}
            className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Form Input Row */}
      <div className={`relative flex items-center gap-2 px-3 py-2 rounded-full border ${
        isLight 
          ? 'bg-gray-100 border-gray-200 text-gray-900' 
          : 'bg-zinc-900 border-zinc-800 text-white'
      } focus-within:border-cyan-500/50 transition-colors`}>
        
        {/* Hidden File Input */}
        <input 
          ref={fileInputRef}
          type="file" 
          accept="image/*,video/*"
          className="hidden" 
          onChange={handleFileChange}
        />

        {/* Media Trigger Button */}
        <button 
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-1 rounded-full text-gray-400 hover:text-cyan-400 active:scale-95 transition-all"
          title="Attach Image, GIF or Video (Max 60s)"
        >
          <Camera className="w-5 h-5" />
        </button>

        {/* Text Area / Input */}
        <input 
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder-gray-500"
        />

        {/* Emoji Selector Trigger */}
        <button 
          type="button"
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          className={`p-1 rounded-full transition-colors ${
            showEmojiPicker ? 'text-cyan-400' : 'text-gray-400 hover:text-cyan-400'
          }`}
        >
          <Smile className="w-5 h-5" />
        </button>

        {/* Submit Send Button */}
        <button 
          type="button"
          onClick={() => handleFormSubmit()}
          disabled={uploading || (!inputText.trim() && !mediaAttachment)}
          className={`p-1.5 rounded-full transition-all ${
            (inputText.trim() || mediaAttachment) && !uploading
              ? 'bg-cyan-500 text-white hover:bg-cyan-600 active:scale-95 shadow-md shadow-cyan-500/20' 
              : 'text-gray-500 cursor-not-allowed'
          }`}
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>

        {/* Floating Emoji Picker Popover */}
        <EmojiPicker
          isOpen={showEmojiPicker}
          onClose={() => setShowEmojiPicker(false)}
          onSelect={(emoji) => {
            setInputText(prev => prev + emoji);
            inputRef.current?.focus();
          }}
          position="above"
        />
      </div>
    </div>
  );
};

export default CommentInputForm;
