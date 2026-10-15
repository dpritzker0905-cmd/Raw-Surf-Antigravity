import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../../contexts/ThemeContext';
import TaggingAssignModal from './TaggingAssignModal';

jest.mock('../../lib/apiClient', () => ({ post: jest.fn() }));

test.each(['light', 'dark', 'beach'])('%s: shows visual descriptions and manual participant selection', theme => {
  localStorage.setItem('raw-surf-theme', theme);
  const scan = jest.fn();
  const select = jest.fn();
  render(<ThemeProvider><TaggingAssignModal
    showTaggingModal setShowTaggingModal={jest.fn()} isLight={theme === 'light'}
    selectedItem={{ id: 'photo', media_type: 'image', preview_url: 'https://example.com/photo.jpg' }}
    aiTagSuggestions={[]} selectedTags={[]} analyzingPhoto={false}
    aiPhotoAnalysis={{ people_count: 1, overall_description: 'A surfer carrying a blue board.', visual_tags: ['blue board'] }}
    sessionParticipants={[{ surfer_id: 'known-participant', full_name: 'Known participant' }]}
    textPrimaryClass="text-inherit" textSecondaryClass="text-inherit" borderClass="border-inherit"
    handleAnalyzePhoto={scan} toggleTagSelection={select}
  /></ThemeProvider>);
  expect(screen.getByText('A surfer carrying a blue board.')).toBeInTheDocument();
  expect(screen.getByText('blue board')).toBeInTheDocument();
  expect(screen.getByText(/Scanning sends this photo to OpenAI/)).toBeInTheDocument();
  expect(screen.queryByText('AI Recognition')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Analyze photo' }));
  expect(scan).toHaveBeenCalledTimes(1);
  const participant = screen.getByRole('button', { name: /Known participant/ });
  expect(participant).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(participant);
  expect(select).toHaveBeenCalledWith('known-participant');
  expect(screen.getByRole('button', { name: 'Tag & Assign (0)' })).toBeDisabled();
});
