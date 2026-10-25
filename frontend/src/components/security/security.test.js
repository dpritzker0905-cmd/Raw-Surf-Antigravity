/**
 * Two-step verification screens (TOTP + recovery codes), 2026-10-25.
 *
 * Pins: the recovery codes are shown once and Continue is locked behind an explicit "I saved them"; the QR code has a
 * typed-key fallback; the enrol-only sign-in token is passed explicitly and never stored; wrong answers are announced
 * (role="alert") and keep the form open; the sign-in step switches between authenticator and recovery code; every
 * state is written in words; the status colours come from the per-theme table (light, dark and beach).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) } }));
let mockTheme = 'dark';
jest.mock('../../contexts/ThemeContext', () => ({ useThemeName: () => mockTheme, useTheme: () => ({ theme: mockTheme }) }));
const mockCompleteMfaLogin = jest.fn();
const mockStartSession = jest.fn();
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ completeMfaLogin: mockCompleteMfaLogin, startSession: mockStartSession }),
}));
const mockToastSuccess = jest.fn();
jest.mock('sonner', () => ({ toast: { success: (...a) => mockToastSuccess(...a), error: jest.fn() } }));
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }), { virtual: true });

import { RecoveryCodesPanel, recoveryCodesText } from './RecoveryCodesPanel';
import { TotpEnrolment } from './TotpEnrolment';
import { StepUpForm } from './StepUpForm';
import { SecuritySettings } from './SecuritySettings';
import { MfaChallengeStep, MfaSetupStep } from './MfaSignInSteps';

const CODES = Array.from({ length: 10 }, (_, i) => `ABCD${i}-EFGH${i}`);
const SETUP = { secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/Raw%20Surf:a%40b.c?secret=JBSWY3DPEHPK3PXP', account: 'a@b.c' };
const STATUS_OFF = { enabled: false, totp: false, passkeys: 0, recovery_codes_remaining: 0, enrolment_available: true, required: false, setup_only: false };
const STATUS_ON = { ...STATUS_OFF, enabled: true, totp: true, recovery_codes_remaining: 10 };
const rejection = (status, detail) => Object.assign(new Error('x'), { response: { status, data: { detail } } });
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  mockTheme = 'dark';
  mockGet.mockResolvedValue({ data: STATUS_OFF });
  mockPost.mockResolvedValue({ data: {} });
});

describe('RecoveryCodesPanel', () => {
  it('lists the ten codes, takes focus, and keeps Continue locked until "I saved them"', () => {
    const onDone = jest.fn();
    render(<RecoveryCodesPanel codes={CODES} onDone={onDone} />);
    expect(screen.getByRole('heading', { name: 'Save your recovery codes' })).toHaveFocus();
    expect(within(screen.getByRole('list', { name: 'Recovery codes' })).getAllByRole('listitem')).toHaveLength(10);
    const next = screen.getByRole('button', { name: 'Continue' });
    expect(next).toBeDisabled();
    expect(next).toHaveAccessibleDescription('Tick the box above to continue.');
    fireEvent.click(next);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I saved these codes somewhere safe' }));
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('copies every code and says so', async () => {
    const writeText = jest.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<RecoveryCodesPanel codes={CODES} onDone={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy codes/ }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied'));
    expect(writeText).toHaveBeenCalledWith(recoveryCodesText(CODES));
    expect(writeText.mock.calls[0][0]).toContain(CODES[9]);
  });

  it('says so when copying is refused', async () => {
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('no')) } });
    render(<RecoveryCodesPanel codes={CODES} onDone={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy codes/ }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent("Couldn't copy"));
  });

  it('downloads a text file', () => {
    URL.createObjectURL = jest.fn(() => 'blob:codes');
    URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<RecoveryCodesPanel codes={CODES} onDone={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Download/ }));
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('raw-surf-recovery-codes.txt');
    click.mockRestore();
  });

  it.each([['light', 'text-amber-900'], ['dark', 'text-amber-100'], ['beach', 'border-amber-400']])(
    '%s theme: the warning uses that theme\'s colours and is also written out', (theme, cls) => {
      mockTheme = theme;
      render(<RecoveryCodesPanel codes={CODES} onDone={jest.fn()} />);
      const note = screen.getByRole('note');
      expect(note.className).toContain(cls);
      expect(note).toHaveTextContent(/only way back into your account/);
    });
});

describe('TotpEnrolment', () => {
  it('asks for the password, shows a QR code AND the typed key, then confirms with a code', async () => {
    const onEnrolled = jest.fn();
    mockPost.mockResolvedValueOnce({ data: SETUP }).mockResolvedValueOnce({ data: { enabled: true, recovery_codes: CODES } });
    render(<TotpEnrolment onEnrolled={onEnrolled} />);
    const start = screen.getByRole('button', { name: /Set up authenticator app/ });
    expect(start).toBeDisabled();
    expect(screen.getByLabelText('Confirm your password')).toHaveFocus();
    type('Confirm your password', 'hunter22');
    fireEvent.click(start);

    expect(await screen.findByRole('img', { name: /QR code/ })).toBeInTheDocument();
    expect(mockPost).toHaveBeenNthCalledWith(1, '/auth/mfa/totp/begin', { password: 'hunter22' }, undefined);
    expect(screen.getByTestId('totp-secret')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');
    expect(screen.getByLabelText('Enter the 6-digit code the app shows')).toHaveFocus();

    const submit = screen.getByRole('button', { name: 'Turn on two-step verification' });
    expect(submit).toBeDisabled();
    type('Enter the 6-digit code the app shows', '123 456');
    fireEvent.click(submit);
    await waitFor(() => expect(onEnrolled).toHaveBeenCalledWith({ enabled: true, recovery_codes: CODES }));
    expect(mockPost).toHaveBeenNthCalledWith(2, '/auth/mfa/totp/confirm', { code: '123 456' }, undefined);
  });

  it('the enrol-only sign-in token skips the password and is passed explicitly', async () => {
    mockPost.mockResolvedValueOnce({ data: SETUP });
    render(<TotpEnrolment setupToken="setup-tok" onEnrolled={jest.fn()} />);
    expect(screen.queryByLabelText('Confirm your password')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Set up authenticator app/ }));
    await screen.findByRole('img', { name: /QR code/ });
    expect(mockPost).toHaveBeenCalledWith('/auth/mfa/totp/begin', { password: null },
      { headers: { Authorization: 'Bearer setup-tok' }, useExplicitAuth: true });
  });

  it('announces a wrong password and stays on the first step', async () => {
    mockPost.mockRejectedValueOnce(rejection(403, 'Password is incorrect'));
    render(<TotpEnrolment onEnrolled={jest.fn()} />);
    type('Confirm your password', 'nope');
    fireEvent.click(screen.getByRole('button', { name: /Set up authenticator app/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Password is incorrect');
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull();
  });

  it('announces a wrong code, clears the box and puts the cursor back in it', async () => {
    mockPost.mockResolvedValueOnce({ data: SETUP }).mockRejectedValueOnce(rejection(400, "That code didn't match. Check your authenticator and try again."));
    const onEnrolled = jest.fn();
    render(<TotpEnrolment setupToken="t" onEnrolled={onEnrolled} />);
    fireEvent.click(screen.getByRole('button', { name: /Set up authenticator app/ }));
    await screen.findByRole('img', { name: /QR code/ });
    type('Enter the 6-digit code the app shows', '000000');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on two-step verification' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That code didn't match");
    const input = screen.getByLabelText('Enter the 6-digit code the app shows');
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(onEnrolled).not.toHaveBeenCalled();
  });

  it('the QR tile is always black on white so it scans in every theme', async () => {
    for (const theme of ['light', 'dark', 'beach']) {
      mockTheme = theme;
      mockPost.mockResolvedValueOnce({ data: SETUP });
      const { unmount } = render(<TotpEnrolment setupToken="t" onEnrolled={jest.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /Set up authenticator app/ }));
      const svg = await screen.findByRole('img', { name: /QR code/ });
      expect(svg.parentElement.style.background).toBe('rgb(255, 255, 255)');
      expect(svg.querySelector('path[fill="#000000"]')).not.toBeNull();
      unmount();
    }
  });
});

describe('StepUpForm', () => {
  const setup = (onSubmit = jest.fn().mockResolvedValue()) => {
    render(<StepUpForm idPrefix="x" title="Do it" description="Why" submitLabel="Go" onSubmit={onSubmit} onCancel={jest.fn()} />);
    return onSubmit;
  };

  it('needs both a password and a code, then submits them', async () => {
    const onSubmit = setup();
    expect(screen.getByRole('heading', { name: 'Do it' })).toHaveFocus();
    const go = screen.getByRole('button', { name: 'Go' });
    expect(go).toBeDisabled();
    type('Password', 'pw');
    expect(go).toBeDisabled();
    type('Authenticator code or recovery code', ' 123456 ');
    fireEvent.click(go);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('pw', '123456'));
  });

  it('shows the server\'s reason, empties the code and stays open', async () => {
    setup(jest.fn().mockRejectedValue(rejection(403, 'That code is not valid')));
    type('Password', 'pw');
    type('Authenticator code or recovery code', '111111');
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not valid');
    expect(screen.getByLabelText('Authenticator code or recovery code')).toHaveValue('');
  });
});

describe('SecuritySettings', () => {
  it('says "OFF" in words and offers setup', async () => {
    render(<SecuritySettings />);
    expect(await screen.findByText('Two-step verification is OFF')).toBeInTheDocument();
    expect(screen.getByTestId('start-enrol')).toBeEnabled();
  });

  it('says it is not available yet when the server has no key, and offers no setup', async () => {
    mockGet.mockResolvedValue({ data: { ...STATUS_OFF, enrolment_available: false } });
    render(<SecuritySettings />);
    expect(await screen.findByText(/isn't available yet/)).toBeInTheDocument();
    expect(screen.queryByTestId('start-enrol')).toBeNull();
  });

  it('notes that the account type requires it', async () => {
    mockGet.mockResolvedValue({ data: { ...STATUS_OFF, required: true } });
    render(<SecuritySettings />);
    expect(await screen.findByText(/required to use two-step verification/)).toBeInTheDocument();
  });

  it('says "ON", counts the recovery codes, and warns when two or fewer remain', async () => {
    mockGet.mockResolvedValue({ data: STATUS_ON });
    const { unmount } = render(<SecuritySettings />);
    expect(await screen.findByText('Two-step verification is ON')).toBeInTheDocument();
    expect(screen.getByTestId('recovery-remaining')).toHaveTextContent('10 of 10');
    expect(screen.queryByText(/running low on recovery codes/)).toBeNull();
    unmount();
    mockGet.mockResolvedValue({ data: { ...STATUS_ON, recovery_codes_remaining: 2 } });
    render(<SecuritySettings />);
    expect(await screen.findByText(/running low on recovery codes/)).toBeInTheDocument();
  });

  it.each([['light', 'text-green-900'], ['dark', 'text-green-200'], ['beach', 'border-green-500']])(
    '%s theme: the ON banner uses that theme\'s colours', async (theme, cls) => {
      mockTheme = theme;
      mockGet.mockResolvedValue({ data: STATUS_ON });
      render(<SecuritySettings />);
      const banner = await screen.findByTestId('mfa-status-banner');
      expect(banner.className).toContain(cls);
      expect(banner).toHaveTextContent('Two-step verification is ON');
    });

  it('sets up end to end: password, code, then the one-time recovery codes', async () => {
    mockPost.mockResolvedValueOnce({ data: SETUP }).mockResolvedValueOnce({ data: { enabled: true, recovery_codes: CODES } });
    render(<SecuritySettings />);
    fireEvent.click(await screen.findByTestId('start-enrol'));
    type('Confirm your password', 'pw');
    fireEvent.click(screen.getByRole('button', { name: /Set up authenticator app/ }));
    await screen.findByRole('img', { name: /QR code/ });
    type('Enter the 6-digit code the app shows', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on two-step verification' }));

    expect(await screen.findByRole('list', { name: 'Recovery codes' })).toBeInTheDocument();
    mockGet.mockResolvedValue({ data: STATUS_ON });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Two-step verification is ON')).toBeInTheDocument();
    expect(mockToastSuccess).toHaveBeenCalledWith('Two-step verification is on');
  });

  it('turns off only with the password and a code, and tells the person', async () => {
    mockGet.mockResolvedValue({ data: STATUS_ON });
    mockPost.mockRejectedValueOnce(rejection(403, 'Password is incorrect')).mockResolvedValueOnce({ data: { enabled: false } });
    render(<SecuritySettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    type('Password', 'wrong');
    type('Authenticator code or recovery code', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Password is incorrect');
    expect(mockPost).toHaveBeenCalledWith('/auth/mfa/disable', { password: 'wrong', code: '123456' });

    mockGet.mockResolvedValue({ data: STATUS_OFF });
    type('Password', 'right');
    type('Authenticator code or recovery code', '654321');
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(await screen.findByText('Two-step verification is OFF')).toBeInTheDocument();
    expect(mockToastSuccess).toHaveBeenCalledWith('Two-step verification is off');
  });

  it('replaces recovery codes behind the same step-up and shows the new ones once', async () => {
    mockGet.mockResolvedValue({ data: STATUS_ON });
    mockPost.mockResolvedValueOnce({ data: { recovery_codes: CODES } });
    render(<SecuritySettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Get new recovery codes' }));
    type('Password', 'pw');
    type('Authenticator code or recovery code', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Replace my recovery codes' }));
    expect(await screen.findByRole('list', { name: 'Recovery codes' })).toBeInTheDocument();
    expect(mockPost).toHaveBeenCalledWith('/auth/mfa/recovery-codes/regenerate', { password: 'pw', code: '123456' });
  });

  it('says so when the settings cannot be loaded and lets the person retry', async () => {
    mockGet.mockRejectedValueOnce(rejection(500, 'boom')).mockResolvedValueOnce({ data: STATUS_OFF });
    render(<SecuritySettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Two-step verification is OFF')).toBeInTheDocument();
  });

  it('has a real Back button to Settings', async () => {
    render(<SecuritySettings />);
    fireEvent.click(await screen.findByRole('button', { name: /Settings/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/settings');
  });
});

describe('MfaChallengeStep', () => {
  const challenge = { mfa_required: true, challenge_token: 'chal-123456', methods: ['totp', 'recovery'] };

  it('submits the code with the challenge and hands the finished session on', async () => {
    const onSuccess = jest.fn();
    mockCompleteMfaLogin.mockResolvedValue({ id: 'u1', access_token: 'tok' });
    render(<MfaChallengeStep challenge={challenge} onSuccess={onSuccess} onBack={jest.fn()} />);
    expect(screen.getByLabelText('Authenticator code')).toHaveFocus();
    type('Authenticator code', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ id: 'u1', access_token: 'tok' }));
    expect(mockCompleteMfaLogin).toHaveBeenCalledWith('chal-123456', '123456');
  });

  it('switches to a recovery code and back, as a pressed toggle', () => {
    render(<MfaChallengeStep challenge={challenge} onSuccess={jest.fn()} onBack={jest.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Use a recovery code instead' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Recovery code')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Use my authenticator app' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Use my authenticator app' }));
    expect(screen.getByLabelText('Authenticator code')).toBeInTheDocument();
  });

  it('offers no recovery toggle when the account has no recovery codes left', () => {
    render(<MfaChallengeStep challenge={{ ...challenge, methods: ['totp'] }} onSuccess={jest.fn()} onBack={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /recovery code/ })).toBeNull();
  });

  it('announces a wrong code with the attempts left, clears the box, and stays', async () => {
    mockCompleteMfaLogin.mockRejectedValue(rejection(401, 'Incorrect code. 4 attempts left.'));
    const onSuccess = jest.fn();
    render(<MfaChallengeStep challenge={challenge} onSuccess={onSuccess} onBack={jest.fn()} />);
    type('Authenticator code', '000000');
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect code. 4 attempts left.');
    expect(screen.getByLabelText('Authenticator code')).toHaveValue('');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('an expired sign-in swaps the form for a way back', async () => {
    mockCompleteMfaLogin.mockRejectedValue(rejection(401, 'Sign-in expired. Please start again.'));
    const onBack = jest.fn();
    render(<MfaChallengeStep challenge={challenge} onSuccess={jest.fn()} onBack={onBack} />);
    type('Authenticator code', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(await screen.findByTestId('mfa-expired')).toHaveTextContent('Sign-in expired');
    expect(screen.queryByLabelText('Authenticator code')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('MfaSetupStep (a required role signing in without a factor)', () => {
  it('enrols with the enrol-only token, shows the recovery codes, and only then starts the session', async () => {
    const session = { id: 'u1', access_token: 'real-session' };
    const onSuccess = jest.fn();
    mockStartSession.mockReturnValue(session);
    mockPost.mockResolvedValueOnce({ data: SETUP }).mockResolvedValueOnce({ data: { enabled: true, recovery_codes: CODES, session } });
    render(<MfaSetupStep setupToken="setup-tok" onSuccess={onSuccess} onBack={jest.fn()} />);
    expect(screen.getByRole('heading', { name: 'Set up two-step verification' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Set up authenticator app/ }));
    await screen.findByRole('img', { name: /QR code/ });
    type('Enter the 6-digit code the app shows', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on two-step verification' }));

    await screen.findByRole('list', { name: 'Recovery codes' });
    expect(mockStartSession).not.toHaveBeenCalled(); // no session until the codes are acknowledged
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Raw Surf' }));
    expect(mockStartSession).toHaveBeenCalledWith(session);
    expect(onSuccess).toHaveBeenCalledWith(session);
  });
});
