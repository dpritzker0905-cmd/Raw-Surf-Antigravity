/**
 * mfaApi -- the two-step verification endpoints (backend/routes/auth_pkg/mfa.py), one place.
 *
 * The enrol-only token a required role receives at sign-in is never stored, so those calls pass it explicitly
 * (`setupToken`) and apiClient keeps it instead of the stored session's. Wrong step-up answers come back as 403, wrong
 * sign-in codes as 401 with the attempts left in `detail`; `mfaErrorMessage` turns either into the sentence to show.
 */
import apiClient from './apiClient';

const withToken = (setupToken) => (setupToken
  ? { headers: { Authorization: `Bearer ${setupToken}` }, useExplicitAuth: true }
  : undefined);

export const mfaApi = {
  status: (setupToken) => apiClient.get('/auth/mfa/status', withToken(setupToken)).then((r) => r.data),
  // code: a current authenticator / recovery code, required once the account already has a second factor.
  beginTotp: (password, setupToken, code) =>
    apiClient.post('/auth/mfa/totp/begin', { password: password || null, ...(code ? { code } : {}) }, withToken(setupToken)).then((r) => r.data),
  confirmTotp: (code, setupToken) =>
    apiClient.post('/auth/mfa/totp/confirm', { code }, withToken(setupToken)).then((r) => r.data),
  disable: (password, code) => apiClient.post('/auth/mfa/disable', { password, code }).then((r) => r.data),
  regenerateRecoveryCodes: (password, code) =>
    apiClient.post('/auth/mfa/recovery-codes/regenerate', { password, code }).then((r) => r.data),
};

export const mfaErrorMessage = (error, fallback = 'Something went wrong. Please try again.') => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (!error?.response) return 'Could not reach Raw Surf. Check your connection and try again.';
  return fallback;
};
