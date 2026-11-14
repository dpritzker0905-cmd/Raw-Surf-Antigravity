import React from 'react';
import { act, render } from '@testing-library/react';
import { useMapLongPress } from './useMapLongPress';

function setup() {
  const handlers = {};
  const canvas = document.createElement('canvas');
  const map = { on: jest.fn((name, fn) => { handlers[name] = fn; }), off: jest.fn(), getCanvas: () => canvas, unproject: () => ({ lat: 28, lng: -80 }) };
  const pin = jest.fn();
  function Harness({ enabled }) { useMapLongPress({ mapInstance: map, onMapLongPress: pin, enabled }); return null; }
  return { handlers, canvas, map, pin, Harness };
}

test('Explore never installs coordinate gestures; Weather enables them without changing map features', () => {
  const { Harness, map, handlers, pin } = setup();
  const { rerender, unmount } = render(<Harness enabled={false} />);
  expect(map.on).not.toHaveBeenCalled();
  rerender(<Harness enabled />);
  const preventDefault = jest.fn();
  // MapLibre's rotate/pitch handlers already suppress the native browser menu.
  act(() => handlers.contextmenu({ preventDefault, originalEvent: { defaultPrevented: true }, lngLat: { lat: 28, lng: -80 } }));
  expect(pin).toHaveBeenCalledWith({ lat: 28, lng: -80 });
  expect(preventDefault).toHaveBeenCalledTimes(1);
  unmount();
  expect(map.off).toHaveBeenCalledWith('contextmenu', handlers.contextmenu);
});

test('switching out of Weather cancels a pending touch pin and subsequent holds still work', () => {
  jest.useFakeTimers();
  try {
    const { Harness, canvas, pin } = setup();
    const { rerender } = render(<Harness enabled />);
    const hold = () => { const event = new Event('touchstart'); Object.defineProperty(event, 'touches', { value: [{ clientX: 10, clientY: 10 }] }); canvas.dispatchEvent(event); };
    act(hold);
    rerender(<Harness enabled={false} />);
    act(() => jest.advanceTimersByTime(600));
    expect(pin).not.toHaveBeenCalled();
    rerender(<Harness enabled />);
    act(hold);
    act(() => jest.advanceTimersByTime(500));
    expect(pin).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});
