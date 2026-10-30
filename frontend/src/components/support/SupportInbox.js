import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../lib/apiClient';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { canonicalSupportTicketId, newSupportRequestId } from './supportRoutes';

export const SupportInbox = () => {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Loading your support inbox…</p>;
  if (!user?.id) return <p role="status">Sign in to read your support tickets.</p>;
  return <SupportSession key={user.id} />;
};

const SupportSession = () => {
  const { ticketId: pathTicketId } = useParams();
  const ticketId = canonicalSupportTicketId(pathTicketId);
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [list, setList] = useState({ pending: true });
  const [detail, setDetail] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [creation, setCreation] = useState({ subject: '', description: '', requestId: null });
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState(null);
  const alive = useRef(true);
  const mutation = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    let active = true;
    setList({ pending: true });
    apiClient.get(`/support/tickets?limit=50&offset=${offset}`).then(({ data }) => {
      if (!active) return;
      if (offset && offset >= data.total) { setOffset(Math.max(0, Math.floor((data.total - 1) / 50) * 50)); return; }
      setList({ pending: false, data });
    }).catch(() => { if (active) setList({ pending: false, error: 'Your tickets could not be loaded.' }); });
    return () => { active = false; };
  }, [offset, refresh]);
  useEffect(() => {
    if (!ticketId) { setDetail(null); return undefined; }
    let active = true;
    setDetail({ ticketId, pending: true });
    apiClient.get(`/support/tickets/${encodeURIComponent(ticketId)}`).then(({ data }) => {
      if (active) setDetail(data.id === ticketId ? { ticketId, data } : { ticketId, error: 'Ticket unavailable.' });
    }).catch(() => { if (active) setDetail({ ticketId, error: 'Ticket unavailable or you do not have access.' }); });
    return () => { active = false; };
  }, [ticketId, refresh]);

  const draft = drafts[ticketId] || { text: '', requestId: null };
  const current = detail?.ticketId === ticketId ? detail : null;
  const sendReply = async event => {
    event.preventDefault();
    if (mutation.current || !draft.text.trim() || !current?.data) return;
    const selected = ticketId;
    const captured = { ...draft, requestId: draft.requestId || newSupportRequestId() };
    setDrafts(prev => ({ ...prev, [selected]: captured }));
    mutation.current = true; setPending(true); setFailure(null);
    try {
      await apiClient.post(`/support/tickets/${encodeURIComponent(selected)}/messages`, {
        message: captured.text, client_message_id: captured.requestId,
      });
      if (alive.current) {
        setDrafts(prev => prev[selected]?.text === captured.text && prev[selected]?.requestId === captured.requestId
          ? { ...prev, [selected]: { text: '', requestId: null } } : prev);
        setRefresh(value => value + 1);
      }
    } catch { if (alive.current) setFailure({ ticketId: selected, text: 'Reply not confirmed. Your draft is kept; retry uses the same request.' }); }
    finally { mutation.current = false; if (alive.current) setPending(false); }
  };
  const create = async event => {
    event.preventDefault();
    if (mutation.current || !creation.subject.trim() || !creation.description.trim()) return;
    const captured = { ...creation, requestId: creation.requestId || newSupportRequestId() };
    setCreation(captured); mutation.current = true; setPending(true); setFailure(null);
    try {
      const { data } = await apiClient.post('/support/tickets', {
        subject: captured.subject, description: captured.description, client_request_id: captured.requestId,
      });
      if (alive.current) {
        setCreation({ subject: '', description: '', requestId: null }); setOffset(0);
        setRefresh(value => value + 1); navigate(`/support/tickets/${encodeURIComponent(data.ticket_id)}`);
      }
    } catch { if (alive.current) setFailure({ ticketId: null, text: 'Ticket not confirmed. Your request is kept; retry uses the same request.' }); }
    finally { mutation.current = false; if (alive.current) setPending(false); }
  };

  return <main className="mx-auto max-w-5xl p-4 text-foreground space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl font-semibold">Support inbox</h1>
      <Button variant="outline" onClick={() => setRefresh(value => value + 1)}>Refresh tickets</Button>
    </div>
    <p className="text-sm text-muted-foreground">Your conversation stays here. Email notices contain a sign-in link, never the reply.</p>
    <div className="grid gap-4 md:grid-cols-2">
      <section aria-label="Your support tickets" className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="font-semibold">Your tickets</h2>
        {list.pending && <p role="status">Loading tickets…</p>}
        {list.error && <div role="alert">{list.error}<Button variant="outline" onClick={() => setRefresh(value => value + 1)}>Retry tickets</Button></div>}
        {list.data && <>
          {!list.data.tickets.length && <p>No support tickets yet.</p>}
          {list.data.tickets.map(ticket => <button key={ticket.id} type="button" aria-pressed={ticketId === ticket.id}
            onClick={() => navigate(`/support/tickets/${encodeURIComponent(ticket.id)}`)}
            className="block w-full rounded-lg border border-border p-3 text-left focus-visible:ring-2 focus-visible:ring-ring">
            <span className="block break-all text-xs text-muted-foreground">{ticket.ticket_number}</span>
            <span className="block break-words font-medium">{ticket.subject}</span>
            <span className="block text-xs text-muted-foreground">{ticket.status?.replaceAll('_', ' ')}</span>
          </button>)}
          <p className="text-sm">{list.data.total} tickets · Page {Math.floor(offset / 50) + 1}</p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 50))}>Previous tickets</Button>
            <Button variant="outline" disabled={offset + 50 >= list.data.total} onClick={() => setOffset(value => value + 50)}>Next tickets</Button>
          </div>
        </>}
      </section>
      <section aria-label="Support conversation" className="rounded-xl border border-border bg-card p-4 space-y-3 min-w-0">
        {!ticketId && <p>Select a ticket to read its conversation.</p>}
        {ticketId && (!current || current.pending) && <p role="status">Loading conversation…</p>}
        {current?.error && <div role="alert">{current.error}<Button variant="outline" onClick={() => setRefresh(value => value + 1)}>Retry conversation</Button></div>}
        {current?.data && <>
          <h2 className="font-semibold break-words">{current.data.subject}</h2>
          <p className="text-xs text-muted-foreground break-all">{current.data.ticket_number}</p>
          <p className="whitespace-pre-wrap break-words">{current.data.description}</p>
          <ol aria-label="Public replies" className="space-y-3">
            {current.data.messages.map(message => <li key={message.id} className="rounded-lg bg-muted p-3">
              <p className="text-xs font-medium">{message.from_support ? 'Support' : 'You'}</p>
              <p className="whitespace-pre-wrap break-words">{message.message}</p>
            </li>)}
          </ol>
          <form onSubmit={sendReply} className="space-y-2">
            <label htmlFor="support-reply" className="block text-sm">Your reply</label>
            <Textarea id="support-reply" maxLength={10000} value={draft.text} onChange={event => setDrafts(prev => ({
              ...prev, [ticketId]: { text: event.target.value, requestId: null },
            }))} />
            <Button type="submit" disabled={pending || !draft.text.trim()}>Send reply</Button>
          </form>
        </>}
        {failure && failure.ticketId === ticketId && <p role="alert">{failure.text}</p>}
      </section>
    </div>
    <section aria-label="New support ticket" className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-semibold mb-3">New ticket</h2>
      <form onSubmit={create} className="space-y-3">
        <label className="block text-sm">Subject<Input maxLength={255} value={creation.subject} disabled={pending}
          onChange={event => setCreation(prev => ({ ...prev, subject: event.target.value, requestId: null }))} /></label>
        <label className="block text-sm">How can we help?<Textarea maxLength={10000} value={creation.description} disabled={pending}
          onChange={event => setCreation(prev => ({ ...prev, description: event.target.value, requestId: null }))} /></label>
        <Button type="submit" disabled={pending || !creation.subject.trim() || !creation.description.trim()}>Create ticket</Button>
        {failure?.ticketId === null && <p role="alert">{failure.text}</p>}
      </form>
    </section>
  </main>;
};

export default SupportInbox;
