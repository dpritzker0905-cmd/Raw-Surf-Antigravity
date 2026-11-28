import { useEffect, useState } from 'react';
import apiClient from '../lib/apiClient';

export const crewId = member => member.user_id || member.id || member.value;

export function sharedTerms(proId, duration, crew) {
  const equal = 100 / (crew.length + 1);
  return {
    target_photographer_id: proId, estimated_duration_hours: duration,
    friend_ids: crew.map(crewId),
    crew_shares: crew.map(member => {
      const share = { user_id: crewId(member) };
      if (member.covered_by_captain) share.covered_by_captain = true;
      else if (member.share_percentage != null) {
        if (Math.abs(member.share_percentage - equal) > 0.000001) share.share_percent = member.share_percentage;
      } else if (member.share_amount != null) share.share_amount = member.share_amount;
      return share;
    }),
  };
}

export function useSharedQuickBookQuote(active, buyerId, proId, duration, crew) {
  const body = active && buyerId && proId && crew.length ? JSON.stringify(sharedTerms(proId, duration, crew)) : null;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const key = JSON.stringify([buyerId, body, attempt]);
  useEffect(() => {
    if (!body) { setResult(null); return; }
    const controller = new AbortController();
    apiClient.post('/dispatch/shared-quote', JSON.parse(body), { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) setResult({ key, quote: data });
      })
      .catch(error => {
        const detail = error.response?.data?.detail;
        if (!controller.signal.aborted) setResult({ key, error: typeof detail === 'string' ? detail : 'Crew price unavailable.' });
      });
    return () => controller.abort();
  }, [body, key]);
  const current = result?.key === key ? result : null;
  return { quote: current?.quote, error: current?.error, refresh: () => setAttempt(n => n + 1) };
}
