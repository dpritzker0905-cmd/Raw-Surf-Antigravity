// src/components/WebGLBroadcastController.js
import React, { useEffect, useRef } from 'react';
import { useRoomContext, useLocalParticipant } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { WebGLVideoProcessor } from '../utils/WebGLFilterEngine';
import logger from '../utils/logger';

export const WebGLBroadcastController = ({ activeFilter, isCameraOff, isFrontCamera }) => {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const processorRef = useRef(null);
  const publishedTrackRef = useRef(null);
  
  // Setup the hardware pipeline
  useEffect(() => {
    // Break off early if room hasn't hooked or the user muted their camera completely
    if (!room || !localParticipant || isCameraOff) return;

    let mediaStream = null;
    let isActive = true;

    const startPipeline = async () => {
      try {
        // Step 1: Hijack the raw hardware camera stream natively bypassing LiveKit defaults
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: isFrontCamera ? 'user' : 'environment' },
            audio: false // Audio is handled independently by the LiveKitRoom audio={true}
        });
        
        if (!isActive) return;

        // Step 2: Feed byte layers to invisible buffer video
        const video = videoRef.current;
        video.srcObject = mediaStream;
        video.muted = true;
        await video.play();

        // Step 3: Initiate the GPU Engine Matrix
        const canvas = canvasRef.current;
        // Dynamically scale the Canvas drawing buffer cleanly matching source resolution bounds
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        
        processorRef.current = new WebGLVideoProcessor(canvas);
        
        // Map the incoming react-state filter string to the shader program key safely
        let filterKey = 'none';
        if (activeFilter.includes('Cyber-Surf')) filterKey = 'cyber';
        if (activeFilter.includes('Bio-Lum')) filterKey = 'bioluminescence';
        if (activeFilter.includes('Pipeline')) filterKey = 'gopro';
        if (activeFilter.includes('Night Vision')) filterKey = 'nightvision';
        if (activeFilter.includes('Pixelate')) filterKey = 'pixelate';
        
        processorRef.current.setFilter(filterKey);
        processorRef.current.start(video);

        // Step 4: Extract mutated graphical canvas structure wrapping it into WebRTC MediaTrack
        const canvasStream = canvas.captureStream(30); // Request 30 FPS steady
        const customTrack = canvasStream.getVideoTracks()[0];

        // Step 5: Force manual publishing hook deep into peer data channel
        if (isActive) {
           const publication = await localParticipant.publishTrack(customTrack, {
               name: 'webgl-filtered-video',
               source: Track.Source.Camera
           });
           publishedTrackRef.current = publication;
           logger.info('[WebGL] Successfully published raw custom processed GPU track into LiveKit.');
        }

      } catch(err) {
        logger.error('[WebGL] Pipeline failure, hardware crashed:', err);
      }
    };

    startPipeline();

    // Deep Teardown Lifecycle
    return () => {
       isActive = false;
       if (processorRef.current) {
           processorRef.current.stop();
       }
       if (mediaStream) {
           mediaStream.getTracks().forEach(t => t.stop());
       }
       if (publishedTrackRef.current && localParticipant) {
           localParticipant.unpublishTrack(publishedTrackRef.current.track, true);
       }
    };
  }, [room, localParticipant, isCameraOff, isFrontCamera]);

  // Update matrix map dynamically reacting to UI button selections
  useEffect(() => {
     if (processorRef.current) {
        let filterKey = 'none';
        if (activeFilter.includes('Cyber-Surf')) filterKey = 'cyber';
        if (activeFilter.includes('Bio-Lum')) filterKey = 'bioluminescence';
        if (activeFilter.includes('Pipeline')) filterKey = 'gopro';
        if (activeFilter.includes('Night Vision')) filterKey = 'nightvision';
        if (activeFilter.includes('Pixelate')) filterKey = 'pixelate';
        processorRef.current.setFilter(filterKey);
     }
  }, [activeFilter]);

  // We explicitly return the canvas node replacing the original <VideoTrack />
  // This visually displays exactly what the Streamer is broadcasting.
  return (
    <>
      <video ref={videoRef} style={{ display: 'none' }} playsInline muted autoPlay />
      <canvas 
        ref={canvasRef} 
        className={`w-full h-full object-cover ${isFrontCamera ? 'scale-x-[-1]' : ''}`} 
      />
    </>
  );
};
