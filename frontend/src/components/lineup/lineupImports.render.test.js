/**
 * Components that used a JSX tag they never imported (audit 2026-10-18, F-11): the first render of the branch that
 * uses it throws "X is not defined" and unmounts the surrounding tree. Each case renders that branch.
 * (The repo-wide pin is the `react/jsx-no-undef` rule in the ESLint gate's ALWAYS_ZERO list.)
 */
import { render, screen } from '@testing-library/react';
import PhotographerCard from '../on-demand/PhotographerCard';
import EmptySeat from './EmptySeat';
import LineupCountdown from './LineupCountdown';
import QuickActionsPanel from './QuickActionsPanel';

describe.each([['light', true], ['dark', false]])('%s theme', (_name, isLight) => {
  it('PhotographerCard renders the searching (Radio) and re-searching (RefreshCw) states', () => {
    const photographer = { full_name: 'Sam Shooter' };
    const { rerender, container } = render(<PhotographerCard photographer={photographer} status="searching_for_pro" isLight={isLight} />);
    expect(screen.getByText('Sam Shooter')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-radio')).not.toBeNull();
    rerender(<PhotographerCard photographer={photographer} status="declined" wasDeclined isLight={isLight} />);
    expect(container.querySelector('svg.lucide-refresh-cw')).not.toBeNull();
  });

  it('EmptySeat renders its "Paddle Out" badge', () => {
    render(<EmptySeat seatNumber={2} isLight={isLight} onClick={() => {}} />);
    expect(screen.getByText('Paddle Out')).toBeInTheDocument();
  });

  it('LineupCountdown renders its timer icon', () => {
    const { container } = render(<LineupCountdown closesAt={new Date(Date.now() + 3600e3).toISOString()} isLight={isLight} />);
    expect(container.querySelector('svg.lucide-timer')).not.toBeNull();
  });

  it('QuickActionsPanel renders for the captain and for a member', () => {
    const lineup = { id: 'l1', status: 'open', is_locked: false, closed_to_invites: false };
    const props = { lineup, isReady: false, loading: false, onLock() {}, onCloseToInvites() {}, onCancelAll() {}, onLeave() {}, onClose() {}, isLight };
    const { unmount } = render(<QuickActionsPanel {...props} isCaptain />);
    unmount();
    render(<QuickActionsPanel {...props} isCaptain={false} />);
  });
});
