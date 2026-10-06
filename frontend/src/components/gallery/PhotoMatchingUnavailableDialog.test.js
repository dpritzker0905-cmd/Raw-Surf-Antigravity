import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { FindMeModal } from './FindMeModal';
import { LockerSelfieModal } from '../LockerSelfieModal';
import apiClient from '../../lib/apiClient';

jest.mock('../../lib/apiClient', () => ({ post: jest.fn() }));

test.each(['light', 'dark', 'beach'].flatMap(theme => ['gallery', 'locker'].map(surface => [theme, surface])))(
  '%s %s explains unavailability without collecting or uploading selfies', async (theme, surface) => {
    localStorage.setItem('raw-surf-theme', theme);
    const opener = document.createElement('button');
    opener.textContent = 'Find photos';
    document.body.appendChild(opener);
    opener.focus();
    const onClose = jest.fn();
    const Modal = surface === 'gallery' ? FindMeModal : LockerSelfieModal;
    const { rerender } = render(<ThemeProvider><Modal open isOpen onClose={onClose} /></ThemeProvider>);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Automatic photo matching is currently unavailable.')).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(document.querySelector('video')).toBeNull();
    expect(apiClient.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to photos' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<ThemeProvider><Modal open={false} isOpen={false} onClose={onClose} /></ThemeProvider>);
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  },
);
