import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TopNavDrawerTray } from './TopNavDrawerTray';

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn(), useLocation: () => ({ pathname: '/feed' }) }), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'Surfer' } }) }));
jest.mock('../contexts/PersonaContext', () => ({ usePersona: () => ({ getEffectiveRole: role => role }) }));
jest.mock('./BackpackDrawer', () => ({ BackpackDrawer: () => null }));
jest.mock('./PhotoToolsDrawer', () => ({ PhotoToolsDrawer: () => null }));
jest.mock('./SurferSessionHub', () => ({ SurferSessionHub: ({ children }) => children }));

test('closed controls leave the accessibility tree and reopen without changing tray animation', () => {
  const view = render(<TopNavDrawerTray isOpen={false} />);
  const tray = screen.getByTestId('topnav-drawer-tray');
  expect(tray.inert).toBe(true);
  expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  expect(tray.style.maxHeight).toBe('0px');
  view.rerender(<TopNavDrawerTray isOpen />);
  expect(tray.inert).toBe(false);
  expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  expect(tray.style.maxHeight).toBe('100px');
});

test('closing restores focus before applying inert and aria-hidden', () => {
  const panel = open => <header><button data-testid="topnav-pull-handle">Tools</button><TopNavDrawerTray isOpen={open} /></header>;
  const view = render(panel(true));
  const trigger = screen.getByText('Tools');
  trigger.getClientRects = () => [{ width: 100, height: 30 }];
  screen.getByRole('button', { name: 'Settings' }).focus();
  view.rerender(panel(false));
  expect(trigger).toHaveFocus();
  expect(screen.getByTestId('topnav-drawer-tray')).toHaveAttribute('aria-hidden', 'true');
});

test('Escape requests closing and resizing a hidden header also closes', () => {
  const close = jest.fn();
  render(<header><TopNavDrawerTray isOpen onClose={close} /></header>);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Settings' }), { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(1);
  fireEvent(window, new Event('resize'));
  expect(close).toHaveBeenCalledTimes(2);
});

test('breakpoint focus loss restores desktop Settings, while deliberate outside focus is respected', () => {
  const panel = open => <><a href="/settings" data-testid="nav-settings">Desktop Settings</a>
    <button>Outside action</button><header><TopNavDrawerTray isOpen={open} /></header></>;
  const view = render(panel(true));
  const desktop = screen.getByTestId('nav-settings');
  desktop.getClientRects = () => [{ width: 100, height: 30 }];
  const settings = screen.getByRole('button', { name: 'Settings', exact: true });
  settings.focus();
  settings.blur(); // Chrome can blur a focused descendant when the header becomes display:none.
  view.rerender(panel(false));
  expect(desktop).toHaveFocus();
  view.rerender(panel(true));
  screen.getByRole('button', { name: 'Settings', exact: true }).focus();
  const outside = screen.getByRole('button', { name: 'Outside action' });
  outside.focus();
  view.rerender(panel(false));
  expect(outside).toHaveFocus();
});
