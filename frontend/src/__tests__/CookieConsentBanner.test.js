/**
 * CookieConsentBanner.test.js Tests for the cookie consent banner.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CookieConsentBanner from '../components/ui/CookieConsentBanner';

const CONSENT_KEY = 'raw-surf-cookie-consent';

beforeEach(() => {
  localStorage.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test('does not render immediately', () => {
  render(<CookieConsentBanner />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('appears after delay when no consent stored', () => {
  render(<CookieConsentBanner />);
  act(() => {});
  act(() => {
    jest.advanceTimersByTime(2500);
  });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('We use cookies')).toBeInTheDocument();
});

test('does not appear if consent already given', () => {
  localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: true }));
  render(<CookieConsentBanner />);
  act(() => {});
  act(() => {
    jest.advanceTimersByTime(5000);
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('Accept All stores consent and hides banner', () => {
  render(<CookieConsentBanner />);
  act(() => {});
  act(() => {
    jest.advanceTimersByTime(2500);
  });
  fireEvent.click(screen.getByText('Accept All'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const stored = JSON.parse(localStorage.getItem(CONSENT_KEY));
  expect(stored.accepted).toBe(true);
});

test('Decline stores rejection and hides banner', () => {
  render(<CookieConsentBanner />);
  act(() => {});
  act(() => {
    jest.advanceTimersByTime(2500);
  });
  fireEvent.click(screen.getByText('Decline'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const stored = JSON.parse(localStorage.getItem(CONSENT_KEY));
  expect(stored.accepted).toBe(false);
});
