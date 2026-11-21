import React, { useState } from 'react';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { TopNavDrawerTray } from './TopNavDrawerTray';
import apiClient from '../lib/apiClient';

let mockTheme = 'dark';
let mockPath = '/support';
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate, useLocation: () => ({ pathname: mockPath }) }), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'synthetic-photographer', role: 'Photographer' } }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../contexts/PersonaContext', () => ({ usePersona: () => ({ getEffectiveRole: role => role }) }));
jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
jest.mock('sonner', () => ({ toast: { info: jest.fn(), error: jest.fn() } }));
jest.mock('./BackpackDrawer', () => ({ BackpackDrawer: () => null }));
jest.mock('./SurferSessionHub', () => ({ SurferSessionHub: ({ children }) => children }));

function Fixture() {
  const [open, setOpen] = useState(true);
  return <>
    <a href="/settings" data-testid="nav-settings">Desktop Settings</a>
    <button>Outside action</button>
    <header><button data-testid="topnav-pull-handle" onClick={() => setOpen(true)}>Tools</button>
      <TopNavDrawerTray isOpen={open} onClose={() => setOpen(false)} />
    </header>
  </>;
}
const opener = () => screen.getByRole('button', { name: 'Photo Tools' });
const close = () => screen.getByRole('button', { name: 'Close' });
const panel = () => screen.getByRole('dialog', { name: 'Photo Tools' });
const open = async () => { const user = userEvent.setup(); await user.click(opener()); return user; };
beforeEach(() => {
  jest.clearAllMocks(); mockTheme = 'dark'; mockPath = '/support';
  apiClient.get.mockResolvedValue({ data: {} });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: jest.fn() } });
  jest.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () {
    return this.isConnected ? [{ width: 100, height: 30 }] : [];
  });
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

test.each(['light', 'dark', 'beach'])('real Photo Tools receives useful named nonmodal entry focus in %s', async theme => {
  mockTheme = theme; render(<Fixture />); const user = await open();
  expect(panel()).toHaveAttribute('aria-modal', 'false'); expect(close()).toHaveFocus();
  await user.tab(); expect(within(panel()).getByRole('button', { name: /View Leaderboard/ })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Settings' })).not.toHaveFocus();
  screen.getByRole('button', { name: 'Outside action' }).focus();
  expect(screen.getByRole('button', { name: 'Outside action' })).toHaveFocus();
});
test.each(['Close', 'Escape', 'backdrop'])('%s dismissal returns focus to the visible actual opener and leaves tray open', async method => {
  render(<Fixture />); await open(); close().focus();
  if (method === 'Close') fireEvent.click(close());
  else if (method === 'Escape') fireEvent.keyDown(close(), { key: 'Escape' });
  else fireEvent.click(close().closest('.fixed').previousElementSibling);
  expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  expect(opener()).toHaveFocus(); expect(screen.getByTestId('topnav-drawer-tray').style.maxHeight).toBe('100px');
});
test('repeated entry and dismissal does not reuse a stale child focus request', async () => {
  render(<Fixture />);
  for (let i = 0; i < 3; i++) {
    await open(); expect(close()).toHaveFocus(); fireEvent.keyDown(close(), { key: 'Escape' }); expect(opener()).toHaveFocus();
  }
});
test('dismissal respects focus deliberately moved to a global control', async () => {
  render(<Fixture />); await open(); const outside = screen.getByRole('button', { name: 'Outside action' }); outside.focus();
  fireEvent.keyDown(outside, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument(); expect(outside).toHaveFocus();
});
test('route activation keeps destination focus instead of restoring the drawer opener', async () => {
  render(<Fixture />); await open();
  const returnFocus = jest.spyOn(opener(), 'focus');
  mockNavigate.mockImplementation(path => { mockPath = path; });
  fireEvent.click(screen.getByTestId('menu-item-gallery'));
  expect(mockNavigate).toHaveBeenCalledWith('/gallery');
  expect(returnFocus).not.toHaveBeenCalled();
  screen.getByRole('button', { name: 'Outside action' }).focus();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Outside action' })).toHaveFocus());
  expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
});
test('hidden mobile opener and handle use visible desktop Settings on dismissal', async () => {
  render(<Fixture />); await open();
  const oldClose = close(); oldClose.focus(); const header = oldClose.closest('header');
  header.getClientRects = () => []; opener().getClientRects = () => [];
  screen.getByTestId('topnav-pull-handle').getClientRects = () => [];
  fireEvent(window, new Event('resize'));
  fireEvent.keyDown(oldClose, { key: 'Escape' });
  expect(screen.getByTestId('nav-settings')).toHaveFocus();
});
test('hidden Photo Tools opener falls back to the visible tools handle', async () => {
  render(<Fixture />); await open(); close().focus(); opener().getClientRects = () => [];
  fireEvent.keyDown(close(), { key: 'Escape' });
  expect(screen.getByTestId('topnav-pull-handle')).toHaveFocus();
});
test('nested prevented Escape remains owned by the child; input and range keys are not intercepted', async () => {
  render(<Fixture />); await open(); const root = close().closest('.fixed');
  const nested = document.createElement('div'); nested.setAttribute('role', 'dialog');
  const input = document.createElement('input'); nested.append(input); root.append(nested); input.focus();
  const owned = event => event.preventDefault(); input.addEventListener('keydown', owned);
  fireEvent.keyDown(input, { key: 'Escape' }); expect(close()).toBeInTheDocument();
  input.removeEventListener('keydown', owned);
  fireEvent.keyDown(input, { key: 'Escape' }); expect(close()).toBeInTheDocument();
  nested.remove(); const range = document.createElement('input'); range.type = 'range'; root.append(range); range.focus();
  const arrow = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }); range.dispatchEvent(arrow);
  expect(arrow.defaultPrevented).toBe(false); expect(range).toHaveFocus(); expect(close()).toBeInTheDocument();
});
