const noop = () => {};
const socket = { current: { readyState: 1 } };
export const sendSignaling = data => window.__callFixture.signals.push({ type: data.type, target: data.target_user_id });
export const useWebRTCSignaling = () => ({ sendSignaling, wsRef: socket, connectSignaling: noop });
export const useWebRTCMedia = () => ({ isMuted: false, isCameraOff: false, facingMode: 'user',
  toggleMute: noop, toggleCamera: noop, flipCamera: noop, replaceVideoTrack: noop, resetMediaState: noop });
export const getMediaStream = async () => ({ getTracks: () => [{ kind: 'audio', stop: noop }] });
export const unlockAudioNow = noop;
export const logger = { debug: noop, warn: noop, error: noop, info: noop };
export const toast = Object.assign(noop, { error: noop, success: noop });
export default { get: async () => ({ data: { allowed: true } }) };
