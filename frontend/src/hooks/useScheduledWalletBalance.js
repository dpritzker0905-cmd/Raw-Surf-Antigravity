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

export default function useScheduledWalletBalance(isOpen, buyerId, photographerId, choosingPayment) {
  const [balance, setBalance] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const activeRead = useRef(null);
  const refresh = useRef(null);

  useLayoutEffect(() => {
    setBalance(null);
    setFailed(false);
    if (!isOpen || !buyerId) return;

    async function readBalance(background = false) {
      if (activeRead.current && !activeRead.current.controller.signal.aborted) return;
      const request = { controller: new AbortController(), background };
      activeRead.current = request;
      const { signal } = request.controller;
      try {
        const writes = Array.from(pendingCreates)
          .filter(entry => entry.buyerId === buyerId)
          .map(entry => entry.request);
        if (writes.length) await Promise.allSettled(writes);
        if (signal.aborted) return;
        const { data } = await apiClient.get(`/credits/balance/${encodeURIComponent(buyerId)}`, { signal });
        if (signal.aborted) return;
        if (data?.user_id !== buyerId || !Number.isFinite(data.balance) || data.balance < 0) {
          setBalance(null);
          setFailed(true);
          return;
        }
        setFailed(false);
        setBalance(data.balance);
      } catch {
        if (!signal.aborted) {
          setBalance(null);
          setFailed(true);
        }
      } finally {
        if (activeRead.current === request) activeRead.current = null;
      }
    }
    refresh.current = readBalance;
    readBalance();
    return () => {
      refresh.current = null;
      activeRead.current?.controller.abort();
    };
  }, [isOpen, buyerId, photographerId, attempt]);

  // A failed checkout response can arrive before the server commits its debit.
  // Recheck while the buyer can see and choose credits, without replaying checkout.
  useLayoutEffect(() => {
    if (!isOpen || !buyerId || !choosingPayment) return;
    const recheck = () => {
      if (!document.hidden) refresh.current?.(true);
    };
    const timer = window.setInterval(recheck, 10000);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      if (activeRead.current?.background) activeRead.current.controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [isOpen, buyerId, photographerId, choosingPayment, attempt]);

  function applyReceiptBalance(remaining) {
    activeRead.current?.controller.abort();
    setFailed(false);
    setBalance(remaining);
  }

  return { balance, failed, retry: () => setAttempt(n => n + 1), applyReceiptBalance };
}
