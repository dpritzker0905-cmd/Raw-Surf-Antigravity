import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SurfboardModal } from './SurfboardModal';
import { ThemeProvider } from '../../contexts/ThemeContext';
import apiClient from '../../lib/apiClient';

jest.mock('../../lib/apiClient', () => ({ post: jest.fn(), patch: jest.fn() }));

test.each(['light', 'dark', 'beach'])('%s: review preserves manual details and uses legible field surfaces', async theme => {
  localStorage.setItem('raw-surf-theme', theme);
  apiClient.post.mockResolvedValue({ data: { success: true, analysis: {
    board_detected: true, brand: 'Detected shaper', model: 'Detected model', board_type: 'surfboard',
    fin_setup: 'quad', description: 'Visible description', length_feet: 99,
  } } });
  const close = jest.fn();
  render(<ThemeProvider><SurfboardModal isOpen onClose={close} onSave={jest.fn()}
    board={{ id: 'existing', brand: 'My shaper', length_feet: 6, photo_urls: ['https://example.com/board.jpg'] }} />
  </ThemeProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Scan Surfboard' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Use suggestions in empty fields' }));
  expect(screen.getByRole('textbox', { name: 'Brand / Shaper' })).toHaveValue('My shaper');
  expect(screen.getByRole('textbox', { name: 'Brand / Shaper' })).toHaveClass(theme === 'beach' ? 'bg-amber-50' : 'bg-background');
  expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('Detected model');
  expect(screen.getByPlaceholderText('5')).toHaveValue(6);
  expect(screen.getByText('Select type')).toBeInTheDocument();
  expect(screen.getByText('Quad (4 fin)')).toBeInTheDocument();
  expect(apiClient.patch).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
