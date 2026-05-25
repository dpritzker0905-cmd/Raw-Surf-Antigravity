import React from 'react';
import { Image, Video, Play, HelpCircle, Camera, Radio, Megaphone } from 'lucide-react';
import { Button } from '../ui/button';

export const EmptyMediaSelection = ({
  photoInputRef,
  videoInputRef,
  setShowCreateWaveModal,
  setShowVideoInfoModal,
  setShowWebcamModal,
  setShowGoLiveModal,
  setShowCreateAdModal,
}) => {
  return (
    <div className="space-y-4" data-testid="empty-media-selection">
      {/* Upload Area */}
      <div className="w-full rounded-2xl border-2 border-dashed border-border p-6 bg-muted/50">
        <p className="text-foreground font-medium text-lg text-center mb-2">Select media to post</p>
        <p className="text-muted-foreground text-sm text-center mb-6">Up to 10 photos or 1 video</p>
        
        <div className="flex justify-center gap-4 mb-4">
          {/* Photo Button */}
          <button aria-label="div"
            onClick={() => photoInputRef.current?.click()}
            className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-muted hover:bg-accent border-2 border-transparent hover:border-blue-500 transition-all active:scale-95"
            data-testid="photo-select-btn"
          >
            <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center">
              <Image className="w-8 h-8 text-blue-400" />
            </div>
            <span className="text-foreground font-medium">Photo</span>
            <span className="text-xs text-muted-foreground">JPG, PNG, HEIC</span>
          </button>

          {/* Video Button */}
          <button aria-label="div"
            onClick={() => videoInputRef.current?.click()}
            className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-muted hover:bg-accent border-2 border-transparent hover:border-purple-500 transition-all active:scale-95"
            data-testid="video-select-btn"
          >
            <div className="w-16 h-16 rounded-full bg-purple-500/20 flex items-center justify-center">
              <Video className="w-8 h-8 text-purple-400" />
            </div>
            <span className="text-foreground font-medium">Video</span>
            <span className="text-xs text-muted-foreground">MP4, MOV</span>
          </button>
          
          {/* Wave (Short Video) Button */}
          <button aria-label="div"
            onClick={() => setShowCreateWaveModal(true)}
            className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-muted hover:bg-accent border-2 border-transparent hover:border-cyan-500 transition-all active:scale-95"
            data-testid="wave-select-btn"
          >
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
              <Play className="w-8 h-8 text-cyan-400" />
            </div>
            <span className="text-foreground font-medium">Wave</span>
            <span className="text-xs text-muted-foreground">60s max</span>
          </button>
        </div>

        <p className="text-muted-foreground text-sm text-center">
          Videos auto-optimized to 1080p
        </p>
        
        {/* Help Link - Video vs Wave */}
        <button aria-label="Help"
          onClick={() => setShowVideoInfoModal(true)}
          className="flex items-center justify-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 mx-auto mt-2"
        >
          <HelpCircle className="w-4 h-4" />
          What's the difference between Video and Wave?
        </button>
      </div>

      {/* Camera shortcut */}
      <Button aria-label="Camera"
        onClick={() => setShowWebcamModal(true)}
        variant="outline"
        className="w-full h-12 border-border text-foreground hover:bg-muted font-medium"
      >
        <Camera className="w-5 h-5 mr-3 text-cyan-500 font-bold" />
        Capture Photo or Video
      </Button>

      {/* Go Live Option */}
      <Button aria-label="Radio"
        onClick={() => setShowGoLiveModal(true)}
        className="w-full h-12 bg-red-500 hover:bg-red-600 text-white border-0 font-bold"
      >
        <Radio className="w-5 h-5 mr-3 animate-pulse" />
        Go Live
      </Button>

      {/* Create Ad Option */}
      <Button aria-label="Megaphone"
        onClick={() => setShowCreateAdModal(true)}
        variant="outline"
        className="w-full h-12 border-purple-500/50 text-purple-500 dark:text-purple-400 hover:bg-purple-500/10 hover:border-purple-500"
        data-testid="create-ad-btn"
      >
        <Megaphone className="w-5 h-5 mr-2" />
        Create Ad
      </Button>
    </div>
  );
};

export default EmptyMediaSelection;
