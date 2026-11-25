import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import WatermarkSettings from './WatermarkSettings';
import apiClient from '../lib/apiClient';

let mockUserId;
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('../lib/apiClient', () => ({ get: jest.fn(), put: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
jest.mock('./ui/slider', () => ({ Slider: () => null }));

const save = () => screen.getByTestId('save-watermark-settings-btn');
const dialog = () => <WatermarkSettings open onOpenChange={jest.fn()} />;
beforeEach(() => { mockUserId = 'a'; });

test('pending and failed reads cannot write defaults; retry saves the loaded settings', async () => {
  let rejectLoad;
  apiClient.get.mockReturnValueOnce(new Promise((_, reject) => { rejectLoad = reject; }))
    .mockResolvedValueOnce({ data: { watermark_text: 'My Studio' } });
  render(dialog());
  fireEvent.click(save());
  expect(apiClient.put).not.toHaveBeenCalled();
  await act(async () => { rejectLoad(new Error('offline')); });
  fireEvent.click(save());
  expect(apiClient.put).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
  expect(screen.getByTestId('watermark-text-input')).toHaveValue('My Studio');
  await act(async () => { fireEvent.click(save()); });
  expect(apiClient.put).toHaveBeenCalledWith('/photographer/a/watermark-settings',
    expect.objectContaining({ watermark_text: 'My Studio' }));
});

test('late profile A cannot replace the settings saved for profile B', async () => {
  let finishA;
  apiClient.get.mockReturnValueOnce(new Promise(resolve => { finishA = resolve; }))
    .mockResolvedValueOnce({ data: { watermark_text: 'Studio B' } });
  const view = render(dialog());
  mockUserId = 'b';
  view.rerender(dialog());
  await screen.findByDisplayValue('Studio B');
  await act(async () => { finishA({ data: { watermark_text: 'Studio A' } }); });
  expect(screen.getByTestId('watermark-text-input')).toHaveValue('Studio B');
  await act(async () => { fireEvent.click(save()); });
  expect(apiClient.put).toHaveBeenCalledWith('/photographer/b/watermark-settings',
    expect.objectContaining({ watermark_text: 'Studio B' }));
});

test('a late read from a closed visit cannot unlock Save on a new visit for the same user', async () => {
  let finishOld;
  let finishNew;
  apiClient.get.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }))
    .mockReturnValueOnce(new Promise(resolve => { finishNew = resolve; }));
  const view = render(dialog());
  view.rerender(<WatermarkSettings open={false} onOpenChange={jest.fn()} />);
  view.rerender(dialog());
  await act(async () => { finishOld({ data: { watermark_text: 'Earlier visit' } }); });
  expect(screen.queryByTestId('watermark-text-input')).toBeNull();
  expect(save()).toBeDisabled();
  await act(async () => { finishNew({ data: { watermark_text: 'Current visit' } }); });
  expect(save()).toBeEnabled();
  expect(screen.getByTestId('watermark-text-input')).toHaveValue('Current visit');
});
