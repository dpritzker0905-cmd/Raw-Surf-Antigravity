import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WatermarkSettings from './WatermarkSettings';

jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'photographer' } }) }));
jest.mock('../lib/apiClient', () => ({ get: async () => ({ data: { watermark_opacity: 0.5 } }) }));

const originalObserver = global.ResizeObserver;
beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterAll(() => {
  if (originalObserver) global.ResizeObserver = originalObserver;
  else delete global.ResizeObserver;
});

test('the keyboard slider exposes the Opacity label and updated percentage', async () => {
  const user = userEvent.setup();
  render(<WatermarkSettings open onOpenChange={jest.fn()} />);
  const thumb = await screen.findByRole('slider');
  expect(thumb).toHaveAccessibleName('Opacity');
  expect(thumb).toHaveAttribute('aria-valuetext', '50%');
  thumb.focus();
  await user.keyboard('{ArrowRight}');
  expect(thumb).toHaveFocus();
  expect(thumb).toHaveAccessibleName('Opacity');
  expect(thumb).toHaveAttribute('aria-valuenow', '55');
  expect(thumb).toHaveAttribute('aria-valuetext', '55%');
  expect(screen.getByText('55%')).toBeVisible();
});
