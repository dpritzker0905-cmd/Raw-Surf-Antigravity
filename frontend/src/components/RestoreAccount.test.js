/** The restore page the deletion email links to: it sends the link's token once and reports the result in words. */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The repo's Jest cannot resolve react-router-dom v7's exports map; the other route tests use this same mapping.
jest.mock('react-router-dom', () => jest.requireActual('react-router'), { virtual: true });

import apiClient from '../lib/apiClient';
import RestoreAccount from './RestoreAccount';

let requested;
let respond;
beforeEach(() => {
  requested = [];
  respond = (config) => Promise.resolve({ data: { message: 'Your account is restored. Sign in with your password.' },
    status: 200, statusText: 'OK', headers: {}, config });
  apiClient.defaults.adapter = (config) => {
    requested.push({ url: `${config.baseURL}${config.url}`, body: JSON.parse(config.data || '{}') });
    return respond(config);
  };
});

const open = (search) => render(<MemoryRouter initialEntries={[`/restore-account${search}`]}><RestoreAccount /></MemoryRouter>);

it('posts the token from the link and says the account is restored', async () => {
  open('?token=abc123-restore-token');
  fireEvent.click(screen.getByRole('button', { name: 'Restore my account' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Your account is restored');
  expect(requested).toHaveLength(1);
  expect(requested[0].url).toMatch(/\/api\/compliance\/restore-account$/);
  expect(requested[0].body).toEqual({ token: 'abc123-restore-token' });
  expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/auth');
});

it('says so when the link has expired', async () => {
  respond = (config) => Promise.reject(Object.assign(new Error('400'), {
    config, response: { status: 400, data: { detail: 'This restore link is not valid or has expired.' } },
  }));
  open('?token=old-token-value');
  fireEvent.click(screen.getByRole('button', { name: 'Restore my account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('not valid or has expired');
});

it('refuses a link without a token', () => {
  open('');
  expect(screen.getByRole('alert')).toHaveTextContent('missing its restore code');
  expect(screen.queryByRole('button', { name: 'Restore my account' })).toBeNull();
});
