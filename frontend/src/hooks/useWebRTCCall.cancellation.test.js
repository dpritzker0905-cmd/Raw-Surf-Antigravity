import { act, renderHook } from '@testing-library/react';
import { StrictMode, Suspense, startTransition, useState } from 'react';
import { toast } from 'sonner';
import apiClient from '../lib/apiClient';
import { getMediaStream } from './webrtc/useWebRTCMedia';
import { CALL_STATE, useWebRTCCall } from './useWebRTCCall';

const mockSend = jest.fn();
const mockResetMedia = jest.fn();
const mockConnect = jest.fn();
const mockWs = { current: { readyState: 1 } };
let mockSignal;
jest.mock('../lib/apiClient', () => ({ get: jest.fn() }));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { error: jest.fn(), success: jest.fn() }) }));
jest.mock('../utils/audioUnlock', () => ({ unlockAudioNow: jest.fn() }));
jest.mock('../utils/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn() } }));
jest.mock('./webrtc/useWebRTCSignaling', () => ({ useWebRTCSignaling: (_id, handler) => {
  mockSignal = handler;
  return { sendSignaling: mockSend, wsRef: mockWs, connectSignaling: mockConnect };
} }));
jest.mock('./webrtc/useWebRTCMedia', () => ({
  getMediaStream: jest.fn(),
  useWebRTCMedia: () => ({ facingMode: 'user', resetMediaState: mockResetMedia }),
}));

const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const makeStream = name => {
  const track = { stop: jest.fn() };
  return { name, track, getTracks: () => [track] };
};
let peers; let peerPlans; let streams;
class FakePeer {
  constructor() {
    this.connectionState = 'new';
    this.addTrack = jest.fn();
    this.createOffer = jest.fn(async () => ({ type: 'offer', sdp: 'fixture-offer' }));
    this.createAnswer = jest.fn(async () => ({ type: 'answer', sdp: 'fixture-answer' }));
    this.setLocalDescription = jest.fn(async () => {});
    this.setRemoteDescription = jest.fn(async value => { this.remoteDescription = value; });
    this.addIceCandidate = jest.fn(async () => {});
    this.close = jest.fn(() => { this.connectionState = 'closed'; });
    this.getStats = jest.fn(async () => new Map());
    Object.assign(this, peerPlans.shift());
    peers.push(this);
  }
}
const flush = () => act(async () => {});
const mount = () => renderHook(({ account }) => useWebRTCCall(account), { initialProps: { account: 'owner' } });
const incoming = (caller = 'old-caller') => act(() => mockSignal({
  type: 'call_offer', caller_id: caller, call_type: 'audio', sdp: { type: 'offer', sdp: 'incoming-fixture' },
}));
const begin = (result, direction = 'outgoing') => {
  let operation;
  act(() => { operation = direction === 'outgoing' ? result.current.startCall('old-recipient') : result.current.answerCall(); });
  return operation;
};
const startNew = async result => {
  act(() => result.current.endCall());
  await act(async () => { await result.current.startCall('new-recipient'); });
  return { stream: result.current.localStream, pc: peers[peers.length - 1] };
};
const expectNewIntact = (result, current) => {
  expect(result.current.callState).toBe(CALL_STATE.OUTGOING);
  expect(result.current.remoteUserInfo.id).toBe('new-recipient');
  expect(result.current.localStream).toBe(current.stream);
  expect(current.stream.track.stop).not.toHaveBeenCalled();
  expect(current.pc.close).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(result.current.permissionDenied).toBe(false);
};
const error = () => Object.assign(new Error('fixture denied'), { name: 'NotAllowedError' });

beforeEach(() => {
  jest.useFakeTimers();
  peers = []; peerPlans = []; streams = [];
  mockWs.current = { readyState: 1 };
  global.RTCPeerConnection = FakePeer;
  global.RTCSessionDescription = function Description(value) { return value; };
  global.RTCIceCandidate = function Candidate(value) { return value; };
  apiClient.get.mockResolvedValue({ data: { allowed: true } });
  getMediaStream.mockImplementation(async () => {
    const stream = makeStream(`stream-${streams.length}`); streams.push(stream); return stream;
  });
  jest.spyOn(console, 'debug').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

describe.each(['outgoing', 'incoming'])('%s setup ownership', direction => {
  const stages = direction === 'outgoing'
    ? ['media', 'permission', 'createOffer', 'setLocalDescription']
    : ['media', 'setRemoteDescription', 'createAnswer', 'setLocalDescription'];
  it.each(stages.flatMap(stage => [[stage, 'resolve'], [stage, 'reject']]))(
    'ignores obsolete %s %s after ending and starting another call', async (stage, outcome) => {
      const gate = deferred(); const staleStream = makeStream('stale');
      if (stage === 'media') getMediaStream.mockReturnValueOnce(gate.promise);
      else if (stage === 'permission') apiClient.get.mockReturnValueOnce(gate.promise);
      else peerPlans.push({ [stage]: jest.fn(() => gate.promise) });
      const { result } = mount();
      if (direction === 'incoming') incoming();
      const operation = begin(result, direction);
      await flush();
      const oldPc = peers[0];
      const current = await startNew(result);
      mockSend.mockClear(); toast.error.mockClear();
      await act(async () => {
        if (outcome === 'reject') gate.reject(error());
        else gate.resolve(stage === 'media' ? staleStream : stage === 'permission'
          ? { data: { allowed: true } } : { type: stage === 'createAnswer' ? 'answer' : 'offer' });
        await operation;
      });
      expectNewIntact(result, current);
      expect(mockSend).not.toHaveBeenCalled();
      expect(peers[peers.length - 1]).toBe(current.pc);
      if (stage === 'media' && outcome === 'resolve') expect(staleStream.track.stop).toHaveBeenCalledTimes(1);
      if (stage === 'createOffer' || stage === 'createAnswer') expect(oldPc.setLocalDescription).not.toHaveBeenCalled();
      if (stage === 'setRemoteDescription') expect(oldPc.createAnswer).not.toHaveBeenCalled();
      act(() => result.current.endCall());
      act(() => jest.advanceTimersByTime(0));
      expect(jest.getTimerCount()).toBe(0);
    });

  it.each(['unmount', 'account', 'logout'].flatMap(cancel => [[cancel, 'resolve'], [cancel, 'reject']]))(
    'handles %s cancellation before late media %s', async (cancel, outcome) => {
      const gate = deferred(); const stream = makeStream('late-media');
      getMediaStream.mockReturnValueOnce(gate.promise);
      const hook = mount();
      if (direction === 'incoming') incoming();
      const operation = begin(hook.result, direction);
      if (cancel === 'unmount') hook.unmount();
      else hook.rerender({ account: cancel === 'logout' ? null : 'other-account' });
      mockSend.mockClear();
      await act(async () => {
        if (outcome === 'reject') gate.reject(error()); else gate.resolve(stream);
        await operation;
      });
      expect(mockSend).not.toHaveBeenCalled();
      expect(peers).toHaveLength(0);
      expect(toast.error).not.toHaveBeenCalled();
      if (outcome === 'resolve') expect(stream.track.stop).toHaveBeenCalledTimes(1);
      if (cancel !== 'unmount') {
        expect(hook.result.current.callState).toBe(CALL_STATE.IDLE);
        expect(hook.result.current.localStream).toBeNull();
        expect(hook.result.current.permissionDenied).toBe(false);
      }
      act(() => jest.advanceTimersByTime(0));
      expect(jest.getTimerCount()).toBe(0);
    });

  it('claims setup synchronously against same-tick duplicate actions', async () => {
    const gate = deferred(); const stream = makeStream('single');
    getMediaStream.mockReturnValue(gate.promise);
    const { result } = mount();
    if (direction === 'incoming') incoming();
    let first; let second;
    act(() => {
      first = direction === 'incoming' ? result.current.answerCall() : result.current.startCall('first');
      second = direction === 'incoming' ? result.current.answerCall() : result.current.startCall('second');
    });
    expect(getMediaStream).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(stream); await Promise.all([first, second]); });
    expect(peers).toHaveLength(1);
    expect(mockSend.mock.calls.filter(([message]) => message.type === `call_${direction === 'incoming' ? 'answer' : 'offer'}`)).toHaveLength(1);
  });
});

it.each(['decline', 'accepted-elsewhere'])('cancels a pending answer on %s', async cancel => {
  const gate = deferred(); const stream = makeStream('late-answer');
  getMediaStream.mockReturnValueOnce(gate.promise);
  const { result } = mount(); incoming();
  const operation = begin(result, 'incoming');
  act(() => {
    if (cancel === 'decline') result.current.declineCall();
    else mockSignal({ type: 'call_accepted_elsewhere' });
  });
  expect(result.current.callState).toBe(CALL_STATE.IDLE);
  mockSend.mockClear();
  await act(async () => { gate.resolve(stream); await operation; });
  expect(stream.track.stop).toHaveBeenCalledTimes(1);
  expect(mockSend).not.toHaveBeenCalled();
  expect(peers).toHaveLength(0);
});

it('does not cancel the local answer after it has been sent', async () => {
  const { result } = mount(); incoming('caller');
  await act(async () => { await result.current.answerCall(); });
  act(() => mockSignal({ type: 'call_accepted_elsewhere' }));
  expect(result.current.callState).toBe(CALL_STATE.CONNECTING);
  expect(peers[0].close).not.toHaveBeenCalled();
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'call_answer', target_user_id: 'caller' }));
});

