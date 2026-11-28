import React, { useEffect, useRef, useState } from 'react';
import apiClient from '../../lib/apiClient';

const usd = (cents) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const outcomes = { '': 'Keep reserved', no_service: 'No service for this seat', buyer_cancelled: 'Buyer cancelled',
  no_show: 'Verified no-show', partial: 'Partial delivery', delivered: 'Fully delivered', disputed: 'Disputed' };
const unitActions = { none: 'No included session recorded', keep_reserved: 'Keep one session reserved',
  consume_one: 'Use one session', restore_one: 'Restore one session', replacement_review: 'Review a replacement session' };

function SeatInputs({ seat, unit, draft, update }) {
  const field = (label, key, numeric = false, max) => <label className="block">{label}
    <input aria-label={label} className="block rounded border p-1" type={numeric ? 'number' : 'text'} min={numeric ? 0 : undefined}
      max={max} step={numeric ? 1 : undefined} value={draft[key] ?? ''}
      onChange={(e) => update({ ...draft, [key]: e.target.value })} /></label>;
  return <fieldset className="space-y-2 rounded border p-3">
    <legend>{seat.role === 'captain' ? 'Captain' : 'Guest'} {seat.seat} · {usd(seat.collected_cents)} collected</legend>
    <label>Seat outcome <select aria-label="Seat outcome" value={draft.outcome || ''} onChange={(e) => update({ outcome: e.target.value })}>
      {Object.entries(outcomes).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select></label>
    {draft.outcome && draft.outcome !== 'disputed' && <>
      {field('Case evidence reference', 'evidence')}
      {draft.outcome === 'partial' && field('Agreed earnings (cents)', 'earned_cents', true, seat.collected_cents)}
      {['buyer_cancelled', 'no_show'].includes(draft.outcome) && <>
        {field('Accepted fee (%)', 'accepted_fee_percent', true, 100)}
        {field('Accepted maximum fee (cents)', 'accepted_fee_cap_cents', true)}
        {field('Payer’s accepted terms reference', 'fee_terms_reference')}
      </>}
      {unit && draft.outcome === 'partial' && field('Subscriber consent to use a whole session (if given)', 'partial_unit_consent')}
      {seat.method === 'card' && seat.role !== 'captain' && field('Payer consent to wallet credit (if verified)', 'card_wallet_consent')}
    </>}
  </fieldset>;
}

function assumptions(drafts) {
  return Object.entries(drafts).filter(([, value]) => value.outcome).map(([seat, value]) => {
    const input = { seat };
    for (const [key, val] of Object.entries(value)) {
      if (val !== '') input[key] = key.endsWith('_cents') || key === 'accepted_fee_percent' ? Number(val) : val;
    }
    return input;
  });
}

export default function QuickBookSettlementPreview() {
  const [id, setId] = useState('');
  const [basis, setBasis] = useState(null);
  const [result, setResult] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);

  const invalidate = () => {
    generation.current += 1;
    setBusy(false);
    setError('');
    setResult(null);
  };
  const calculate = async (event) => {
    event.preventDefault();
    invalidate();
    const current = generation.current;
    setBusy(true);
    try {
      const { data } = await apiClient.post('/admin/support/quick-books/' + encodeURIComponent(id.trim()) + '/settlement-preview',
        { seats: assumptions(drafts) });
      if (current === generation.current) { setBasis(data); setResult(data); }
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (current === generation.current && [401, 403, 404, 409].includes(err.response?.status)) {
        setBasis(null); setDrafts({});
      }
      if (current === generation.current) setError(typeof detail === 'string' ? detail :
        (Array.isArray(detail) ? detail.map((item) => item.msg).join(' ') : 'Unable to load this settlement preview.'));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  return <details className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">Shared Quick Book settlement preview</summary>
    <form onSubmit={calculate} className="mt-3 space-y-3">
      <label>Dispatch ID <input aria-label="Dispatch ID" required className="rounded border p-1" value={id} onChange={(e) => {
        invalidate(); setId(e.target.value); setBasis(null); setDrafts({});
      }} /></label>
      {basis && <p>Model each seat using the case evidence. An omitted outcome keeps its funds reserved. Enter a fee only when the payer accepted that rate and cap.</p>}
      {basis?.seats.map((seat) => <SeatInputs key={seat.seat} seat={seat}
        unit={basis.included_session.subscriber_id === seat.seat} draft={drafts[seat.seat] || {}}
        update={(value) => { invalidate(); setDrafts((prev) => ({ ...prev, [seat.seat]: value })); }} />)}
      <button disabled={!id.trim() || busy} className="rounded border px-3 py-1" type="submit">
        {busy ? 'Calculating…' : 'Calculate preview'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result && <section aria-label="Proposed settlement" aria-live="polite" className="mt-4 space-y-2">
      <p>Estimate as of {new Date(result.as_of).toLocaleString()}. No transfers are posted.</p>
      <p>Collected {usd(result.collected_cents)} · Returns {usd(result.refund_cents)} · Photographer gross {usd(result.photographer_gross_cents)} · Reserved {usd(result.reserved_cents)}</p>
      <p>Included session: {unitActions[result.included_session.action]}</p>
      <ul>{result.seats.map((s) => <li key={s.seat}>Seat {s.seat}: return {usd(s.refund_cents)},
        photographer {usd(s.photographer_gross_cents)}, reserved {usd(s.reserved_cents)}{s.reserve_reason && ' · ' + s.reserve_reason}</li>)}</ul>
      <ul>{result.funding.map((s) => <li key={s.source_id}>Payer {s.payer_id}: {usd(s.refund_cents)} to wallet,
        including {usd(s.promo_refund_cents)} promotional credit.</li>)}</ul>
      {result.separate_receipts.map((r) => <p key={r.receipt_id}>Receipt {r.receipt_id} for {usd(r.amount_cents)} from {r.payer_id} ({r.status}) requires separate review.</p>)}
    </section>}
  </details>;
}
