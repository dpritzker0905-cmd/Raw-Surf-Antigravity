/**
 * useWebRTCCall -- React hook for 1-on-1 audio/video calling via WebRTC.
 *
 * Architecture:
 *   - Signaling: useWebRTCSignaling (WebSocket lifecycle, reconnect, keepalive)
 *   - Media: useWebRTCMedia (getUserMedia, mute, camera toggle, flip)
 *   - Connection: This orchestrator (PeerConnection, call flow, ICE, cleanup)
 *
 * Call Flow:
 *   1. Caller: startCall(targetUserId, 'audio'|'video')
 * 2. Callee: receives 'incoming_call' via WS -- shows IncomingCallModal
 * 3. Callee: answerCall() G sends SDP answer
 * 4. Both: exchange ICE candidates -- P2P stream established
 * 5. Either: endCall() G cleanup
 */

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import { unlockAudioNow } from '../utils/audioUnlock';
import { logger } from '../utils/logger';
import { useWebRTCSignaling } from './webrtc/useWebRTCSignaling';
import { useWebRTCMedia, getMediaStream } from './webrtc/useWebRTCMedia';

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
 INCOMING: 'incoming', // ringing -- waiting for user to accept/decline
  CONNECTING: 'connecting', // SDP exchanged, waiting for ICE
  IN_CALL: 'in-call',       // media flowing
  ENDED: 'ended',           // call finished
};

