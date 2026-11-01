import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TopNavDrawerTray } from './TopNavDrawerTray';

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn(), useLocation: () => ({ pathname: '/feed' }) }), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'Surfer' } }) }));
jest.mock('../contexts/PersonaContext', () => ({ usePersona: () => ({ getEffectiveRole: role => role }) }));
jest.mock('./BackpackDrawer', () => {
  const { Sheet, SheetContent, SheetTitle } = require('./ui/sheet');
  return { BackpackDrawer: ({ isOpen, onClose }) => (
    <Sheet modal={false} open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent>
        <SheetTitle>Backpack</SheetTitle>
        <button>Child action</button>
      </SheetContent>
    </Sheet>
  ) };
});
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

test('real child portal Escape returns to its tray opener before the tray closes', async () => {
  const Scene = () => {
    const [open, setOpen] = React.useState(true);
    return <header><button data-testid="topnav-pull-handle">Tools</button>
      <TopNavDrawerTray isOpen={open} onClose={() => setOpen(false)} /></header>;
  };
  render(<Scene />);
  const tools = screen.getByText('Tools');
  const backpack = screen.getByRole('button', { name: 'Backpack', exact: true });
  tools.getClientRects = backpack.getClientRects = () => [{ width: 100, height: 30 }];
  fireEvent.click(backpack);
  const dialog = await screen.findByRole('dialog', { name: 'Backpack' });
  expect(screen.getByTestId('topnav-drawer-tray')).not.toContainElement(dialog);
  await waitFor(() => expect(dialog).toContainElement(document.activeElement));
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Backpack' })).not.toBeInTheDocument());
  expect(screen.getByTestId('topnav-drawer-tray').inert).toBe(false);
  expect(backpack).toHaveFocus();
  fireEvent.keyDown(backpack, { key: 'Escape' });
  expect(tools).toHaveFocus();
  expect(screen.getByTestId('topnav-drawer-tray')).toHaveAttribute('aria-hidden', 'true');
});

test('child portal close respects focus deliberately moved outside', async () => {
  render(<><TopNavDrawerTray isOpen /><button>Outside child action</button></>);
  fireEvent.click(screen.getByRole('button', { name: 'Backpack', exact: true }));
  const dialog = await screen.findByRole('dialog', { name: 'Backpack' });
  await waitFor(() => expect(dialog).toContainElement(document.activeElement));
  const outside = screen.getByText('Outside child action');
  outside.focus();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Backpack' })).not.toBeInTheDocument());
  expect(outside).toHaveFocus();
});

test('child portal Escape uses visible desktop Settings after its mobile header hides', async () => {
  const panel = hidden => <><a href="/settings" data-testid="nav-settings">Desktop Settings</a>
    <header style={{ display: hidden ? 'none' : 'block' }}><button data-testid="topnav-pull-handle">Tools</button>
      <TopNavDrawerTray isOpen={!hidden} /></header></>;
  const view = render(panel(false));
  const desktop = screen.getByTestId('nav-settings');
  desktop.getClientRects = () => [{ width: 100, height: 30 }];
  fireEvent.click(screen.getByRole('button', { name: 'Backpack', exact: true }));
  const dialog = await screen.findByRole('dialog', { name: 'Backpack' });
  await waitFor(() => expect(dialog).toContainElement(document.activeElement));
  view.rerender(panel(true));
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Backpack' })).not.toBeInTheDocument());
  expect(desktop).toHaveFocus();
});
