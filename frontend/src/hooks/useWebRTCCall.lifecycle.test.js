import { act, renderHook } from '@testing-library/react';
import { useWebRTCCall, CALL_STATE } from './useWebRTCCall';
import apiClient from '../lib/apiClient';
import { getMediaStream } from './webrtc/useWebRTCMedia';

const mockSend = jest.fn();
const mockResetMedia = jest.fn();
const mockConnect = jest.fn();
const mockWs = { current: { readyState: 1 } };
let mockSignal;
const mockStream = { getTracks: () => [{ stop: jest.fn() }] };
jest.mock('../lib/apiClient', () => ({ get: jest.fn() }));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { error: jest.fn(), success: jest.fn() }) }));
jest.mock('../utils/audioUnlock', () => ({ unlockAudioNow: jest.fn() }));
jest.mock('../utils/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn() } }));
jest.mock('./webrtc/useWebRTCSignaling', () => ({ useWebRTCSignaling: (_id, handler) => {
  mockSignal = handler;
  return { sendSignaling: mockSend, wsRef: mockWs, connectSignaling: mockConnect };
} }));
jest.mock('./webrtc/useWebRTCMedia', () => ({
  getMediaStream: jest.fn(() => Promise.resolve(mockStream)),
  useWebRTCMedia: () => ({ facingMode: 'user', resetMediaState: mockResetMedia }),
}));

let peers;
class FakePeer {
  constructor() {
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.getStats = jest.fn(async () => new Map());
    peers.push(this);
  }
  addTrack() {}
  createOffer() { return Promise.resolve({ type: 'offer', sdp: 'fixture' }); }
  setLocalDescription() { return Promise.resolve(); }
  setRemoteDescription() { return Promise.resolve(); }
  close() { this.connectionState = 'closed'; }
}
const start = (result, target) => act(async () => { await result.current.startCall(target); });
const tick = ms => act(() => { jest.advanceTimersByTime(ms); });
const connect = pc => act(() => {
  pc.connectionState = 'connected'; pc.onconnectionstatechange();
  pc.iceConnectionState = 'connected'; pc.oniceconnectionstatechange();
});

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-29T18:20:00Z'));
  peers = [];
  global.RTCPeerConnection = FakePeer;
  global.RTCSessionDescription = function Description(value) { return value; };
  apiClient.get.mockResolvedValue({ data: { allowed: true } });
  getMediaStream.mockResolvedValue(mockStream);
  jest.clearAllMocks();
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

it('does not let a finished call timeout end the next outgoing call', async () => {
  const { result } = renderHook(() => useWebRTCCall('owner'));
  await start(result, 'first'); tick(10000);
  act(() => result.current.endCall());
  await start(result, 'second');
  tick(20000);
  expect(result.current.callState).toBe(CALL_STATE.OUTGOING);
  tick(10000);
  expect(result.current.callState).toBe(CALL_STATE.IDLE);
  expect(mockSend).toHaveBeenLastCalledWith({ type: 'call_end', target_user_id: 'second' });
});

it('sends a current timeout to the actual recipient rather than a stale render', async () => {
  const { result } = renderHook(() => useWebRTCCall('owner'));
  await start(result, 'recipient');
  tick(30000);
  expect(mockSend).toHaveBeenLastCalledWith({ type: 'call_end', target_user_id: 'recipient' });
});

it('starts only one timer and stats monitor for same-tick connection and ICE events', async () => {
  const { result } = renderHook(() => useWebRTCCall('owner'));
  await start(result, 'recipient');
  connect(peers[0]);
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(peers[0].getStats).toHaveBeenCalledTimes(1);
  expect(result.current.callDuration).toBe(5);
  act(() => peers[0].onconnectionstatechange());
  expect(result.current.callDuration).toBe(5);
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(peers[0].getStats).toHaveBeenCalledTimes(2);
  expect(result.current.callDuration).toBe(10);
});

it('ignores a retired peer callback instead of failing the next call or routing its ICE', async () => {
  const { result } = renderHook(() => useWebRTCCall('owner'));
  await start(result, 'first');
  const old = peers[0]; const oldState = old.onconnectionstatechange; const oldIce = old.onicecandidate;
  act(() => result.current.endCall());
  await start(result, 'second');
  mockSend.mockClear();
  act(() => {
    oldIce({ candidate: { candidate: 'old-fixture' } });
    old.connectionState = 'failed'; oldState();
  });
  expect(result.current.callState).toBe(CALL_STATE.OUTGOING);
  expect(mockSend).not.toHaveBeenCalled();
});

it('cleans all timers on unmount and cancels answer waiting when answered', async () => {
  const { result, unmount } = renderHook(() => useWebRTCCall('owner'));
  await start(result, 'recipient');
  await act(async () => mockSignal({ type: 'call_answer', sdp: { type: 'answer' } }));
  tick(0);
  expect(jest.getTimerCount()).toBe(0);
  connect(peers[0]);
  unmount();
  tick(0);
  expect(jest.getTimerCount()).toBe(0);
});

it('does not apply retired peer statistics to the next call', async () => {
  let resolveStats;
  const heldStats = new Promise(resolve => { resolveStats = resolve; });
  const { result } = renderHook(() => useWebRTCCall('owner'));
  await start(result, 'first');
  peers[0].getStats.mockReturnValue(heldStats);
  connect(peers[0]); tick(5000);
  act(() => result.current.endCall());
  await start(result, 'second');
  await act(async () => resolveStats(new Map([['old', {
    type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 1,
  }]])));
  expect(result.current.connectionQuality).toBe('good');
  expect(result.current.callState).toBe(CALL_STATE.OUTGOING);
});

it('keeps one monitor when ICE reports connected before the peer connection', async () => {
  const { result } = renderHook(() => useWebRTCCall('owner'));
  await start(result, 'recipient');
  const pc = peers[0];
  act(() => {
    pc.iceConnectionState = 'connected'; pc.oniceconnectionstatechange();
    pc.connectionState = 'connected'; pc.onconnectionstatechange();
    pc.iceConnectionState = 'completed'; pc.oniceconnectionstatechange();
  });
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(pc.getStats).toHaveBeenCalledTimes(1);
  expect(result.current.callDuration).toBe(5);
});

it('coalesces duplicate offline retries and cancels their pending timer on end', async () => {
  const { result } = renderHook(() => useWebRTCCall('owner'));
  await start(result, 'recipient');
  mockSend.mockClear();
  act(() => {
    mockSignal({ type: 'call_target_offline' });
    mockSignal({ type: 'call_target_offline' });
  });
  tick(2000);
  expect(mockSend.mock.calls.filter(([message]) => message.type === 'call_offer')).toHaveLength(1);
  act(() => mockSignal({ type: 'call_target_offline' }));
  act(() => result.current.endCall());
  mockSend.mockClear();
  tick(2000);
  expect(mockSend).not.toHaveBeenCalled();
});