it.each(['end', 'unmount', 'account'])('settles and cancels the signaling wait on %s', async cancel => {
  mockWs.current = { readyState: 0 };
  const hook = mount(); let settled = false;
  const operation = begin(hook.result).then(() => { settled = true; });
  expect(mockConnect).toHaveBeenCalledTimes(1);
  if (cancel === 'end') act(() => hook.result.current.endCall());
  else if (cancel === 'unmount') hook.unmount();
  else hook.rerender({ account: 'other-account' });
  await flush();
  expect(settled).toBe(true);
  await operation;
  act(() => jest.advanceTimersByTime(0));
  expect(jest.getTimerCount()).toBe(0);
  mockWs.current = { readyState: 1 };
  await act(async () => { jest.advanceTimersByTime(4000); });
  expect(getMediaStream).not.toHaveBeenCalled();
});

it('releases its setup claim after a signaling connection timeout', async () => {
  mockWs.current = { readyState: 0 };
  const { result } = mount();
  const operation = begin(result);
  await act(async () => { jest.advanceTimersByTime(3000); await operation; });
  expect(getMediaStream).not.toHaveBeenCalled();
  expect(result.current.callState).toBe(CALL_STATE.IDLE);
  mockWs.current = { readyState: 1 };
  await act(async () => { await result.current.startCall('retry'); });
  expect(result.current.callState).toBe(CALL_STATE.OUTGOING);
});

