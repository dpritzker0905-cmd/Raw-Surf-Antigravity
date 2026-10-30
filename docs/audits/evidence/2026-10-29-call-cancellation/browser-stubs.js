const noop = () => {};
const socket = { current: { readyState: 1 } };
export const sendSignaling = data => window.__callFixture.signals.push({ type: data.type, target: data.target_user_id || null, caller: data.caller_id || null });
export const useWebRTCSignaling = (_owner, handler) => {
  window.__callFixture.incoming = handler;
  return { sendSignaling, wsRef: socket, connectSignaling: noop };
};
export const useWebRTCMedia = () => ({ isMuted: false, isCameraOff: false, facingMode: 'user',
  toggleMute: noop, toggleCamera: noop, flipCamera: noop, replaceVideoTrack: noop, resetMediaState: noop });
export const getMediaStream = () => {
  const fixture = window.__callFixture;
  return fixture.perform('media', fixture.makeStream());
};
export const unlockAudioNow = noop;
export const logger = { debug: noop, warn: noop, error: noop, info: noop };
const notice = () => window.__callFixture.notices.push('notice');
export const toast = Object.assign(notice, { error: notice, success: notice });
export default { get: () => window.__callFixture.perform('permission', { data: { allowed: true } }) };
