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

  test('renders nothing when the server cannot answer (a report is never blocked by it)', async () => {
    apiClient.get.mockRejectedValue(new Error('401'));
    const { container } = render(<TrainingConsent idPrefix="t" />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
