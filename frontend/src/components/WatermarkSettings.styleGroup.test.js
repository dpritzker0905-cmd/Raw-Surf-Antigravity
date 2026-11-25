import React from 'react';
import { render, screen, within } from '@testing-library/react';
import WatermarkSettings from './WatermarkSettings';

jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'photographer' } }) }));
jest.mock('../lib/apiClient', () => ({ get: async () => ({ data: { watermark_style: 'text' } }) }));
jest.mock('./ui/slider', () => ({ Slider: () => null }));

test('the Watermark Style group contains exactly the three style choices', async () => {
  render(<WatermarkSettings open onOpenChange={jest.fn()} />);
  const group = await screen.findByRole('group', { name: 'Watermark Style' });
  const buttons = within(group).getAllByRole('button');
  expect(buttons).toHaveLength(3);
  ['Text Only', 'Logo Only', 'Logo + Text'].forEach((name, index) => {
    expect(buttons[index]).toHaveAccessibleName(name);
  });
});
