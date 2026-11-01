/**
 * The guardian-link screens (guardian program, PRs 1-2).
 *
 * Pins: the child's "Ask my parent" asks the server for a one-time code and shows it with its expiry; an invite is
 * answered by the child (confirm / decline) and never auto-accepted; the adult's "Link my child" sends exactly the
 * code the child gave; errors are announced (role="alert"); the level badge writes the level in words and lists what
 * is locked and what unlocks it. Every control is a real button/input with an accessible name. Colours come from the
 * shared tokens, so no theme branch is needed (light, dark and beach all resolve them).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockUpdateUser = jest.fn();
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) } }));
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'adult-1', is_grom_parent: false }, updateUser: mockUpdateUser }),
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));

import AskMyParentPanel from './AskMyParentPanel';
import LinkMyChildPanel from './LinkMyChildPanel';
import GuardianLevelBadge from './GuardianLevelBadge';

beforeEach(() => {
  mockGet.mockReset().mockResolvedValue({ data: { incoming: [] } });
  mockPost.mockReset();
  mockUpdateUser.mockReset();
});

describe('AskMyParentPanel (the child)', () => {
  it('asks the server for a code and shows it with its expiry', async () => {
    mockPost.mockResolvedValue({ data: { code: 'ABCD-EFGH', expires_at: '2026-10-27T12:00:00Z', valid_hours: 48 } });
    render(<AskMyParentPanel />);
    fireEvent.click(screen.getByRole('button', { name: /get a code/i }));
    expect(await screen.findByTestId('guardian-code')).toHaveTextContent('ABCD-EFGH');
    expect(mockPost).toHaveBeenCalledWith('/grom-hq/guardian-code');
    expect(screen.getByText(/valid until/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get a new code/i })).toBeInTheDocument();
  });

  it('announces a failure instead of showing a code', async () => {
    mockPost.mockRejectedValue({ response: { data: { detail: 'This account already has a linked parent or guardian.' } } });
    render(<AskMyParentPanel />);
    fireEvent.click(screen.getByRole('button', { name: /get a code/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already has a linked parent');
    expect(screen.queryByTestId('guardian-code')).toBeNull();
  });

  it('lists an invite and only the child can confirm it (never auto-accepted)', async () => {
    mockGet.mockResolvedValue({ data: { incoming: [{ invite_id: 'inv-1', from: { id: 'a', full_name: 'Sam Parent' }, expires_at: '2026-10-27T00:00:00Z' }] } });
    mockPost.mockResolvedValue({ data: { success: true } });
    const onLinked = jest.fn();
    render(<AskMyParentPanel onLinked={onLinked} />);
    expect(await screen.findByText('Sam Parent')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/grom-hq/guardian-invites/inv-1/confirm'));
    await waitFor(() => expect(onLinked).toHaveBeenCalled());
  });

  it('declining an invite calls decline, not confirm', async () => {
    mockGet.mockResolvedValue({ data: { incoming: [{ invite_id: 'inv-2', from: { id: 'a', full_name: 'Sam Parent' }, expires_at: 'x' }] } });
    mockPost.mockResolvedValue({ data: { success: true } });
    render(<AskMyParentPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/grom-hq/guardian-invites/inv-2/decline'));
  });
});

describe('LinkMyChildPanel (the adult)', () => {
  it('has a labelled field and sends exactly the code typed', async () => {
    mockPost.mockResolvedValue({ data: { success: true, grom: { id: 'k', full_name: 'Kai' } } });
    const onLinked = jest.fn();
    render(<LinkMyChildPanel onLinked={onLinked} />);
    const input = screen.getByLabelText('Code from your child');
    fireEvent.change(input, { target: { value: 'abcd-efgh' } });
    expect(input).toHaveValue('ABCD-EFGH');
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/grom-hq/link-by-code', null,
      { params: { parent_id: 'adult-1', guardian_code: 'ABCD-EFGH' } }));
    expect(await screen.findByRole('status')).toHaveTextContent('Kai');
    expect(mockUpdateUser).toHaveBeenCalledWith(expect.objectContaining({ is_grom_parent: true }));
    expect(onLinked).toHaveBeenCalled();
  });

  it('does not submit an empty code', () => {
    render(<LinkMyChildPanel />);
    expect(screen.getByRole('button', { name: 'Link' })).toBeDisabled();
  });

  it('announces a bad code and does not mark the account as a parent', async () => {
    mockPost.mockRejectedValue({ response: { data: { detail: 'That code is not valid, has expired, or was already used.' } } });
    render(<LinkMyChildPanel />);
    fireEvent.change(screen.getByLabelText('Code from your child'), { target: { value: 'ZZZZ-ZZZZ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not valid');
    expect(screen.getByLabelText('Code from your child')).toHaveAttribute('aria-invalid', 'true');
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});

describe('GuardianLevelBadge', () => {
  const l1 = {
    browse: { allowed: true, needs: 'L0' }, comment: { allowed: true, needs: 'L1' },
    photo: { allowed: false, needs: 'L2' }, money: { allowed: false, needs: 'L2' },
  };

  it('writes the level in words, never by colour alone', () => {
    render(<GuardianLevelBadge level="L1" unlocked={l1} />);
    expect(screen.getByText('Level 1: Linked')).toBeInTheDocument();
  });

  it('says what is unlocked and what a locked feature needs', () => {
    render(<GuardianLevelBadge level="L1" unlocked={l1} />);
    expect(screen.getByText(/comment and react/i).parentElement).toHaveTextContent('unlocked');
    expect(screen.getByText(/photos and video of the child/i).parentElement).toHaveTextContent('needs a verified guardian (Level 2)');
  });

  it('shows Level 0 when no level is given and has a keyboard-reachable disclosure', () => {
    render(<GuardianLevelBadge level={undefined} unlocked={{}} />);
    expect(screen.getByText('Level 0: Not linked')).toBeInTheDocument();
    expect(screen.getByText('What this level unlocks').tagName).toBe('SUMMARY');
  });
});
