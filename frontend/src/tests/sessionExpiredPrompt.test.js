/**
 * #782 / #783: the forecast's expired-session prompt. A read refused WITH the user's token sends them back through
 * sign-in with a return path, instead of a blank map. Three themes, keyboard and ARIA.
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../contexts/ThemeContext';
import SessionExpiredPrompt, { promptPalette } from '../components/SessionExpiredPrompt';
import {
  WEATHER_SESSION_EXPIRED, isSignInRefusal, reportWeatherSessionExpired, signInAgainPath, signInAgain,
} from '../lib/weatherSession';

const expire = () => act(() => { window.dispatchEvent(new CustomEvent(WEATHER_SESSION_EXPIRED)); });

function renderIn(theme, props = {}) {
  window.localStorage.setItem('raw-surf-theme', theme);
  return render(<ThemeProvider><SessionExpiredPrompt {...props} /></ThemeProvider>);
}

afterEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); delete window.__RAW_DISABLE_SESSION_PROMPT__; });

describe('weatherSession (pure)', () => {
  test('only the accounts-only 401 counts as a refusal', () => {
    const r = (status, mark) => ({ status, headers: new Headers(mark ? { 'X-Raw-Tier-Clamp': mark } : {}) });
    expect(isSignInRefusal(r(401, 'account'))).toBe(true);
    expect(isSignInRefusal(r(401, null))).toBe(false);
    expect(isSignInRefusal(r(200, 'account'))).toBe(false);
    expect(isSignInRefusal(r(401, 'hours,model'))).toBe(false);
    expect(isSignInRefusal(null)).toBe(false);
  });

  test('the return path is where the user was (ProtectedRoute shape, login tab), never an off-site or auth loop', () => {
    expect(signInAgainPath({ pathname: '/map', search: '?spot=12&model=GFS' }))
      .toBe(`/auth?tab=login&redirect=${encodeURIComponent('/map?spot=12&model=GFS')}`);
    expect(signInAgainPath({ pathname: '//evil.test', search: '' })).toBe('/auth?tab=login');
    expect(signInAgainPath({ pathname: '/auth', search: '?tab=login' })).toBe('/auth?tab=login');
  });

  test('signing in again drops the refused session, marks the tab, and goes to the form', () => {
    const assign = jest.fn();
    const clearSession = jest.fn();
    const win = { location: { pathname: '/spot-hub/7', search: '', assign } };
    expect(signInAgain({ win, clearSession })).toBe(`/auth?tab=login&redirect=${encodeURIComponent('/spot-hub/7')}`);
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(`/auth?tab=login&redirect=${encodeURIComponent('/spot-hub/7')}`);
    expect(window.sessionStorage.getItem('raw-surf-session-rejected-at')).not.toBeNull();
  });

  test('kill switch and the auth page itself raise nothing', () => {
    const dispatchEvent = jest.fn();
    const base = { CustomEvent, dispatchEvent };
    expect(reportWeatherSessionExpired({ ...base, __RAW_DISABLE_SESSION_PROMPT__: true, location: { pathname: '/map' } })).toBe(false);
    expect(reportWeatherSessionExpired({ ...base, location: { pathname: '/auth' } })).toBe(false);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});

describe('SessionExpiredPrompt', () => {
  test('hidden until a refused read is reported; then an ARIA alertdialog with the primary action focused', async () => {
    jest.useFakeTimers();
    renderIn('dark');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expire();
    const dialog = screen.getByRole('alertdialog', { name: 'Your session has expired' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/Sign in again to keep seeing the forecast/);
    act(() => { jest.advanceTimersByTime(60); });
    expect(screen.getByRole('button', { name: 'Sign in again' })).toHaveFocus();
    jest.useRealTimers();
  });

  test('"Sign in again" leaves for sign-in; Escape and "Not now" dismiss', () => {
    const onSignIn = jest.fn();
    renderIn('light', { onSignIn });
    expire();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('a dismissed prompt does not re-open on the very next refused read (no focus stealing)', () => {
    renderIn('dark');
    expire();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expire();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test.each(['light', 'dark', 'beach'])('%s theme: its own palette, no single-theme colours', (theme) => {
    renderIn(theme);
    expire();
    const card = screen.getByRole('alertdialog');
    for (const cls of promptPalette(theme).card.split(' ')) expect(card).toHaveClass(cls);
  });

  test('the three palettes differ (light is light; beach is the deepest black)', () => {
    expect(promptPalette('light').card).toContain('bg-white');
    expect(promptPalette('dark').card).toContain('bg-zinc-900');
    expect(promptPalette('beach').card).toContain('bg-black');
  });
});
