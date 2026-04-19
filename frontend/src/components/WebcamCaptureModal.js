import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Camera, X, Loader2, RefreshCcw, Sparkles, SlidersHorizontal, 
  CircleDot, Eye, Grid, Sunset, Waves, Moon, Zap, 
  Sun, Contrast, Droplets, Thermometer, RotateCcw, Scissors
} from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { WebGLVideoProcessor } from '../utils/WebGLFilterEngine';
import { HairFilterEngine } from '../utils/HairFilterEngine';
import { HairFilterPicker } from './HairFilterPicker';

export default function WebcamCaptureModal({ isOpen, onClose, onCapture, maxLength = null }) {
  const [stream, setStream] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [facingMode, setFacingMode] = useState('user'); 
  
  // Filtering Hooks
  const [showPresets, setShowPresets] = useState(false);
  const [showSliders, setShowSliders] = useState(false);
  const [showHairPicker, setShowHairPicker] = useState(false);
  const [activeHairStyle, setActiveHairStyle] = useState(null);
  const [videoFilters, setVideoFilters] = useState({ 
    brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0, presetName: 'None'
  });
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null); // Invisible canvas for WebRTC stream mapping
  const hairCanvasRef = useRef(null);
  const hairEngineRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const processorRef = useRef(null); // Explicit binding for high-resolution dynamic shader engine

  const startCamera = useCallback(async () => {
    try {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not accessible.');
      }

      let newStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
          audio: true
        });
      } catch (audioErr) {
        console.warn("Audio/Video simultaneous hook failed, falling back to Video only.", audioErr);
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } }
        });
      }
      
      setStream(newStream);
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
      }
    } catch (err) {
      console.error("Camera access error:", err);
      toast.error("Could not access camera/microphone. Please check permissions.");
      // Ensure we immediately purge pending bindings if a hardware error is detected natively
      if (videoRef.current && videoRef.current.srcObject) {
         videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }
      onClose();
    }
  }, [facingMode, onClose]);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      // Escape stale closure scope relying strictly on the active DOM source mapping
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
      if (isRecording) stopRecording();
    }
    
    return () => {
      // Critical cleanup executing safely circumventing React closures to prevent Mobile WebRTC hardware freeze locks!
      if (videoRef.current && videoRef.current.srcObject) {
         videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
         mediaRecorderRef.current.stop();
      }
      if (processorRef.current) {
         processorRef.current.stop();
         processorRef.current = null;
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // Intentionally limited deps: only trigger on modal open/close and camera switch
  }, [isOpen, facingMode]);

  // Utilize the exact identical hardware shader mapped in the Live broadcast resolving highest tier filter deployments
  const initProcessor = useCallback((video) => {
    if (!video || !canvasRef.current) return;
    try {
      if (!processorRef.current) {
        canvasRef.current.width = video.videoWidth || 1080;
        canvasRef.current.height = video.videoHeight || 1920;
        processorRef.current = new WebGLVideoProcessor(canvasRef.current);
      }
      
      let filterKey = 'none';
      if (videoFilters.presetName.includes('Cyber-Surf')) filterKey = 'cyber';
      else if (videoFilters.presetName.includes('Golden Hour')) filterKey = 'goldenhour';
      else if (videoFilters.presetName.includes('Bio-Lum')) filterKey = 'bioluminescence';
      else if (videoFilters.presetName.includes('Pipeline')) filterKey = 'gopro';
      else if (videoFilters.presetName.includes('Night Vision')) filterKey = 'nightvision';
      else if (videoFilters.presetName.includes('Pixelate')) filterKey = 'pixelate';
      else filterKey = 'none';

      processorRef.current.setFilter(filterKey);
      processorRef.current.start(video);
    } catch (e) {
      console.warn("WebGL Shader instantiation crashed - falling back silently.", e);
    }
  }, [videoFilters.presetName]);

  useEffect(() => {
    if (stream && videoRef.current && videoRef.current.readyState >= 2) {
      initProcessor(videoRef.current);
    }
  }, [stream, videoFilters.presetName, initProcessor]);

  const toggleCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  const takePhoto = () => {
    // If our invisible canvas stalled drawing (e.g. 1x1 width or missing dimensions), forcefully execute raw hardware buffer snapshot to secure fallback reliability ensuring no Black Photos
    if (videoRef.current && (!canvasRef.current || canvasRef.current.width === 0 || canvasRef.current.width === 300)) {
       const vRef = videoRef.current;
       const fallbackCanvas = document.createElement('canvas');
       fallbackCanvas.width = vRef.videoWidth || 1080;
       fallbackCanvas.height = vRef.videoHeight || 1920;
       const fallbackCtx = fallbackCanvas.getContext('2d');
       
       if (facingMode === 'user') {
         fallbackCtx.translate(fallbackCanvas.width, 0);
         fallbackCtx.scale(-1, 1);
       }
       fallbackCtx.drawImage(vRef, 0, 0, fallbackCanvas.width, fallbackCanvas.height);
       fallbackCanvas.toBlob((blob) => {
         if (blob) {
           onCapture([new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' })]);
           onClose();
         }
       }, 'image/jpeg', 0.9);
       return;
    }

    if (!canvasRef.current) return;
    
    canvasRef.current.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
        onCapture([file]);
        onClose();
      }
    }, 'image/jpeg', 0.9);
  };

  const startRecording = () => {
    if (!stream || !canvasRef.current) return;
    
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm;codecs=vp8,opus';
    
    // Pull the active canvas drawing stream structurally embedding the visual aesthetic!
    const capturedStream = canvasRef.current.captureStream(30);
    
    // Reattach the hardware mic track into the isolated WebGL canvas stream
    if (stream.getAudioTracks().length > 0) {
       capturedStream.addTrack(stream.getAudioTracks()[0]);
    }

    const mediaRecorder = new MediaRecorder(capturedStream, { mimeType });
    mediaRecorderRef.current = mediaRecorder;
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([blob], `video_${Date.now()}.${extension}`, { type: mimeType });
      onCapture([file]);
      onClose();
    };
    
    mediaRecorder.start(100);
    setIsRecording(true);
    setRecordingTime(0);
    
    let currentSeconds = 0;
    timerRef.current = setInterval(() => {
      currentSeconds += 1;
      setRecordingTime(currentSeconds);
      
      if (maxLength && currentSeconds >= maxLength) {
        if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        setIsRecording(false);
        clearInterval(timerRef.current);
      }
    }, 1000);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleFilterChange = (key, val) => setVideoFilters(p => ({ ...p, [key]: val }));
  const handlePresetSelect = (preset) => {
    setVideoFilters({ ...preset.values, presetName: preset.name });
    toast.success('Filter active');
  };

  // ── Hair Filter Engine lifecycle ──
  useEffect(() => {
    const engine = new HairFilterEngine();
    hairEngineRef.current = engine;
    engine.init().catch(() => {});
    return () => {
      engine.dispose();
      hairEngineRef.current = null;
    };
  }, []);

  // Start/stop hair engine when camera stream changes
  useEffect(() => {
    const engine = hairEngineRef.current;
    if (!engine || !engine._initialized || !stream) return;
    
    const videoEl = videoRef.current;
    const hairCanvas = hairCanvasRef.current;
    
    if (videoEl && hairCanvas) {
      const timer = setTimeout(() => {
        engine.start(videoEl, hairCanvas);
      }, 500);
      return () => { clearTimeout(timer); engine.stop(); };
    }
  }, [stream]);
  
  // Update hair style when selection changes
  useEffect(() => {
    const engine = hairEngineRef.current;
    if (engine) engine.setHairStyle(activeHairStyle);
  }, [activeHairStyle]);
  
  const handleSelectHairStyle = useCallback((styleId) => {
    setActiveHairStyle(styleId);
    setShowHairPicker(false);
    if (styleId) toast.success('Hair filter applied! 💇');
  }, []);

  if (!isOpen) return null;

  const presets = [
    { name: 'None', icon: CircleDot, values: { brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0 } },
    { name: 'AI Night Vision', icon: Eye, values: { brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0 } },
    { name: 'AI Pixelate', icon: Grid, values: { brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0 } },
    { name: 'Golden Hour', icon: Sunset, values: { brightness: 105, contrast: 110, saturation: 120, warmth: 120, vignette: 20 } },
    { name: 'AI Pipeline', icon: Waves, values: { brightness: 90, contrast: 130, saturation: 90, warmth: 110, vignette: 40 } },
    { name: 'AI Bio-Lum', icon: Moon, values: { brightness: 85, contrast: 140, saturation: 150, warmth: 160, vignette: 30 } },
    { name: 'AI Cyber-Surf', icon: Zap, values: { brightness: 110, contrast: 125, saturation: 140, warmth: 40, vignette: 0 } }
  ];

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-0 sm:p-6">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm hidden sm:block" onClick={onClose} />
      
      <div className="relative w-full h-full sm:w-[1100px] sm:h-[720px] sm:max-h-[90vh] sm:rounded-2xl sm:overflow-hidden bg-black shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent absolute top-0 left-0 right-0 z-20 pointer-events-none">
          <button onClick={onClose} className="p-2 bg-black/50 rounded-full text-white hover:bg-zinc-800 transition-colors pointer-events-auto">
            <X className="w-6 h-6" />
          </button>
          
          <div className="flex gap-2 pointer-events-auto">
            {isRecording ? (
              <div className="bg-black/50 backdrop-blur text-white px-3 py-1 rounded-full text-sm font-medium flex items-center gap-2">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className={maxLength && recordingTime >= maxLength - 5 ? 'text-red-400 font-bold' : ''}>
                  {formatTime(recordingTime)} {maxLength ? `/ ${formatTime(maxLength)}` : ''}
                </span>
              </div>
            ) : (
              <div className="bg-black/50 backdrop-blur text-white px-3 py-1 rounded-full text-sm font-medium flex items-center gap-2">
                <Camera className="w-4 h-4" />
                <span>Camera</span>
              </div>
            )}
          </div>

          <button onClick={toggleCamera} disabled={isRecording} className={`p-2 bg-black/50 rounded-full text-white hover:bg-zinc-800 transition-colors ${isRecording ? 'opacity-50' : ''} pointer-events-auto`}>
            <RefreshCcw className="w-5 h-5" />
          </button>
        </div>

        {/* Floating Side Tools (Exactly like GoLiveModal transparent buttons) */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-3 z-[60] pointer-events-auto">
          <button
            onClick={() => { setShowPresets(!showPresets); setShowSliders(false); setShowHairPicker(false); }}
            className={`p-3 rounded-full bg-black/40 backdrop-blur border border-white/20 transition-all active:scale-95 shadow-md ${showPresets ? 'bg-cyan-500 text-white border-transparent' : 'text-white'}`}
            title="Surf Filters"
          >
            <Sparkles className="w-5 h-5" />
          </button>
          <button
            onClick={() => { setShowSliders(!showSliders); setShowPresets(false); setShowHairPicker(false); }}
            className={`p-3 rounded-full bg-black/40 backdrop-blur border border-white/20 transition-all active:scale-95 shadow-md ${showSliders ? 'bg-cyan-500 text-white border-transparent' : 'text-white'}`}
            title="Filter Adjustments"
          >
            <SlidersHorizontal className="w-5 h-5" />
          </button>
          <button
            onClick={() => { setShowHairPicker(!showHairPicker); setShowPresets(false); setShowSliders(false); }}
            className={`p-3 rounded-full bg-black/40 backdrop-blur border border-white/20 transition-all active:scale-95 shadow-md ${showHairPicker ? 'bg-yellow-500 text-white border-transparent' : activeHairStyle ? 'bg-yellow-500/30 border-yellow-500/50 text-white' : 'text-white'}`}
            title="Hair Filters"
          >
            <Scissors className="w-5 h-5" />
          </button>
        </div>

        {/* Filter Popups */}
        <AnimatePresence>
          {showPresets && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
              className="absolute right-16 top-1/4 w-60 max-h-[50vh] overflow-y-auto bg-black/70 backdrop-blur-md border border-zinc-700 p-3 rounded-xl z-[60]"
            >
              <div className="flex items-center justify-between mb-3 border-b border-zinc-700 pb-2">
                <span className="text-white text-sm font-bold">Presets</span>
                <X className="w-4 h-4 text-zinc-400 cursor-pointer" onClick={() => setShowPresets(false)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {presets.map(preset => {
                  const Icon = preset.icon;
                  return (
                    <button key={preset.name} onClick={() => handlePresetSelect(preset)}
                      className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-transform hover:scale-105 ${videoFilters.presetName === preset.name ? 'bg-cyan-500/30 border border-cyan-500' : 'bg-zinc-800/60'}`}
                    >
                      <Icon className="w-4 h-4 text-cyan-400" />
                      <span className="text-white text-[10px] text-center">{preset.name}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {showSliders && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
              className="absolute right-16 top-1/4 w-60 max-h-[50vh] overflow-y-auto bg-black/70 backdrop-blur-md border border-zinc-700 p-4 rounded-xl z-[60]"
            >
              <div className="flex items-center justify-between mb-3 border-b border-zinc-700 pb-2">
                <span className="text-white text-sm font-bold">Adjustments</span>
                <X className="w-4 h-4 text-zinc-400 cursor-pointer" onClick={() => setShowSliders(false)} />
              </div>
              
              {/* Sliders */}
              {[
                { key: 'brightness', label: 'Brightness', icon: Sun, min: 50, max: 150 },
                { key: 'contrast', label: 'Contrast', icon: Contrast, min: 50, max: 150 },
                { key: 'saturation', label: 'Saturation', icon: Droplets, min: 50, max: 150 },
                { key: 'warmth', label: 'Warmth', icon: Thermometer, min: 50, max: 150 },
                { key: 'vignette', label: 'Vignette', icon: CircleDot, min: 0, max: 50 }
              ].map(slider => (
                <div key={slider.key} className="mb-3">
                  <div className="flex items-center justify-between pointer-events-none mb-1">
                    <div className="flex items-center gap-1.5"><slider.icon className="w-3 h-3 text-zinc-300" /><span className="text-xs text-zinc-300">{slider.label}</span></div>
                    <span className="text-[10px] text-white font-mono">{videoFilters[slider.key]}%</span>
                  </div>
                  <input type="range" min={slider.min} max={slider.max} value={videoFilters[slider.key]} onChange={(e) => handleFilterChange(slider.key, parseInt(e.target.value))} className="w-full h-1.5 rounded-full appearance-none accent-cyan-500 cursor-pointer" />
                </div>
              ))}
              <Button onClick={() => setVideoFilters({ brightness: 100, contrast: 100, saturation: 100, warmth: 100, vignette: 0, presetName: 'None' })} size="sm" variant="outline" className="w-full bg-zinc-800 text-white border-zinc-700 mt-2 hover:bg-zinc-700 hover:text-white">
                <RotateCcw className="w-3 h-3 mr-2" /> Reset
              </Button>
            </motion.div>
          )}

          {/* Hair Filter Picker */}
          {showHairPicker && (
            <HairFilterPicker
              isOpen={showHairPicker}
              onClose={() => setShowHairPicker(false)}
              activeStyleId={activeHairStyle}
              onSelectHair={handleSelectHairStyle}
              colors={{
                overlayBg: 'bg-black/70 backdrop-blur-md',
                primaryText: 'text-white',
                secondaryText: 'text-zinc-400',
                accentText: 'text-cyan-400',
                buttonBg: 'bg-white/10 hover:bg-white/20',
                border: 'border-zinc-700',
              }}
            />
          )}
        </AnimatePresence>

        {/* Viewfinder block physically tracking canvas structure for recording */}
        <div className="flex-1 relative bg-zinc-900 flex items-center justify-center overflow-hidden">
          {!stream && (
            <div className="flex flex-col items-center text-zinc-500">
              <Loader2 className="w-8 h-8 animate-spin mb-2" />
              <p>Accessing camera...</p>
            </div>
          )}
          {/* Expand core hardware view bounding securely ensuring background decoding maps accurately unblocking Mobile processors safely */}
          <video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={(e) => { 
            if (e.target) {
              e.target.play().catch(() => {});
              initProcessor(e.target);
            }
          }} className="absolute inset-0 w-full h-full object-cover opacity-0 pointer-events-none z-0" />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover z-10" />
          {/* Hair filter canvas overlay */}
          <canvas ref={hairCanvasRef} className="absolute inset-0 w-full h-full object-cover pointer-events-none z-[15]" />
        </div>

        {/* Rule of Thirds */}
        <div className="absolute inset-x-0 bottom-[160px] top-[72px] pointer-events-none z-[5] opacity-20 flex flex-col justify-center items-center mix-blend-overlay hidden sm:flex">
          <div className="w-full h-1/3 border-b border-t border-white" />
          <div className="absolute top-0 bottom-0 left-1/3 right-1/3 border-l border-r border-white" />
        </div>

        {/* Controls */}
        <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-black/95 via-black/50 to-transparent flex items-center justify-center gap-12 pb-6 z-20 pointer-events-auto">
          <Button
            onClick={takePhoto}
            disabled={isRecording}
            variant="ghost"
            className={`flex flex-col items-center gap-2 hover:bg-transparent ${isRecording ? 'opacity-30' : 'opacity-100'} transition-opacity`}
          >
            <div className="w-12 h-12 rounded-full border-2 border-white flex items-center justify-center">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <span className="text-white font-medium text-xs">Photo</span>
          </Button>

          <div className="relative">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`w-20 h-20 rounded-full border-4 flex items-center justify-center transition-colors ${isRecording ? 'border-red-500' : 'border-white'}`}
            >
              <div className={`transition-all duration-300 ${isRecording ? 'w-8 h-8 rounded-md bg-red-500' : 'w-16 h-16 rounded-full bg-red-500'}`} />
            </button>
          </div>

          <Button disabled variant="ghost" className="flex flex-col items-center gap-2 hover:bg-transparent opacity-0 pointer-events-none">
            <div className="w-12 h-12 rounded-full border-2 border-transparent" />
            <span className="text-transparent font-medium text-xs">Blank</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
