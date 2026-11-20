import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { UsernameCard } from './UsernameCard';
import apiClient from '../../lib/apiClient';
import { toast } from 'sonner';

// CRA/Jest27 cannot resolve react-router-dom7's missing legacy main file.
// Use the actual router implementation, without mocking navigation or the component.
jest.mock('react-router-dom', () => {
  global.TextEncoder = require('util').TextEncoder;
  global.TextDecoder = require('util').TextDecoder;
  return jest.requireActual('react-router');
}, { virtual: true });
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: {
  get: jest.fn(), put: jest.fn(), post: jest.fn(),
} }), { virtual: true });
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }), { virtual: true });
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const original = { username: 'audit_user', has_username: true, can_change: true };
let status;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const LocationReceipt = () => <output data-testid="location">{useLocation().pathname}</output>;
const mount = async (theme = 'light') => {
  document.documentElement.dataset.theme = theme;
  render(<MemoryRouter initialEntries={['/settings']}>
    <UsernameCard userId="synthetic-owner" textSecondaryClass="text-muted-foreground"
      borderClass="border-border" cardBgClass="bg-card border-border" />
    <LocationReceipt />
  </MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Change Username' }));
  return screen.getByText('Save', { selector: 'button' });
};

beforeEach(() => {
  jest.clearAllMocks(); status = { ...original };
  apiClient.get.mockImplementation(url => Promise.resolve({ data: url === '/username/status'
    ? { ...status } : { available: true } }));
  apiClient.put.mockResolvedValue({ data: {} });
  apiClient.post.mockResolvedValue({ data: {} });
});
afterEach(() => { delete document.documentElement.dataset.theme; });

test.each(['light', 'dark', 'beach'])('Save exposes its purpose with actual UI primitives in %s', async theme => {
  const save = await mount(theme);
  expect(save).toHaveTextContent(/^Save$/);
  expect(save).toBeEnabled();
  expect(save).toHaveAccessibleName('Save username');
  expect(screen.queryByRole('button', { name: 'Loader2' })).not.toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();
  expect(apiClient.post).not.toHaveBeenCalled();
});

test.each(['light', 'dark', 'beach'])('pending save retains its accessible purpose and blocks duplicate submission in %s', async theme => {
  const pending = deferred(); apiClient.put.mockReturnValueOnce(pending.promise);
  const save = await mount(theme);
  fireEvent.click(save);
  await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
  try {
    expect(apiClient.put).toHaveBeenCalledWith('/username/change', { new_username: 'audit_user' });
    expect(save).toBeDisabled();
    expect(save.querySelector('svg')).not.toBeNull();
    fireEvent.click(save);
    expect(apiClient.put).toHaveBeenCalledTimes(1);
    expect(save).toHaveTextContent(/^Save$/);
    expect(save).toHaveAccessibleName('Save username');
    expect(apiClient.post).not.toHaveBeenCalled();
  } finally {
    await act(async () => { pending.resolve({ data: {} }); });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument());
  }
});

test('unavailable changed username remains disabled without a mutation', async () => {
  apiClient.get.mockImplementation(url => Promise.resolve({ data: url === '/username/status'
    ? { ...status } : { available: false, reason: 'Already taken' } }));
  const save = await mount();
  fireEvent.change(screen.getByRole('textbox', { name: 'username' }), { target: { value: 'reserved' } });
  await screen.findByText('Already taken');
  expect(apiClient.get).toHaveBeenCalledWith('/username/check/reserved');
  expect(save).toBeDisabled();
  fireEvent.click(save);
  expect(apiClient.put).not.toHaveBeenCalled();
  expect(apiClient.post).not.toHaveBeenCalled();
});

test('keyboard activation saves the available normalized value with the unchanged contract', async () => {
  const user = userEvent.setup();
  apiClient.put.mockImplementation((url, body) => {
    status = { ...status, username: body.new_username };
    return Promise.resolve({ data: {} });
  });
  const save = await mount();
  const input = screen.getByRole('textbox', { name: 'username' });
  await user.clear(input);
  await user.type(input, 'Next_Surf');
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/username/check/next_surf'));
  await waitFor(() => expect(save).toBeEnabled());
  await user.tab();
  expect(save).toHaveFocus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/username/change', { new_username: 'next_surf' }));
  await screen.findByText('@next_surf');
  expect(toast.success).toHaveBeenCalledWith('Username updated to @next_surf');
  expect(screen.getByTestId('location')).toHaveTextContent('/settings');
  expect(apiClient.put).toHaveBeenCalledTimes(1);
  expect(apiClient.post).not.toHaveBeenCalled();
});

test('a rejected save keeps the editor, visible label and accessible purpose retryable', async () => {
  apiClient.put.mockRejectedValueOnce({ response: { data: { detail: 'Synthetic refusal' } } });
  const save = await mount();
  fireEvent.click(save);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Synthetic refusal'));
  await waitFor(() => expect(save).toBeEnabled());
  expect(screen.getByRole('textbox', { name: 'username' })).toHaveValue('audit_user');
  expect(apiClient.put).toHaveBeenCalledWith('/username/change', { new_username: 'audit_user' });
  expect(apiClient.put).toHaveBeenCalledTimes(1);
  expect(save).toHaveTextContent(/^Save$/);
  expect(save).toHaveAccessibleName('Save username');
});

test('Cancel preserves the existing username and sends no update', async () => {
  await mount();
  fireEvent.change(screen.getByRole('textbox', { name: 'username' }), { target: { value: 'unused_name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('textbox', { name: 'username' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Change Username' })).toBeEnabled();
  expect(screen.getByText('@audit_user')).toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();
  expect(apiClient.post).not.toHaveBeenCalled();
});
