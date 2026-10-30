import React from 'react';
import { createRoot } from 'react-dom/client';
import { useWebRTCCall } from '../../../../frontend/src/hooks/useWebRTCCall';

const fixture = window.__callFixture = { signals: [], peers: [], statsCalls: 0, intervals: new Set() };
const originalSetInterval = window.setInterval.bind(window);
const originalClearInterval = window.clearInterval.bind(window);
window.setInterval = (callback, delay, ...args) => {
  const id = originalSetInterval(callback, delay, ...args); fixture.intervals.add(id); return id;
};
window.clearInterval = id => { fixture.intervals.delete(id); originalClearInterval(id); };
window.RTCPeerConnection = class {
  constructor() { this.connectionState = 'new'; this.iceConnectionState = 'new'; fixture.peers.push(this); }
  addTrack() {}
  async createOffer() { return { type: 'offer', sdp: 'synthetic' }; }
  async setLocalDescription() {}
  async getStats() { fixture.statsCalls += 1; return new Map(); }
  close() { this.connectionState = 'closed'; }
};
function App() {
  const call = useWebRTCCall('fixture-caller', { name: 'Synthetic caller' });
  fixture.api = call;
  return <main><output data-testid="state">{call.callState}</output><output data-testid="duration">{call.callDuration}</output>
    <button onClick={() => call.startCall('fixture-a')}>Start A</button>
    <button onClick={() => call.startCall('fixture-b')}>Start B</button>
    <button onClick={() => call.endCall()}>End</button>
    <button onClick={() => { const pc = fixture.peers.at(-1); pc.connectionState = 'connected'; pc.onconnectionstatechange(); }}>Connect</button>
    <button onClick={() => { const pc = fixture.peers.at(-1); pc.iceConnectionState = 'completed'; pc.oniceconnectionstatechange(); pc.onconnectionstatechange(); }}>Duplicate events</button>
  </main>;
}
const root = createRoot(document.getElementById('root'));
fixture.unmount = () => root.unmount();
root.render(<App />);
