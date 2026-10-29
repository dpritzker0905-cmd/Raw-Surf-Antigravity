import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useWebRTCCall } from '../../../../frontend/src/hooks/useWebRTCCall';

const fixture = window.__callFixture = {
  signals: [], peers: [], streams: [], requests: [], gates: [], tasks: [], notices: [], timers: new Map(),
};
let nextStream = 0;
fixture.hold = operation => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  fixture.gates.push({ operation, promise, resolve, reject, used: false, released: false });
};
fixture.perform = (operation, value, peer = null) => {
  const gate = fixture.gates.find(item => item.operation === operation && !item.used);
  fixture.requests.push({ operation, peer });
  if (!gate) return Promise.resolve(value);
  gate.used = true;
  return gate.promise.then(() => value);
};
fixture.release = (operation, errorName = null) => {
  const gate = fixture.gates.find(item => item.operation === operation && item.used && !item.released);
  if (!gate) throw new Error('No matching used fixture gate');
  gate.released = true;
  if (errorName) { const error = new Error('Synthetic setup failure'); error.name = errorName; gate.reject(error); }
  else gate.resolve();
};
fixture.makeStream = () => {
  const track = { kind: 'audio', stopped: 0, stop() { this.stopped += 1; } };
  const stream = { id: `stream-${++nextStream}`, getTracks: () => [track] };
  fixture.streams.push({ stream, track });
  return stream;
};
fixture.begin = (action, ...args) => {
  const task = { action, settled: false, rejected: false }; fixture.tasks.push(task);
  Promise.resolve(fixture.api[action](...args)).then(() => { task.settled = true; }, () => { task.settled = true; task.rejected = true; });
};
for (const [setName, clearName, interval] of [['setTimeout', 'clearTimeout', false], ['setInterval', 'clearInterval', true]]) {
  const originalSet = window[setName].bind(window); const originalClear = window[clearName].bind(window);
  window[setName] = (callback, delay, ...args) => {
    let id;
    id = originalSet(() => { if (!interval) fixture.timers.delete(id); callback(...args); }, delay);
    fixture.timers.set(id, { interval, delay }); return id;
  };
  window[clearName] = id => { fixture.timers.delete(id); originalClear(id); };
}
window.RTCPeerConnection = class {
  constructor() { this.id = fixture.peers.length; this.connectionState = 'new'; this.iceConnectionState = 'new'; this.closed = false; fixture.peers.push(this); }
  addTrack() {}
  createOffer() { return fixture.perform('offer', { type: 'offer', sdp: 'synthetic' }, this.id); }
  createAnswer() { return fixture.perform('answer', { type: 'answer', sdp: 'synthetic' }, this.id); }
  async setLocalDescription(value) { await fixture.perform('local', null, this.id); this.localDescription = value; }
  async setRemoteDescription(value) { await fixture.perform('remote', null, this.id); this.remoteDescription = value; }
  addIceCandidate() { return fixture.perform('ice', null, this.id); }
  async getStats() { return new Map(); }
  close() { this.closed = true; this.connectionState = 'closed'; }
};
window.RTCSessionDescription = function Description(value) { return value; };
window.RTCIceCandidate = function Candidate(value) { return value; };
const userInfo = { name: 'Synthetic fixture caller' };
function App() {
  const [owner, setOwner] = useState('fixture-owner');
  const call = useWebRTCCall(owner, userInfo);
  fixture.api = call; fixture.owner = owner; fixture.switchOwner = setOwner;
  return <main><h1>Isolated call cancellation fixture</h1><output data-testid="state">{call.callState}</output><output data-testid="owner">{owner}</output>
    <button onClick={() => fixture.begin('startCall', 'fixture-a')}>Start A</button>
    <button onClick={() => fixture.begin('startCall', 'fixture-b')}>Start B</button>
    <button onClick={() => call.endCall()}>End</button>
  </main>;
}
const root = createRoot(document.getElementById('root'));
fixture.unmount = () => { if (!fixture.unmounted) { fixture.unmounted = true; root.unmount(); } };
fixture.snapshot = () => ({
  state: fixture.api.callState, remote: fixture.api.remoteUserInfo?.id || null,
  local: fixture.api.localStream?.id || null, permissionDenied: fixture.api.permissionDenied,
  signals: fixture.signals, peers: fixture.peers.map(pc => ({ id: pc.id, closed: pc.closed })),
  streams: fixture.streams.map(({ stream, track }) => ({ id: stream.id, stopped: track.stopped })),
  answerTimers: [...fixture.timers.values()].filter(timer => !timer.interval && timer.delay === 30000).length,
  intervals: [...fixture.timers.values()].filter(timer => timer.interval).length,
  notices: fixture.notices,
});
root.render(<App />);
