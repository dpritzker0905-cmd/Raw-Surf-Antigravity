import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { Auth } from '../components/Auth';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';

jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null, login: jest.fn(), register: jest.fn() }) }));
let mockSearch = 'tab=login';
// Theme/form behavior is the subject; router and authentication are explicit test boundaries.
jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams(mockSearch), jest.fn()],
}), { virtual: true });
const fs = require('fs');
const path = require('path');
function ChangeTheme() {
  const { toggleTheme } = useTheme();
  return <button onClick={() => toggleTheme('light')}>Change test theme</button>;
}
afterEach(() => localStorage.clear());

test.each(['light', 'dark', 'beach'].flatMap(theme =>
  ['login', 'surfer', 'photographer', 'business'].map(form => [theme, form])))('%s %s form remains theme-aware', (theme, form) => {
  localStorage.setItem('raw-surf-theme', theme);
  mockSearch = form === 'login' ? 'tab=login' : 'tab=signup&category=' + form;
  const { container } = render(<ThemeProvider><Auth /></ThemeProvider>);
  const fields = [...container.querySelectorAll('input:not([type="checkbox"])')];
  expect(fields.length).toBeGreaterThanOrEqual(2);
  expect(fields.every(field => field.closest('.auth-card') && field.classList.contains('auth-input'))).toBe(true);
  expect(document.documentElement.classList.contains(theme === 'beach' ? 'beach-mode' : theme)).toBe(true);
  // Optional artifact export for browser CSS verification; no export in normal CI.
  if (process.env.AUTH_THEME_FIXTURE_DIR) {
    fs.writeFileSync(path.join(process.env.AUTH_THEME_FIXTURE_DIR, `${theme}-${form}.fragment.html`), container.innerHTML);
  }
});

test('changing theme preserves entered login text and password field semantics', () => {
  localStorage.setItem('raw-surf-theme', 'dark');
  mockSearch = 'tab=login';
  const { container, getByText } = render(<ThemeProvider><Auth /><ChangeTheme /></ThemeProvider>);
  const email = container.querySelector('input[type="email"]');
  const password = container.querySelector('input[type="password"]');
  fireEvent.change(email, { target: { value: 'theme-check@example.invalid' } });
  fireEvent.change(password, { target: { value: 'test-only-not-a-credential' } });
  fireEvent.click(getByText('Change test theme'));
  expect(email.value).toBe('theme-check@example.invalid');
  expect(password.value).toBe('test-only-not-a-credential');
  expect(password.type).toBe('password');
  expect(document.documentElement.classList.contains('light')).toBe(true);
});
