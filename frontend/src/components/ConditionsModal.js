import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  Camera, Upload, X, Video, FileText, 
  CheckCircle2, AlertCircle, Loader2, CloudSun, Waves, RefreshCw
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import logger from '../utils/logger';

/**
 * ConditionsModal - Mandatory "Go Live" Gatekeeper
 * 
 * This modal ensures photographers provide critical context before starting a session:
 * 1. Capture or upload a condition photo/video (REQUIRED)
 * 2. Add spot notes for surfers (optional but encouraged)
 * 
 * The 'Go Live' button is disabled until media is attached.
 */
const ConditionsModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  spotName, 
  isLoading = false 
}) => {
  // State
  const [conditionMedia, setConditionMedia] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [mediaType, setMediaType] = useState(null); // 'image' | 'video'
  const [spotNotes, setSpotNotes] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraMode, setCameraMode] = useState('photo'); // 'photo' | 'video'
  const [cameraFacing, setCameraFacing] = useState('environment'); // 'environment' = rear, 'user' = front
  const [isRecording, setIsRecording] = useState(false);
  const [_uploadMode, setUploadMode] = useState('capture'); // 'capture' | 'upload'
  
  // Refs
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const fileInputRef = useRef(null);

  // Cleanup camera on unmount or modal close
  useEffect(() => {
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      // Reset state when modal closes
      setConditionMedia(null);
      setMediaPreview(null);
      setMediaType(null);
      setSpotNotes('');
      setCameraActive(false);
      setUploadMode('capture');
    }
  }, [isOpen]);

  // Camera functions
  const startCamera = async (mode = 'photo', facing = cameraFacing) => {
    try {
      setCameraMode(mode);
      
      // Stop existing stream first
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      
      let stream;
      const baseConstraints = {
        width: { ideal: 1280 },
        height: { ideal: 720 }
      };
      
      // Try multiple constraint variations for better mobile compatibility
      const constraintOptions = [
        // Option 1: Simple string facingMode (most compatible)
        { video: { facingMode: facing, ...baseConstraints }, audio: mode === 'video' },
        // Option 2: Object with ideal (recommended)
        { video: { facingMode: { ideal: facing }, ...baseConstraints }, audio: mode === 'video' },
        // Option 3: Object with exact (strict)
        { video: { facingMode: { exact: facing }, ...baseConstraints }, audio: mode === 'video' },
        // Option 4: No facingMode (last resort)
        { video: baseConstraints, audio: mode === 'video' }
      ];
      
      for (let i = 0; i < constraintOptions.length; i++) {
        try {
          logger.debug(`Trying camera constraint option ${i + 1}:`, constraintOptions[i]);
          stream = await navigator.mediaDevices.getUserMedia(constraintOptions[i]);
          logger.debug(`Camera initialized with option ${i + 1}`);
          break;
        } catch (err) {
          logger.warn(`Camera option ${i + 1} failed:`, err.name);
          if (i === constraintOptions.length - 1) {
            throw err; // Rethrow on last attempt
          }
        }
      }
      
      if (!stream) {
        throw new Error('Could not acquire camera stream');
      }
      
      streamRef.current = stream;
      
      // IMPORTANT: Set cameraActive FIRST so the video element renders
      // Then attach the stream in the next tick when videoRef is available
      setCameraActive(true);
      
    } catch (error) {
      logger.error('Camera error:', error);
      toast.error('Could not access camera. Please use file upload instead.');
      setUploadMode('upload');
    }
  };
  
  // Effect to attach stream to video element when it becomes available
  useEffect(() => {
    // Use a small delay to ensure the video element is fully mounted
    const attachStream = () => {
      if (cameraActive && streamRef.current && videoRef.current) {
        logger.debug('Attaching stream to video element');
        videoRef.current.srcObject = streamRef.current;
        // Ensure video plays
        videoRef.current.play().catch((err) => {
          logger.warn('Video play warning:', err);
        });
      }
    };
    
    // Small timeout to ensure React has rendered the video element
    const timeoutId = setTimeout(attachStream, 50);
    return () => clearTimeout(timeoutId);
  }, [cameraActive]);

  // Flip camera between front and back
  const flipCamera = async () => {
    const newFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    setCameraFacing(newFacing);
    // Small delay to ensure state is updated before restarting camera
    await startCamera(cameraMode, newFacing);
    toast.success(`Switched to ${newFacing === 'environment' ? 'rear' : 'front'} camera`);
  };

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
    setCameraActive(false);
    setIsRecording(false);
  }, [isRecording]);

  // Capture photo
  const capturePhoto = () => {
    if (!videoRef.current) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0);
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setMediaPreview(dataUrl);
    setMediaType('image');
    
    // Convert to blob for upload
    canvas.toBlob((blob) => {
      setConditionMedia(blob);
    }, 'image/jpeg', 0.85);
    
    stopCamera();
    toast.success('Photo captured!');
  };

  // Start/Stop video recording
  const toggleVideoRecording = () => {
    if (!isRecording) {
      // Start recording
      recordedChunksRef.current = [];
      const stream = streamRef.current;
      
      if (!stream) return;
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      mediaRecorderRef.current = mediaRecorder;
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        setMediaPreview(url);
        setMediaType('video');
        setConditionMedia(blob);
        stopCamera();
        toast.success('Video recorded!');
      };
      
      mediaRecorder.start();
      setIsRecording(true);
    } else {
      // Stop recording
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    }
  };

  // Handle file upload
  const handleFileSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // Validate file type
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    
    if (!isImage && !isVideo) {
      toast.error('Please select an image or video file');
      return;
    }
    
    // Check file size (max 50MB for video, 10MB for image)
    const maxSize = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`File too large. Max ${isVideo ? '50MB' : '10MB'}`);
      return;
    }
    
    setConditionMedia(file);
    setMediaType(isImage ? 'image' : 'video');
    setMediaPreview(URL.createObjectURL(file));
    toast.success(`${isImage ? 'Photo' : 'Video'} selected!`);
  };

  // Clear media
  const clearMedia = () => {
    if (mediaPreview && mediaPreview.startsWith('blob:')) {
      URL.revokeObjectURL(mediaPreview);
    }
    setConditionMedia(null);
    setMediaPreview(null);
    setMediaType(null);
  };

  // Handle confirm
  const handleConfirm = () => {
    if (!conditionMedia) {
      toast.error('Please add a condition photo or video first');
      return;
    }
    
    onConfirm({
      media: conditionMedia,
      mediaType,
      spotNotes: spotNotes.trim()
    });
  };

  // Check if go live is enabled
  const canGoLive = !!conditionMedia;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="bg-zinc-900 border-zinc-700 text-white sm:max-w-md"
        overlayClassName="z-[9998]"
        data-testid="conditions-modal"
        style={{ zIndex: 9999 }}
      >
        <DialogHeader className="border-b border-zinc-800">
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <CloudSun className="w-5 h-5 text-cyan-400" />
            Conditions Check
          </DialogTitle>
        </DialogHeader>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6">
          <div className="space-y-4 py-4">
          {/* Spot Info */}
          <div className="flex items-center gap-2 p-3 bg-zinc-800/50 rounded-lg">
            <Waves className="w-4 h-4 text-blue-400" />
            <span className="text-gray-300 text-sm">Going live at</span>
            <span className="text-white font-medium">{spotName}</span>
          </div>

          {/* Instructions */}
          <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
            <p className="text-cyan-300 text-sm">
              <span className="font-medium">Required:</span> Share current conditions with surfers 
              by taking a quick photo or video of the waves.
            </p>
          </div>

          {/* Media Capture/Upload Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-gray-400 text-sm flex items-center gap-2">
                <Camera className="w-4 h-4" />
                Condition Media <span className="text-red-400">*</span>
              </label>
              {conditionMedia && (
                <Badge className="bg-green-500/20 text-green-400">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Ready
                </Badge>
              )}
            </div>

            {/* Preview or Capture Area */}
            {mediaPreview ? (
              <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
                {mediaType === 'video' ? (
                  <video 
                    src={mediaPreview} 
                    className="w-full h-full object-cover" 
                    controls
                    data-testid="media-preview-video"
                  />
                ) : (
                  <img 
                    src={mediaPreview} 
                    alt="Conditions preview" 
                    className="w-full h-full object-cover"
                    data-testid="media-preview-image" 
                  />
                )}
                <button
                  onClick={clearMedia}
                  className="absolute top-2 right-2 w-8 h-8 bg-black/70 rounded-full flex items-center justify-center text-white hover:bg-red-500/70 transition-colors"
                  data-testid="clear-media-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : cameraActive ? (
              <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
                <video
                  ref={(el) => {
                    videoRef.current = el;
                    // Immediately attach stream when video element mounts
                    if (el && streamRef.current && !el.srcObject) {
                      el.srcObject = streamRef.current;
                      el.play().catch(() => {});
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  onLoadedMetadata={(e) => {
                    // Ensure video plays when metadata is loaded (iOS fix)
                    e.target.play().catch(() => {});
                  }}
                />
                {/* Recording indicator */}
                {isRecording && (
                  <div className="absolute top-3 left-3 flex items-center gap-2 px-2 py-1 bg-red-500/90 rounded-full">
                    <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                    <span className="text-white text-xs font-medium">REC</span>
                  </div>
                )}
                
                {/* Camera controls */}
                <div className="absolute bottom-3 left-0 right-0 flex justify-center items-center gap-3">
                  {/* Flip Camera Button */}
                  <Button
                    onClick={flipCamera}
                    variant="outline"
                    className="w-10 h-10 rounded-full border-zinc-600 text-white hover:bg-zinc-800 p-0"
                    data-testid="flip-camera-btn"
                  >
                    <RefreshCw className="w-5 h-5" />
                  </Button>
                  
                  {/* Main Capture Button */}
                  {cameraMode === 'photo' ? (
                    <Button
                      onClick={capturePhoto}
                      className="w-14 h-14 rounded-full bg-white hover:bg-gray-100"
                      data-testid="capture-photo-btn"
                    >
                      <Camera className="w-6 h-6 text-black" />
                    </Button>
                  ) : (
                    <Button
                      onClick={toggleVideoRecording}
                      className={`w-14 h-14 rounded-full ${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-red-500 hover:bg-red-600'}`}
                      data-testid="record-video-btn"
                    >
                      {isRecording ? (
                        <span className="w-5 h-5 bg-white rounded-sm" />
                      ) : (
                        <Video className="w-6 h-6 text-white" />
                      )}
                    </Button>
                  )}
                  
                  {/* Cancel Button */}
                  <Button
                    onClick={stopCamera}
                    variant="outline"
                    className="border-zinc-600 text-white hover:bg-zinc-800"
                    data-testid="cancel-camera-btn"
                  >
                    Cancel
                  </Button>
                </div>
                
                {/* Camera facing indicator */}
                <div className="absolute top-3 right-3 px-2 py-1 bg-black/50 rounded-full text-xs text-white">
                  {cameraFacing === 'environment' ? 'Rear' : 'Front'}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {/* Capture Photo */}
                <button
                  onClick={() => startCamera('photo')}
                  className="flex flex-col items-center justify-center gap-2 p-4 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-cyan-500/50 rounded-xl transition-all"
                  data-testid="start-photo-capture"
                >
                  <div className="w-12 h-12 rounded-full bg-cyan-500/20 flex items-center justify-center">
                    <Camera className="w-6 h-6 text-cyan-400" />
                  </div>
                  <span className="text-white text-sm font-medium">Take Photo</span>
                  <span className="text-gray-500 text-xs">Use camera</span>
                </button>
                
                {/* Capture Video */}
                <button
                  onClick={() => startCamera('video')}
                  className="flex flex-col items-center justify-center gap-2 p-4 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-purple-500/50 rounded-xl transition-all"
                  data-testid="start-video-capture"
                >
                  <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center">
                    <Video className="w-6 h-6 text-purple-400" />
                  </div>
                  <span className="text-white text-sm font-medium">Record Video</span>
                  <span className="text-gray-500 text-xs">15 sec max</span>
                </button>
                
                {/* Upload from Gallery */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="col-span-2 flex items-center justify-center gap-3 p-3 bg-zinc-800/50 hover:bg-zinc-800 border border-dashed border-zinc-700 hover:border-zinc-500 rounded-xl transition-all"
                  data-testid="upload-media-btn"
                >
                  <Upload className="w-5 h-5 text-gray-400" />
                  <span className="text-gray-400 text-sm">Upload from gallery</span>
                </button>
                
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleFileSelect}
                  className="hidden"
                  data-testid="file-input"
                />
              </div>
            )}
          </div>

          {/* Spot Notes */}
          <div className="space-y-2">
            <label className="text-gray-400 text-sm flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Spot Notes <span className="text-gray-600">(optional)</span>
            </label>
            <Textarea
              value={spotNotes}
              onChange={(e) => setSpotNotes(e.target.value)}
              placeholder="E.g., Clean 3-4ft sets, offshore winds, best at mid-tide..."
              className="bg-zinc-800 border-zinc-700 text-white placeholder-gray-500 resize-none h-20"
              maxLength={200}
              data-testid="spot-notes-input"
            />
            <p className="text-gray-600 text-xs text-right">{spotNotes.length}/200</p>
          </div>

          {/* Requirement Notice */}
          {!conditionMedia && (
            <div className="flex items-center gap-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0" />
              <p className="text-yellow-300 text-xs">
                Add a condition photo or video to enable Go Live
              </p>
            </div>
          )}
          </div>
        </div>

        <DialogFooter className="flex flex-row gap-3 border-t border-zinc-800">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 border-zinc-700 text-white hover:bg-zinc-800"
            disabled={isLoading}
            data-testid="cancel-conditions-btn"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canGoLive || isLoading}
            className={`flex-1 font-bold transition-all ${
              canGoLive 
                ? 'bg-gradient-to-r from-green-400 to-emerald-500 text-black hover:from-green-500 hover:to-emerald-600' 
                : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
            }`}
            data-testid="go-live-final-btn"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Go Live
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConditionsModal;
