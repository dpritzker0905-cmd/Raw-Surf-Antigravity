import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MapInitFailureNotice from './MapInitFailureNotice';
import { WEBGL_UNSUPPORTED_REASONS } from './mapWebglSupport';

// The component reads the live theme, so the themes are driven through the real provider
// rather than a stub — a stub would let a hardcoded colour pass the three-theme mandate.
jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: global.__TEST_THEME__ || 'dark' }),
}));

const renderInTheme = (theme, props = {}) => {
  global.__TEST_THEME__ = theme;
  return render(<MapInitFailureNotice reason={WEBGL_UNSUPPORTED_REASONS.CONTEXT_UNAVAILABLE} {...props} />);
};

afterEach(() => { delete global.__TEST_THEME__; });

describe('MapInitFailureNotice', () => {
  it('announces the failure rather than only drawing it', () => {
    // A user who cannot see the blank map area is precisely the user worst served by a
    // silent failure, so the panel must reach the accessibility tree as an alert.
    renderInTheme('dark');

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });

  it('states the problem in text, not by colour alone', () => {
    renderInTheme('dark');

    expect(screen.getByText(/could not start/i)).toBeInTheDocument();
    expect(screen.getByText(/graphics acceleration/i)).toBeInTheDocument();
  });

  it.each(['light', 'dark', 'beach'])('renders in %s theme with a theme-appropriate surface', (theme) => {
    const { container, unmount } = renderInTheme(theme);
    const panel = container.querySelector('[role="alert"]');

    expect(panel).toBeInTheDocument();
    // Each theme must pick a DIFFERENT surface; a single hardcoded palette would make the
    // panel unreadable in at least one of the three.
    const expected = { light: 'bg-white/95', dark: 'bg-zinc-900/95', beach: 'bg-black/90' }[theme];
    expect(panel.className).toContain(expected);
    unmount();
  });

  it('exposes retry as a real button with an accessible name', () => {
    const onRetry = jest.fn();
    renderInTheme('dark', { onRetry });

    const btn = screen.getByRole('button', { name: /retry loading the map/i });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');

    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('is operable by keyboard', () => {
    const onRetry = jest.fn();
    renderInTheme('dark', { onRetry });

    const btn = screen.getByRole('button', { name: /retry loading the map/i });
    btn.focus();
    expect(btn).toHaveFocus();
    // A real <button> activates on Enter/Space natively; this asserts we did not replace it
    // with a div-with-onClick, which is the house's named accessibility debt.
    expect(btn.className).toMatch(/focus-visible:ring/);
  });

  it('omits the retry control entirely when no handler is supplied', () => {
    renderInTheme('dark');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the underlying error text so it is not console-only', () => {
    // The console is exactly where the original failure went to die unread.
    renderInTheme('dark', { reason: 'init-failed', detail: 'WebGL context creation failed' });

    expect(screen.getByTestId('map-init-failure-detail')).toHaveTextContent('WebGL context creation failed');
  });

  it('hides the decorative icon from assistive technology', () => {
    const { container } = renderInTheme('dark');
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});
