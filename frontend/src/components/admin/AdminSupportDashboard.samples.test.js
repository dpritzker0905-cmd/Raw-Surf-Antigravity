import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import apiClient from '../../lib/apiClient';
import { AdminSupportDashboard } from './AdminSupportDashboard';

jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'fictional-admin' } }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }));
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
let metrics;
const card = label => within(screen.getByText(label, { exact: true }).parentElement);
const mount = async () => { render(<AdminSupportDashboard />); await screen.findByText('Avg Response'); };
beforeEach(() => {
  jest.clearAllMocks();
  metrics = { open_tickets: 0, resolved_tickets: 0, sla_breached_count: 0,
    avg_first_response_hours: 0, avg_resolution_hours: 0, first_response_sample_count: 0, resolution_sample_count: 0 };
  apiClient.get.mockImplementation(url => Promise.resolve({ data: url.includes('/metrics?') ? { ...metrics } : { tickets: [], total: 0, offset: 0, limit: 50 } }));
});

test('no observations are unavailable rather than an instant response or resolution', async () => {
  await mount();
  expect(card('Avg Response').getByText('—')).toBeInTheDocument(); expect(card('Avg Resolution').getByText('—')).toBeInTheDocument();
  expect(card('Avg Response').getByText('No response measurements')).toBeInTheDocument();
  expect(card('Avg Resolution').getByText('No resolution measurements')).toBeInTheDocument();
  expect(screen.queryAllByText('0h')).toHaveLength(0);
});

test('a genuine measured zero remains zero hours', async () => {
  metrics.first_response_sample_count = 1; metrics.resolution_sample_count = 1; await mount();
  expect(card('Avg Response').getByText('0h')).toBeInTheDocument(); expect(card('Avg Resolution').getByText('0h')).toBeInTheDocument();
  expect(screen.queryByText('—')).not.toBeInTheDocument();
});

test('singular sample labels disclose one measurement', async () => {
  metrics.first_response_sample_count = 1; metrics.resolution_sample_count = 1; await mount();
  expect(card('Avg Response').getByText('1 response measurement')).toBeInTheDocument();
  expect(card('Avg Resolution').getByText('1 resolution measurement')).toBeInTheDocument();
});

test('positive averages disclose independent sample sizes', async () => {
  metrics = { ...metrics, first_response_sample_count: 3, resolution_sample_count: 2, avg_first_response_hours: 1.5, avg_resolution_hours: 4 };
  await mount(); expect(card('Avg Response').getByText('1.5h')).toBeInTheDocument();
  expect(card('Avg Response').getByText('3 response measurements')).toBeInTheDocument();
  expect(card('Avg Resolution').getByText('4h')).toBeInTheDocument();
  expect(card('Avg Resolution').getByText('2 resolution measurements')).toBeInTheDocument();
});

test('response data can be absent while resolution data is present', async () => {
  metrics.resolution_sample_count = 2; metrics.avg_resolution_hours = 3.5; await mount();
  expect(card('Avg Response').getByText('—')).toBeInTheDocument(); expect(card('Avg Resolution').getByText('3.5h')).toBeInTheDocument();
});

test('resolution data can be absent while response data is present', async () => {
  metrics.first_response_sample_count = 2; metrics.avg_first_response_hours = 2.5; await mount();
  expect(card('Avg Response').getByText('2.5h')).toBeInTheDocument(); expect(card('Avg Resolution').getByText('—')).toBeInTheDocument();
});

test('older backend responses retain their numeric display without an invented sample count', async () => {
  delete metrics.first_response_sample_count; delete metrics.resolution_sample_count; metrics.avg_first_response_hours = 1.25;
  await mount(); expect(card('Avg Response').getByText('1.25h')).toBeInTheDocument();
  expect(card('Avg Resolution').getByText('0h')).toBeInTheDocument();
  expect(screen.queryByText(/No response measurements|No resolution measurements/)).not.toBeInTheDocument();
});

test('refresh transitions from measurements to absent observations and back', async () => {
  metrics.first_response_sample_count = 2; metrics.avg_first_response_hours = 1.5; await mount();
  metrics.first_response_sample_count = 0; metrics.avg_first_response_hours = 0;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true })); await screen.findByText('No response measurements');
  expect(card('Avg Response').queryByText('1.5h')).not.toBeInTheDocument();
  metrics.first_response_sample_count = 1; metrics.avg_first_response_hours = 0;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true })); await screen.findByText('1 response measurement');
  expect(card('Avg Response').getByText('0h')).toBeInTheDocument();
});

test('a failed metrics read cannot be presented as a zero-sample success', async () => {
  await mount(); apiClient.get.mockImplementation(url => url.includes('/metrics?')
    ? Promise.reject(new Error('Fictional metrics failure')) : Promise.resolve({ data: { tickets: [], total: 0, limit: 50, offset: 0 } }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load support metrics');
  expect(screen.queryByText('No response measurements')).not.toBeInTheDocument(); expect(screen.queryByText('Avg Response')).not.toBeInTheDocument();
});

test('late zero-sample data cannot replace newer measured data', async () => {
  await mount(); let finishOld;
  const old = new Promise(resolve => { finishOld = resolve; });
  apiClient.get.mockImplementationOnce(() => Promise.resolve({ data: { tickets: [], total: 0 } }))
    .mockImplementationOnce(() => old);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
  metrics.first_response_sample_count = 1; metrics.avg_first_response_hours = 2.75;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true })); await screen.findByText('2.75h');
  await act(async () => finishOld({ data: { ...metrics, first_response_sample_count: 0, avg_first_response_hours: 0 } }));
  expect(card('Avg Response').getByText('2.75h')).toBeInTheDocument();
});
