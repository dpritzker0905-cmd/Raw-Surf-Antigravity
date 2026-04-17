import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, Video, X, Loader2, RefreshCcw, Circle, Square } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';

export default function WebcamCaptureModal({ isOpen, onClose, onCapture }) {
  const [stream, setStream] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [facingMode, setFacingMode] = useState('user'); // 'user' or 'environment'
  
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  const startCamera = useCallback(async () => {
    try {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: true
      });
      
      setStream(newStream);
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
      }
    } catch (err) {
      console.error("Camera access error:", err);
      toast.error("Could not access camera/microphone. Please check permissions.");
      onClose();
    }
  }, [facingMode, onClose, stream]);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
      if (isRecording) {
        stopRecording();
      }
    }
    
    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, facingMode]);

  const toggleCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  const takePhoto = () => {
    if (!videoRef.current) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    
    // Mirror horizontally if using front camera
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
        onCapture([file]);
        onClose();
      }
    }, 'image/jpeg', 0.9);
  };

  const startRecording = () => {
    if (!stream) return;
    
    chunksRef.current = [];
    // Prefer mp4 if supported, else webm
    const mimeType = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm;codecs=vp8,opus';
    
    const mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = mediaRecorder;
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
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
    
    timerRef.current = setInterval(() => {
      setRecordingTime(prev => prev + 1);
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent absolute top-0 left-0 right-0 z-10">
        <button onClick={onClose} className="p-2 bg-black/50 rounded-full text-white hover:bg-zinc-800 transition-colors">
          <X className="w-6 h-6" />
        </button>
        
        {isRecording && (
          <div className="flex items-center gap-2 bg-red-500/20 px-3 py-1 rounded-full backdrop-blur-md">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-white text-sm font-medium tracking-wide font-mono">
              {formatTime(recordingTime)}
            </span>
          </div>
        )}
        
        <button onClick={toggleCamera} disabled={isRecording} className={`p-2 bg-black/50 rounded-full text-white hover:bg-zinc-800 transition-colors ${isRecording ? 'opacity-50' : ''}`}>
          <RefreshCcw className="w-5 h-5" />
        </button>
      </div>

      {/* Viewfinder */}
      <div className="flex-1 relative bg-zinc-900 flex items-center justify-center overflow-hidden">
        {!stream && (
          <div className="flex flex-col items-center text-zinc-500">
            <Loader2 className="w-8 h-8 animate-spin mb-2" />
            <p>Accessing camera...</p>
          </div>
        )}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
        />
      </div>

      {/* Controls */}
      <div className="h-32 bg-black flex items-center justify-center gap-12 pb-6">
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

        <Button
          disabled
          variant="ghost" 
          className="flex flex-col items-center gap-2 hover:bg-transparent opacity-0 pointer-events-none"
        >
          {/* Invisible balancing element for layout mirroring */}
          <div className="w-12 h-12 rounded-full border-2 border-transparent" />
          <span className="text-transparent font-medium text-xs">Blank</span>
        </Button>
      </div>
    </div>
  );
}
