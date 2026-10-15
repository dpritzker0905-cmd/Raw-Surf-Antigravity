import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImageVisionPanel } from './ImageVisionPanel';
import { ThemeProvider } from '../../contexts/ThemeContext';
import apiClient from '../../lib/apiClient';

jest.mock('../../lib/apiClient', () => ({ post: jest.fn() }));
const images = [
  { id: 'owned-photo', url: 'https://example.com/one.jpg', label: 'First photo' },
  { id: 'another-photo', url: 'https://example.com/two.jpg', label: 'Second photo' },
];
beforeEach(() => jest.clearAllMocks());

test.each(['light', 'dark', 'beach'])('%s: scans only the explicitly chosen owned photo and renders descriptive tags', async theme => {
  localStorage.setItem('raw-surf-theme', theme);
  apiClient.post.mockResolvedValue({ data: { success: true, analysis: {
    overall_description: 'A wooden board.', people_count: 0, visual_tags: ['wood grain'],
  } } });
  render(<ThemeProvider><ImageVisionPanel images={images} /></ThemeProvider>);
  expect(apiClient.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Photo to analyze'), { target: { value: 'another-photo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Scan Photo' }));
  expect(await screen.findByText('wood grain')).toBeInTheDocument();
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.post).toHaveBeenCalledWith('/ai/suggest-tags', {
    image_url: images[1].url, gallery_item_id: 'another-photo',
  });
  expect(screen.getByText(/Select known surfers manually/)).toBeInTheDocument();
});

test('ignores a late response after choosing a different photo', async () => {
  let finish;
  apiClient.post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<ImageVisionPanel images={images} />);
  fireEvent.click(screen.getByRole('button', { name: 'Scan Photo' }));
  fireEvent.change(screen.getByLabelText('Photo to analyze'), { target: { value: 'another-photo' } });
  await act(async () => finish({ data: { success: true, analysis: { overall_description: 'Stale photo' } } }));
  expect(screen.queryByText('Stale photo')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Scan Photo' })).toBeEnabled();
});

test('reports a paused budget without retrying or applying anything', async () => {
  apiClient.post.mockRejectedValue({ response: { data: { detail: 'AI is paused: the testing budget is unavailable or exhausted' } } });
  const apply = jest.fn();
  render(<ImageVisionPanel images={images} kind="board" onApply={apply} />);
  fireEvent.click(screen.getByRole('button', { name: 'Scan Surfboard' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('AI is paused');
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Scan Surfboard' })).toBeEnabled();
});

test('board suggestions require explicit review and never save a board', async () => {
  const analysis = { board_detected: true, brand: 'Visible shaper', model: null, tail_shape: 'swallow' };
  apiClient.post.mockResolvedValue({ data: { success: true, analysis, saved: false } });
  const apply = jest.fn();
  render(<ImageVisionPanel images={images} kind="board" boardId="owned-board" onApply={apply} />);
  fireEvent.click(screen.getByRole('button', { name: 'Scan Surfboard' }));
  await screen.findByText('Visible shaper');
  expect(apiClient.post).toHaveBeenCalledWith('/ai/scan-surfboard', { image_url: images[0].url, surfboard_id: 'owned-board' });
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use suggestions in empty fields' }));
  expect(apply).toHaveBeenCalledWith(analysis);
  expect(apiClient.post).toHaveBeenCalledTimes(1);
});

test('no board detected cannot be applied; empty photo list cannot incur a charge', async () => {
  const { rerender } = render(<ImageVisionPanel images={[]} kind="board" />);
  expect(screen.getByRole('button', { name: 'Scan Surfboard' })).toBeDisabled();
  apiClient.post.mockResolvedValue({ data: { success: true, analysis: { board_detected: false } } });
  rerender(<ImageVisionPanel images={images} kind="board" />);
  fireEvent.click(screen.getByRole('button', { name: 'Scan Surfboard' }));
  await waitFor(() => expect(screen.getByText(/No surfboard detected/)).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Use suggestions in empty fields' })).not.toBeInTheDocument();
});
