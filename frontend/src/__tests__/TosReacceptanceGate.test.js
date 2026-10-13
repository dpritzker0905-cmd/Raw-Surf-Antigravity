import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import TosReacceptanceGate from '../components/routing/TosReacceptanceGate';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
import apiClient from '../lib/apiClient';

jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'terms-theme-fixture' } }) }));
jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn() } }));

function ThemeControls() {
  const { toggleTheme } = useTheme();
  return <button onClick={() => toggleTheme('light')}>Change fixture theme</button>;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('raw-surf-user', JSON.stringify({ access_token: 'fixture-only' }));
  apiClient.get.mockImplementation(url => Promise.resolve({ data: url.includes('tos-status')
    ? { acknowledged: false }
    : { sections: [{ title: 'Fixture terms', body: 'Test text for layout review; not a legal agreement.' }] } }));
  apiClient.post.mockClear();
});
afterEach(() => localStorage.clear());

test.each(['light', 'dark', 'beach'])('%s terms remain readable and theme changes preserve unsubmitted consent', async theme => {
  localStorage.setItem('raw-surf-theme', theme);
  const view = render(<ThemeProvider><TosReacceptanceGate><ThemeControls /></TosReacceptanceGate></ThemeProvider>);
  const dialog = await view.findByRole('dialog', { name: 'Updated Terms of Service' });
  const accept = view.getByRole('button', { name: 'I Agree to the Updated Terms' });
  expect(accept.disabled).toBe(true);
  fireEvent.click(view.getByRole('button', { name: 'Read full Terms of Service' }));
  await view.findByText('Fixture terms');
  const checkbox = view.getByRole('checkbox', { name: 'I have read and understood the updated Terms of Service' });
  fireEvent.click(checkbox);
  expect(accept.disabled).toBe(false);
  expect(dialog.classList.contains('bg-card')).toBe(true);
  // Render the real component's expanded state for browser CSS/layout inspection.
  if (process.env.TOS_THEME_FIXTURE_DIR) {
    const fs = require('fs');
    const path = require('path');
    fs.writeFileSync(path.join(process.env.TOS_THEME_FIXTURE_DIR, `${theme}.html`),
      `<!doctype html><html class="${theme === 'beach' ? 'beach-mode' : theme}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="styles.css"></head><body>${view.container.innerHTML}</body></html>`);
  }
  fireEvent.click(view.getByRole('button', { name: 'Change fixture theme' }));
  await waitFor(() => expect(document.documentElement.classList.contains('light')).toBe(true));
  expect(checkbox.checked).toBe(true);
  expect(view.getByText('Fixture terms')).toBeTruthy();
  expect(apiClient.post).not.toHaveBeenCalled();
  expect([...Array(localStorage.length)].map((_, i) => localStorage.key(i)).some(key => key.startsWith('tos-accepted-'))).toBe(false);
  checkbox.focus();
  fireEvent.keyDown(document, { key: 'Tab' });
  accept.focus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(document.activeElement).toBe(view.getByRole('button', { name: 'Hide full terms' }));
});
