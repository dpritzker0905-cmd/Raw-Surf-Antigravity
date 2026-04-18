import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Play, Pause, Send, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';

const API = process.env.REACT_APP_BACKEND_URL;

// Supabase storage URL for voice notes
const _SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || '';

export const VoiceRecorder = ({ 
  onSend, 
  onCancel,
  conversationId,
  senderId,
  maxDuration = 60 // seconds
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [_isPaused, _setIsPaused] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [waveformData, setWaveformData] = useState([]);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const audioRef = useRef(null);
  const analyzerRef = useRef(null);
  const animationRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Set up audio analyzer for waveform
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyzer = audioContext.createAnalyser();
      analyzer.fftSize = 256;
      source.connect(analyzer);
      analyzerRef.current = analyzer;
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { 
          type: mediaRecorder.mimeType 
        });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);
      setDuration(0);
      
      // Start timer
      timerRef.current = setInterval(() => {
        setDuration(prev => {
          if (prev >= maxDuration) {
            stopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
      
      // Start waveform visualization
      visualizeWaveform();
      
    } catch (error) {
      logger.error('Failed to start recording:', error);
      toast.error('Microphone access denied');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    setIsRecording(false);
  };

  const visualizeWaveform = () => {
    if (!analyzerRef.current) return;
    
    const bufferLength = analyzerRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const draw = () => {
      if (!isRecording) return;
      
      analyzerRef.current.getByteFrequencyData(dataArray);
      
      // Get average amplitude for simplified waveform
      const average = dataArray.reduce((a, b) => a + b) / bufferLength;
      setWaveformData(prev => [...prev.slice(-50), average / 255]);
      
      animationRef.current = requestAnimationFrame(draw);
    };
    
    draw();
  };

  const togglePlayback = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSend = async () => {
    if (!audioBlob) return;
    
    setUploading(true);
    
    try {
      // Create form data for upload
      const formData = new FormData();
      formData.append('file', audioBlob, `voice_${Date.now()}.webm`);
      formData.append('duration', duration.toString());
      formData.append('conversation_id', conversationId);
      formData.append('sender_id', senderId);
      
      // Upload to backend (which handles Supabase storage)
      const response = await apiClient.post(
        `/messages/voice-note`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' }
        }
      );
      
      if (onSend) {
        onSend(response.data);
      }
      
      toast.success('Voice note sent!');
      handleCancel();
      
    } catch (error) {
      logger.error('Failed to send voice note:', error);
      toast.error('Failed to send voice note');
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    if (isRecording) {
      stopRecording();
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioBlob(null);
    setAudioUrl(null);
    setDuration(0);
    setWaveformData([]);
    if (onCancel) onCancel();
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-lg">
      {/* Cancel Button */}
      <button
        onClick={handleCancel}
        className="p-2 text-gray-400 hover:text-white rounded-full hover:bg-zinc-700 transition-colors"
      >
        <X className="w-5 h-5" />
      </button>

      {/* Waveform / Recording Indicator */}
      <div className="flex-1 h-10 flex items-center gap-0.5 overflow-hidden">
        {isRecording ? (
          // Live waveform
          waveformData.map((value, i) => (
            <div
              key={i}
              className="w-1 bg-red-500 rounded-full transition-all"
              style={{ height: `${Math.max(4, value * 32)}px` }}
            />
          ))
        ) : audioUrl ? (
          // Playback waveform (static representation)
          <div className="flex items-center gap-0.5 w-full">
            {Array.from({ length: 40 }).map((_, i) => (
              <div
                key={i}
                className={`w-1 rounded-full transition-all ${isPlaying ? 'bg-cyan-400' : 'bg-zinc-500'}`}
                style={{ height: `${Math.random() * 24 + 8}px` }}
              />
            ))}
          </div>
        ) : (
          <span className="text-gray-500 text-sm">Tap mic to record</span>
        )}
      </div>

      {/* Duration */}
      <span className={`text-sm font-mono min-w-[40px] ${isRecording ? 'text-red-400' : 'text-gray-400'}`}>
        {formatTime(duration)}
      </span>

      {/* Action Buttons */}
      {!audioBlob ? (
        // Recording controls
        <button
          onClick={isRecording ? stopRecording : startRecording}
          className={`p-3 rounded-full transition-all ${
            isRecording 
              ? 'bg-red-500 hover:bg-red-600 animate-pulse' 
              : 'bg-cyan-500 hover:bg-cyan-600'
          }`}
        >
          {isRecording ? (
            <Square className="w-5 h-5 text-white" />
          ) : (
            <Mic className="w-5 h-5 text-white" />
          )}
        </button>
      ) : (
        // Playback and send controls
        <div className="flex items-center gap-2">
          <button
            onClick={togglePlayback}
            className="p-2 bg-zinc-700 hover:bg-zinc-600 rounded-full transition-colors"
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 text-white" />
            ) : (
              <Play className="w-5 h-5 text-white" />
            )}
          </button>
          
          <button
            onClick={handleSend}
            disabled={uploading}
            className="p-3 bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 rounded-full transition-all"
          >
            {uploading ? (
              <Loader2 className="w-5 h-5 text-black animate-spin" />
            ) : (
              <Send className="w-5 h-5 text-black" />
            )}
          </button>
        </div>
      )}

      {/* Hidden audio element for playback */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onEnded={() => setIsPlaying(false)}
          className="hidden"
        />
      )}
    </div>
  );
};

export default VoiceRecorder;
