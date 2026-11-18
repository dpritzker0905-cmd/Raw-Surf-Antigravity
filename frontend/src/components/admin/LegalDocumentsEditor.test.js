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
  test('three sub-sections in a keyboard tablist', async () => {
    await openEditor();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Terms of Service', 'Privacy Policy', 'Forecast data consent']);
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
    expect(screen.getByRole('status')).toHaveTextContent(/wording fix/i);
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: '2.0' } });
    expect(screen.getByRole('status')).toHaveTextContent(/asked again/i);
    expect(screen.getByRole('button', { name: /publish consent 2\.0 \(asks everyone again\)/i })).toBeInTheDocument();
  });

  test('publishing the consent sends one section under the chosen version', async () => {
    await openEditor();
    fireEvent.click(screen.getByRole('tab', { name: 'Forecast data consent' }));
    fireEvent.change(await screen.findByLabelText('Text under the checkbox'), { target: { value: 'Clearer words.' } });
    fireEvent.click(screen.getByRole('button', { name: /publish consent 1\.0/i }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/compliance/tos-content', {
      doc_type: 'forecast_consent', version: '1.0', sections: [{ title: 'Use my reports', body: 'Clearer words.' }],
      effective_date: '', set_active: true,
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
