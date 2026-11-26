import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import WatermarkSettings from './WatermarkSettings';
import apiClient from '../lib/apiClient';

let mockUserId;
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() }));
jest.mock('./ui/slider', () => ({ Slider: () => null }));

const dialog = (open = true) => <WatermarkSettings open={open} onOpenChange={jest.fn()} />;
async function startUpload() {
  const input = await screen.findByTestId('logo-upload-input');
  fireEvent.change(input, { target: { files: [new File(['fixture'], 'logo.png', { type: 'image/png' })] } });
}

beforeEach(() => {
  mockUserId = 'a';
  apiClient.get.mockImplementation(async url => ({ data: {
    watermark_style: 'logo',
    watermark_logo_url: url === '/users/b/profile' ? '/b.png' : null,
  } }));
});

test('a late upload for A cannot replace the logo displayed or saved for B', async () => {
  let finish;
  apiClient.post.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(dialog());
  await startUpload();
  mockUserId = 'b';
  view.rerender(dialog());
  const logo = await screen.findByRole('img', { name: 'Watermark logo' });
  expect(logo).toHaveAttribute('src', '/b.png');
  await act(async () => { finish({ data: { url: '/a.png' } }); });
  expect(logo).toHaveAttribute('src', '/b.png');
  await act(async () => { fireEvent.click(screen.getByTestId('save-watermark-settings-btn')); });
  expect(apiClient.put).toHaveBeenCalledWith('/photographer/b/watermark-settings',
    expect.objectContaining({ watermark_logo_url: '/b.png' }));
});

test('an old failure after reopen cannot interrupt a new upload for the same user', async () => {
  const alert = jest.spyOn(window, 'alert').mockImplementation(() => {});
  try {
    let failOld, finishNew;
    apiClient.post.mockReturnValueOnce(new Promise((_, reject) => { failOld = reject; }))
      .mockReturnValueOnce(new Promise(resolve => { finishNew = resolve; }));
    const view = render(dialog());
    await startUpload();
    view.rerender(dialog(false));
    view.rerender(dialog());
    await startUpload();
    await act(async () => { failOld(new Error('obsolete')); });
    expect(alert).not.toHaveBeenCalled();
    expect(screen.queryByText('Upload Logo')).toBeNull();
    await act(async () => { finishNew({ data: { url: '/new.png' } }); });
    expect(await screen.findByRole('img', { name: 'Watermark logo' })).toHaveAttribute('src', '/new.png');
  } finally {
    alert.mockRestore();
  }
});

test('replacing a file in the same visit keeps the newer upload active', async () => {
  let finishOld, finishNew;
  apiClient.post.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }))
    .mockReturnValueOnce(new Promise(resolve => { finishNew = resolve; }));
  render(dialog());
  await startUpload();
  await startUpload();
  const [oldRequest, newRequest] = apiClient.post.mock.calls;
  expect(oldRequest[2].signal.aborted).toBe(true);
  expect(newRequest[2].signal.aborted).toBe(false);
  await act(async () => { finishOld({ data: { url: '/superseded.png' } }); });
  expect(screen.queryByRole('img', { name: 'Watermark logo' })).toBeNull();
  expect(screen.queryByText('Upload Logo')).toBeNull();
  await act(async () => { finishNew({ data: { url: '/replacement.png' } }); });
  expect(await screen.findByRole('img', { name: 'Watermark logo' })).toHaveAttribute('src', '/replacement.png');
});

test('a completed upload before switching profiles does not replace the next loaded logo', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { url: '/immediate.png' } });
  const view = render(dialog());
  await startUpload();
  expect(await screen.findByRole('img', { name: 'Watermark logo' })).toHaveAttribute('src', '/immediate.png');
  mockUserId = 'b';
  view.rerender(dialog());
  await screen.findByTestId('save-watermark-settings-btn');
  expect(await screen.findByRole('img', { name: 'Watermark logo' })).toHaveAttribute('src', '/b.png');
});
