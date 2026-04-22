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
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        } catch (e) {
          console.error('[WebRTC] Failed to add ICE candidate:', e);
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
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

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

    // Handle incoming streams — when remote user replaces a track (e.g. camera
    // toggle off→on), ontrack fires with the same stream object.  Creating a new
    // MediaStream reference ensures React re-renders and re-attaches srcObject.
    pc.ontrack = (event) => {
      console.debug('[WebRTC] Remote track received:', event.track.kind);
      const incomingStream = event.streams[0] || new MediaStream([event.track]);

      // Always publish a fresh reference so React's useEffect([remoteStream]) fires
      const freshRemote = new MediaStream(incomingStream.getTracks());
      remoteStreamRef.current = freshRemote;
      setRemoteStream(freshRemote);
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
      // ── Grom Permission Check ──
      try {
        const permRes = await apiClient.get(`/grom-hq/call-permission/${userId}/${targetUserId}`);
        if (!permRes.data.allowed) {
          toast.error(permRes.data.reason || 'Call not allowed');
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

      // Get local media
      const constraints = {
        audio: true,
        video: type === 'video' ? { width: { ideal: 640 }, height: { ideal: 480 } } : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);

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
        toast.error('Camera/Microphone access denied. Check your browser permissions.');
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
      setCallState(CALL_STATE.CONNECTING);

      const pendingOffer = peerConnection.current?._pendingOffer;
      if (!pendingOffer) {
        toast.error('Call data lost. Try again.');
        cleanup();
        return;
      }

      // Get local media
      const constraints = {
        audio: true,
        video: callType === 'video' ? { width: { ideal: 640 }, height: { ideal: 480 } } : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);

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

      // Notify our OTHER devices/tabs to stop ringing
      sendSignaling({
        type: 'call_accepted_elsewhere',
        target_user_id: userId, // Send to our own room
      });

    } catch (err) {
      console.error('[WebRTC] Failed to answer call:', err);
      if (err.name === 'NotAllowedError') {
        toast.error('Camera/Microphone access denied.');
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
