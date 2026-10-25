/**
 * passkeys -- WebAuthn ceremonies against backend/routes/auth_pkg/passkeys.py, using @simplewebauthn/browser.
 *
 * Every ceremony is two server calls around one browser prompt: ask the server for options (it keeps the challenge),
 * let the browser/authenticator answer (PIN, biometric or device unlock), send the answer back. The page's origin is
 * attached by the browser itself; the server only accepts the sites it was configured for.
 */
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import apiClient from './apiClient';
import { mfaErrorMessage } from './mfaApi';

export const passkeysSupported = () => {
  try { return browserSupportsWebAuthn(); } catch (_) { return false; }
};

const withToken = (setupToken) => (setupToken
  ? { headers: { Authorization: `Bearer ${setupToken}` }, useExplicitAuth: true }
  : undefined);

/** The sentence to show for a failed or cancelled ceremony (the browser's own wording is not for people). */
export const passkeyErrorMessage = (error) => {
  if (error?.response || error?.isAxiosError) return mfaErrorMessage(error);
  const code = error?.code || '';
  const name = error?.name || error?.cause?.name || '';
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return 'This device already has a passkey for your account.';
  if (code === 'ERROR_CEREMONY_ABORTED' || name === 'NotAllowedError' || name === 'AbortError'
      || code === 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY') return 'Passkey was cancelled or timed out. Try again when you are ready.';
  if (code === 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT'
      || code === 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT') return "This device can't be used as a passkey. Try another device.";
  if (/not supported/i.test(error?.message || '')) return "This browser doesn't support passkeys.";
  return "Couldn't use the passkey. Please try again.";
};

export const passkeyApi = {
  list: () => apiClient.get('/auth/passkeys').then((r) => r.data.passkeys),
  rename: (id, name) => apiClient.patch(`/auth/passkeys/${id}`, { name }).then((r) => r.data),
  remove: (id, password) => apiClient.post(`/auth/passkeys/${id}/remove`, { password }).then((r) => r.data),
};

/** Add a passkey. Resolves to the server's reply: { passkey, recovery_codes, session? }. */
export async function registerPasskey({ password, name, setupToken }) {
  const { data } = await apiClient.post('/auth/passkeys/register/options', { password: password || null }, withToken(setupToken));
  const credential = await startRegistration({ optionsJSON: data.options });
  const verified = await apiClient.post('/auth/passkeys/register/verify',
    { ceremony_id: data.ceremony_id, credential, name: name || null }, withToken(setupToken));
  return verified.data;
}

/** Sign in with a passkey alone (no username, no password). Resolves to the session payload. */
export async function signInWithPasskey() {
  const { data } = await apiClient.post('/auth/login/passkey/options');
  const credential = await startAuthentication({ optionsJSON: data.options });
  const verified = await apiClient.post('/auth/login/passkey/verify', { ceremony_id: data.ceremony_id, credential });
  return verified.data;
}

/** Answer a sign-in challenge (after the password) with a passkey. Resolves to the session payload. */
export async function passkeySecondStep(challengeToken) {
  const { data } = await apiClient.post('/auth/login/mfa/passkey/options', { challenge_token: challengeToken });
  const credential = await startAuthentication({ optionsJSON: data.options });
  const verified = await apiClient.post('/auth/login/mfa/passkey/verify',
    { challenge_token: challengeToken, ceremony_id: data.ceremony_id, credential });
  return verified.data;
}
