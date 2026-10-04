import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { FindMeModal } from './FindMeModal';
import { LockerSelfieModal } from '../LockerSelfieModal';
import apiClient from '../../lib/apiClient';

jest.mock('../../lib/apiClient', () => ({ post: jest.fn() }));

test.each(['light', 'dark', 'beach'].flatMap(theme => ['gallery', 'locker'].map(surface => [theme, surface])))(
  '%s %s explains unavailability without collecting or uploading selfies', (theme, surface) => {
    localStorage.setItem('raw-surf-theme', theme);
    const onClose = jest.fn();
    const Modal = surface === 'gallery' ? FindMeModal : LockerSelfieModal;
    const { container } = render(<ThemeProvider><Modal open isOpen onClose={onClose} /></ThemeProvider>);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Automatic photo matching is currently unavailable.')).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(document.querySelector('video')).toBeNull();
    expect(apiClient.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to photos' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  },
);
