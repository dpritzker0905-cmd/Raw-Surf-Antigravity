import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import PurchaseRequestsPanel from './PurchaseRequestsPanel';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockSuccess = jest.fn();
const mockError = jest.fn();
let mockTheme = 'light';
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'fictional-parent' } }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: {
  get: (...args) => mockGet(...args), post: (...args) => mockPost(...args),
} }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../../utils/media', () => ({ getFullUrl: () => null }));
jest.mock('sonner', () => ({ toast: {
  success: (...args) => mockSuccess(...args), error: (...args) => mockError(...args),
} }));

const requests = [
  { id: 'fictional-alpha', grom_name: 'Fictional Alex', item_name: 'Coastal photo', item_type: 'gallery_photo', amount: 4, status: 'pending' },
  { id: 'fictional-beta', grom_name: 'Fictional Bea', item_name: 'Beach photo', item_type: 'gallery_photo', amount: 6, status: 'pending' },
];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const row = id => screen.getByTestId(`purchase-request-fictional-${id}`);
const approve = id => screen.getByTestId(`approve-request-fictional-${id}`);
const openDeny = id => fireEvent.click(screen.getByTestId(`deny-request-fictional-${id}`));
const reason = id => within(row(id)).getByRole('textbox');
const confirm = id => within(row(id)).getByRole('button', { name: /^(Loader2|Confirm Deny .+)$/ });
const complete = async pending => { await act(async () => { pending.resolve({ data: { message: 'Fictional decision saved' } }); }); };
const start = async () => {
  mockGet.mockResolvedValue({ data: { requests, pending_count: 2 } });
  render(<PurchaseRequestsPanel />);
  await screen.findByText('Coastal photo');
};
beforeEach(() => { mockGet.mockReset(); mockPost.mockReset(); mockSuccess.mockReset(); mockError.mockReset(); mockTheme = 'light'; });

