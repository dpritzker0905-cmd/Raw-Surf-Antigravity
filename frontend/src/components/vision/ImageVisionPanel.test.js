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
  expect(screen.getByLabelText('Photo to analyze')).toHaveClass(theme === 'beach' ? 'bg-amber-50' : 'bg-background');
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

test.each(['light', 'dark', 'beach'])('board clues in %s keep ambiguous candidates, evidence and manual review', async theme => {
  localStorage.setItem('raw-surf-theme', theme);
  const clues = ['Alex', 'Sam'].map((full_name, i) => ({
    surfer_id: String(i), full_name, username: full_name.toLowerCase(), board_id: String(i),
    board_label: 'Coastal Fish', person_index: 0, relationship: 'holding', strength: 'limited',
    evidence: [{ field: 'board_type', observed: 'fish', saved: 'fish' }],
    conflicts: [{ field: 'tail_shape', observed: 'round', saved: 'swallow' }], requires_manual_review: true,
  }));
  apiClient.post.mockResolvedValue({ data: { success: true, analysis: {
    overall_description: 'A person holding a board', people_count: 1, people: [{ position: 'left' }], visual_tags: [],
  }, board_clues: clues, board_clue_status: 'ready', board_clues_truncated: true } });
  const review = jest.fn();
  render(<ThemeProvider><ImageVisionPanel images={images} includeBoardClues onReviewPhoto={review} /></ThemeProvider>);
  expect(apiClient.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Scan Photo' }));
  expect(await screen.findByRole('region', { name: 'Saved board clues' })).toBeInTheDocument();
  expect(screen.getByText('Alex')).toBeInTheDocument();
  expect(screen.getByText('Sam')).toBeInTheDocument();
  expect(screen.getAllByText('Limited board clue')).toHaveLength(2);
  expect(screen.getAllByText(/Details differ/)).toHaveLength(2);
  expect(screen.getByText(/Other possible overlaps may be omitted/)).toBeInTheDocument();
  expect(screen.queryByText(/% match/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Use only this photo for manual assignment' }));
  expect(review).toHaveBeenCalledWith('owned-photo');
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.post).toHaveBeenCalledWith('/ai/suggest-tags', {
    image_url: images[0].url, gallery_item_id: 'owned-photo', include_board_clues: true,
  });
  fireEvent.change(screen.getByLabelText('Photo to analyze'), { target: { value: 'another-photo' } });
  expect(screen.queryByRole('region', { name: 'Saved board clues' })).not.toBeInTheDocument();
  expect(review).toHaveBeenCalledTimes(1);
});

test.each([
  ['no_linked_session', /Link this folder to a session/],
  ['no_saved_boards', /no saved board details/],
  ['ready', /No usable board overlap/],
  [undefined, /Saved board clues are unavailable/],
])('board clue status %s does not fabricate candidates or trigger more paid calls', async (status, message) => {
  apiClient.post.mockResolvedValue({ data: { success: true, analysis: {
    overall_description: 'A board alone', people_count: 0, visual_tags: [],
  }, board_clues: [], board_clue_status: status } });
  render(<ImageVisionPanel images={images} includeBoardClues />);
  fireEvent.click(screen.getByRole('button', { name: 'Scan Photo' }));
  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Possible board overlaps' })).toBeEmptyDOMElement();
  expect(apiClient.post).toHaveBeenCalledTimes(1);
});
