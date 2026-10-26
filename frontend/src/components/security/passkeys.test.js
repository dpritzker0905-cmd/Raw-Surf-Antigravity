/**
 * Passkey screens and ceremonies (2026-10-25).
 *
 * Pins: each ceremony is "ask the server -> browser prompt -> send the answer back", in that order, and the second call
 * never happens if the person cancels; the enrol-only token is passed explicitly; cancelled / timed-out prompts get a
 * human sentence (not the browser's); the manager lists, adds (password first), renames and removes, shows the server's
 * reason when it refuses (the last second step), and says in words when a passkey belongs to a different site; the
 * sign-in button and the second-step option only exist where passkeys can work.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const mockPost = jest.fn();
const mockGet = jest.fn();
const mockPatch = jest.fn();
jest.mock('../../lib/apiClient', () => ({
  __esModule: true,
  default: { get: (...a) => mockGet(...a), post: (...a) => mockPost(...a), patch: (...a) => mockPatch(...a) },
}));
let mockTheme = 'dark';
jest.mock('../../contexts/ThemeContext', () => ({ useThemeName: () => mockTheme, useTheme: () => ({ theme: mockTheme }) }));
const mockStartSession = jest.fn();
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ startSession: mockStartSession, completeMfaLogin: jest.fn() }) }));
const mockToastSuccess = jest.fn();
jest.mock('sonner', () => ({ toast: { success: (...a) => mockToastSuccess(...a), error: jest.fn() } }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
const mockStartRegistration = jest.fn();
const mockStartAuthentication = jest.fn();
let mockSupported = true;
jest.mock('@simplewebauthn/browser', () => ({
  startRegistration: (...a) => mockStartRegistration(...a),
  startAuthentication: (...a) => mockStartAuthentication(...a),
  browserSupportsWebAuthn: () => mockSupported,
}));

import { passkeyErrorMessage, registerPasskey, signInWithPasskey, passkeySecondStep } from '../../lib/passkeys';
import { PasskeyManager } from './PasskeyManager';
import { MfaChallengeStep, MfaSetupStep, PasskeySignInButton } from './MfaSignInSteps';
import { SecuritySettings } from './SecuritySettings';

const OPTIONS = { challenge: 'abc', rpId: 'app.example.test' };
const CREDENTIAL = { id: 'cred', response: {} };
const CODES = Array.from({ length: 10 }, (_, i) => `ABCD${i}-EFGH${i}`);
const reject = (status, detail) => Object.assign(new Error('x'), { response: { status, data: { detail } } });
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const ITEMS = [
  { id: 'p1', name: 'Phone', created_at: '2026-10-01T12:00:00Z', last_used_at: null, usable_here: true },
  { id: 'p2', name: 'Old laptop', created_at: '2026-09-01T12:00:00Z', last_used_at: '2026-10-02T12:00:00Z', usable_here: false },
];

beforeEach(() => {
  mockTheme = 'dark';
  mockSupported = true;
  mockGet.mockResolvedValue({ data: { passkeys: ITEMS } });
  mockPost.mockResolvedValue({ data: {} });
  mockPatch.mockResolvedValue({ data: {} });
  mockStartSession.mockImplementation((s) => s);
});

describe('ceremonies', () => {
  it('registration: options, then the browser prompt, then verify - with the person\'s answer', async () => {
    mockPost.mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } })
      .mockResolvedValueOnce({ data: { passkey: { id: 'p1' }, recovery_codes: CODES } });
    mockStartRegistration.mockResolvedValue(CREDENTIAL);
    const result = await registerPasskey({ password: 'pw', name: 'Phone' });
    expect(mockPost).toHaveBeenNthCalledWith(1, '/auth/passkeys/register/options', { password: 'pw' }, undefined);
    expect(mockStartRegistration).toHaveBeenCalledWith({ optionsJSON: OPTIONS });
    expect(mockPost).toHaveBeenNthCalledWith(2, '/auth/passkeys/register/verify',
      { ceremony_id: 'cer', credential: CREDENTIAL, name: 'Phone' }, undefined);
    expect(result.recovery_codes).toEqual(CODES);
  });

  it('a cancelled prompt never reaches verify', async () => {
    mockPost.mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } });
    mockStartRegistration.mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }));
    await expect(registerPasskey({ password: 'pw' })).rejects.toThrow('cancelled');
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('the enrol-only token rides on both calls and is never read from storage', async () => {
    mockPost.mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } }).mockResolvedValueOnce({ data: {} });
    mockStartRegistration.mockResolvedValue(CREDENTIAL);
    await registerPasskey({ setupToken: 'setup-tok' });
    const explicit = { headers: { Authorization: 'Bearer setup-tok' }, useExplicitAuth: true };
    expect(mockPost).toHaveBeenNthCalledWith(1, '/auth/passkeys/register/options', { password: null }, explicit);
    expect(mockPost).toHaveBeenNthCalledWith(2, '/auth/passkeys/register/verify',
      { ceremony_id: 'cer', credential: CREDENTIAL, name: null }, explicit);
  });

  it('sign-in with a passkey: options, prompt, verify, and returns the session', async () => {
    mockPost.mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } })
      .mockResolvedValueOnce({ data: { id: 'u1', access_token: 'tok' } });
    mockStartAuthentication.mockResolvedValue(CREDENTIAL);
    expect(await signInWithPasskey()).toEqual({ id: 'u1', access_token: 'tok' });
    expect(mockPost).toHaveBeenNthCalledWith(1, '/auth/login/passkey/options');
    expect(mockPost).toHaveBeenNthCalledWith(2, '/auth/login/passkey/verify', { ceremony_id: 'cer', credential: CREDENTIAL });
  });

  it('second step: the challenge travels with both calls', async () => {
    mockPost.mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } }).mockResolvedValueOnce({ data: { id: 'u1' } });
    mockStartAuthentication.mockResolvedValue(CREDENTIAL);
    await passkeySecondStep('chal');
    expect(mockPost).toHaveBeenNthCalledWith(1, '/auth/login/mfa/passkey/options', { challenge_token: 'chal' });
    expect(mockPost).toHaveBeenNthCalledWith(2, '/auth/login/mfa/passkey/verify',
      { challenge_token: 'chal', ceremony_id: 'cer', credential: CREDENTIAL });
  });

  it.each([
    [{ name: 'NotAllowedError' }, /cancelled or timed out/],
    [{ code: 'ERROR_CEREMONY_ABORTED' }, /cancelled or timed out/],
    [{ code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' }, /already has a passkey/],
    [{ code: 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT' }, /can't be used as a passkey/],
    [{ message: 'WebAuthn is not supported in this browser' }, /doesn't support passkeys/],
    [{ response: { data: { detail: 'Your passkey couldn\'t be verified.' } } }, /couldn't be verified/],
    [{}, /Couldn't use the passkey/],
  ])('turns %o into a sentence a person can use', (error, expected) => {
    expect(passkeyErrorMessage(Object.assign(new Error(error.message || ''), error))).toMatch(expected);
  });
});

describe('PasskeyManager', () => {
  it('lists passkeys with dates and says in words which belong to another site', async () => {
    render(<PasskeyManager />);
    const list = await screen.findByRole('list', { name: 'Your passkeys' });
    const [phone, laptop] = within(list).getAllByRole('listitem');
    expect(phone).toHaveTextContent('Phone');
    expect(phone).toHaveTextContent('Not used yet');
    expect(laptop).toHaveTextContent('Last used');
    expect(laptop).toHaveTextContent('Made for a different Raw Surf site');
    expect(phone).not.toHaveTextContent('different Raw Surf site');
    expect(screen.getByRole('button', { name: 'Rename passkey Phone' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove passkey Old laptop' })).toBeInTheDocument();
  });

  it('adds a passkey: password first (focused), then the prompt, then the list refreshes', async () => {
    const onCodes = jest.fn();
    const onChanged = jest.fn();
    mockPost.mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } })
      .mockResolvedValueOnce({ data: { passkey: { id: 'p3' }, recovery_codes: CODES } });
    mockStartRegistration.mockResolvedValue(CREDENTIAL);
    render(<PasskeyManager onCodes={onCodes} onChanged={onChanged} />);
    fireEvent.click(await screen.findByTestId('add-passkey'));
    expect(screen.getByLabelText('Password')).toHaveFocus();
    const submit = screen.getByRole('button', { name: 'Add passkey' });
    expect(submit).toBeDisabled();
    type('Password', 'pw');
    type('Name (optional)', ' My phone ');
    fireEvent.click(submit);
    await waitFor(() => expect(onCodes).toHaveBeenCalledWith(CODES));
    expect(mockPost).toHaveBeenNthCalledWith(1, '/auth/passkeys/register/options', { password: 'pw' }, undefined);
    expect(mockPost).toHaveBeenNthCalledWith(2, '/auth/passkeys/register/verify',
      { ceremony_id: 'cer', credential: CREDENTIAL, name: 'My phone' }, undefined);
    expect(mockToastSuccess).toHaveBeenCalledWith('Passkey added');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('a later passkey (no new codes) just refreshes the page', async () => {
    const onCodes = jest.fn();
    const onChanged = jest.fn();
    mockPost.mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } })
      .mockResolvedValueOnce({ data: { passkey: { id: 'p3' }, recovery_codes: [] } });
    mockStartRegistration.mockResolvedValue(CREDENTIAL);
    render(<PasskeyManager onCodes={onCodes} onChanged={onChanged} />);
    fireEvent.click(await screen.findByTestId('add-passkey'));
    type('Password', 'pw');
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(onCodes).not.toHaveBeenCalled();
  });

  it('says a wrong password in the server\'s words and a cancelled prompt in ours, and stays open', async () => {
    mockPost.mockRejectedValueOnce(reject(403, 'Password is incorrect'))
      .mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } });
    mockStartRegistration.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    render(<PasskeyManager />);
    fireEvent.click(await screen.findByTestId('add-passkey'));
    type('Password', 'nope');
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Password is incorrect');
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/cancelled or timed out/));
    expect(screen.getByTestId('passkey-form')).toBeInTheDocument();
  });

  it('renames', async () => {
    render(<PasskeyManager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename passkey Phone' }));
    expect(screen.getByLabelText('New name')).toHaveFocus();
    expect(screen.getByLabelText('New name')).toHaveValue('Phone');
    type('New name', 'Work phone');
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/auth/passkeys/p1', { name: 'Work phone' }));
  });

  it('removes only with the password, and shows why when the server refuses the last second step', async () => {
    const onChanged = jest.fn();
    mockPost.mockRejectedValueOnce(reject(409, 'This is your only second step. Add an authenticator app or another passkey first, or turn two-step verification off.'))
      .mockResolvedValueOnce({ data: { removed: 'p1' } });
    render(<PasskeyManager onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove passkey Phone' }));
    type('Password', 'pw');
    fireEvent.click(screen.getByRole('button', { name: 'Remove passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('only second step');
    expect(mockPost).toHaveBeenCalledWith('/auth/passkeys/p1/remove', { password: 'pw' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove passkey' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mockToastSuccess).toHaveBeenCalledWith('Passkey removed');
  });

  it('in a browser without passkeys it says so and cannot add one', async () => {
    mockSupported = false;
    render(<PasskeyManager />);
    expect(await screen.findByText(/can't create passkeys/)).toBeInTheDocument();
    expect(screen.getByTestId('add-passkey')).toBeDisabled();
  });

  it.each([['light', 'text-amber-900'], ['dark', 'text-amber-100'], ['beach', 'border-amber-400']])(
    '%s theme: the unsupported note uses that theme\'s colours', async (theme, cls) => {
      mockTheme = theme;
      mockSupported = false;
      render(<PasskeyManager />);
      expect((await screen.findByRole('note')).className).toContain(cls);
    });
});

describe('sign-in second step with a passkey', () => {
  const challenge = (methods) => ({ mfa_required: true, challenge_token: 'chal-123456', methods });

  it('offers the passkey first and finishes the session with it', async () => {
    const onSuccess = jest.fn();
    mockPost.mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } })
      .mockResolvedValueOnce({ data: { id: 'u1', access_token: 'tok' } });
    mockStartAuthentication.mockResolvedValue(CREDENTIAL);
    render(<MfaChallengeStep challenge={challenge(['passkey', 'recovery'])} onSuccess={onSuccess} onBack={jest.fn()} />);
    fireEvent.click(screen.getByTestId('mfa-use-passkey'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ id: 'u1', access_token: 'tok' }));
    expect(mockStartSession).toHaveBeenCalledWith({ id: 'u1', access_token: 'tok' });
  });

  it('a passkey-only account (plus recovery codes) is asked for a recovery code, not an authenticator code', () => {
    render(<MfaChallengeStep challenge={challenge(['passkey', 'recovery'])} onSuccess={jest.fn()} onBack={jest.fn()} />);
    expect(screen.getByLabelText('Recovery code')).toBeInTheDocument();
    expect(screen.queryByLabelText('Authenticator code')).toBeNull();
    expect(screen.queryByRole('button', { name: /authenticator app/ })).toBeNull();
  });

  it('a passkey-only account with no recovery codes left shows only the passkey and a way back', () => {
    render(<MfaChallengeStep challenge={challenge(['passkey'])} onSuccess={jest.fn()} onBack={jest.fn()} />);
    expect(screen.getByTestId('mfa-use-passkey')).toBeInTheDocument();
    expect(screen.queryByTestId('mfa-code-input')).toBeNull();
    expect(screen.getByRole('button', { name: 'Back to sign in' })).toBeInTheDocument();
  });

  it('no passkey button where the browser cannot do passkeys', () => {
    mockSupported = false;
    render(<MfaChallengeStep challenge={challenge(['totp', 'passkey', 'recovery'])} onSuccess={jest.fn()} onBack={jest.fn()} />);
    expect(screen.queryByTestId('mfa-use-passkey')).toBeNull();
    expect(screen.getByLabelText('Authenticator code')).toBeInTheDocument();
  });

  it('announces a failed passkey with the server\'s attempts-left and an expired one swaps the form for a way back', async () => {
    mockPost.mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } })
      .mockRejectedValueOnce(reject(401, 'Your passkey couldn\'t be verified. 4 attempts left.'));
    mockStartAuthentication.mockResolvedValue(CREDENTIAL);
    render(<MfaChallengeStep challenge={challenge(['totp', 'passkey', 'recovery'])} onSuccess={jest.fn()} onBack={jest.fn()} />);
    fireEvent.click(screen.getByTestId('mfa-use-passkey'));
    expect(await screen.findByRole('alert')).toHaveTextContent('4 attempts left');

    mockPost.mockReset();
    mockPost.mockRejectedValueOnce(reject(401, 'Sign-in expired. Please start again.'));
    fireEvent.click(screen.getByTestId('mfa-use-passkey'));
    expect(await screen.findByTestId('mfa-expired')).toBeInTheDocument();
  });
});

describe('required setup with a passkey', () => {
  it('offers a passkey beside the authenticator app and starts the session only after the codes are saved', async () => {
    const session = { id: 'u1', access_token: 'real' };
    const onSuccess = jest.fn();
    mockPost.mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } })
      .mockResolvedValueOnce({ data: { passkey: { id: 'p1' }, recovery_codes: CODES, session } });
    mockStartRegistration.mockResolvedValue(CREDENTIAL);
    render(<MfaSetupStep setupToken="setup-tok" methods={['totp', 'passkey']} onSuccess={onSuccess} onBack={jest.fn()} />);
    fireEvent.click(screen.getByTestId('setup-use-passkey'));
    await screen.findByRole('list', { name: 'Recovery codes' });
    expect(mockPost).toHaveBeenNthCalledWith(1, '/auth/passkeys/register/options', { password: null },
      { headers: { Authorization: 'Bearer setup-tok' }, useExplicitAuth: true });
    expect(mockStartSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Raw Surf' }));
    expect(onSuccess).toHaveBeenCalledWith(session);
  });

  it('no passkey option when the server did not list it', () => {
    render(<MfaSetupStep setupToken="t" methods={['totp']} onSuccess={jest.fn()} onBack={jest.fn()} />);
    expect(screen.queryByTestId('setup-use-passkey')).toBeNull();
  });

  it('a cancelled prompt is announced and nothing starts', async () => {
    mockPost.mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } });
    mockStartRegistration.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    render(<MfaSetupStep setupToken="t" methods={['totp', 'passkey']} onSuccess={jest.fn()} onBack={jest.fn()} />);
    fireEvent.click(screen.getByTestId('setup-use-passkey'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cancelled or timed out/);
    expect(mockStartSession).not.toHaveBeenCalled();
  });
});

describe('PasskeySignInButton', () => {
  it('signs in with a passkey alone and hands on the session', async () => {
    const onSuccess = jest.fn();
    mockPost.mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } })
      .mockResolvedValueOnce({ data: { id: 'u1', access_token: 'tok' } });
    mockStartAuthentication.mockResolvedValue(CREDENTIAL);
    render(<PasskeySignInButton onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ id: 'u1', access_token: 'tok' }));
    expect(mockStartSession).toHaveBeenCalledTimes(1);
  });

  it('is absent where passkeys cannot work', () => {
    mockSupported = false;
    const { container } = render(<PasskeySignInButton onSuccess={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces a refused passkey and signs nobody in', async () => {
    mockPost.mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } })
      .mockRejectedValueOnce(reject(401, 'Your passkey couldn\'t be verified.'));
    mockStartAuthentication.mockResolvedValue(CREDENTIAL);
    const onSuccess = jest.fn();
    render(<PasskeySignInButton onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("couldn't be verified");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mockStartSession).not.toHaveBeenCalled();
  });
});

describe('SecuritySettings with passkeys', () => {
  const STATUS = { enabled: true, totp: false, passkeys: 1, recovery_codes_remaining: 10, enrolment_available: true, passkeys_available: true, required: false, setup_only: false };

  it('a passkey-only account is ON, lists its passkeys, and still offers an authenticator app', async () => {
    mockGet.mockImplementation((url) => Promise.resolve({ data: url === '/auth/mfa/status' ? STATUS : { passkeys: ITEMS } }));
    render(<SecuritySettings />);
    expect(await screen.findByText('Two-step verification is ON')).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Your passkeys' })).toBeInTheDocument();
    expect(screen.getByText('Not set up.')).toBeInTheDocument();
    expect(screen.getByTestId('start-enrol')).toBeInTheDocument();
    expect(screen.getByTestId('recovery-remaining')).toHaveTextContent('10 of 10');
  });

  it('no passkey section when the site is not set up for passkeys', async () => {
    mockGet.mockResolvedValue({ data: { ...STATUS, passkeys: 0, enabled: false, passkeys_available: false } });
    render(<SecuritySettings />);
    await screen.findByText('Two-step verification is OFF');
    expect(screen.queryByTestId('passkey-manager')).toBeNull();
  });

  it('the first passkey shows the one-time recovery codes', async () => {
    mockGet.mockImplementation((url) => Promise.resolve({ data: url === '/auth/mfa/status' ? { ...STATUS, enabled: false, passkeys: 0, recovery_codes_remaining: 0 } : { passkeys: [] } }));
    mockPost.mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } })
      .mockResolvedValueOnce({ data: { passkey: { id: 'p1' }, recovery_codes: CODES } });
    mockStartRegistration.mockResolvedValue(CREDENTIAL);
    render(<SecuritySettings />);
    fireEvent.click(await screen.findByTestId('add-passkey'));
    type('Password', 'pw');
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }));
    expect(await screen.findByRole('list', { name: 'Recovery codes' })).toBeInTheDocument();
  });
});


describe('PasskeyManager step-up when another way already exists', () => {
  it('asks for a current code, locks Add until given, and sends it with the password', async () => {
    mockPost.mockResolvedValueOnce({ data: { ceremony_id: 'cer', options: OPTIONS } })
      .mockResolvedValueOnce({ data: { passkey: { id: 'p3' }, recovery_codes: [] } });
    mockStartRegistration.mockResolvedValue(CREDENTIAL);
    render(<PasskeyManager needsCode onChanged={jest.fn()} />);
    fireEvent.click(await screen.findByTestId('add-passkey'));
    type('Password', 'pw');
    const submit = screen.getByRole('button', { name: 'Add passkey' });
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText('Current code or recovery code')).toHaveAccessibleDescription(/like turning two-step verification off/);
    type('Current code or recovery code', ' 123456 ');
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    expect(mockPost).toHaveBeenNthCalledWith(1, '/auth/passkeys/register/options', { password: 'pw', code: '123456' }, undefined);
  });

  it('shows the server\'s refusal of a wrong code and does not open the browser prompt', async () => {
    mockPost.mockRejectedValueOnce(reject(403, 'That code is not valid'));
    render(<PasskeyManager needsCode />);
    fireEvent.click(await screen.findByTestId('add-passkey'));
    type('Password', 'pw');
    type('Current code or recovery code', '000000');
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not valid');
    expect(mockStartRegistration).not.toHaveBeenCalled();
  });

  it('the first passkey asks for no code', async () => {
    render(<PasskeyManager />);
    fireEvent.click(await screen.findByTestId('add-passkey'));
    expect(screen.queryByLabelText('Current code or recovery code')).toBeNull();
  });
});