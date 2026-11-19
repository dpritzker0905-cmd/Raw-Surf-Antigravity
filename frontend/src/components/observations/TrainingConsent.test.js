import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiClient from '../../lib/apiClient';
import TrainingConsent from './TrainingConsent';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), put: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { warn: jest.fn() } }));

const SERVER = { granted: false, version: null, current_version: 'draft-x', title: 'Use my wave reports',
  text: 'Off unless you turn it on.' };

beforeEach(() => {
  apiClient.get.mockReset();
  apiClient.put.mockReset();
});

describe('TrainingConsent (T1 P3 opt-in)', () => {
  test('shows the server wording, off by default, as a labelled, described checkbox', async () => {
    apiClient.get.mockResolvedValue({ data: SERVER });
    render(<TrainingConsent idPrefix="t" />);
    const box = await screen.findByRole('checkbox', { name: /use my wave reports/i });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription('Off unless you turn it on.');
    expect(screen.getByText('(Off)')).toBeInTheDocument();           // state in words, not colour
    expect(apiClient.get).toHaveBeenCalledWith('/surf-observations/consent');
  });

  test('turning it on sends only the choice and its screen, and shows On', async () => {
    apiClient.get.mockResolvedValue({ data: SERVER });
    apiClient.put.mockResolvedValue({ data: { ...SERVER, granted: true, version: 'draft-x' } });
    render(<TrainingConsent idPrefix="t" />);
    fireEvent.click(await screen.findByRole('checkbox'));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/surf-observations/consent',
      { granted: true, source: 'blind_height_input' }));
    expect(await screen.findByText('(On)')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  test('a failed save reverts the box and says so', async () => {
    apiClient.get.mockResolvedValue({ data: SERVER });
    apiClient.put.mockRejectedValue(new Error('offline'));
    render(<TrainingConsent idPrefix="t" />);
    fireEvent.click(await screen.findByRole('checkbox'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  test('after a new wording version an earlier yes shows as off, says why, and the screen it sits on is the source',
    async () => {
      apiClient.get.mockResolvedValue({ data: { ...SERVER, granted: false, needs_reconsent: true, version: 'old' } });
      apiClient.put.mockResolvedValue({ data: { ...SERVER, granted: true, needs_reconsent: false } });
      render(<TrainingConsent idPrefix="s" source="settings" />);
      expect(await screen.findByText(/wording changed since you turned it on/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('checkbox'));
      await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/surf-observations/consent',
        { granted: true, source: 'settings' }));
      expect(screen.queryByText(/wording changed/i)).toBeNull();
    });

  test('the privacy notice named in the wording is a real link to /privacy, in a new tab', async () => {
    const text = 'Off unless you turn it on. Raw Surf Adventures Inc. uses them. Privacy notice: /privacy';
    apiClient.get.mockResolvedValue({ data: { ...SERVER, final: true, privacy_url: '/privacy', text } });
    render(<TrainingConsent idPrefix="t" />);
    const link = await screen.findByRole('link', { name: 'Privacy Policy' });
    expect(link).toHaveAttribute('href', '/privacy');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('checkbox')).toHaveAccessibleDescription(/Raw Surf Adventures Inc\. uses them\. Privacy notice: Privacy Policy/);
  });

  test('renders nothing while the server wording is a draft with placeholders (no one can agree to it)', async () => {
    apiClient.get.mockResolvedValue({ data: { ...SERVER, final: false, text: 'When on, [COMPANY] uses ...' } });
    const { container } = render(<TrainingConsent idPrefix="t" />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/\[COMPANY\]/)).toBeNull();
  });

  test('renders nothing when the server cannot answer (a report is never blocked by it)', async () => {
    apiClient.get.mockRejectedValue(new Error('401'));
    const { container } = render(<TrainingConsent idPrefix="t" />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