test('decision controls name the action, item and child rather than icons', async () => {
  await start();
  expect(screen.getByRole('button', { name: 'Approve Coastal photo for Fictional Alex' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Deny Beach photo for Fictional Bea' })).toBeEnabled();
  openDeny('beta');
  expect(screen.getByRole('textbox', { name: 'Reason (optional) for denying Beach photo for Fictional Bea' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm Deny Beach photo for Fictional Bea' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Cancel denial of Beach photo for Fictional Bea' })).toBeEnabled();
});

test('two approve clicks in one batch dispatch only one decision', async () => {
  const pending = deferred(); mockPost.mockReturnValue(pending.promise); await start();
  try {
    const button = approve('alpha');
    act(() => { button.click(); button.click(); });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/grom-hq/purchase-requests/fictional-alpha/approve?parent_id=fictional-parent');
  } finally { await complete(pending); }
});

test('two confirm-deny clicks in one batch dispatch only one decision', async () => {
  const pending = deferred(); mockPost.mockReturnValue(pending.promise); await start(); openDeny('alpha');
  fireEvent.change(reason('alpha'), { target: { value: 'Fictional reason' } });
  try {
    const button = confirm('alpha'); act(() => { button.click(); button.click(); });
    expect(mockPost).toHaveBeenCalledTimes(1);
  } finally { await complete(pending); }
});

test('two independent requests remain locked while both decisions are pending', async () => {
  const alpha = deferred(), beta = deferred(); mockPost.mockReturnValueOnce(alpha.promise).mockReturnValueOnce(beta.promise); await start();
  try {
    fireEvent.click(approve('alpha')); fireEvent.click(approve('beta'));
    expect(approve('alpha')).toBeDisabled(); expect(approve('beta')).toBeDisabled();
    expect(screen.getByTestId('deny-request-fictional-alpha')).toBeDisabled();
    expect(screen.getByTestId('deny-request-fictional-beta')).toBeDisabled();
  } finally { await complete(alpha); await complete(beta); }
});

test('one successful completion cannot unlock a different pending request', async () => {
  const alpha = deferred(), beta = deferred(); mockPost.mockReturnValueOnce(alpha.promise).mockReturnValueOnce(beta.promise); await start();
  fireEvent.click(approve('alpha')); fireEvent.click(approve('beta')); await complete(alpha);
  try {
    expect(screen.queryByTestId('purchase-request-fictional-alpha')).not.toBeInTheDocument();
    expect(approve('beta')).toBeDisabled(); expect(screen.getByText('1 PENDING')).toBeInTheDocument();
    fireEvent.click(approve('beta')); expect(mockPost).toHaveBeenCalledTimes(2);
  } finally { await complete(beta); }
});

test('a failed decision unlocks only that request and can retry while another stays pending', async () => {
  const alpha = deferred(), beta = deferred(), retry = deferred();
  mockPost.mockReturnValueOnce(alpha.promise).mockReturnValueOnce(beta.promise).mockReturnValueOnce(retry.promise); await start();
  fireEvent.click(approve('alpha')); fireEvent.click(approve('beta'));
  await act(async () => { alpha.reject({ response: { data: { detail: 'Fictional retry needed' } } }); });
  try {
    expect(mockError).toHaveBeenCalledWith('Fictional retry needed');
    expect(approve('alpha')).toBeEnabled(); expect(approve('beta')).toBeDisabled();
    fireEvent.click(approve('alpha')); expect(mockPost).toHaveBeenCalledTimes(3);
    expect(mockPost.mock.calls[2]).toEqual(['/grom-hq/purchase-requests/fictional-alpha/approve?parent_id=fictional-parent']);
    expect(approve('alpha')).toBeDisabled(); expect(approve('beta')).toBeDisabled();
  } finally { await complete(beta); await complete(retry); }
});

test('one denial completion preserves another open denial editor and its draft', async () => {
  const alpha = deferred(); mockPost.mockReturnValue(alpha.promise); await start();
  openDeny('alpha'); fireEvent.change(reason('alpha'), { target: { value: 'Alex reason' } }); fireEvent.click(confirm('alpha'));
  openDeny('beta'); fireEvent.change(reason('beta'), { target: { value: 'Bea reason' } }); await complete(alpha);
  expect(reason('beta')).toHaveValue('Bea reason'); expect(confirm('beta')).toBeEnabled();
  expect(mockPost).toHaveBeenCalledTimes(1);
});

test('another row cancel cannot discard a failed pending denial draft', async () => {
  const alpha = deferred(); mockPost.mockReturnValue(alpha.promise); await start();
  openDeny('alpha'); fireEvent.change(reason('alpha'), { target: { value: 'Alex retained reason' } }); fireEvent.click(confirm('alpha'));
  openDeny('beta'); fireEvent.change(reason('beta'), { target: { value: 'Bea canceled reason' } });
  fireEvent.click(within(row('beta')).getByText('Cancel'));
  await act(async () => { alpha.reject(new Error('fictional offline')); });
  openDeny('alpha'); expect(reason('alpha')).toHaveValue('Alex retained reason');
  expect(mockPost).toHaveBeenCalledTimes(1);
});

test('concurrent denial requests retain their own existing encoded reason contract', async () => {
  const alpha = deferred(), beta = deferred(); mockPost.mockReturnValueOnce(alpha.promise).mockReturnValueOnce(beta.promise); await start();
  openDeny('alpha'); fireEvent.change(reason('alpha'), { target: { value: 'Alex & reason?' } }); fireEvent.click(confirm('alpha'));
  openDeny('beta'); fireEvent.change(reason('beta'), { target: { value: 'Bea / reason' } }); fireEvent.click(confirm('beta'));
  try {
    expect(mockPost.mock.calls).toEqual([
      ['/grom-hq/purchase-requests/fictional-alpha/deny?parent_id=fictional-parent&reason=Alex%20%26%20reason%3F'],
      ['/grom-hq/purchase-requests/fictional-beta/deny?parent_id=fictional-parent&reason=Bea%20%2F%20reason'],
    ]);
    await complete(alpha); expect(confirm('beta')).toBeDisabled(); expect(reason('beta')).toHaveValue('Bea / reason');
  } finally { await complete(beta); }
});

test('a pending denial disables its editor and cancel control', async () => {
  const alpha = deferred(); mockPost.mockReturnValue(alpha.promise); await start(); openDeny('alpha'); fireEvent.click(confirm('alpha'));
  try {
    expect(confirm('alpha')).toBeDisabled(); expect(reason('alpha')).toBeDisabled();
    expect(within(row('alpha')).getByText('Cancel')).toBeDisabled();
  } finally { await complete(alpha); }
});

test('one successful approval removes only its row and decrements the count once', async () => {
  const alpha = deferred(); mockPost.mockReturnValue(alpha.promise); await start(); fireEvent.click(approve('alpha')); await complete(alpha);
  expect(screen.queryByTestId('purchase-request-fictional-alpha')).not.toBeInTheDocument();
  expect(row('beta')).toBeInTheDocument(); expect(screen.getByText('1 PENDING')).toBeInTheDocument();
  expect(mockSuccess).toHaveBeenCalledWith('Fictional decision saved'); expect(mockPost).toHaveBeenCalledTimes(1);
});

test.each(['light', 'dark', 'beach'])('%s failure preserves the request and permits the same denial retry', async theme => {
  mockTheme = theme; const retry = deferred(); mockPost.mockRejectedValueOnce(new Error('fictional offline')).mockReturnValueOnce(retry.promise);
  await start(); openDeny('alpha'); fireEvent.change(reason('alpha'), { target: { value: 'Fictional & reason' } }); fireEvent.click(confirm('alpha'));
  await screen.findByText('Confirm Deny');
  expect(reason('alpha')).toHaveValue('Fictional & reason'); expect(confirm('alpha')).toBeEnabled();
  expect(screen.getByText('2 PENDING')).toBeInTheDocument();
  fireEvent.click(confirm('alpha')); expect(mockPost.mock.calls[1]).toEqual([
    '/grom-hq/purchase-requests/fictional-alpha/deny?parent_id=fictional-parent&reason=Fictional%20%26%20reason',
  ]);
  await complete(retry); expect(row('beta')).toBeInTheDocument();
});
