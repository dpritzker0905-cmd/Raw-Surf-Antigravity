export const CALL_STATE = { IDLE: 'idle', INCOMING: 'incoming', OUTGOING: 'outgoing', CONNECTED: 'connected' };
export const useWebRTCCall = () => ({ callState: 'idle' });
export const usePushNotifications = () => ({ isSupported: false, isSubscribed: false });
export const hasPushOptIn = () => false;
export const ensureAudioUnlocked = () => {};
export default function useDisabledFeature() { return { activeSession: null, loading: false }; }
