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

test('a current preview failure still shows the sample and permits retry', async () => {
  apiClient.post.mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ data: { preview_url: '/retry.png' } });
  render(dialog());
  await screen.findByDisplayValue('/users/a/profile');
  await act(async () => { fireEvent.click(generate()); });
  expect(image()).toHaveAttribute('src', apiClient.post.mock.calls[0][1].sample_image_url);
  await act(async () => { fireEvent.click(generate()); });
  expect(image()).toHaveAttribute('src', '/retry.png');
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
