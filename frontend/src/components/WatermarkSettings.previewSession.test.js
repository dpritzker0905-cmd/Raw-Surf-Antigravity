import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import WatermarkSettings from './WatermarkSettings';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

let mockUserId;
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
jest.mock('./ui/slider', () => ({ Slider: () => null }));

const dialog = (open = true) => <WatermarkSettings open={open} onOpenChange={jest.fn()} />;
const generate = () => screen.getByTestId('generate-preview-btn');
const image = () => screen.queryByRole('img', { name: 'Watermark preview' });

beforeEach(() => {
  jest.resetAllMocks();
  mockUserId = 'a';
  apiClient.get.mockImplementation(async url => ({ data: { watermark_text: url } }));
});

test('a late preview for A never appears on B', async () => {
  let finishA;
  apiClient.post.mockReturnValueOnce(new Promise(resolve => { finishA = resolve; }));
  const view = render(dialog());
  await screen.findByDisplayValue('/users/a/profile');
  fireEvent.click(generate());
  mockUserId = 'b';
  view.rerender(dialog());
  await screen.findByDisplayValue('/users/b/profile');
  await act(async () => { finishA({ data: { preview_url: '/a.png' } }); });
  expect(image()).toBeNull();
  expect(generate()).toBeEnabled();
});

test('a completed preview is cleared when the photographer changes', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { preview_url: '/old.png' } });
  const view = render(dialog());
  await screen.findByDisplayValue('/users/a/profile');
  await act(async () => { fireEvent.click(generate()); });
  expect(image()).toHaveAttribute('src', '/old.png');
  mockUserId = 'b';
  view.rerender(dialog());
  await screen.findByDisplayValue('/users/b/profile');
  expect(image()).toBeNull();
});

test('a failure from a closed visit cannot show a fallback or end the new preview request', async () => {
  let failOld, finishNew;
  apiClient.post.mockReturnValueOnce(new Promise((_, reject) => { failOld = reject; }))
    .mockReturnValueOnce(new Promise(resolve => { finishNew = resolve; }));
  const view = render(dialog());
  await screen.findByDisplayValue('/users/a/profile');
  fireEvent.click(generate());
  view.rerender(dialog(false));
  view.rerender(dialog());
  await screen.findByDisplayValue('/users/a/profile');
  fireEvent.click(generate());
  await act(async () => { failOld(new Error('obsolete')); });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(image()).toBeNull();
  expect(generate()).toBeDisabled();
  await act(async () => { finishNew({ data: { preview_url: '/new.png' } }); });
  expect(image()).toHaveAttribute('src', '/new.png');
  expect(generate()).toBeEnabled();
});

test('a completed preview for B survives a later response from A even if transport ignores abort', async () => {
  let finishA;
  apiClient.post.mockReturnValueOnce(new Promise(resolve => { finishA = resolve; }))
    .mockResolvedValueOnce({ data: { preview_url: '/b.png' } });
  const view = render(dialog());
  await screen.findByDisplayValue('/users/a/profile');
  fireEvent.click(generate());
  const signalA = apiClient.post.mock.calls[0][2].signal;
  mockUserId = 'b';
  view.rerender(dialog());
  await screen.findByDisplayValue('/users/b/profile');
  expect(signalA.aborted).toBe(true);
  await act(async () => { fireEvent.click(generate()); });
  expect(image()).toHaveAttribute('src', '/b.png');
  await act(async () => { finishA({ data: { preview_url: '/late-a.png' } }); });
  expect(image()).toHaveAttribute('src', '/b.png');
});

test('a failed regeneration clears the old preview, reports the error and permits retry', async () => {
  let finishRetry;
  apiClient.post.mockResolvedValueOnce({ data: { preview_url: '/first.png' } })
    .mockRejectedValueOnce(new Error('offline'))
    .mockReturnValueOnce(new Promise(resolve => { finishRetry = resolve; }));
  render(dialog());
  await screen.findByDisplayValue('/users/a/profile');
  await act(async () => { fireEvent.click(generate()); });
  expect(image()).toHaveAttribute('src', '/first.png');
  await act(async () => { fireEvent.click(generate()); });
  expect(image()).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent(/could not generate/i);
  expect(screen.queryByText('/users/a/profile')).toBeNull();
  expect(generate()).toBeEnabled();
  fireEvent.click(generate());
  expect(screen.queryByRole('alert')).toBeNull();
  expect(generate()).toBeDisabled();
  expect(screen.queryByText(/click "generate preview"/i)).toBeNull();
  expect(screen.queryByText('/users/a/profile')).toBeNull();
  const status = screen.getByText('Generating watermark preview…');
  expect(status).toHaveAttribute('role', 'status');
  await act(async () => { finishRetry({ data: { preview_url: '/retry.png' } }); });
  expect(status).toBeInTheDocument();
  expect(status).toBeEmptyDOMElement();
  expect(image()).toHaveAttribute('src', '/retry.png');
});