it('does not let an old remote answer consume the next call ICE queue', async () => {
  const gate = deferred();
  const { result } = mount();
  await act(async () => { await result.current.startCall('old'); });
  const oldPc = peers[0]; oldPc.setRemoteDescription.mockReturnValue(gate.promise);
  act(() => mockSignal({ type: 'call_answer', sdp: { type: 'answer' } }));
  const current = await startNew(result);
  act(() => mockSignal({ type: 'ice_candidate', candidate: { candidate: 'new-only' } }));
  await act(async () => gate.resolve());
  expect(oldPc.addIceCandidate).not.toHaveBeenCalled();
  await act(async () => mockSignal({ type: 'call_answer', sdp: { type: 'answer' } }));
  expect(current.pc.addIceCandidate).toHaveBeenCalledWith({ candidate: 'new-only' });
});

it('does not requeue a rejected old ICE candidate into a newer call', async () => {
  const gate = deferred();
  const { result } = mount();
  await act(async () => { await result.current.startCall('old'); });
  peers[0].remoteDescription = { type: 'answer' };
  peers[0].addIceCandidate.mockReturnValueOnce(gate.promise);
  act(() => mockSignal({ type: 'ice_candidate', candidate: { candidate: 'old-only' } }));
  const current = await startNew(result);
  await act(async () => gate.reject(new Error('retired ICE')));
  await act(async () => mockSignal({ type: 'call_answer', sdp: { type: 'answer' } }));
  expect(current.pc.addIceCandidate).not.toHaveBeenCalled();
});

