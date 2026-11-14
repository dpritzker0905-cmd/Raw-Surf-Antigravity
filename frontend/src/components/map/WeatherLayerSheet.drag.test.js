import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import WeatherLayerSheet from './WeatherLayerSheet';

const pointer = (target, type, y, extra = {}) => {
  const event = new Event(type, { bubbles: true });
  Object.entries({ clientY: y, pointerId: 1, button: 0, isPrimary: true, ...extra }).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
  fireEvent(target, event);
};
function setup() {
  const close = jest.fn();
  const view = render(<div data-responsive-weather="true">
    <button data-testid="weather-layers-btn">Layers</button>
    <WeatherLayerSheet onClose={close} className="weather-layer-sheet">
      {dismiss => <button onClick={dismiss}>Close X</button>}
    </WeatherLayerSheet>
  </div>);
  const sheet = view.container.querySelector('.weather-layer-sheet');
  sheet.getBoundingClientRect = () => ({ height: 600 });
  return { ...view, close, sheet, handle: screen.getByRole('button', { name: 'Close weather layers, or drag down' }) };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });

test('downward drag follows the pointer and closes only after release, returning focus', () => {
  const { close, sheet, handle } = setup();
  pointer(handle, 'pointerdown', 100);
  pointer(handle, 'pointermove', 230);
  expect(sheet.style.getPropertyValue('--weather-sheet-drag')).toBe('130px');
  act(() => jest.advanceTimersByTime(500));
  expect(close).not.toHaveBeenCalled();
  pointer(handle, 'pointerup', 230);
  expect(sheet).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByTestId('weather-layers-btn')).toHaveFocus();
  act(() => jest.advanceTimersByTime(180));
  expect(close).toHaveBeenCalledTimes(1);
  fireEvent.click(handle);
  expect(close).toHaveBeenCalledTimes(1);
});

test('small and cancelled drags recover the open sheet without an accidental click dismissal', () => {
  const { close, sheet, handle } = setup();
  pointer(handle, 'pointerdown', 200);
  pointer(handle, 'pointerup', 100);
  fireEvent.click(handle, { detail: 1 });
  expect(close).not.toHaveBeenCalled();
  pointer(handle, 'pointerdown', 100);
  act(() => jest.advanceTimersByTime(200));
  pointer(handle, 'pointerup', 115);
  fireEvent.click(handle, { detail: 1 });
  expect(sheet.style.getPropertyValue('--weather-sheet-drag')).toBe('0px');
  pointer(handle, 'pointerdown', 100);
  pointer(handle, 'pointermove', 250);
  pointer(handle, 'pointercancel', 250);
  fireEvent.click(handle, { detail: 1 });
  act(() => jest.advanceTimersByTime(1000));
  expect(close).not.toHaveBeenCalled();
  expect(sheet).not.toHaveAttribute('aria-hidden');
  pointer(handle, 'pointerdown', 100);
  pointer(document.body, 'pointerdown', 100, { pointerId: 2, isPrimary: false, pointerType: 'touch' });
  pointer(handle, 'pointerup', 250);
  fireEvent.click(handle, { detail: 1 });
  act(() => jest.advanceTimersByTime(1000));
  expect(close).not.toHaveBeenCalled();
});

test('unmount cancels a pending close callback', () => {
  const { close, handle, unmount } = setup();
  fireEvent.click(handle);
  unmount();
  act(() => jest.advanceTimersByTime(1000));
  expect(close).not.toHaveBeenCalled();
});

test.each(['keyboard', 'assistive'])('%s activation still works after a cancelled pointer drag', kind => {
  const { close, handle } = setup();
  pointer(handle, 'pointerdown', 100);
  pointer(handle, 'pointercancel', 150);
  if (kind === 'keyboard') fireEvent.keyDown(handle, { key: 'Enter' });
  fireEvent.click(handle, { detail: 0 });
  act(() => jest.advanceTimersByTime(180));
  expect(close).toHaveBeenCalledTimes(1);
});

test.each(['handle', 'X', 'Escape'])('%s uses the same animated and idempotent dismissal', action => {
  const { close, sheet, handle } = setup();
  if (action === 'handle') fireEvent.click(handle);
  if (action === 'X') fireEvent.click(screen.getByRole('button', { name: 'Close X' }));
  if (action === 'Escape') fireEvent.keyDown(sheet, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  expect(sheet).toHaveAttribute('data-sheet-closing', 'true');
  fireEvent.keyDown(sheet, { key: 'Escape' });
  act(() => jest.advanceTimersByTime(180));
  expect(close).toHaveBeenCalledTimes(1);
});

test('reduced motion dismisses without waiting for the animation', () => {
  const original = window.matchMedia;
  window.matchMedia = jest.fn(() => ({ matches: true }));
  try {
    const { close, handle } = setup();
    fireEvent.click(handle);
    act(() => jest.advanceTimersByTime(0));
    expect(close).toHaveBeenCalledTimes(1);
  } finally { window.matchMedia = original; }
});
