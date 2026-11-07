import React, { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GalleryLightbox } from './GalleryLightbox';

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const assets = ['A', 'B'].map(id => ({
  id, title: `Asset ${id}`, media_type: 'photo', price: 7, is_paid: false,
  thumbnail_url: `/preview-${id}.jpg`, original_url: `/original-${id}.jpg`,
  created_at: '2026-11-07T00:00:00Z',
}));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function Harness({ onPurchase }) {
  const [item, setItem] = useState(assets[0]);
  const [open, setOpen] = useState(true);
  return open ? (
    <GalleryLightbox item={item} items={assets} onNavigate={setItem}
      onClose={() => setOpen(false)} onPurchase={onPurchase} />
  ) : null;
}

const mount = onPurchase => {
  const view = render(<StrictMode><Harness onPurchase={onPurchase} /></StrictMode>);
  act(() => { jest.advanceTimersByTime(50); });
  return view;
};
const buy = () => fireEvent.click(screen.getByText(/Buy for/));
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));
const previous = () => fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
const settle = async (pending, value = true) => {
  await act(async () => { pending.resolve(value); await pending.promise; });
};
const advance = milliseconds => act(() => { jest.advanceTimersByTime(milliseconds); });
const expectLocked = id => {
  expect(screen.getByText('Unlock Full Resolution')).toBeInTheDocument();
  expect(screen.queryByText('Unlocked!')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: `Asset ${id}` }).getAttribute('src')).toContain(`/preview-${id}.jpg`);
};

let timeoutSpy;
let clearTimeoutSpy;
const animationTimer = () => {
  const index = timeoutSpy.mock.calls.findIndex(([, delay]) => delay === 1200);
  expect(index).toBeGreaterThanOrEqual(0);
  return timeoutSpy.mock.results[index].value;
};
const expectNoAnimationTimer = () => {
  expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 1200)).toBe(false);
};
beforeEach(() => {
  jest.useFakeTimers();
  timeoutSpy = jest.spyOn(global, 'setTimeout');
  clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
});
afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('a purchase completing after navigation cannot unlock the next item', async () => {
  const pending = deferred();
  const onPurchase = jest.fn(() => pending.promise);
  mount(onPurchase);
  buy();
  next();
  await settle(pending);
  expectLocked('B');
  advance(1200);
  expectLocked('B');
  expect(onPurchase).toHaveBeenCalledWith('A', 'high');
});

test('navigation clears the prior item purchasing state', () => {
  mount(() => new Promise(() => {}));
  buy();
  next();
  expect(screen.getByText(/Buy for/).closest('button')).toBeEnabled();
  expectLocked('B');
});

test('navigation cancels a completed purchase animation and its unlock timer', async () => {
  mount(jest.fn().mockResolvedValue(true));
  await act(async () => { buy(); });
  expect(screen.getByText('Unlocked!')).toBeInTheDocument();
  const timer = animationTimer();
  next();
  expectLocked('B');
  expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
  advance(1200);
  expectLocked('B');
});

test('returning to the same item does not revive an earlier pending purchase', async () => {
  const pending = deferred();
  mount(() => pending.promise);
  buy();
  next();
  previous();
  await settle(pending);
  advance(1200);
  expectLocked('A');
});

test('returning to the same item does not revive its earlier animation timer', async () => {
  mount(jest.fn().mockResolvedValue(true));
  await act(async () => { buy(); });
  next();
  previous();
  advance(1200);
  expectLocked('A');
});

test('the prior purchase settling does not clear a newer item purchase', async () => {
  const first = deferred();
  const second = deferred();
  const onPurchase = jest.fn(id => id === 'A' ? first.promise : second.promise);
  mount(onPurchase);
  buy();
  next();
  buy();
  expect(onPurchase).toHaveBeenCalledTimes(2);
  await settle(first);
  expect(screen.getByRole('button', { name: 'Loader2' })).toBeDisabled();
  expectLocked('B');
  await settle(second);
  expect(screen.getByText('Unlocked!')).toBeInTheDocument();
  advance(1200);
  expect(screen.getByRole('img', { name: 'Asset B' }).getAttribute('src')).toContain('/original-B.jpg');
});

test('closing before a purchase settles does not schedule an unlock timer', async () => {
  const pending = deferred();
  mount(() => pending.promise);
  buy();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await settle(pending);
  expectNoAnimationTimer();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test('unmounting during the animation cancels its timer', async () => {
  const view = mount(jest.fn().mockResolvedValue(true));
  await act(async () => { buy(); });
  expect(screen.getByText('Unlocked!')).toBeInTheDocument();
  const timer = animationTimer();
  view.unmount();
  expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
});

test('the current item still unlocks after its 1200 ms success animation', async () => {
  const onPurchase = jest.fn().mockResolvedValue(true);
  mount(onPurchase);
  await act(async () => { buy(); });
  expect(screen.getByText('Unlocked!')).toBeInTheDocument();
  advance(1199);
  expect(screen.getByRole('img', { name: 'Asset A' }).getAttribute('src')).toContain('/preview-A.jpg');
  advance(1);
  expect(screen.queryByText('Unlocked!')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Asset A' }).getAttribute('src')).toContain('/original-A.jpg');
  expect(onPurchase).toHaveBeenCalledTimes(1);
});

test('repeated clicks dispatch only one purchase while the current visit is pending', async () => {
  const pending = deferred();
  const onPurchase = jest.fn(() => pending.promise);
  mount(onPurchase);
  const button = screen.getByText(/Buy for/).closest('button');
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(onPurchase).toHaveBeenCalledTimes(1);
  await settle(pending);
  expect(screen.getByText('Unlocked!')).toBeInTheDocument();
});
test.each(['refused', 'rejected'])('a %s purchase remains locked and can be retried', async outcome => {
  const onPurchase = outcome === 'refused'
    ? jest.fn().mockResolvedValue(false)
    : jest.fn().mockRejectedValue(new Error('Purchase refused'));
  mount(onPurchase);
  await act(async () => { buy(); });
  expectLocked('A');
  expect(screen.getByText(/Buy for/).closest('button')).toBeEnabled();
  expectNoAnimationTimer();
  onPurchase.mockResolvedValueOnce(true);
  await act(async () => { buy(); });
  expect(onPurchase).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Unlocked!')).toBeInTheDocument();
  advance(1200);
  expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
});
