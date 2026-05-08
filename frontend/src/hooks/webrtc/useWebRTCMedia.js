/**
 * useWebRTCMedia — Media acquisition and track management for WebRTC calls.
 *
 * Handles:
 *   - getUserMedia with iOS Safari sequential permission strategy
 *   - Mute/unmute audio
 *   - Camera on/off toggle with track re-acquisition
 *   - Camera flip (front ↔ rear) with device enumeration fallbacks
 *   - Track replacement for WebGL filtered canvas streams
 */

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { logger } from '../../utils/logger';

// Detect iOS for platform-specific permission guidance
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Robust getUserMedia with sequential permission requests for iOS Safari.
 *
 * iOS Safari (iPhone 15+) is extremely strict about media permissions:
 *   - Requesting audio+video simultaneously can fail with NotAllowedError
 *     even when the user hasn't been prompted yet (gesture-gating).
 *   - Requesting audio first, then video separately, produces two
 *     sequential native permission prompts which iOS reliably shows.
 *
 * Strategy for VIDEO calls:
 *   1. Acquire audio-only stream (most reliable on all platforms)
 *   2. Acquire video-only stream (triggers separate camera prompt on iOS)
 *   3. Merge tracks into a single MediaStream
 *   Falls back to audio-only if video fails at every constraint level.
 *
 * Strategy for AUDIO calls:
 *   Single { audio: true } request.
 */
export async function getMediaStream(type = 'audio', facingMode = 'user') {
  // ── Pre-flight: Check if permissions are permanently denied ──
  // navigator.permissions.query is NOT available for camera/mic on Safari,
  // so we skip this check on iOS and rely on the getUserMedia error instead.
  if (!isIOS && navigator.permissions?.query) {
    try {
      const micPerm = await navigator.permissions.query({ name: 'microphone' });
      if (micPerm.state === 'denied') {
        console.warn('[WebRTC] Microphone permission permanently denied');
        throw Object.assign(new DOMException('Microphone permanently denied', 'NotAllowedError'), { _permanentlyDenied: true });
      }
    } catch (e) {
      if (e._permanentlyDenied) throw e;
      // permissions.query not supported for this name — continue
    }
  }

  // ── Step 1: Always acquire audio first ──
  let audioStream;
  try {
    logger.debug('[WebRTC] Step 1 — requesting audio-only…');
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    logger.debug('[WebRTC] ✅ Audio acquired:', audioStream.getAudioTracks().length, 'track(s)');
  } catch (err) {
    console.error('[WebRTC] ❌ Audio request failed:', err.name, err.message);
    throw err; // No audio = no call possible
  }

  // Audio-only call — we're done
  if (type !== 'video') {
    return audioStream;
  }

  // ── Step 2: Acquire video separately (iOS needs its own prompt) ──
  const videoConstraintChain = [
    { audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode } },
    { audio: false, video: { facingMode } },
    { audio: false, video: true },
  ];

  let videoStream = null;
  for (const constraints of videoConstraintChain) {
    try {
      logger.debug('[WebRTC] Step 2 — trying video with:', JSON.stringify(constraints));
      videoStream = await navigator.mediaDevices.getUserMedia(constraints);
      logger.debug('[WebRTC] ✅ Video acquired:', videoStream.getVideoTracks().length, 'track(s)');
      break;
    } catch (err) {
      console.warn('[WebRTC] Video attempt failed:', constraints, err.name, err.message);
    }
  }

  // ── Step 3: Merge into a single MediaStream ──
  if (videoStream) {
    const combined = new MediaStream();
    audioStream.getAudioTracks().forEach(t => combined.addTrack(t));
    videoStream.getVideoTracks().forEach(t => combined.addTrack(t));
    logger.debug('[WebRTC] ✅ Combined stream:', combined.getAudioTracks().length, 'audio,', combined.getVideoTracks().length, 'video');
    return combined;
  }

  // Video failed at all constraint levels — fall back to audio-only
  console.warn('[WebRTC] ⚠️ All video attempts failed, falling back to audio-only');
  toast('Camera unavailable \u{2014} continuing with audio only', { icon: '\u{1F4F9}' });
  return audioStream;
}