export function useWebRTCCall(userId, userInfo = {}) {
 // --- Core State ---
  const [callState, setCallState] = useState(CALL_STATE.IDLE);
  const [callType, setCallType] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [remoteUserInfo, setRemoteUserInfo] = useState(null);
  const [connectionQuality, setConnectionQuality] = useState('good');
  const [permissionDenied, setPermissionDenied] = useState(false);

 // --- Refs ---
  const peerConnection = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const callTimerRef = useRef(null);
  const statsIntervalRef = useRef(null);
  const outgoingTimeoutRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const callStartTimeRef = useRef(null);
  const callRetryRef = useRef(null);
  const callRetryCountRef = useRef(0);
  const pendingOfferRef = useRef(null);
  const sessionRef = useRef(null);
  const mountedRef = useRef(true);
  const currentUserIdRef = useRef(userId);

  // State refs to avoid stale closures
  const callStateRef = useRef(callState);
  const remoteUserInfoRef = useRef(remoteUserInfo);

  const isCurrentSession = useCallback((session, pc) => Boolean(
    session && mountedRef.current && sessionRef.current === session &&
    currentUserIdRef.current === session.userId && (!pc || peerConnection.current === pc)
  ), []);

  const applyBufferedCandidates = useCallback(async (session, pc) => {
    const candidates = session.candidates.splice(0);
    for (const candidate of candidates) {
      if (!isCurrentSession(session, pc)) return;
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* ignore */ }
    }
  }, [isCurrentSession]);

 // --- Sub-Hooks ---
  const { sendSignaling, wsRef, connectSignaling } = useWebRTCSignaling(userId, handleSignalingMessage);

  const {
    isMuted, isCameraOff, facingMode,
    toggleMute, toggleCamera, flipCamera,
    replaceVideoTrack, resetMediaState,
  } = useWebRTCMedia({ localStreamRef, peerConnectionRef: peerConnection, setLocalStream });

 // --- Call Timer ---
  const startCallTimer = () => {
    if (callTimerRef.current !== null) return;
    callStartTimeRef.current = Date.now();
    setCallDuration(0);
    callTimerRef.current = setInterval(() => {
      setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
    }, 1000);
  };

 // --- Connection Quality Monitor ---
  const startStatsMonitor = (pc) => {
    if (statsIntervalRef.current !== null) return;
    statsIntervalRef.current = setInterval(async () => {
      try {
        if (peerConnection.current !== pc) return;
        const stats = await pc.getStats();
        if (peerConnection.current !== pc) return;
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

 // --- Cleanup ---
  const cleanup = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.cancelWait?.();
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;

    const pc = peerConnection.current;
    peerConnection.current = null;
    if (pc?.close) {
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
    }

    clearInterval(callTimerRef.current);
    clearInterval(statsIntervalRef.current);
    clearTimeout(outgoingTimeoutRef.current);
    callTimerRef.current = null;
    statsIntervalRef.current = null;
    outgoingTimeoutRef.current = null;
    callStartTimeRef.current = null;
    if (callRetryRef.current) { clearTimeout(callRetryRef.current); callRetryRef.current = null; }
    pendingOfferRef.current = null;
    callRetryCountRef.current = 0;
    pendingCandidatesRef.current = [];

    callStateRef.current = CALL_STATE.IDLE;
    remoteUserInfoRef.current = null;
    setCallState(CALL_STATE.IDLE);
    setCallType(null);
    setLocalStream(null);
    setRemoteStream(null);
    setCallDuration(0);
    setRemoteUserInfo(null);
    setConnectionQuality('good');
    resetMediaState();
  }, [resetMediaState]);

 // --- Create Peer Connection ---
  const createPeerConnection = useCallback((session) => {
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      sdpSemantics: 'unified-plan',
      iceTransportPolicy: 'all',
    });

    pc.onicecandidate = (event) => {
      if (!isCurrentSession(session, pc)) return;
      if (event.candidate) {
        sendSignaling({
          type: 'ice_candidate',
          candidate: event.candidate,
          target_user_id: remoteUserInfoRef.current?.id,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (!isCurrentSession(session, pc)) return;
      console.debug('[WebRTC] Connection state:', pc.connectionState);
      switch (pc.connectionState) {
        case 'connected':
          clearTimeout(outgoingTimeoutRef.current);
          outgoingTimeoutRef.current = null;
          callStateRef.current = CALL_STATE.IN_CALL;
          setCallState(CALL_STATE.IN_CALL);
          startCallTimer();
          startStatsMonitor(pc);
          break;
        case 'disconnected':
        case 'failed':
          setConnectionQuality('poor');
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

 // iOS Safari fallback -- it doesn't always fire onconnectionstatechange
    pc.oniceconnectionstatechange = () => {
      if (!isCurrentSession(session, pc)) return;
      console.debug('[WebRTC] ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        if (callStateRef.current !== CALL_STATE.IN_CALL) {
          clearTimeout(outgoingTimeoutRef.current);
          outgoingTimeoutRef.current = null;
          callStateRef.current = CALL_STATE.IN_CALL;
          logger.debug('[WebRTC] \u{2705} ICE connected \u{2014} forcing IN_CALL state (iOS Safari fix)');
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

    // Handle incoming remote tracks
    pc.ontrack = (event) => {
      if (!isCurrentSession(session, pc)) return;
      console.debug('[WebRTC] Remote track received:', event.track.kind);
      const incomingStream = event.streams[0] || new MediaStream([event.track]);

      if (remoteStreamRef.current !== incomingStream) {
        logger.debug('[WebRTC] New remote stream attached (first track)');
        remoteStreamRef.current = incomingStream;
        setRemoteStream(incomingStream);
      } else {
        logger.debug('[WebRTC] Additional track on existing stream');
        setRemoteStream(incomingStream);
      }
    };

    return pc;
  }, [sendSignaling, cleanup, isCurrentSession]);

 // --- Signaling Message Handler ---
  function handleSignalingMessage(data) {
    if (!mountedRef.current || currentUserIdRef.current !== userId || !userId) return;
    switch (data.type) {
      case 'call_offer': {
        if (sessionRef.current || callStateRef.current !== CALL_STATE.IDLE) {
          sendSignaling({ type: 'call_busy', target_user_id: data.caller_id });
          break;
        }
        console.debug('[WebRTC] Incoming call from:', data.caller_id);
        sessionRef.current = {
          userId, direction: 'incoming', type: data.call_type || 'audio',
          offer: data.sdp, recipient: data.caller_id, candidates: [], setupStarted: false, answerSent: false,
        };
        remoteUserInfoRef.current = { id: data.caller_id, name: data.caller_name || 'Unknown', avatar: data.caller_avatar };
        callStateRef.current = CALL_STATE.INCOMING;
        setRemoteUserInfo({
          id: data.caller_id,
          name: data.caller_name || 'Unknown',
          avatar: data.caller_avatar,
        });
        setCallType(data.call_type || 'audio');
        setCallState(CALL_STATE.INCOMING);
        peerConnection.current = { _pendingOffer: data.sdp };
        break;
      }

      case 'call_answer': {
        const session = sessionRef.current;
        const pc = peerConnection.current;
        if (!isCurrentSession(session, pc) || session.direction !== 'outgoing' ||
            callStateRef.current !== CALL_STATE.OUTGOING || !pc?.setRemoteDescription || session.answerPending) break;
        session.answerPending = true;
        clearTimeout(outgoingTimeoutRef.current);
        outgoingTimeoutRef.current = null;
        clearTimeout(callRetryRef.current);
        callRetryRef.current = null;
        callStateRef.current = CALL_STATE.CONNECTING;
        console.debug('[WebRTC] Call answered');
        setCallState(CALL_STATE.CONNECTING);
        (async () => {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            if (!isCurrentSession(session, pc)) return;
            await applyBufferedCandidates(session, pc);
          } catch (e) {
            if (isCurrentSession(session, pc)) console.error('[WebRTC] Failed to set remote description:', e);
          }
        })();
        break;
      }

      case 'ice_candidate': {
        const session = sessionRef.current;
        const pc = peerConnection.current;
        if (!isCurrentSession(session) || !data.candidate) break;
        (async () => {
          try {
            if (pc?.addIceCandidate) {
              if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
              } else {
                session.candidates.push(data.candidate);
              }
            } else {
              session.candidates.push(data.candidate);
            }
          } catch (e) {
            if (isCurrentSession(session, pc)) session.candidates.push(data.candidate);
          }
        })();
        break;
      }

      case 'call_decline':
        toast('Call declined', { icon: '\u{1F4F5}' });
        cleanup();
        break;

      case 'call_end':
        toast('Call ended', { icon: '\u{1F4DE}' });
        cleanup();
        break;

      case 'call_busy':
        toast('User is busy on another call', { icon: '\u{1F4F5}' });
        cleanup();
        break;

      case 'call_accepted_elsewhere':
        if (isCurrentSession(sessionRef.current) && sessionRef.current.direction === 'incoming' && !sessionRef.current.answerSent) {
          toast('Call answered on another device', { icon: '\u{1F4F1}' });
          cleanup();
        }
        break;

      case 'call_target_offline': {
        const retryCount = callRetryCountRef.current || 0;
        const MAX_RETRIES = 12;
        if (retryCount < MAX_RETRIES && callStateRef.current === CALL_STATE.OUTGOING && pendingOfferRef.current) {
          callRetryCountRef.current = retryCount + 1;
          clearTimeout(callRetryRef.current);
          const offer = pendingOfferRef.current;
          callRetryRef.current = setTimeout(() => {
            callRetryRef.current = null;
            if (callStateRef.current === CALL_STATE.OUTGOING && pendingOfferRef.current === offer) {
              sendSignaling(offer);
            }
          }, 2000);
        } else if (retryCount >= MAX_RETRIES) {
          toast('User is currently unavailable', { icon: '\u{1F4F5}' });
          cleanup();
        }
        break;
      }

      default:
        break;
    }
  }

 // --- Start Call ---
  const startCall = useCallback(async (targetUserId, type = 'audio', targetUserInfo = {}) => {
    if (!mountedRef.current || currentUserIdRef.current !== userId || !userId) return;
    if (sessionRef.current || callStateRef.current !== CALL_STATE.IDLE) {
      toast.error('Already in a call');
      return;
    }
    const session = { userId, direction: 'outgoing', candidates: [] };
    sessionRef.current = session;
    remoteUserInfoRef.current = { id: targetUserId, name: targetUserInfo.name || 'User', avatar: targetUserInfo.avatar };
    callStateRef.current = CALL_STATE.OUTGOING;
    setRemoteUserInfo(remoteUserInfoRef.current);
    setCallType(type);
    setCallState(CALL_STATE.OUTGOING);

    try {
      // Pre-check: ensure signaling WebSocket is connected
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        logger.warn('[WebRTC] Signaling WS not connected, reconnecting...');
        connectSignaling();
        await new Promise((resolve) => {
          let elapsed = 0;
          const finish = () => {
            clearInterval(check);
            session.cancelWait = null;
            resolve();
          };
          const check = setInterval(() => {
            elapsed += 200;
            if (wsRef.current?.readyState === WebSocket.OPEN || elapsed >= 3000) {
              finish();
            }
          }, 200);
          session.cancelWait = finish;
        });
        if (!isCurrentSession(session)) return;
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          toast.error('Connection issue \u{2014} please try again');
          cleanup();
          return;
        }
      }

      unlockAudioNow();
      const stream = await getMediaStream(type, facingMode);
      if (!isCurrentSession(session)) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Grom Permission Check
      try {
        const permRes = await apiClient.get(`/grom-hq/call-permission/${userId}/${targetUserId}`);
        if (!isCurrentSession(session)) return;
        if (!permRes.data.allowed) {
          toast.error(permRes.data.reason || 'Call not allowed');
          cleanup();
          return;
        }
      } catch (permErr) {
        if (!isCurrentSession(session)) return;
        console.debug('[WebRTC] Permission check skipped:', permErr.message);
      }

      const pc = createPeerConnection(session);
      peerConnection.current = pc;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === 'video',
      });
      if (!isCurrentSession(session, pc)) return;
      await pc.setLocalDescription(offer);
      if (!isCurrentSession(session, pc)) return;

      const offerMsg = {
        type: 'call_offer',
        target_user_id: targetUserId,
        caller_id: userId,
        caller_name: userInfo.name || 'User',
        caller_avatar: userInfo.avatar,
        call_type: type,
        sdp: offer,
      };
      pendingOfferRef.current = offerMsg;
      callRetryCountRef.current = 0;
      session.offerSent = true;
      sendSignaling(offerMsg);
      if (!isCurrentSession(session, pc)) return;

      // Timeout: auto-end if no answer in 30 seconds
      clearTimeout(outgoingTimeoutRef.current);
      outgoingTimeoutRef.current = setTimeout(() => {
        outgoingTimeoutRef.current = null;
        if (isCurrentSession(session, pc) && callStateRef.current === CALL_STATE.OUTGOING) {
          toast('No answer', { icon: '\u{1F4F5}' });
          endCall();
        }
      }, 30000);

    } catch (err) {
      if (!isCurrentSession(session)) return;
      console.error('[WebRTC] Failed to start call:', err);
      if (err.name === 'NotAllowedError') {
        setPermissionDenied(true);
      } else if (err.name === 'NotFoundError') {
        toast.error('No camera or microphone found on this device.');
      } else {
        toast.error('Failed to start call');
      }
      cleanup();
    }
  }, [userId, userInfo, facingMode, createPeerConnection, sendSignaling, wsRef, connectSignaling, cleanup, isCurrentSession]);

 // --- Answer Call ---
  const answerCall = useCallback(async () => {
    if (currentUserIdRef.current !== userId) return;
    const session = sessionRef.current;
    if (!isCurrentSession(session) || session.direction !== 'incoming' || session.setupStarted ||
        callStateRef.current !== CALL_STATE.INCOMING) return;
    session.setupStarted = true;
    callStateRef.current = CALL_STATE.CONNECTING;
    setCallState(CALL_STATE.CONNECTING);

    try {
      unlockAudioNow();
      const stream = await getMediaStream(session.type, facingMode);
      if (!isCurrentSession(session)) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pendingOffer = session.offer;
      if (!pendingOffer) {
        toast.error('Call data lost. Try again.');
        cleanup();
        return;
      }

      const pc = createPeerConnection(session);
      peerConnection.current = pc;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer));
      if (!isCurrentSession(session, pc)) return;
      const answer = await pc.createAnswer();
      if (!isCurrentSession(session, pc)) return;
      await pc.setLocalDescription(answer);
      if (!isCurrentSession(session, pc)) return;

      session.answerSent = true;
      sendSignaling({
        type: 'call_answer',
        target_user_id: session.recipient,
        sdp: answer,
      });

      // Apply buffered ICE candidates
      if (!isCurrentSession(session, pc)) return;
      await applyBufferedCandidates(session, pc);
      if (!isCurrentSession(session, pc)) return;

      sendSignaling({ type: 'call_accepted_elsewhere', target_user_id: userId });

    } catch (err) {
      if (!isCurrentSession(session)) return;
      console.error('[WebRTC] Failed to answer call:', err);
      if (err.name === 'NotAllowedError') {
        setPermissionDenied(true);
      } else if (err.name === 'NotFoundError') {
        toast.error('No camera or microphone found on this device.');
      } else {
        toast.error('Failed to answer call');
      }
      cleanup();
    }
  }, [facingMode, userId, createPeerConnection, sendSignaling, cleanup, isCurrentSession, applyBufferedCandidates]);

 // --- Decline Call ---
  const declineCall = useCallback(() => {
    const session = sessionRef.current;
    if (!isCurrentSession(session) || session.direction !== 'incoming' || session.answerSent) return;
    sendSignaling({ type: 'call_decline', target_user_id: remoteUserInfoRef.current?.id });
    cleanup();
  }, [sendSignaling, cleanup, isCurrentSession]);

 // --- End Call ---
  const endCall = useCallback(() => {
    const session = sessionRef.current;
    if (isCurrentSession(session) && (session.direction === 'incoming' || session.offerSent)) {
      sendSignaling({ type: 'call_end', target_user_id: remoteUserInfoRef.current?.id });
    }
    cleanup();
  }, [sendSignaling, cleanup, isCurrentSession]);

  // Pending work belongs to this mounted account, including StrictMode remounts.
  useLayoutEffect(() => {
    currentUserIdRef.current = userId;
    mountedRef.current = true;
    setPermissionDenied(false);
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [userId, cleanup]);

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
    callState, callType, localStream, remoteStream,
    isMuted, isCameraOff, callDuration, remoteUserInfo,
    connectionQuality, permissionDenied,
    // Actions
    startCall, answerCall, declineCall, endCall,
    toggleMute, toggleCamera, flipCamera,
    facingMode, replaceVideoTrack,
    dismissPermissionModal: () => setPermissionDenied(false),
    retryAfterPermission: () => {
      setPermissionDenied(false);
      toast.success('Permissions updated! Try your call again.', { duration: 3000 });
    },
  };
}
