import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ForecastTimeSteps from './ForecastTimeSteps';

test('compact time actions preserve every shortcut and Escape returns keyboard focus', () => {
  const step = jest.fn();
  render(<ForecastTimeSteps compact onStep={step} className="bg-white text-gray-900" />);
  const toggle = screen.getByRole('button', { name: 'Time shortcuts' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('button', { name: 'Jump to now' })).not.toBeInTheDocument();
  fireEvent.click(toggle);
  const actions = [['Step back 1 day', -24, undefined], ['Step back 3 hours', -3, -1], ['Step back 1 hour', -1, undefined], ['Jump to now', null, undefined], ['Step forward 1 hour', 1, undefined], ['Step forward 3 hours', 3, 1], ['Step forward 1 day', 24, undefined]];
  for (const [name, delta, grid] of actions) { fireEvent.click(screen.getByRole('button', { name })); expect(step).toHaveBeenLastCalledWith(delta, grid); }
  const now = screen.getByRole('button', { name: 'Jump to now' });
  now.focus(); fireEvent.keyDown(now, { key: 'Escape' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveFocus();
});

test('outside pointer dismisses time shortcuts without stealing focus', () => {
  render(<><ForecastTimeSteps compact onStep={() => {}} /><button>Other map control</button></>);
  const toggle = screen.getByRole('button', { name: 'Time shortcuts' });
  fireEvent.click(toggle);
  const other = screen.getByRole('button', { name: 'Other map control' });
  other.focus(); fireEvent.pointerDown(other);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(other).toHaveFocus();
});

test('non-step options are named correctly and return focus when their action closes the panel', () => {
  render(<ForecastTimeSteps compact showSteps={false}>{close => <button onClick={close}>Legend</button>}</ForecastTimeSteps>);
  const toggle = screen.getByRole('button', { name: 'Timeline options' });
  fireEvent.click(toggle);
  const legend = screen.getByRole('button', { name: 'Legend' });
  legend.focus(); fireEvent.click(legend);
  expect(toggle).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Legend' })).not.toBeInTheDocument();
});

test('legacy time actions stay inline without an extra disclosure', () => {
  const step = jest.fn();
  render(<ForecastTimeSteps onStep={step} className="bg-black text-white" />);
  expect(screen.queryByRole('button', { name: 'Time shortcuts' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(7);
  fireEvent.click(screen.getByRole('button', { name: 'Jump to now' }));
  expect(step).toHaveBeenCalledWith(null, undefined);
});
