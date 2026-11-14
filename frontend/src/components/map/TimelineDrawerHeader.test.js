import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import TimelineDrawerHeader from './TimelineDrawerHeader';

test('both original surfboard handles and the selected-time label toggle one drawer', () => {
  function Harness() { const [open, setOpen] = useState(false); return <TimelineDrawerHeader expanded={open} onToggle={() => setOpen(value => !value)} timeLabel="Thu, Nov 12, 2026, 10:00 PM EST" />; }
  render(<Harness />);
  const left = screen.getByRole('button', { name: 'Open timeline, left surfboard handle' });
  const right = screen.getByRole('button', { name: 'Open timeline, right surfboard handle' });
  const time = screen.getByRole('button', { name: /^Timeline/ });
  expect(left).toHaveAttribute('aria-controls', 'weather-mobile-timeline-body');
  expect(right).toHaveAttribute('aria-controls', 'weather-mobile-timeline-body');
  expect(time).toHaveTextContent('2026');
  fireEvent.click(left);
  expect(left).toHaveAttribute('aria-expanded', 'true'); expect(right).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(right);
  expect(time).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(time);
  expect(left).toHaveAttribute('aria-expanded', 'true');
});

test('the handle icons mirror while keyboard controls retain independent accessible names', () => {
  const toggle = jest.fn();
  const { container } = render(<TimelineDrawerHeader expanded onToggle={toggle} timeLabel="Selected forecast" textClass="text-gray-600" />);
  expect(container.querySelectorAll('.weather-surfboard-icon')).toHaveLength(2);
  expect(container.querySelectorAll('.weather-surfboard-mirrored')).toHaveLength(1);
  expect(screen.getAllByRole('button')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Close timeline, right surfboard handle' }));
  expect(toggle).toHaveBeenCalledTimes(1);
});
