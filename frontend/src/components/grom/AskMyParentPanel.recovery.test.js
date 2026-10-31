import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import AskMyParentPanel from './AskMyParentPanel';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: {
  get: (...args) => mockGet(...args), post: (...args) => mockPost(...args),
} }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const invites = name => ({ data: { incoming: [{ invite_id: name, from: { full_name: name } }] } });
const empty = { data: { incoming: [] } };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
beforeEach(() => { mockGet.mockReset(); mockPost.mockReset(); });

test('failed invitation read is announced while code creation remains independently available', async () => {
  mockGet.mockRejectedValue(new Error('offline')); render(<AskMyParentPanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Parent invitations could not be loaded');
  expect(screen.getByRole('button', { name: 'Retry parent invitations' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Get a code' })).toBeEnabled();
  expect(screen.queryByTestId('guardian-invites')).not.toBeInTheDocument();
  expect(mockPost).not.toHaveBeenCalled();
});

test('retry restores an invitation without accepting, declining, generating a code or linking', async () => {
  mockGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(invites('Fictional Parent'));
  const onLinked = jest.fn(); render(<AskMyParentPanel onLinked={onLinked} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry parent invitations' }));
  const list = await screen.findByTestId('guardian-invites');
  expect(within(list).getByText('Fictional Parent')).toBeInTheDocument();
  expect(within(list).getByRole('button', { name: 'Confirm' })).toBeEnabled();
  expect(within(list).getByRole('button', { name: 'Decline' })).toBeEnabled();
  expect(mockGet.mock.calls).toEqual([['/grom-hq/guardian-invites'], ['/grom-hq/guardian-invites']]);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(mockPost).not.toHaveBeenCalled(); expect(onLinked).not.toHaveBeenCalled();
});

test('successful empty retry clears the error and preserves the existing hidden-empty invitation section', async () => {
  mockGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(empty); render(<AskMyParentPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry parent invitations' }));
  await act(async () => {});
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('status', { name: 'Loading parent invitations' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('guardian-invites')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Get a code' })).toBeEnabled();
});

test('initial pending invitation read is announced without blocking the independent code control', async () => {
  const read = deferred(); mockGet.mockReturnValue(read.promise); render(<AskMyParentPanel />);
  expect(screen.getByRole('status', { name: 'Loading parent invitations' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Get a code' })).toBeEnabled();
  await act(async () => { read.resolve(empty); });
  expect(screen.queryByRole('status', { name: 'Loading parent invitations' })).not.toBeInTheDocument();
});

test('pending retry hides retry and invitation decisions until the read succeeds', async () => {
  const read = deferred(); mockGet.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(read.promise);
  render(<AskMyParentPanel />); fireEvent.click(await screen.findByRole('button', { name: 'Retry parent invitations' }));
  expect(screen.getByRole('status', { name: 'Loading parent invitations' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry parent invitations' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  await act(async () => { read.resolve(invites('Fictional Parent')); });
  await screen.findByText('Fictional Parent'); expect(mockPost).not.toHaveBeenCalled();
});

test('repeated invitation failures retain an accessible read-only retry', async () => {
  mockGet.mockRejectedValue(new Error('offline')); render(<AskMyParentPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry parent invitations' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Parent invitations could not be loaded');
  expect(mockGet).toHaveBeenCalledTimes(2); expect(mockPost).not.toHaveBeenCalled();
});

test('abandoned effect success cannot replace the current invitation result', async () => {
  const old = deferred(); mockGet.mockReturnValueOnce(old.promise).mockResolvedValueOnce(invites('Current Fictional Parent'));
  render(<React.StrictMode><AskMyParentPanel /></React.StrictMode>);
  await screen.findByText('Current Fictional Parent');
  await act(async () => { old.resolve(invites('Obsolete Fictional Parent')); });
  expect(screen.getByText('Current Fictional Parent')).toBeInTheDocument();
  expect(screen.queryByText('Obsolete Fictional Parent')).not.toBeInTheDocument();
});

test('abandoned effect failure leaves current invitations available', async () => {
  const old = deferred(); mockGet.mockReturnValueOnce(old.promise).mockResolvedValueOnce(invites('Current Fictional Parent'));
  render(<React.StrictMode><AskMyParentPanel /></React.StrictMode>);
  await screen.findByText('Current Fictional Parent'); await act(async () => { old.reject(new Error('obsolete offline')); });
  expect(screen.getByText('Current Fictional Parent')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('abandoned completion cannot dismiss the current loading state or show obsolete invitation actions', async () => {
  const old = deferred(), current = deferred(); mockGet.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  render(<React.StrictMode><AskMyParentPanel /></React.StrictMode>);
  await act(async () => { old.resolve(invites('Obsolete Fictional Parent')); });
  expect(screen.getByRole('status', { name: 'Loading parent invitations' })).toBeInTheDocument();
  expect(screen.queryByText('Obsolete Fictional Parent')).not.toBeInTheDocument();
  await act(async () => { current.resolve(invites('Current Fictional Parent')); });
  await screen.findByText('Current Fictional Parent'); expect(mockPost).not.toHaveBeenCalled();
});
