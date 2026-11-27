import { useLayoutEffect, useRef, useState } from 'react';
import apiClient from '../lib/apiClient';

// A drawer can unmount while the booking API is still committing a wallet debit.
const pendingCreates = new Set();

export async function createScheduledBooking(buyerId, path, payload) {
  const entry = { buyerId, request: apiClient.post(path, payload) };
  pendingCreates.add(entry);
  try {
    return await entry.request;
  } finally {
    pendingCreates.delete(entry);
  }
}

export default function useScheduledWalletBalance(isOpen, buyerId, photographerId) {
  const [balance, setBalance] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const activeRead = useRef(null);

  useLayoutEffect(() => {
    setBalance(null);
    setFailed(false);
    if (!isOpen || !buyerId) return;

    const controller = new AbortController();
    activeRead.current = controller;
    const { signal } = controller;
    async function readBalance() {
      try {
        const writes = Array.from(pendingCreates)
          .filter(entry => entry.buyerId === buyerId)
          .map(entry => entry.request);
        if (writes.length) await Promise.allSettled(writes);
        if (signal.aborted) return;
        const { data } = await apiClient.get(`/credits/balance/${encodeURIComponent(buyerId)}`, { signal });
        if (signal.aborted) return;
        if (data?.user_id !== buyerId || !Number.isFinite(data.balance) || data.balance < 0) {
          setFailed(true);
          return;
        }
        setBalance(data.balance);
      } catch {
        if (!signal.aborted) setFailed(true);
      }
    }
    readBalance();
    return () => controller.abort();
  }, [isOpen, buyerId, photographerId, attempt]);

  function applyReceiptBalance(remaining) {
    activeRead.current?.abort();
    setFailed(false);
    setBalance(remaining);
  }

  return { balance, failed, retry: () => setAttempt(n => n + 1), applyReceiptBalance };
}
