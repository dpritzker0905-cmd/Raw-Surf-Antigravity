import React from 'react';
import { render, screen } from '@testing-library/react';
import WatermarkSettings from './WatermarkSettings';

jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'photographer' } }) }));
jest.mock('../lib/apiClient', () => ({ get: async () => ({ data: {} }) }));
jest.mock('./ui/slider', () => ({ Slider: () => null }));

test.each([
  ['generate-preview-btn', 'Generate Preview'],
  ['save-watermark-settings-btn', 'Save Settings'],
])('%s exposes its visible action name', async (id, name) => {
  render(<WatermarkSettings open onOpenChange={jest.fn()} />);
  await screen.findByTestId('generate-preview-btn');
  expect(screen.getByTestId(id)).toHaveAccessibleName(name);
});
