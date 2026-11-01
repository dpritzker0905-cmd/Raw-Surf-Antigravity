/**
 * The Settings switch that turns push on or off for THIS account on THIS device (#470, 2026-10-23).
 *
 * Pins: it is a real switch (role="switch", aria-checked, labelled and described), it shows the backend's answer and
 * says the state in words, On only through the account's own click (subscribe), Off deletes only this account's row
 * (unsubscribe), it is disabled with a reason when push cannot work here, and its track colours are the per-theme ones
 * chosen for >= 3:1 contrast in light, dark and beach.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let mockPush;
let mockTheme = 'dark';
const mockToastError = jest.fn();
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('sonner', () => ({ toast: { error: (...a) => mockToastError(...a), success: jest.fn() } }));
jest.mock('../../hooks/usePushNotifications', () => ({ usePushNotifications: () => mockPush }));

import { PushDeviceRow } from './PushDeviceRow';

const base = () => ({
  isSupported: true, permission: 'granted', serverSubscribed: false, serverStatusError: false,
  subscribe: jest.fn().mockResolvedValue(true), unsubscribe: jest.fn().mockResolvedValue(true),
});
const renderRow = () => render(<PushDeviceRow textPrimaryClass="text-foreground" textSecondaryClass="text-muted-foreground" borderClass="border-border" />);

beforeEach(() => {
  mockPush = base();
  mockTheme = 'dark';
  mockToastError.mockReset();
});

it('is a labelled, described switch that says the state in words', () => {
  mockPush.serverSubscribed = true;
  renderRow();
  const sw = screen.getByRole('switch', { name: 'Push on this device' });
  expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(sw).toHaveAccessibleDescription('On: this account gets push notifications on this device');
  expect(sw).toBeEnabled();
});

it('On -> Off deletes only this account\'s row (unsubscribe), never subscribes', async () => {
  mockPush.serverSubscribed = true;
  renderRow();
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(mockPush.unsubscribe).toHaveBeenCalledTimes(1));
  expect(mockPush.subscribe).not.toHaveBeenCalled();
});

it('Off -> On is this account\'s own subscribe', async () => {
  renderRow();
  const sw = screen.getByRole('switch');
  expect(sw).toHaveAttribute('aria-checked', 'false');
  expect(sw).toHaveAccessibleDescription('Off for this account on this device');
  fireEvent.click(sw);
  await waitFor(() => expect(mockPush.subscribe).toHaveBeenCalledTimes(1));
  expect(mockPush.unsubscribe).not.toHaveBeenCalled();
});

it.each([
  [{ isSupported: false }, 'Not available in this browser'],
  [{ permission: 'denied' }, 'Blocked in your browser settings'],
  [{ serverSubscribed: null }, 'Checking...'],
])('is disabled with a reason when it cannot act (%o)', (state, reason) => {
  Object.assign(mockPush, state);
  renderRow();
  const sw = screen.getByRole('switch');
  expect(sw).toBeDisabled();
  expect(sw).toHaveAccessibleDescription(reason);
  fireEvent.click(sw);
  expect(mockPush.subscribe).not.toHaveBeenCalled();
  expect(mockPush.unsubscribe).not.toHaveBeenCalled();
});

it('a failed status check says so and still lets the account turn push on', async () => {
  Object.assign(mockPush, { serverSubscribed: null, serverStatusError: true });
  renderRow();
  const sw = screen.getByRole('switch');
  expect(sw).toBeEnabled();
  expect(sw).toHaveAccessibleDescription("Couldn't check right now");
  fireEvent.click(sw);
  await waitFor(() => expect(mockPush.subscribe).toHaveBeenCalledTimes(1));
});

it('a failed change is announced', async () => {
  mockPush.subscribe = jest.fn().mockResolvedValue(false);
  renderRow();
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(mockToastError).toHaveBeenCalledWith("Couldn't turn on push notifications"));
});

it.each([
  ['light', true],
  ['dark', false],
  ['beach', false],
])('%s theme: an off track with contrast; cyan-700 on-track only in light', (theme, cyan) => {
  mockTheme = theme;
  renderRow();
  const cls = screen.getByRole('switch').className;
  expect(cls).toContain('data-[state=unchecked]:bg-muted-foreground');
  expect(cls.includes('data-[state=checked]:bg-cyan-700')).toBe(cyan);
  expect(cls).toContain('focus-visible:ring-2');
});
