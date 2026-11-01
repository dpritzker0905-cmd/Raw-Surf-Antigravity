import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import GromLimitedFeed from './GromLimitedFeed';

const mockPreviewGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'fictional-child' } }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: {
  get: path => path.startsWith('/posts/grom-preview') ? mockPreviewGet(path) : Promise.resolve({ data: { incoming: [] } }),
  post: (...args) => mockPost(...args),
} }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../utils/media', () => ({ getFullUrl: value => value }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('./grom/AskMyParentPanel', () => () => <button type="button">Get a code</button>);

const result = (...names) => ({ data: names.map(name => ({ id: name, author_name: name, likes_count: 0, comments_count: 0 })) });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
beforeEach(() => { mockPreviewGet.mockReset(); mockPost.mockReset(); });

test('failed preview read is unavailable rather than a confirmed empty community or invented count', async () => {
  mockPreviewGet.mockRejectedValue(new Error('offline')); render(<GromLimitedFeed />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Community preview could not be loaded');
  expect(screen.queryByText('No Grom Posts Yet')).not.toBeInTheDocument();
  expect(screen.queryByText(/^[0-9]+ POSTS?$/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Get a code' })).toBeEnabled();
  expect(screen.getByText('Features locked until parent approval:')).toBeInTheDocument();
  expect(mockPost).not.toHaveBeenCalled();
});

test('retry restores actual preview posts/count without changing parent-link controls or writing', async () => {
  mockPreviewGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(result('Recovered A', 'Recovered B'));
  render(<GromLimitedFeed />); fireEvent.click(await screen.findByRole('button', { name: 'Retry community preview' }));
  await screen.findByText('Recovered A'); expect(screen.getByText('Recovered B')).toBeInTheDocument();
  expect(screen.getByText('2 POSTS')).toBeInTheDocument();
  expect(mockPreviewGet.mock.calls).toEqual([['/posts/grom-preview?limit=3'], ['/posts/grom-preview?limit=3']]);
  expect(screen.getByRole('button', { name: 'Get a code' })).toBeEnabled(); expect(mockPost).not.toHaveBeenCalled();
});

test('successful empty retry may show the real empty community and zero count', async () => {
  mockPreviewGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(result());
  render(<GromLimitedFeed />); fireEvent.click(await screen.findByRole('button', { name: 'Retry community preview' }));
  await screen.findByText('No Grom Posts Yet'); expect(screen.getByText('0 POSTS')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(mockPost).not.toHaveBeenCalled();
});

test('pending initial read announces loading without an invented post count', async () => {
  const read = deferred(); mockPreviewGet.mockReturnValue(read.promise); render(<GromLimitedFeed />);
  expect(screen.getByRole('status', { name: 'Loading community preview' })).toBeInTheDocument();
  expect(screen.queryByText(/^[0-9]+ POSTS?$/)).not.toBeInTheDocument();
  await act(async () => { read.resolve(result('Current A')); }); await screen.findByText('Current A');
});

test('pending retry hides retry and empty text until a result arrives', async () => {
  const read = deferred(); mockPreviewGet.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(read.promise);
  render(<GromLimitedFeed />); fireEvent.click(await screen.findByRole('button', { name: 'Retry community preview' }));
  expect(screen.getByRole('status', { name: 'Loading community preview' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry community preview' })).not.toBeInTheDocument();
  expect(screen.queryByText('No Grom Posts Yet')).not.toBeInTheDocument();
  await act(async () => { read.resolve(result('Recovered A')); }); await screen.findByText('Recovered A');
});

test('repeated failure retains accessible GET-only retry', async () => {
  mockPreviewGet.mockRejectedValue(new Error('offline')); render(<GromLimitedFeed />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry community preview' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Community preview could not be loaded');
  expect(mockPreviewGet).toHaveBeenCalledTimes(2); expect(mockPost).not.toHaveBeenCalled();
});

test('obsolete effect success cannot overwrite current preview posts or count', async () => {
  const old = deferred(); mockPreviewGet.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result('Current A', 'Current B'));
  render(<React.StrictMode><GromLimitedFeed /></React.StrictMode>); await screen.findByText('Current A');
  await act(async () => { old.resolve(result('Obsolete A')); });
  expect(screen.getByText('Current A')).toBeInTheDocument(); expect(screen.getByText('2 POSTS')).toBeInTheDocument();
  expect(screen.queryByText('Obsolete A')).not.toBeInTheDocument();
});

test('obsolete effect failure cannot clear current preview posts', async () => {
  const old = deferred(); mockPreviewGet.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result('Current A'));
  render(<React.StrictMode><GromLimitedFeed /></React.StrictMode>); await screen.findByText('Current A');
  await act(async () => { old.reject(new Error('obsolete offline')); });
  expect(screen.getByText('Current A')).toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('obsolete completion cannot dismiss a current pending read', async () => {
  const old = deferred(), current = deferred(); mockPreviewGet.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  render(<React.StrictMode><GromLimitedFeed /></React.StrictMode>);
  await act(async () => { old.resolve(result('Obsolete A')); });
  expect(screen.getByRole('status', { name: 'Loading community preview' })).toBeInTheDocument();
  expect(screen.queryByText('Obsolete A')).not.toBeInTheDocument();
  await act(async () => { current.resolve(result('Current A')); }); await screen.findByText('Current A');
});

test.each([0, 1, 2, 3])('successful %i-post response uses its real count and singular/plural label', async count => {
  const names = Array.from({ length: count }, (_, index) => `Fictional ${index}`);
  mockPreviewGet.mockResolvedValue(result(...names)); render(<GromLimitedFeed />);
  if (count) await screen.findByText(names[0]);
  else await screen.findByText('No Grom Posts Yet');
  expect(await screen.findByText(`${count} ${count === 1 ? 'POST' : 'POSTS'}`)).toBeInTheDocument();
  if (count) for (const name of names) expect(screen.getByText(name)).toBeInTheDocument();
  else expect(screen.getByText('No Grom Posts Yet')).toBeInTheDocument();
  expect(mockPost).not.toHaveBeenCalled();
});
