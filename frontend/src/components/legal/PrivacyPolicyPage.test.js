import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import apiClient from '../../lib/apiClient';
import PrivacyPolicyPage from './PrivacyPolicyPage';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));

const page = () => render(<MemoryRouter><PrivacyPolicyPage /></MemoryRouter>);

beforeEach(() => apiClient.get.mockReset());

describe('PrivacyPolicyPage (/privacy, public)', () => {
  test('renders the active policy with the company named, one heading per section', async () => {
    apiClient.get.mockResolvedValue({ data: { version: '1.0', effective_date: 'May 2026', company: 'Raw Surf Adventures Inc.',
      sections: [{ title: '1. Information We Collect', body: 'Name and email.' },
        { title: '10. Who We Are', body: 'Raw Surf is operated by Raw Surf Adventures Inc.' }] } });
    page();
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(await screen.findByRole('heading', { level: 2, name: '10. Who We Are' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByText(/Raw Surf Adventures Inc\. · Version 1\.0 · Effective May 2026/)).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith('/compliance/tos-content/current?doc_type=privacy');
    expect(screen.getByRole('link', { name: /back to raw surf/i })).toHaveAttribute('href', '/');
  });

  test('a failed load says so instead of showing an empty page', async () => {
    apiClient.get.mockRejectedValue(new Error('offline'));
    page();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
  });
});
