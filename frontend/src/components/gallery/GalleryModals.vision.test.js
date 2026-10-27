import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { TagAssignModal } from './GalleryModals';
import apiClient from '../../lib/apiClient';

jest.mock('../../lib/apiClient', () => ({ post: jest.fn() }));

test('main Gallery Hub review scans a selected photo, excludes videos and keeps manual assignment', async () => {
  apiClient.post.mockResolvedValue({ data: { success: true, analysis: {
    overall_description: 'A red board.', people_count: 0, visual_tags: ['red board'],
  } } });
  render(<TagAssignModal showTagAssignModal setShowTagAssignModal={jest.fn()}
    selectedGallery={{ id: 'gallery', title: 'Upload QA' }} selectedItems={new Set(['photo', 'video'])}
    galleryItems={[
      { id: 'other', title: 'Unselected photo', media_type: 'image', preview_url: 'https://example.com/other.jpg' },
      { id: 'photo', title: 'Selected photo', media_type: 'image', preview_url: 'https://example.com/photo.jpg' },
      { id: 'video', media_type: 'video', preview_url: 'https://example.com/video.mp4' },
    ]} participants={[]} batchTagLoading={{}} distributeLoading={{}} sessionInfo={{ is_linked: false }}
    searchResults={[]} manualSurferSearch="" />);
  expect(screen.queryByRole('option', { name: 'Unselected photo' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('option')).toHaveLength(1);
  expect(apiClient.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Scan Photo' }));
  expect(await screen.findByText('A red board.')).toBeInTheDocument();
  expect(apiClient.post).toHaveBeenCalledWith('/ai/suggest-tags', {
    image_url: 'https://example.com/photo.jpg', gallery_item_id: 'photo', include_board_clues: true,
  });
  expect(screen.getByText('Manual Assignment')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'AI Match All' })).not.toBeInTheDocument();
});

test('reviewing a clue explicitly narrows assignment to one photo without tagging anyone', async () => {
  const setSelectedItems = jest.fn();
  const assign = jest.fn();
  apiClient.post.mockResolvedValue({ data: { success: true, analysis: {
    overall_description: 'A surfer holding a blue board', people_count: 1, visual_tags: [],
  }, board_clue_status: 'ready', board_clues: [] } });
  render(<TagAssignModal showTagAssignModal setShowTagAssignModal={jest.fn()}
    selectedGallery={{ id: 'gallery', title: 'Fixture' }} selectedItems={new Set()} setSelectedItems={setSelectedItems}
    galleryItems={[
      { id: 'one', media_type: 'image', preview_url: 'https://example.com/one.jpg' },
      { id: 'two', media_type: 'image', preview_url: 'https://example.com/two.jpg' },
    ]} participants={[]} batchTagLoading={{}} distributeLoading={{}} sessionInfo={{ is_linked: false }}
    searchResults={[]} manualSurferSearch="" handleBatchTagToSurfer={assign} />);
  fireEvent.change(screen.getByLabelText('Photo to analyze'), { target: { value: 'two' } });
  fireEvent.click(screen.getByRole('button', { name: 'Scan Photo' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Use only this photo for manual assignment' }));
  expect(setSelectedItems).toHaveBeenCalledWith(new Set(['two']));
  expect(assign).not.toHaveBeenCalled();
  expect(apiClient.post).toHaveBeenCalledTimes(1);
});