test('a response without an image reports failure until the settings change', async () => {
  apiClient.post.mockResolvedValueOnce({ data: {} });
  render(dialog());
  const input = await screen.findByDisplayValue('/users/a/profile');
  await act(async () => { fireEvent.click(generate()); });
  expect(screen.getByRole('alert')).toHaveTextContent(/could not generate/i);
  expect(image()).toBeNull();
  fireEvent.change(input, { target: { value: 'Updated' } });
  expect(screen.queryByRole('alert')).toBeNull();
});

test('an image load error clears the broken preview and allows retrying the same URL', async () => {
  apiClient.post.mockResolvedValue({ data: { preview_url: '/preview.jpg' } });
  render(dialog());
  await screen.findByDisplayValue('/users/a/profile');
  await act(async () => { fireEvent.click(generate()); });
  const failedImage = image();
  fireEvent.error(failedImage);
  expect(image()).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent(/could not display/i);
  expect(generate()).toBeEnabled();
  await act(async () => { fireEvent.click(generate()); });
  expect(image()).toHaveAttribute('src', '/preview.jpg');
  expect(image()).not.toBe(failedImage);
  fireEvent.error(failedImage);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(image()).toHaveAttribute('src', '/preview.jpg');
});

test('unmount releases the pending preview and ignores its later rejection', async () => {
  let reject;
  apiClient.post.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const view = render(dialog());
  await screen.findByDisplayValue('/users/a/profile');
  fireEvent.click(generate());
  const signal = apiClient.post.mock.calls[0][2].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { reject(new Error('late rejection')); });
  expect(logger.error).not.toHaveBeenCalled();
});

test('a completed preview survives reselecting the same style but clears when the text changes', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { preview_url: '/original.png' } });
  render(dialog());
  const input = await screen.findByDisplayValue('/users/a/profile');
  await act(async () => { fireEvent.click(generate()); });
  fireEvent.click(screen.getByRole('button', { name: 'Text Only' }));
  expect(image()).toHaveAttribute('src', '/original.png');
  fireEvent.change(input, { target: { value: 'Revised text' } });
  expect(image()).toBeNull();
});

test('changing style invalidates a pending preview and allows a new preview immediately', async () => {
  let finishOld, finishNew;
  apiClient.post.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }))
    .mockReturnValueOnce(new Promise(resolve => { finishNew = resolve; }));
  render(dialog());
  await screen.findByDisplayValue('/users/a/profile');
  fireEvent.click(generate());
  fireEvent.click(screen.getByRole('button', { name: 'Logo + Text' }));
  expect(generate()).toBeEnabled();
  await act(async () => { fireEvent.click(generate()); });
  expect(apiClient.post).toHaveBeenLastCalledWith('/gallery/generate-watermark-preview',
    expect.objectContaining({ watermark_style: 'both' }), expect.anything());
  await act(async () => { finishOld({ data: { preview_url: '/obsolete.png' } }); });
  expect(image()).toBeNull();
  expect(generate()).toBeDisabled();
  await act(async () => { finishNew({ data: { preview_url: '/both.png' } }); });
  expect(image()).toHaveAttribute('src', '/both.png');
});

test('removing the logo clears a completed preview and regenerates without the logo', async () => {
  apiClient.get.mockResolvedValueOnce({ data: { watermark_style: 'both', watermark_logo_url: '/logo.png' } });
  apiClient.post.mockResolvedValueOnce({ data: { preview_url: '/with-logo.png' } })
    .mockResolvedValueOnce({ data: { preview_url: '/without-logo.png' } });
  render(dialog());
  const removeLogo = await screen.findByTestId('remove-logo-btn');
  await act(async () => { fireEvent.click(generate()); });
  expect(image()).toHaveAttribute('src', '/with-logo.png');
  fireEvent.click(removeLogo);
  expect(image()).toBeNull();
  await act(async () => { fireEvent.click(generate()); });
  expect(apiClient.post).toHaveBeenLastCalledWith('/gallery/generate-watermark-preview',
    expect.objectContaining({ watermark_logo_url: null }), expect.anything());
  expect(image()).toHaveAttribute('src', '/without-logo.png');
});
