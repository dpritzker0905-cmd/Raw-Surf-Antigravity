import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import apiClient from '../../lib/apiClient';
import { toast } from 'sonner';
import { AdminSupportDashboard } from './AdminSupportDashboard';

jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'fictional-admin' } }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }));
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
let rows;
const listCalls = () => apiClient.get.mock.calls.filter(([url]) => url.includes('/tickets?')).map(([url]) => Object.fromEntries(new URL(url, 'http://fixture.invalid').searchParams));
const editor = () => screen.getByRole('textbox', { name: 'Type your reply...' });
const mount = async () => { render(<AdminSupportDashboard />); await screen.findByText('Open request'); };
const open = async (subject, number) => { fireEvent.click(screen.getByText(subject)); await screen.findByText(`Ticket: ${number}`); };
const choose = async (label, value) => {
  const user = userEvent.setup(); await user.click(screen.getByRole('combobox', { name: label, exact: true }));
  await user.click(screen.getByRole('option', { name: value, exact: true }));
};
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.PointerEvent = MouseEvent;
});
beforeEach(() => {
  jest.clearAllMocks();
  rows = [{ id: 'A', ticket_number: 'TEST-A', subject: 'Open request', status: 'open' },
    ...Array.from({ length: 63 }, (_, index) => ({ id: `I${index + 1}`, ticket_number: `TEST-I${index + 1}`,
      subject: `Internal request ${index + 1}`, status: 'waiting_internal' })),
    { id: 'C', ticket_number: 'TEST-C', subject: 'Closed request', status: 'closed' }]
    .map(row => ({ ...row, priority: 'medium', description: 'Fictional ticket', category: 'other', messages: [] }));
  apiClient.get.mockImplementation(url => {
    if (url.includes('/metrics?')) return Promise.resolve({ data: null });
    if (url.includes('/tickets?')) {
      const query = new URL(url, 'http://fixture.invalid').searchParams;
      const filtered = query.get('status') ? rows.filter(row => row.status === query.get('status')) : rows;
      const offset = Number(query.get('offset') || 0), limit = Number(query.get('limit') || 50);
      return Promise.resolve({ data: { tickets: filtered.slice(offset, offset + limit).map(row => ({ ...row })), total: filtered.length, offset, limit } });
    }
    return Promise.resolve({ data: { ...rows.find(row => row.id === url.split('/').pop()) } });
  });
  apiClient.put.mockImplementation(async (url, body) => {
    Object.assign(rows.find(row => row.id === url.split('/').pop()), body); return { data: { success: true } };
  });
});

test('an existing waiting-internal ticket has a visible selected status', async () => {
  await mount(); await open('Internal request 1', 'TEST-I1');
  expect(screen.getByRole('combobox', { name: 'Ticket status', exact: true })).toHaveTextContent('Waiting Internal');
});

test('Waiting Internal filtering is query-bound and paginated', async () => {
  await mount(); await choose('Filter ticket status', 'Waiting Internal');
  await screen.findByText('Showing 1–50 of 63 tickets');
  expect(screen.queryByText('Open request')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next ticket page' })); await screen.findByText('Showing 51–63 of 63 tickets');
  expect(listCalls().at(-1)).toMatchObject({ status: 'waiting_internal', offset: '50' });
  expect(screen.getByText('Internal request 63')).toBeInTheDocument();
});

test('assigning Waiting Internal preserves the selected ticket draft and note mode', async () => {
  await mount(); await open('Open request', 'TEST-A');
  fireEvent.change(editor(), { target: { value: 'Keep A draft' } }); fireEvent.click(screen.getByRole('checkbox', { name: 'Internal note' }));
  await choose('Ticket status', 'Waiting Internal'); await screen.findByText('Ticket: TEST-A');
  expect(apiClient.put).toHaveBeenCalledWith('/admin/support/tickets/A', { status: 'waiting_internal' });
  expect(screen.getByRole('combobox', { name: 'Ticket status', exact: true })).toHaveTextContent('Waiting Internal');
  expect(editor()).toHaveValue('Keep A draft'); expect(screen.getByRole('checkbox', { name: 'Internal note' })).toBeChecked();
  expect(apiClient.post).not.toHaveBeenCalled();
});

test('an existing internal ticket can still return to Open', async () => {
  await mount(); await open('Internal request 1', 'TEST-I1'); await choose('Ticket status', 'Open');
  await screen.findByText('Ticket: TEST-I1');
  expect(screen.getByRole('combobox', { name: 'Ticket status', exact: true })).toHaveTextContent('Open');
  expect(apiClient.put).toHaveBeenCalledWith('/admin/support/tickets/I1', { status: 'open' });
});

test('leaving the internal filter updates its total without losing detail or draft', async () => {
  await mount(); await choose('Filter ticket status', 'Waiting Internal'); await screen.findByText('Showing 1–50 of 63 tickets');
  await open('Internal request 1', 'TEST-I1'); fireEvent.change(editor(), { target: { value: 'Internal draft stays' } });
  await choose('Ticket status', 'Open'); await screen.findByText('Showing 1–50 of 62 tickets');
  expect(screen.getByText('Ticket: TEST-I1')).toBeInTheDocument(); expect(editor()).toHaveValue('Internal draft stays');
  expect(screen.queryByRole('button', { name: /TEST-I1 medium/ })).not.toBeInTheDocument();
});

test('failed internal-status update retains the old status and draft', async () => {
  await mount(); await open('Open request', 'TEST-A'); fireEvent.change(editor(), { target: { value: 'Retry A status later' } });
  apiClient.put.mockRejectedValueOnce(new Error('Fictional update failure')); await choose('Ticket status', 'Waiting Internal');
  expect(toast.error).toHaveBeenCalledWith('Failed to update ticket');
  expect(screen.getByRole('combobox', { name: 'Ticket status', exact: true })).toHaveTextContent('Open');
  expect(editor()).toHaveValue('Retry A status later');
});

test('Closed and All filters retain the previously repaired behavior', async () => {
  await mount(); await choose('Filter ticket status', 'Closed'); await screen.findByText('Showing 1–1 of 1 tickets');
  expect(screen.getByText('Closed request')).toBeInTheDocument();
  await choose('Filter ticket status', 'All Status'); await screen.findByText('Showing 1–50 of 65 tickets');
  expect(listCalls().at(-1).status).toBeUndefined();
});

test('both controls expose all six existing backend statuses', async () => {
  await mount(); const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Filter ticket status', exact: true }));
  for (const name of ['Open', 'In Progress', 'Waiting User', 'Waiting Internal', 'Resolved', 'Closed']) {
    expect(screen.getByRole('option', { name, exact: true })).toBeInTheDocument();
  }
  await user.keyboard('{Escape}'); await open('Open request', 'TEST-A');
  await user.click(screen.getByRole('combobox', { name: 'Ticket status', exact: true }));
  expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(6);
});
