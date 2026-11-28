import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import apiClient from '../../lib/apiClient';
import QuickBookSettlementPreview from './QuickBookSettlementPreview';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { post: jest.fn() } }));
const result = {
  seats: [{ seat: 'guest-a', role: 'guest', method: 'card', confirmed_after_cancellation: true, collected_cents: 3500, reserved_cents: 3500,
    refund_cents: 0, photographer_gross_cents: 0 }], funding: [
    { source_id: 'original-card', payer_id: 'guest-a', method: 'card', refund_cents: 0, promo_refund_cents: 0 }
  ], included_session: { action: 'none' },
  collected_cents: 3500, refund_cents: 0, photographer_gross_cents: 0, reserved_cents: 3500,
  as_of: '2026-11-28T17:00:00Z', separate_receipts: []
};
beforeEach(() => { jest.clearAllMocks(); });
function open() {
  render(<QuickBookSettlementPreview />);
  fireEvent.click(screen.getByText('Shared Quick Book settlement preview'));
  fireEvent.change(screen.getByLabelText('Dispatch ID'), { target: { value: 'first' } });
  fireEvent.click(screen.getByRole('button', { name: 'Calculate preview' }));
}
test('edited seat choices invalidate the old totals and send only simulation inputs', async () => {
  apiClient.post.mockResolvedValue({ data: result });
  open();
  const output = await screen.findByRole('region', { name: 'Proposed settlement' });
  expect(within(output).getByText(/No transfers are posted/)).toBeInTheDocument();
  expect(within(output).getByText(/No wallet refund proposed/)).toBeInTheDocument();
  expect(within(output).getByText(/Card payment confirmed after cancellation/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Seat outcome'), { target: { value: 'partial' } });
  expect(screen.queryByRole('region', { name: 'Proposed settlement' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Case evidence reference'), { target: { value: 'case-1' } });
  fireEvent.change(screen.getByLabelText('Agreed earnings (cents)'), { target: { value: '2000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Calculate preview' }));
  await screen.findByRole('region', { name: 'Proposed settlement' });
  expect(apiClient.post).toHaveBeenLastCalledWith('/admin/support/quick-books/first/settlement-preview',
    { seats: [{ seat: 'guest-a', outcome: 'partial', evidence: 'case-1', earned_cents: 2000 }] });
});
test('an older request cannot display funds for a different dispatch', async () => {
  let finish;
  apiClient.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  open();
  fireEvent.change(screen.getByLabelText('Dispatch ID'), { target: { value: 'second' } });
  await act(async () => { finish({ data: result }); });
  expect(screen.queryByRole('region', { name: 'Proposed settlement' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Seat outcome')).not.toBeInTheDocument();
});
