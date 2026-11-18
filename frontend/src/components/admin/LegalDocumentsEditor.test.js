import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiClient from '../../lib/apiClient';
import LegalDocumentsEditor from './LegalDocumentsEditor';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), put: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const DOCS = {
  tos: { version: '2.0', effective_date: 'May 2026', sections: [{ title: '1. Terms', body: 'Be nice.' }] },
  privacy: { version: '1.0', effective_date: '', sections: [{ title: '1. Data', body: 'We keep little.' }] },
  forecast_consent: { version: '1.0', effective_date: '', sections: [{ title: 'Use my reports', body: 'Off unless on.' }] },
  company_details: { version: '1.0', effective_date: '', sections: [{ title: 'legal_name', body: 'Raw Surf Adventures Inc.' },
    { title: 'privacy_url', body: '/privacy' }, { title: 'privacy_contact', body: '' }] },
};

beforeEach(() => {
  apiClient.get.mockReset();
  apiClient.put.mockReset();
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/compliance/forecast-consent/summary')) {
      return Promise.resolve({ data: { version: '1.0', opted_in: 4, awaiting_reconsent: 1, opted_out: 2 } });
    }
    const dt = new URLSearchParams(url.split('?')[1]).get('doc_type');
    return Promise.resolve({ data: DOCS[dt] });
  });
  apiClient.put.mockResolvedValue({ data: {} });
});

async function openEditor() {
  render(<LegalDocumentsEditor />);
  const toggle = screen.getByRole('button', { name: /legal documents/i });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await screen.findByDisplayValue('1. Terms');
}

describe('LegalDocumentsEditor (Compliance > Legal documents)', () => {
  test('four sub-sections in a keyboard tablist, company details next to the Terms', async () => {
    await openEditor();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Terms of Service', 'Company details', 'Privacy Policy',
      'Forecast data consent']);
    // the editor reads the template as written, never the filled text
    expect(apiClient.get).toHaveBeenCalledWith('/compliance/tos-content/current?doc_type=tos&raw=true');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tabs[0], { key: 'End' });
    await screen.findByLabelText('Checkbox label');
    expect(screen.getByRole('tab', { name: 'Forecast data consent' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'legal-tab-forecast_consent');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Forecast data consent' }), { key: 'ArrowRight' });
    await screen.findByDisplayValue('1. Terms');                                   // wraps to the first
  });

  test('the consent is one label and one text, with counts and the version rule said in words', async () => {
    await openEditor();
    fireEvent.click(screen.getByRole('tab', { name: 'Forecast data consent' }));
    expect(await screen.findByLabelText('Checkbox label')).toHaveValue('Use my reports');
    expect(screen.getByLabelText('Text under the checkbox')).toHaveValue('Off unless on.');
    expect(screen.queryByRole('button', { name: /add section/i })).toBeNull();
    expect(await screen.findByText('4')).toBeInTheDocument();                       // opted in under this version
    expect(screen.getByRole('status')).toHaveTextContent(/same text: everyone who opted in stays opted in/i);
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: '2.0' } });
    expect(screen.getByRole('status')).toHaveTextContent(/asked again/i);
    expect(screen.getByRole('button', { name: /publish consent 2\.0 \(asks everyone again\)/i })).toBeInTheDocument();
  });

  test('new words under the same version are locked; a new version publishes them as one section', async () => {
    await openEditor();
    fireEvent.click(screen.getByRole('tab', { name: 'Forecast data consent' }));
    fireEvent.change(await screen.findByLabelText('Text under the checkbox'), { target: { value: 'Clearer words.' } });
    expect(screen.getByRole('status')).toHaveTextContent(/cannot change: people agreed to it/i);
    expect(screen.getByRole('button', { name: /publish consent 1\.0/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: '1.1' } });
    fireEvent.click(screen.getByRole('button', { name: /publish consent 1\.1/i }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/compliance/tos-content', {
      doc_type: 'forecast_consent', version: '1.1', sections: [{ title: 'Use my reports', body: 'Clearer words.' }],
      effective_date: '', set_active: true,
    }));
  });

  test('company details are three labelled fields, published in a fixed order', async () => {
    await openEditor();
    fireEvent.click(screen.getByRole('tab', { name: 'Company details' }));
    const name = await screen.findByLabelText('Legal entity name');
    expect(name).toHaveValue('Raw Surf Adventures Inc.');
    expect(screen.getByLabelText('Privacy notice link')).toHaveValue('/privacy');
    expect(screen.queryByRole('button', { name: /add section/i })).toBeNull();
    fireEvent.change(name, { target: { value: 'Raw Surf Holdings LLC' } });
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: '1.1' } });
    fireEvent.click(screen.getByRole('button', { name: /publish company details 1\.1/i }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/compliance/tos-content', {
      doc_type: 'company_details', version: '1.1', effective_date: '', set_active: true,
      sections: [{ title: 'legal_name', body: 'Raw Surf Holdings LLC' }, { title: 'privacy_url', body: '/privacy' },
        { title: 'privacy_contact', body: '' }],
    }));
  });

  test('the Terms keep their multi-section editor with labelled fields', async () => {
    await openEditor();
    expect(screen.getByLabelText('Section 1 title')).toHaveValue('1. Terms');
    fireEvent.click(screen.getByRole('button', { name: /add section/i }));
    expect(screen.getByLabelText('Section 2 title')).toHaveValue('2. New section');
    fireEvent.click(screen.getByRole('button', { name: 'Remove section 2' }));
    expect(screen.queryByLabelText('Section 2 title')).toBeNull();
  });
});
