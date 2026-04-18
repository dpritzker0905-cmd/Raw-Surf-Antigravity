/**
 * CreateWaveModal - Upload short-form vertical video (max 60 seconds)
 */
import React, { useState, useRef, useCallback } from 'react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { 
  Upload, Video, Loader2, MapPin, Clock, AlertCircle, 
  CheckCircle, Play, Pause, Volume2, VolumeX, RotateCcw
} from 'lucide-react';
import { toast } from 'sonner';

const MAX_DURATION = 60; // seconds
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export const CreateWaveModal = ({ isOpen, onClose, onSuccess }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  
  const [step, setStep] = useState('select'); // 'select', 'preview', 'details', 'uploading'
  const [selectedFile, setSelectedFile] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null);
  const [videoInfo, setVideoInfo] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  
  const bgClass = isLight ? 'bg-white' : 'bg-zinc-900';
  const textClass = isLight ? 'text-zinc-900' : 'text-white';
  const mutedClass = isLight ? 'text-zinc-500' : 'text-zinc-400';
  const borderClass = isLight ? 'border-zinc-200' : 'border-zinc-700';
  
  const resetState = () => {
    setStep('select');
    setSelectedFile(null);
    setVideoPreview(null);
    setVideoInfo(null);
    setCaption('');
    setLocation('');
    setUploadProgress(0);
    setError(null);
    setIsPlaying(false);
  };
  
  const handleClose = () => {
    resetState();
    onClose();
  };
  
  const handleFileSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setError(null);
    
    // Validate file type
    if (!file.type.startsWith('video/')) {
      setError('Please select a video file');
      return;
    }
    
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
      return;
    }
    
    // Create preview URL
    const previewUrl = URL.createObjectURL(file);
    setVideoPreview(previewUrl);
    setSelectedFile(file);
    
    // Get video metadata
    const video = document.createElement('video');
    video.preload = 'metadata';
    
    video.onloadedmetadata = () => {
      const duration = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;
      
      // Check duration
      if (duration > MAX_DURATION) {
        setError(`Video must be ${MAX_DURATION} seconds or less. Your video is ${Math.round(duration)} seconds.`);
        setVideoPreview(null);
        setSelectedFile(null);
        URL.revokeObjectURL(previewUrl);
        return;
      }
      
      // Calculate aspect ratio
      let aspectRatio = '9:16';
      const ratio = height / width;
      if (ratio >= 1.7) aspectRatio = '9:16';
      else if (ratio >= 1.2) aspectRatio = '4:5';
      else if (ratio >= 0.9) aspectRatio = '1:1';
      else aspectRatio = '16:9';
      
      setVideoInfo({
        duration,
        width,
        height,
        aspectRatio,
        isVertical: height > width
      });
      
      setStep('preview');
    };
    
    video.onerror = () => {
      setError('Could not read video file');
      URL.revokeObjectURL(previewUrl);
    };
    
    video.src = previewUrl;
  }, []);
  
  const handleUpload = async () => {
    if (!selectedFile || !user) return;
    
    setStep('uploading');
    setError(null);
    
    try {
      // Step 1: Upload video
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('user_id', user.id);
      
      const uploadResponse = await apiClient.post(`/upload/wave`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(progress);
        }
      });
      
      // Step 2: Create Wave post
      const waveData = {
        author_id: user.id,
        media_url: uploadResponse.data.media_url,
        thumbnail_url: uploadResponse.data.thumbnail_url,
        caption: caption.trim() || null,
        location: location.trim() || null,
        aspect_ratio: uploadResponse.data.aspect_ratio,
        video_width: uploadResponse.data.final_width || uploadResponse.data.original_width,
        video_height: uploadResponse.data.final_height || uploadResponse.data.original_height,
        video_duration: uploadResponse.data.duration
      };
      
      await apiClient.post(`/waves`, null, { params: waveData });
      
      toast.success('Wave posted!');
      handleClose();
      onSuccess?.();
      
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.response?.data?.detail || 'Failed to upload wave');
      setStep('details');
    }
  };
  
  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  const togglePlayPause = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className={`${bgClass} ${textClass} max-w-md mx-auto p-0 overflow-hidden`}>
        <DialogHeader className={`p-4 border-b ${borderClass}`}>
          <DialogTitle className="flex items-center gap-2">
            <Video className="w-5 h-5 text-cyan-500" />
            Create Wave
          </DialogTitle>
        </DialogHeader>
        
        <div className="p-4">
          {/* Step 1: Select Video */}
          {step === 'select' && (
            <div className="space-y-4">
              <div 
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed ${borderClass} rounded-xl p-8 text-center cursor-pointer hover:border-cyan-500 transition-colors`}
                data-testid="wave-upload-dropzone"
              >
                <Upload className={`w-12 h-12 mx-auto mb-4 ${mutedClass}`} />
                <p className={`font-medium mb-1 ${textClass}`}>Select a video</p>
                <p className={`text-sm ${mutedClass}`}>
                  MP4, MOV, or WebM • Max {MAX_DURATION} seconds
                </p>
              </div>
              
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                className="hidden"
                data-testid="wave-file-input"
              />
              
              {error && (
                <div className="flex items-center gap-2 text-red-500 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}
              
              <div className={`text-xs ${mutedClass} space-y-1`}>
                <p className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Videos must be 60 seconds or less (music label compliance)
                </p>
                <p>Vertical videos (9:16) work best for Waves</p>
              </div>
            </div>
          )}
          
          {/* Step 2: Preview */}
          {step === 'preview' && videoPreview && (
            <div className="space-y-4">
              <div className="relative aspect-[9/16] max-h-[400px] bg-black rounded-xl overflow-hidden mx-auto">
                <video
                  ref={videoRef}
                  src={videoPreview}
                  className="w-full h-full object-contain"
                  loop
                  playsInline
                  muted={isMuted}
                />
                
                {/* Video controls */}
                <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                  <div className="flex items-center justify-between text-white">
                    <button onClick={togglePlayPause} className="p-2">
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                    </button>
                    
                    <div className="flex items-center gap-3">
                      <span className="text-sm">
                        {formatDuration(videoInfo?.duration || 0)}
                      </span>
                      <button onClick={() => setIsMuted(!isMuted)} className="p-2">
                        {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                </div>
                
                {/* Aspect ratio badge */}
                <div className="absolute top-3 left-3 bg-black/50 px-2 py-1 rounded text-white text-xs">
                  {videoInfo?.aspectRatio}
                </div>
              </div>
              
              {/* Video info */}
              <div className={`flex items-center justify-center gap-4 text-sm ${mutedClass}`}>
                <span>{videoInfo?.width}x{videoInfo?.height}</span>
                <span>•</span>
                <span>{formatDuration(videoInfo?.duration || 0)}</span>
                {videoInfo?.isVertical && (
                  <>
                    <span>•</span>
                    <span className="text-green-500 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Vertical
                    </span>
                  </>
                )}
              </div>
              
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={resetState}
                  className={`flex-1 ${isLight ? '' : 'border-zinc-700 hover:bg-zinc-800'}`}
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Choose Different
                </Button>
                <Button
                  onClick={() => setStep('details')}
                  className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-white"
                  data-testid="wave-continue-btn"
                >
                  Continue
                </Button>
              </div>
            </div>
          )}
          
          {/* Step 3: Add Details */}
          {step === 'details' && (
            <div className="space-y-4">
              {/* Thumbnail preview */}
              <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
                <video
                  src={videoPreview}
                  className="w-full h-full object-contain"
                  muted
                />
                <div className="absolute bottom-2 right-2 bg-black/50 px-2 py-1 rounded text-white text-xs">
                  {formatDuration(videoInfo?.duration || 0)}
                </div>
              </div>
              
              {/* Caption */}
              <div>
                <label className={`text-sm font-medium ${textClass} mb-1 block`}>
                  Caption
                </label>
                <Textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Add a caption..."
                  className={`${isLight ? 'bg-white border-zinc-300' : 'bg-zinc-800 border-zinc-700'} resize-none`}
                  rows={3}
                  maxLength={500}
                  data-testid="wave-caption-input"
                />
                <p className={`text-xs ${mutedClass} mt-1 text-right`}>
                  {caption.length}/500
                </p>
              </div>
              
              {/* Location */}
              <div>
                <label className={`text-sm font-medium ${textClass} mb-1 block`}>
                  Location
                </label>
                <div className="relative">
                  <MapPin className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${mutedClass}`} />
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Add location..."
                    className={`pl-9 ${isLight ? 'bg-white border-zinc-300' : 'bg-zinc-800 border-zinc-700'}`}
                    data-testid="wave-location-input"
                  />
                </div>
              </div>
              
              {error && (
                <div className="flex items-center gap-2 text-red-500 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}
              
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setStep('preview')}
                  className={`flex-1 ${isLight ? '' : 'border-zinc-700 hover:bg-zinc-800'}`}
                >
                  Back
                </Button>
                <Button
                  onClick={handleUpload}
                  className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white"
                  data-testid="wave-post-btn"
                >
                  Post Wave
                </Button>
              </div>
            </div>
          )}
          
          {/* Step 4: Uploading */}
          {step === 'uploading' && (
            <div className="py-8 text-center space-y-4">
              <Loader2 className="w-12 h-12 mx-auto text-cyan-500 animate-spin" />
              <div>
                <p className={`font-medium ${textClass}`}>Uploading your Wave...</p>
                <p className={`text-sm ${mutedClass}`}>{uploadProgress}%</p>
              </div>
              
              {/* Progress bar */}
              <div className={`w-full h-2 rounded-full ${isLight ? 'bg-zinc-200' : 'bg-zinc-700'}`}>
                <div 
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              
              <p className={`text-xs ${mutedClass}`}>
                Please don't close this window
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateWaveModal;
