import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import WatermarkSettings from './WatermarkSettings';
import apiClient from '../lib/apiClient';

jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'photographer' } }) }));
jest.mock('../lib/apiClient', () => ({ get: async () => ({ data: {} }), put: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
jest.mock('./ui/slider', () => ({ Slider: () => null }));

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

async function openSettings() {
  render(<WatermarkSettings open onOpenChange={jest.fn()} />);
  await screen.findByTestId('watermark-text-input');
  return screen.getByTestId('save-watermark-settings-btn');
}

test('an existing live status receives the save confirmation and clears after three seconds', async () => {
  const save = await openSettings();
  const status = screen.getByRole('status');
  expect(status).toBeEmptyDOMElement();
  apiClient.put.mockResolvedValueOnce({});
  await act(async () => { fireEvent.click(save); });
  expect(status).toHaveTextContent('Watermark settings saved!');
  act(() => jest.advanceTimersByTime(3000));
  expect(status).toBeEmptyDOMElement();
});

test('a previous success timer cannot erase a failed retry', async () => {
  const save = await openSettings();
  apiClient.put.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { fireEvent.click(save); });
  expect(screen.getByText('Watermark settings saved!')).toBeVisible();
  act(() => jest.advanceTimersByTime(1000));
  await act(async () => { fireEvent.click(save); });
  expect(screen.getByText('Failed to save settings')).toBeVisible();
  act(() => jest.advanceTimersByTime(3000));
  expect(screen.getByText('Failed to save settings')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Failed to save settings');
});

test('each success receives its own three-second confirmation', async () => {
  const save = await openSettings();
  apiClient.put.mockResolvedValue({});
  await act(async () => { fireEvent.click(save); });
  act(() => jest.advanceTimersByTime(2000));
  await act(async () => { fireEvent.click(save); });
  act(() => jest.advanceTimersByTime(2999));
  expect(screen.getByRole('status')).toHaveTextContent('Watermark settings saved!');
  act(() => jest.advanceTimersByTime(1));
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
});

test('a response from a closed dialog cannot populate a reopened status', async () => {
  let finish;
  apiClient.put.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const dialog = open => <WatermarkSettings open={open} onOpenChange={jest.fn()} />;
  const view = render(dialog(true));
  await screen.findByTestId('watermark-text-input');
  fireEvent.click(screen.getByTestId('save-watermark-settings-btn'));
  view.rerender(dialog(false));
  view.rerender(dialog(true));
  await screen.findByTestId('watermark-text-input');
  expect(screen.getByTestId('save-watermark-settings-btn')).toBeDisabled();
  await act(async () => { finish({}); });
  expect(screen.getByTestId('save-watermark-settings-btn')).toBeEnabled();
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
});
