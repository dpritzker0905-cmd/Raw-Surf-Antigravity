import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WatermarkSettings from './WatermarkSettings';
import apiClient from '../lib/apiClient';

jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'photographer' } }) }));
jest.mock('../lib/apiClient', () => ({ get: async () => ({ data: {} }), post: jest.fn(), put: jest.fn() }));
jest.mock('./ui/slider', () => ({ Slider: () => null }));

test.each([
  ['Generate Preview', 'Generate Preview', 'post'],
  ['Save Settings', 'Saving...', 'put'],
])('%s has a usable name before, during and after its request', async (idleName, pendingName, method) => {
  let finishRequest;
  apiClient[method].mockReturnValueOnce(new Promise(resolve => { finishRequest = resolve; }));
  const user = userEvent.setup();
  render(<WatermarkSettings open onOpenChange={jest.fn()} />);
  await screen.findByTestId('generate-preview-btn');
  const button = screen.getByRole('button', { name: idleName });
  await user.click(button);
  expect(screen.getByRole('button', { name: pendingName })).toBeDisabled();
  await act(async () => { finishRequest({ data: { preview_url: '/preview.png' } }); });
  expect(screen.getByRole('button', { name: idleName })).toBeEnabled();
});
