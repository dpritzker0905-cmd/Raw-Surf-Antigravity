/**
 * useWebRTCCall — React hook for 1-on-1 audio/video calling via WebRTC.
 *
 * Architecture:
 *   - Signaling: WebSocket (/ws/call/{userId}) for SDP & ICE exchange
 *   - NAT Traversal: Google free STUN servers
 *   - Media: getUserMedia for local stream, RTCPeerConnection for P2P
 *
 * Call Flow:
 *   1. Caller: startCall(targetUserId, 'audio'|'video')
 *   2. Callee: receives 'incoming_call' via WS → shows IncomingCallModal
 *   3. Callee: answerCall() → sends SDP answer
 *   4. Both: exchange ICE candidates → P2P stream established
 *   5. Either: endCall() → cleanup
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { toast } from 'sonner';
import { unlockAudioNow } from '../utils/audioUnlock';

// STUN + TURN servers for reliable NAT traversal
// STUN alone fails ~15-20% of the time (symmetric NAT, mobile carriers, corporate networks)
// TURN from Metered.ca (rawsurf app) + Google STUN
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.relay.metered.ca:80' },
  {
    urls: 'turn:global.relay.metered.ca:80',
    username: '625f8466354cfa3017779b2b',
    credential: 'g4h9mvCCyzX7Hk0H',
  },
  {
    urls: 'turn:global.relay.metered.ca:80?transport=tcp',
    username: '625f8466354cfa3017779b2b',
    credential: 'g4h9mvCCyzX7Hk0H',
  },
  {
    urls: 'turn:global.relay.metered.ca:443',
    username: '625f8466354cfa3017779b2b',
    credential: 'g4h9mvCCyzX7Hk0H',
  },
  {
    urls: 'turn:global.relay.metered.ca:443?transport=tcp',
    username: '625f8466354cfa3017779b2b',
    credential: 'g4h9mvCCyzX7Hk0H',
  },
];

// Call states
export const CALL_STATE = {
  IDLE: 'idle',
  OUTGOING: 'outgoing',    // waiting for callee to answer
  INCOMING: 'incoming',     // ringing — waiting for user to accept/decline
  CONNECTING: 'connecting', // SDP exchanged, waiting for ICE
  IN_CALL: 'in-call',       // media flowing
  ENDED: 'ended',           // call finished
};

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
async function getMediaStream(type = 'audio', facingMode = 'user') {
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
    console.log('[WebRTC] Step 1 — requesting audio-only…');
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log('[WebRTC] ✅ Audio acquired:', audioStream.getAudioTracks().length, 'track(s)');
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
      console.log('[WebRTC] Step 2 — trying video with:', JSON.stringify(constraints));
      videoStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[WebRTC] ✅ Video acquired:', videoStream.getVideoTracks().length, 'track(s)');
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
    console.log('[WebRTC] ✅ Combined stream:', combined.getAudioTracks().length, 'audio,', combined.getVideoTracks().length, 'video');
    return combined;
  }

  // Video failed at all constraint levels — fall back to audio-only
  console.warn('[WebRTC] ⚠️ All video attempts failed, falling back to audio-only');
  toast('Camera unavailable — continuing with audio only', { icon: '📹' });
  return audioStream;
}

export function useWebRTCCall(userId, userInfo = {}) {
  // State
  const [callState, setCallState] = useState(CALL_STATE.IDLE);
  const [callType, setCallType] = useState(null); // 'audio' | 'video'
  const [remoteStream, setRemoteStream] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [facingMode, setFacingMode] = useState('user'); // 'user' = front, 'environment' = rear
  const [callDuration, setCallDuration] = useState(0);
  const [remoteUserInfo, setRemoteUserInfo] = useState(null); // { id, name, avatar }
  const [connectionQuality, setConnectionQuality] = useState('good'); // good, fair, poor

  // Refs (avoid re-renders for WebRTC internals)
  const peerConnection = useRef(null);
  const wsRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const callTimerRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const statsIntervalRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const callStartTimeRef = useRef(null);
  const keepaliveRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const callRetryRef = useRef(null); // Timer for auto-retrying call offers
  const callRetryCountRef = useRef(0);
  const pendingOfferRef = useRef(null); // Store the last call_offer for retrying
  const earlyIceCandidatesRef = useRef([]); // Buffer ICE candidates received before answerCall creates real PC

  // Track call state in ref to avoid stale closures in WS handlers
  const callStateRef = useRef(callState);
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  
  // Track remoteUserInfo in ref to avoid stale closures in ICE candidate handler
  const remoteUserInfoRef = useRef(remoteUserInfo);
  useEffect(() => { remoteUserInfoRef.current = remoteUserInfo; }, [remoteUserInfo]);

  // ── WebSocket Connection ──────────────────────────────────────────
  const connectSignaling = useCallback(() => {
    if (!userId) return;
    
    // Don't reconnect if already open
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    
    // Build WS URL from backend URL
    // NOTE: WebSocket routes are under /api prefix (api_router in __init__.py)
    const wsProtocol = BACKEND_URL.startsWith('https') ? 'wss' : 'ws';
    const wsHost = BACKEND_URL.replace(/^https?:\/\//, '');
    const wsUrl = `${wsProtocol}://${wsHost}/api/ws/call/${userId}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WebRTC] ✅ Signaling WS connected to:', wsUrl);
        // Reset reconnect backoff on success
        reconnectAttemptsRef.current = 0;
        // Flush any pending ICE candidates
        if (pendingCandidatesRef.current.length > 0) {
          pendingCandidatesRef.current.forEach(c => {
            ws.send(JSON.stringify(c));
          });
          pendingCandidatesRef.current = [];
        }
        // Start keepalive ping every 20s (Render.com drops idle WS at ~60s)
        if (keepaliveRef.current) clearInterval(keepaliveRef.current);
        keepaliveRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 20000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleSignalingMessage(data);
        } catch (e) {
          // Ignore pong responses and parse errors for non-JSON
          if (event.data !== '{"type":"pong"}') {
            console.error('[WebRTC] Failed to parse signaling message:', e);
          }
        }
      };

      ws.onclose = () => {
        console.debug('[WebRTC] Signaling WS closed');
        if (keepaliveRef.current) clearInterval(keepaliveRef.current);
        // ALWAYS reconnect — the receiver must stay connected to receive incoming calls
        const attempts = reconnectAttemptsRef.current || 0;
        const delay = Math.min(2000 * Math.pow(1.5, attempts), 30000); // 2s → 3s → 4.5s → ... max 30s
        reconnectAttemptsRef.current = attempts + 1;
        console.debug(`[WebRTC] Reconnecting in ${delay}ms (attempt ${attempts + 1})`);
        reconnectTimerRef.current = setTimeout(() => connectSignaling(), delay);
      };

      ws.onerror = (err) => {
        console.error('[WebRTC] Signaling WS error:', err);
      };
    } catch (e) {
      console.error('[WebRTC] Failed to connect signaling:', e);
    }
  }, [userId]);

  // Connect on mount
  useEffect(() => {
    connectSignaling();
    return () => {
      // Prevent reconnect on unmount
      clearTimeout(reconnectTimerRef.current);
      clearInterval(keepaliveRef.current);
      reconnectAttemptsRef.current = 999; // prevent further reconnects
      wsRef.current?.close();
    };
  }, [connectSignaling]);

  // ── Signaling Message Handler ─────────────────────────────────────
  const handleSignalingMessage = useCallback(async (data) => {
    switch (data.type) {
      case 'call_offer': {
        // Incoming call — check if we're already in a call
        if (callStateRef.current !== CALL_STATE.IDLE) {
          // Already in a call or ringing — send busy
          sendSignaling({
            type: 'call_busy',
            target_user_id: data.caller_id,
          });
          break;
        }
        console.debug('[WebRTC] Incoming call from:', data.caller_id);
        setRemoteUserInfo({
          id: data.caller_id,
          name: data.caller_name || 'Unknown',
          avatar: data.caller_avatar,
        });
        setCallType(data.call_type || 'audio');
        setCallState(CALL_STATE.INCOMING);

        // Store the offer SDP for when user accepts
        peerConnection.current = { _pendingOffer: data.sdp };
        // Reset early ICE buffer — candidates arriving before Accept will be queued here
        earlyIceCandidatesRef.current = [];
        break;
      }

      case 'call_answer': {
        // Callee accepted — set remote description
        console.debug('[WebRTC] Call answered');
        setCallState(CALL_STATE.CONNECTING);
        try {
          const pc = peerConnection.current;
          if (pc && pc.setRemoteDescription) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            
            // Flush any ICE candidates that arrived before we had the remote description
            if (earlyIceCandidatesRef.current.length > 0) {
              console.log(`[WebRTC] Flushing ${earlyIceCandidatesRef.current.length} early ICE candidates after setRemoteDescription`);
              for (const candidate of earlyIceCandidatesRef.current) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (iceErr) {
                  console.warn('[WebRTC] Failed to apply queued ICE candidate:', iceErr);
                }
              }
              earlyIceCandidatesRef.current = [];
            }
          }
        } catch (e) {
          console.error('[WebRTC] Failed to set remote description:', e);
        }
        break;
      }

      case 'ice_candidate': {
        // Add ICE candidate from remote peer
        try {
          const pc = peerConnection.current;
          if (pc && pc.addIceCandidate && data.candidate) {
            // Real PeerConnection exists — check if remote description is set
            if (pc.remoteDescription && pc.remoteDescription.type) {
              // Remote description is set — safe to add directly
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } else {
              // Remote description not yet set (caller waiting for answer, or callee pre-Accept)
              // Buffer for later application
              console.debug('[WebRTC] Buffering ICE candidate (remote description not yet set)');
              earlyIceCandidatesRef.current.push(data.candidate);
            }
          } else if (data.candidate) {
            // PeerConnection not ready yet (e.g. user hasn't tapped Accept)
            // Buffer the candidate so answerCall can apply it later
            console.debug('[WebRTC] Buffering early ICE candidate (PC not ready)');
            earlyIceCandidatesRef.current.push(data.candidate);
          }
        } catch (e) {
          // If addIceCandidate throws, buffer the candidate instead of losing it
          if (data.candidate) {
            console.debug('[WebRTC] addIceCandidate threw, buffering:', e.message);
            earlyIceCandidatesRef.current.push(data.candidate);
          }
        }
        break;
      }

      case 'call_decline': {
        console.debug('[WebRTC] Call declined');
        toast('Call declined', { icon: '📵' });
        cleanup();
        break;
      }

      case 'call_end': {
        console.debug('[WebRTC] Call ended by remote');
        toast('Call ended', { icon: '📞' });
        cleanup();
        break;
      }

      case 'call_busy': {
        console.debug('[WebRTC] User is busy');
        toast('User is busy on another call', { icon: '📵' });
        cleanup();
        break;
      }

      case 'call_accepted_elsewhere': {
        // Another device/tab answered this call — stop ringing here
        console.debug('[WebRTC] Call answered on another device');
        if (callStateRef.current === CALL_STATE.INCOMING) {
          toast('Call answered on another device', { icon: '📱' });
          setCallState(CALL_STATE.IDLE);
          setCallType(null);
          setRemoteUserInfo(null);
        }
        break;
      }

      case 'call_target_offline': {
        // Target user's WS is not connected — auto-retry the offer
        const retryCount = callRetryCountRef.current || 0;
        const MAX_RETRIES = 5;
        if (retryCount < MAX_RETRIES && callStateRef.current === CALL_STATE.OUTGOING && pendingOfferRef.current) {
          console.debug(`[WebRTC] Target offline, retrying offer (${retryCount + 1}/${MAX_RETRIES})...`);
          callRetryCountRef.current = retryCount + 1;
          callRetryRef.current = setTimeout(() => {
            if (callStateRef.current === CALL_STATE.OUTGOING && pendingOfferRef.current) {
              sendSignaling(pendingOfferRef.current);
            }
          }, 2000);
        } else if (retryCount >= MAX_RETRIES) {
          console.debug('[WebRTC] Max retries reached, target appears offline');
          toast('User is currently unavailable', { icon: '📵' });
          cleanup();
        }
        break;
      }

      default:
        break;
    }
  }, []);

  // Listen for signaling messages with updated handleSignalingMessage
  useEffect(() => {
    if (!wsRef.current) return;
    wsRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleSignalingMessage(data);
      } catch (e) {
        console.error('[WebRTC] Parse error:', e);
      }
    };
  }, [handleSignalingMessage]);

  // ── Create Peer Connection ────────────────────────────────────────
  const createPeerConnection = useCallback((isVideo = false) => {
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      sdpSemantics: 'unified-plan', // Explicit for Safari/Chrome cross-platform compatibility
      iceTransportPolicy: 'all',    // Use all available transports (relay + direct)
    });

    // Handle ICE candidates — use ref to avoid stale closure
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignaling({
          type: 'ice_candidate',
          candidate: event.candidate,
          target_user_id: remoteUserInfoRef.current?.id,
        });
      }
    };

    // Handle connection state
    pc.onconnectionstatechange = () => {
      console.debug('[WebRTC] Connection state:', pc.connectionState);
      switch (pc.connectionState) {
        case 'connected':
          setCallState(CALL_STATE.IN_CALL);
          startCallTimer();
          startStatsMonitor(pc);
          break;
        case 'disconnected':
        case 'failed':
          setConnectionQuality('poor');
          // Try ICE restart
          if (pc.connectionState === 'failed') {
            toast.error('Call connection lost');
            cleanup();
          }
          break;
        case 'closed':
          cleanup();
          break;
        default:
          break;
      }
    };

    // iOS Safari fallback — it doesn't always fire onconnectionstatechange
    // but DOES fire oniceconnectionstatechange. Without this, iPhone calls
    // can connect at the ICE level but the UI stays stuck on "connecting...".
    pc.oniceconnectionstatechange = () => {
      console.debug('[WebRTC] ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        // If connectionState hasn't already handled this, force IN_CALL
        if (callStateRef.current !== CALL_STATE.IN_CALL) {
          console.log('[WebRTC] ✅ ICE connected — forcing IN_CALL state (iOS Safari fix)');
          setCallState(CALL_STATE.IN_CALL);
          startCallTimer();
          startStatsMonitor(pc);
        }
      } else if (pc.iceConnectionState === 'failed') {
        console.warn('[WebRTC] ICE failed');
        toast.error('Call connection failed');
        cleanup();
      }
    };

    // Handle incoming streams — iOS Safari CRITICAL:
    //   event.streams[0] carries an internal WebRTC autoplay exemption flag.
    //   Wrapping tracks in `new MediaStream()` DESTROYS this exemption,
    //   causing play() to fail with NotAllowedError on iOS Safari.
    //   FIX: Always use the original stream reference from the peer connection.
    //
    //   ontrack fires once per track (audio, then video). For the second track,
    //   the same stream object is reused, so we only need to nudge play() — no
    //   need to re-create the stream or re-render React.
    pc.ontrack = (event) => {
      console.debug('[WebRTC] Remote track received:', event.track.kind,
        'readyState:', event.track.readyState,
        'streams:', event.streams?.length);
      
      const incomingStream = event.streams[0] || new MediaStream([event.track]);

      // Only update React state if this is a NEW stream (first track arrival).
      // For the second track on the same stream, the stream object is identical —
      // no need to re-set srcObject or re-call play().
      if (remoteStreamRef.current !== incomingStream) {
        console.log('[WebRTC] New remote stream attached (first track)');
        remoteStreamRef.current = incomingStream;
        setRemoteStream(incomingStream);
      } else {
        console.log('[WebRTC] Additional track on existing stream — no re-render needed');
        // Force a state update with a new ref to nudge the video element
        // This handles the case where video track arrives after audio is already playing
        setRemoteStream(prev => {
          // Return same object — React will still run effects if we add a version counter
          // Actually, we need to trigger the InCallView effect to call play() again
          // Use a new wrapper only as last resort on non-iOS, otherwise just return same ref
          return incomingStream;
        });
      }
    };

    return pc;
  }, []); // remoteUserInfo accessed via ref, sendSignaling via ref

  // ── Send Signaling Message ────────────────────────────────────────
  const sendSignaling = useCallback((message) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      // Queue if WS not ready
      pendingCandidatesRef.current.push(message);
    }
  }, []);

  // ── Start Call ────────────────────────────────────────────────────
  const startCall = useCallback(async (targetUserId, type = 'audio', targetUserInfo = {}) => {
    if (callState !== CALL_STATE.IDLE) {
      toast.error('Already in a call');
      return;
    }

    try {
      // Pre-warm iOS audio pipeline during user gesture
      unlockAudioNow();

      // ⚠️ iOS Safari CRITICAL: getUserMedia MUST be the first async call
      // after the user tap gesture. Any prior await (API call, setState flush)
      // will invalidate the gesture context and iOS will reject with NotAllowedError.
      const stream = await getMediaStream(type, facingMode);
      localStreamRef.current = stream;
      setLocalStream(stream);

      // ── Grom Permission Check (safe to do after getUserMedia) ──
      try {
        const permRes = await apiClient.get(`/grom-hq/call-permission/${userId}/${targetUserId}`);
        if (!permRes.data.allowed) {
          toast.error(permRes.data.reason || 'Call not allowed');
          // Stop the stream we already acquired
          stream.getTracks().forEach(t => t.stop());
          localStreamRef.current = null;
          setLocalStream(null);
          return;
        }
      } catch (permErr) {
        // If permission check fails (network, 404), allow call for non-Grom users
        console.debug('[WebRTC] Permission check skipped:', permErr.message);
      }

      setCallType(type);
      setRemoteUserInfo({
        id: targetUserId,
        name: targetUserInfo.name || 'User',
        avatar: targetUserInfo.avatar,
      });
      setCallState(CALL_STATE.OUTGOING);

      // Create peer connection
      const pc = createPeerConnection(type === 'video');
      peerConnection.current = pc;

      // Add local tracks to connection
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // Create and send offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === 'video',
      });
      await pc.setLocalDescription(offer);

      sendSignaling({
        type: 'call_offer',
        target_user_id: targetUserId,
        caller_id: userId,
        caller_name: userInfo.name || 'User',
        caller_avatar: userInfo.avatar,
        call_type: type,
        sdp: offer,
      });

      // Store the offer so we can auto-retry if target is offline
      pendingOfferRef.current = {
        type: 'call_offer',
        target_user_id: targetUserId,
        caller_id: userId,
        caller_name: userInfo.name || 'User',
        caller_avatar: userInfo.avatar,
        call_type: type,
        sdp: offer,
      };
      callRetryCountRef.current = 0;

      // Timeout: auto-end if no answer in 30 seconds
      setTimeout(() => {
        if (callStateRef.current === CALL_STATE.OUTGOING) {
          toast('No answer', { icon: '📵' });
          endCall();
        }
      }, 30000);

    } catch (err) {
      console.error('[WebRTC] Failed to start call:', err);
      if (err.name === 'NotAllowedError') {
        if (isIOS) {
          toast.error(
            'Camera/Mic blocked. Go to iPhone Settings → Apps → Safari → Camera & Microphone → set to "Allow".',
            { duration: 8000 }
          );
        } else {
          toast.error(
            'Camera/Microphone access denied. Click the 🔒 icon in your address bar to allow access, then try again.',
            { duration: 6000 }
          );
        }
      } else if (err.name === 'NotFoundError') {
        toast.error('No camera or microphone found on this device.');
      } else {
        toast.error('Failed to start call');
      }
      cleanup();
    }
  }, [callState, userId, userInfo, createPeerConnection, sendSignaling]);

  // ── Answer Call ───────────────────────────────────────────────────
  const answerCall = useCallback(async () => {
    if (callState !== CALL_STATE.INCOMING) return;

    try {
      // iOS Safari fix: Unlock audio pipeline during user gesture (Accept tap).
      unlockAudioNow();

      // ⚠️ iOS Safari CRITICAL: getUserMedia MUST be the first async call
      // after the user tap. setCallState() or any other operation that could
      // trigger a React re-render will break the gesture context on iOS,
      // causing NotAllowedError even though the user tapped Accept.
      const stream = await getMediaStream(callType, facingMode);
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Now safe to update state (media already acquired)
      setCallState(CALL_STATE.CONNECTING);

      const pendingOffer = peerConnection.current?._pendingOffer;
      if (!pendingOffer) {
        toast.error('Call data lost. Try again.');
        stream.getTracks().forEach(t => t.stop());
        cleanup();
        return;
      }

      // Create peer connection
      const pc = createPeerConnection(callType === 'video');
      peerConnection.current = pc;

      // Add local tracks
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // Set remote offer
      await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer));

      // Create and send answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendSignaling({
        type: 'call_answer',
        target_user_id: remoteUserInfo?.id,
        sdp: answer,
      });

      // Apply any ICE candidates that arrived before we created the real PeerConnection
      // (Samsung→iPhone race: caller sends ICE fast, but user hasn't tapped Accept yet)
      if (earlyIceCandidatesRef.current.length > 0) {
        console.log(`[WebRTC] Applying ${earlyIceCandidatesRef.current.length} buffered ICE candidates`);
        for (const candidate of earlyIceCandidatesRef.current) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn('[WebRTC] Failed to apply buffered ICE candidate:', e);
          }
        }
        earlyIceCandidatesRef.current = [];
      }

      // Notify our OTHER devices/tabs to stop ringing
      sendSignaling({
        type: 'call_accepted_elsewhere',
        target_user_id: userId, // Send to our own room
      });

    } catch (err) {
      console.error('[WebRTC] Failed to answer call:', err);
      if (err.name === 'NotAllowedError') {
        if (isIOS) {
          toast.error(
            'Camera/Mic blocked. Go to iPhone Settings → Apps → Safari → Camera & Microphone → set to "Allow".',
            { duration: 8000 }
          );
        } else {
          toast.error(
            'Camera/Microphone access denied. Click the 🔒 icon in your address bar to allow access, then try again.',
            { duration: 6000 }
          );
        }
      } else if (err.name === 'NotFoundError') {
        toast.error('No camera or microphone found on this device.');
      } else {
        toast.error('Failed to answer call');
      }
      cleanup();
    }
  }, [callState, callType, remoteUserInfo, createPeerConnection, sendSignaling]);

  // ── Decline Call ──────────────────────────────────────────────────
  const declineCall = useCallback(() => {
    // Use ref to avoid stale closure — callState may be outdated in the callback
    if (callStateRef.current !== CALL_STATE.INCOMING) {
      console.debug('[WebRTC] declineCall ignored — state is', callStateRef.current);
      // Force reset to dismiss the modal even if state is stale
      setCallState(CALL_STATE.IDLE);
      setCallType(null);
      setRemoteUserInfo(null);
      return;
    }
    sendSignaling({
      type: 'call_decline',
      target_user_id: remoteUserInfoRef.current?.id,
    });
    // Reset state directly (cleanup is defined later, can't be in deps)
    setCallState(CALL_STATE.IDLE);
    setCallType(null);
    setRemoteUserInfo(null);
  }, [sendSignaling]);

  // ── End Call ──────────────────────────────────────────────────────
  const endCall = useCallback(() => {
    sendSignaling({
      type: 'call_end',
      target_user_id: remoteUserInfo?.id,
    });
    cleanup();
  }, [remoteUserInfo, sendSignaling]);

  // ── Toggle Mute ──────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach(track => {
      track.enabled = !track.enabled;
    });
    setIsMuted(prev => !prev);
  }, []);

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
        const pc = peerConnection.current;
        if (pc) {
          const videoSender = pc.getSenders().find(s =>
            s.track?.kind === 'video' || (s._trackKind === 'video')
          );
          if (videoSender) {
            await videoSender.replaceTrack(freshVideoTrack);
            console.log('[WebRTC] ✅ Replaced sender track with fresh camera track');
          }
        }

        // Create a new MediaStream reference so React re-renders InCallView
        // which triggers the WebGL pipeline re-init (useEffect([localStream]))
        const updatedStream = new MediaStream(stream.getTracks());
        localStreamRef.current = updatedStream;
        setLocalStream(updatedStream);
        setIsCameraOff(false);

        console.log('[WebRTC] ✅ Camera re-enabled with fresh track');
      } catch (err) {
        console.error('[WebRTC] Failed to re-enable camera:', err);
        if (err.name === 'NotAllowedError') {
          toast.error('Camera access denied. Check your permissions.');
        } else {
          toast.error('Could not re-enable camera');
        }
      }
    }
  }, [isCameraOff]);

  // ── Flip Camera (Front ↔ Rear) ───────────────────────────────────
  const flipCamera = useCallback(async () => {
    if (isCameraOff) return; // Can't flip if camera is off
    const stream = localStreamRef.current;
    if (!stream) return;

    try {
      const newFacing = facingMode === 'user' ? 'environment' : 'user';
      const freshMedia = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { exact: newFacing },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });
      const freshVideoTrack = freshMedia.getVideoTracks()[0];

      if (!freshVideoTrack) {
        toast.error('Could not access camera');
        return;
      }

      // Stop and remove old video track
      const oldVideoTrack = stream.getVideoTracks()[0];
      if (oldVideoTrack) {
        stream.removeTrack(oldVideoTrack);
        oldVideoTrack.stop();
      }
      stream.addTrack(freshVideoTrack);

      // Replace on peer connection sender
      const pc = peerConnection.current;
      if (pc) {
        const videoSender = pc.getSenders().find(s =>
          s.track?.kind === 'video' || (s._trackKind === 'video')
        );
        if (videoSender) {
          await videoSender.replaceTrack(freshVideoTrack);
        }
      }

      // Publish fresh stream reference for React re-render
      const updatedStream = new MediaStream(stream.getTracks());
      localStreamRef.current = updatedStream;
      setLocalStream(updatedStream);
      setFacingMode(newFacing);
      console.log(`[WebRTC] ✅ Camera flipped to ${newFacing}`);
    } catch (err) {
      console.error('[WebRTC] Failed to flip camera:', err);
      // Some devices don't support exact facingMode — try without 'exact'
      try {
        const fallbackFacing = facingMode === 'user' ? 'environment' : 'user';
        const fallbackMedia = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: fallbackFacing,
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        });
        const fallbackTrack = fallbackMedia.getVideoTracks()[0];
        if (fallbackTrack) {
          const oldTrack = stream.getVideoTracks()[0];
          if (oldTrack) { stream.removeTrack(oldTrack); oldTrack.stop(); }
          stream.addTrack(fallbackTrack);
          const pc = peerConnection.current;
          if (pc) {
            const sender = pc.getSenders().find(s => s.track?.kind === 'video');
            if (sender) await sender.replaceTrack(fallbackTrack);
          }
          const updated = new MediaStream(stream.getTracks());
          localStreamRef.current = updated;
          setLocalStream(updated);
          setFacingMode(fallbackFacing);
          console.log(`[WebRTC] ✅ Camera flipped (fallback) to ${fallbackFacing}`);
        }
      } catch (fallbackErr) {
        console.error('[WebRTC] Flip camera fallback also failed:', fallbackErr);
        toast.error('Could not switch camera');
      }
    }
  }, [isCameraOff, facingMode]);

  // ── Call Timer ────────────────────────────────────────────────────
  const startCallTimer = () => {
    callStartTimeRef.current = Date.now();
    setCallDuration(0);
    callTimerRef.current = setInterval(() => {
      setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
    }, 1000);
  };

  // ── Connection Quality Monitor ────────────────────────────────────
  const startStatsMonitor = (pc) => {
    statsIntervalRef.current = setInterval(async () => {
      try {
        const stats = await pc.getStats();
        stats.forEach(report => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            const rtt = report.currentRoundTripTime;
            if (rtt !== undefined) {
              if (rtt < 0.1) setConnectionQuality('good');
              else if (rtt < 0.3) setConnectionQuality('fair');
              else setConnectionQuality('poor');
            }
          }
        });
      } catch { /* stats collection is non-critical */ }
    }, 5000);
  };

  // ── Cleanup ──────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    // Stop local media tracks
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;

    // Close peer connection
    if (peerConnection.current?.close) {
      peerConnection.current.close();
    }
    peerConnection.current = null;

    // Clear timers
    clearInterval(callTimerRef.current);
    clearInterval(statsIntervalRef.current);
    if (callRetryRef.current) { clearTimeout(callRetryRef.current); callRetryRef.current = null; }
    pendingOfferRef.current = null;
    callRetryCountRef.current = 0;
    earlyIceCandidatesRef.current = [];

    // Reset state
    setCallState(CALL_STATE.IDLE);
    setCallType(null);
    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    setIsCameraOff(false);
    setCallDuration(0);
    setRemoteUserInfo(null);
    setConnectionQuality('good');
  }, []);

  // Replace the video track on the peer connection (for WebGL filtered canvas stream)
  const replaceVideoTrack = useCallback((newVideoTrack) => {
    const pc = peerConnection.current;
    if (!pc || !newVideoTrack) return;
    
    const senders = pc.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
    if (videoSender) {
      videoSender.replaceTrack(newVideoTrack)
        .then(() => console.log('[WebRTC] ✅ Video track replaced with filtered canvas track'))
        .catch(err => console.error('[WebRTC] Failed to replace video track:', err));
    } else {
      console.warn('[WebRTC] No video sender found to replace track on');
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Listen for custom events from MessagesPage call buttons
  useEffect(() => {
    const handleStartCall = (e) => {
      const { targetUserId, callType: type, targetUserName, targetUserAvatar } = e.detail;
      startCall(targetUserId, type, { name: targetUserName, avatar: targetUserAvatar });
    };
    window.addEventListener('rawsurf:startCall', handleStartCall);
    return () => window.removeEventListener('rawsurf:startCall', handleStartCall);
  }, [startCall]);

  return {
    // State
    callState,
    callType,
    localStream,
    remoteStream,
    isMuted,
    isCameraOff,
    callDuration,
    remoteUserInfo,
    connectionQuality,
    // Actions
    startCall,
    answerCall,
    declineCall,
    endCall,
    toggleMute,
    toggleCamera,
    flipCamera,
    facingMode,
    replaceVideoTrack,
  };
}