it('preserves an explicit permission denial and permits retry afterward', async () => {
  apiClient.get.mockResolvedValueOnce({ data: { allowed: false, reason: 'Fixture permission denied' } });
  const { result } = mount();
  await act(async () => { await result.current.startCall('denied'); });
  expect(peers).toHaveLength(0);
  expect(streams[0].track.stop).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith('Fixture permission denied');
  expect(result.current.callState).toBe(CALL_STATE.IDLE);
  await act(async () => { await result.current.startCall('allowed'); });
  expect(result.current.callState).toBe(CALL_STATE.OUTGOING);
});

it('preserves the existing permission request error fallback', async () => {
  apiClient.get.mockRejectedValueOnce(new Error('fixture unavailable'));
  const { result } = mount();
  await act(async () => { await result.current.startCall('recipient'); });
  expect(result.current.callState).toBe(CALL_STATE.OUTGOING);
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'call_offer' }));
});

it.each(['createAnswer', 'setLocalDescription'])('cancels accepted-elsewhere while %s is pending', async stage => {
  const gate = deferred();
  peerPlans.push({ [stage]: jest.fn(() => gate.promise) });
  const { result } = mount(); incoming();
  const operation = begin(result, 'incoming');
  await flush();
  expect(result.current.callState).toBe(CALL_STATE.CONNECTING);
  act(() => mockSignal({ type: 'call_accepted_elsewhere' }));
  expect(result.current.callState).toBe(CALL_STATE.IDLE);
  mockSend.mockClear();
  await act(async () => { gate.resolve({ type: 'answer' }); await operation; });
  expect(mockSend).not.toHaveBeenCalled();
  expect(streams[0].track.stop).toHaveBeenCalledTimes(1);
  expect(peers[0].close).toHaveBeenCalledTimes(1);
});

it('applies a duplicate remote answer only once', async () => {
  const gate = deferred();
  const { result } = mount();
  await act(async () => { await result.current.startCall('recipient'); });
  peers[0].setRemoteDescription.mockReturnValueOnce(gate.promise);
  act(() => {
    mockSignal({ type: 'call_answer', sdp: { type: 'answer' } });
    mockSignal({ type: 'call_answer', sdp: { type: 'answer' } });
  });
  expect(peers[0].setRemoteDescription).toHaveBeenCalledTimes(1);
  await act(async () => gate.resolve());
});

it('ignores unsolicited answers while idle', () => {
  const { result } = mount();
  act(() => mockSignal({ type: 'call_answer', sdp: { type: 'answer' } }));
  expect(result.current.callState).toBe(CALL_STATE.IDLE);
});

it('does not revive a previous attempt when switching accounts and back', async () => {
  const gate = deferred(); const staleStream = makeStream('old-owner');
  getMediaStream.mockReturnValueOnce(gate.promise);
  const hook = mount(); const operation = begin(hook.result);
  hook.rerender({ account: 'other-account' });
  hook.rerender({ account: 'owner' });
  const current = await startNew(hook.result);
  mockSend.mockClear();
  await act(async () => { gate.resolve(staleStream); await operation; });
  expectNewIntact(hook.result, current);
  expect(staleStream.track.stop).toHaveBeenCalledTimes(1);
  expect(mockSend).not.toHaveBeenCalled();
});