/**
 * useWebRTCMedia — Hook for managing local media controls during a WebRTC call.
 *
 * @param {Object} params
 * @param {React.MutableRefObject} params.localStreamRef - Ref to the current local MediaStream
 * @param {React.MutableRefObject} params.peerConnectionRef - Ref to the RTCPeerConnection
 * @param {Function} params.setLocalStream - State setter for localStream
 */
export function useWebRTCMedia({ localStreamRef, peerConnectionRef, setLocalStream }) {
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [facingMode, setFacingMode] = useState('user');

  // ── Toggle Mute ──────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach(track => {
      track.enabled = !track.enabled;
    });
    setIsMuted(prev => !prev);
  }, [localStreamRef]);

  // ── Toggle Camera ────────────────────────────────────────────────
  // When turning OFF: disable the video track (fast, no renegotiation needed)
  // When turning ON: re-acquire camera via getUserMedia to get a fresh track,
  //   then replace it on the stream AND peer connection sender so InCallView's
  //   WebGL pipeline restarts and the remote peer receives live frames again.
  const toggleCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    if (!isCameraOff) {
      // ── Turning camera OFF ──
      stream.getVideoTracks().forEach(track => {
        track.enabled = false;
      });
      setIsCameraOff(true);
    } else {
      // ── Turning camera back ON ──
      try {
        // Re-acquire a fresh video track from the camera hardware
        const freshMedia = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 } }
        });
        const freshVideoTrack = freshMedia.getVideoTracks()[0];

        if (!freshVideoTrack) {
          toast.error('Could not access camera');
          return;
        }

        // Swap the track on the existing stream
        const oldVideoTrack = stream.getVideoTracks()[0];
        if (oldVideoTrack) {
          stream.removeTrack(oldVideoTrack);
          oldVideoTrack.stop(); // Release old camera handle
        }
        stream.addTrack(freshVideoTrack);

        // Replace track on the peer connection sender for immediate remote visibility
        const pc = peerConnectionRef.current;
        if (pc) {
          const videoSender = pc.getSenders().find(s =>
            s.track?.kind === 'video' || (s._trackKind === 'video')
          );
          if (videoSender) {
            await videoSender.replaceTrack(freshVideoTrack);
            logger.debug('[WebRTC] \u{2705} Replaced sender track with fresh camera track');
          }
        }

        // Create a new MediaStream reference so React re-renders InCallView
        // which triggers the WebGL pipeline re-init (useEffect([localStream]))
        const updatedStream = new MediaStream(stream.getTracks());
        localStreamRef.current = updatedStream;
        setLocalStream(updatedStream);
        setIsCameraOff(false);

        logger.debug('[WebRTC] \u{2705} Camera re-enabled with fresh track');
      } catch (err) {
        console.error('[WebRTC] Failed to re-enable camera:', err);
        if (err.name === 'NotAllowedError') {
          toast.error('Camera access denied. Check your permissions.');
        } else {
          toast.error('Could not re-enable camera');
        }
      }
    }
  }, [isCameraOff, localStreamRef, peerConnectionRef, setLocalStream]);

  // ── Flip Camera (Front ↔ Rear) ───────────────────────────────────
  // Samsung S23 FE + many Android devices: must STOP the old camera
  // track BEFORE requesting a new one, otherwise the browser throws
  // OverconstrainedError or NotReadableError because the hardware
  // handle is still held by the running track.
  const flipCamera = useCallback(async () => {
    if (isCameraOff) return;
    const stream = localStreamRef.current;
    if (!stream) return;

    const newFacing = facingMode === 'user' ? 'environment' : 'user';

    // 1. Stop the old video track FIRST to release the camera hardware
    const oldVideoTrack = stream.getVideoTracks()[0];
    if (oldVideoTrack) {
      stream.removeTrack(oldVideoTrack);
      oldVideoTrack.stop();
    }

    // 2. Small delay for hardware release (critical on Samsung/Android)
    await new Promise(r => setTimeout(r, 300));

    // 3. Try acquiring new camera — cascade: ideal → plain string → deviceId
    let freshVideoTrack = null;

    // Attempt 1: ideal facingMode (broadest compatibility)
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: newFacing },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });
      freshVideoTrack = media.getVideoTracks()[0];
    } catch (e1) {
      logger.warn('[WebRTC] ideal facingMode failed:', e1.name);
    }

    // Attempt 2: plain string facingMode (no constraint wrapper)
    if (!freshVideoTrack) {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: newFacing,
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });
        freshVideoTrack = media.getVideoTracks()[0];
      } catch (e2) {
        logger.warn('[WebRTC] plain facingMode failed:', e2.name);
      }
    }

    // Attempt 3: enumerate devices and pick by deviceId
    if (!freshVideoTrack) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        // If we have multiple cameras, pick the one that's NOT the current
        if (videoDevices.length > 1) {
          const targetDevice = videoDevices.find(d => {
            const label = d.label.toLowerCase();
            return newFacing === 'environment'
              ? (label.includes('back') || label.includes('rear') || label.includes('environment'))
              : (label.includes('front') || label.includes('user'));
          }) || videoDevices.find(d => d.deviceId !== (oldVideoTrack?.getSettings?.()?.deviceId || ''));

          if (targetDevice) {
            const media = await navigator.mediaDevices.getUserMedia({
              video: {
                deviceId: { exact: targetDevice.deviceId },
                width: { ideal: 640 },
                height: { ideal: 480 },
              },
            });
            freshVideoTrack = media.getVideoTracks()[0];
          }
        }
      } catch (e3) {
        logger.warn('[WebRTC] enumerateDevices fallback failed:', e3.name);
      }
    }

    if (!freshVideoTrack) {
      // All attempts failed — re-acquire the original camera so the user isn't left with no video
      try {
        const recovery = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 } },
        });
        const recoveryTrack = recovery.getVideoTracks()[0];
        if (recoveryTrack) {
          stream.addTrack(recoveryTrack);
          const pc = peerConnectionRef.current;
          if (pc) {
            const sender = pc.getSenders().find(s => s.track?.kind === 'video' || !s.track);
            if (sender) await sender.replaceTrack(recoveryTrack);
          }
          const updated = new MediaStream(stream.getTracks());
          localStreamRef.current = updated;
          setLocalStream(updated);
        }
      } catch { /* last resort failed */ }
      toast.error('Could not switch camera on this device');
      return;
    }

    // 4. Add the new track and replace on peer connection
    stream.addTrack(freshVideoTrack);
    const pc = peerConnectionRef.current;
    if (pc) {
      const videoSender = pc.getSenders().find(s =>
        s.track?.kind === 'video' || (s._trackKind === 'video') || !s.track
      );
      if (videoSender) {
        await videoSender.replaceTrack(freshVideoTrack);
      }
    }

    // 5. Publish fresh stream reference for React re-render
    const updatedStream = new MediaStream(stream.getTracks());
    localStreamRef.current = updatedStream;
    setLocalStream(updatedStream);
    setFacingMode(newFacing);
    logger.debug(`[WebRTC] \u{2705} Camera flipped to ${newFacing}`);
  }, [isCameraOff, facingMode, localStreamRef, peerConnectionRef, setLocalStream]);

  // ── Replace Video Track (for WebGL filtered canvas stream) ──────
  const replaceVideoTrack = useCallback((newVideoTrack) => {
    const pc = peerConnectionRef.current;
    if (!pc || !newVideoTrack) return;
    
    const senders = pc.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
    if (videoSender) {
      videoSender.replaceTrack(newVideoTrack)
        .then(() => logger.debug('[WebRTC] \u{2705} Video track replaced with filtered canvas track'))
        .catch(err => console.error('[WebRTC] Failed to replace video track:', err));
    } else {
      console.warn('[WebRTC] No video sender found to replace track on');
    }
  }, [peerConnectionRef]);

  // Reset media state (called by orchestrator during cleanup)
  const resetMediaState = useCallback(() => {
    setIsMuted(false);
    setIsCameraOff(false);
  }, []);

  return {
    isMuted,
    isCameraOff,
    facingMode,
    toggleMute,
    toggleCamera,
    flipCamera,
    replaceVideoTrack,
    resetMediaState,
  };
}