it('does not allow an answer action captured by the former account to answer a new call', async () => {
  const hook = mount(); const oldAnswer = hook.result.current.answerCall;
  hook.rerender({ account: 'other-account' }); incoming('new-caller');
  await act(async () => oldAnswer());
  expect(getMediaStream).not.toHaveBeenCalled();
  expect(hook.result.current.callState).toBe(CALL_STATE.INCOMING);
});

it.each(['media', 'permission', 'offer', 'signaling'])('does not signal a remote hangup before an offer during %s', async stage => {
  const gate = deferred(); const stream = makeStream('pending');
  if (stage === 'media') getMediaStream.mockReturnValueOnce(gate.promise);
  if (stage === 'permission') apiClient.get.mockReturnValueOnce(gate.promise);
  if (stage === 'offer') peerPlans.push({ createOffer: jest.fn(() => gate.promise) });
  if (stage === 'signaling') mockWs.current = { readyState: 0 };
  const { result } = mount(); const operation = begin(result); await flush();
  act(() => result.current.endCall());
  expect(mockSend).not.toHaveBeenCalled();
  await act(async () => {
    gate.resolve(stage === 'media' ? stream : { data: { allowed: true }, type: 'offer' });
    await operation;
  });
  expect(mockSend).not.toHaveBeenCalled();
});

it('still signals hangup to the recipient after sending the offer', async () => {
  const { result } = mount();
  await act(async () => { await result.current.startCall('recipient'); });
  act(() => result.current.endCall());
  expect(mockSend).toHaveBeenLastCalledWith({ type: 'call_end', target_user_id: 'recipient' });
});

it('retains the current permission-denied feedback for an active attempt', async () => {
  getMediaStream.mockRejectedValueOnce(error());
  const { result } = mount();
  await act(async () => { await result.current.startCall('recipient'); });
  expect(result.current.permissionDenied).toBe(true);
  expect(result.current.callState).toBe(CALL_STATE.IDLE);
  expect(mockSend).not.toHaveBeenCalled();
});

it('keeps the committed account attempt during an abandoned suspended account render', async () => {
  const gate = deferred(); const suspended = deferred(); const stream = makeStream('committed-owner');
  getMediaStream.mockReturnValueOnce(gate.promise);
  const { result } = renderHook(() => {
    const [account, selectAccount] = useState('owner');
    const call = useWebRTCCall(account);
    if (account === 'suspended-account') throw suspended.promise;
    return { ...call, selectAccount };
  }, { wrapper: ({ children }) => <Suspense fallback={null}>{children}</Suspense> });
  const operation = begin(result);
  act(() => startTransition(() => result.current.selectAccount('suspended-account')));
  await act(async () => { gate.resolve(stream); await operation; });
  expect(result.current.localStream).toBe(stream);
  expect(stream.track.stop).not.toHaveBeenCalled();
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'call_offer', caller_id: 'owner' }));
  act(() => result.current.selectAccount('owner'));
});

it('can start and cancel after StrictMode replays the mount cleanup', async () => {
  const gate = deferred(); const stream = makeStream('strict-media');
  getMediaStream.mockReturnValueOnce(gate.promise);
  const { result } = renderHook(() => useWebRTCCall('owner'), {
    wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
  });
  const operation = begin(result);
  act(() => result.current.endCall());
  await act(async () => { gate.resolve(stream); await operation; });
  expect(stream.track.stop).toHaveBeenCalledTimes(1);
  expect(peers).toHaveLength(0);
  expect(result.current.callState).toBe(CALL_STATE.IDLE);
});
