import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../lib/apiClient';
import { GalleryPage } from '../components/GalleryPage';
import { Button } from '../components/ui/button';

const linkedToSession = (gallery, sessionId) =>
  ['live_session_id', 'booking_id', 'dispatch_id'].some(field => gallery[field] === sessionId);
const validRows = rows => Array.isArray(rows) && rows.every(row => row && typeof row === 'object');

export default function SessionRecapPage() {
  const { sessionId } = useParams();
  const { user } = useAuth();
  const photographerId = user?.id;
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState(null);
  const [state, setState] = useState({ status: 'loading' });
  const cache = useRef(null);
  const retrying = useRef(false);
  const identity = JSON.stringify([photographerId, sessionId]);
  const selectedId = choice?.identity === identity ? choice.id : null;
  const ticket = JSON.stringify([identity, attempt]);
  const key = JSON.stringify([ticket, selectedId]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const publish = value => { if (active) setState({ key, ...value }); };
    publish({ status: 'loading' });
    async function load() {
      try {
        if (!photographerId || !sessionId) {
          publish({ status: 'error', message: 'Sign in to view your session recap.' });
          return;
        }
        let galleries = cache.current?.ticket === ticket ? cache.current.galleries : null;
        if (!galleries) {
          const response = await apiClient.get(`/galleries/photographer/${encodeURIComponent(photographerId)}`, { signal: controller.signal });
          if (!active) return;
          if (!validRows(response.data) || response.data.some(row => typeof row.id !== 'string' || !row.id)) {
            throw new Error('Invalid gallery response');
          }
          galleries = response.data;
          cache.current = { ticket, galleries };
        }
        const matches = galleries.filter(gallery => linkedToSession(gallery, sessionId));
        if (!matches.length) {
          publish({ status: 'missing', message: 'No gallery was found for this session.' });
          return;
        }
        const gallery = selectedId ? matches.find(row => row.id === selectedId) : matches.length === 1 ? matches[0] : null;
        if (!gallery) {
          publish({ status: 'choose', matches });
          return;
        }
        const galleryId = encodeURIComponent(gallery.id);
        const [people, photos] = await Promise.all([
          apiClient.get(`/gallery/${galleryId}/session-participants`, { params: { photographer_id: photographerId }, signal: controller.signal }),
          apiClient.get(`/galleries/${galleryId}/items`, { params: { viewer_id: photographerId }, signal: controller.signal }),
        ]);
        if (!active) return;
        if (!validRows(people.data?.participants) || !validRows(photos.data)) throw new Error('Invalid recap response');
        publish({ status: 'ready', data: {
          gallery: { ...gallery, spot_name: gallery.surf_spot_name ?? gallery.spot_name },
          participants: people.data.participants, session: people.data.session || null, items: photos.data,
        } });
      } catch (error) {
        if (!active) return;
        controller.abort();
        const status = error.response?.status;
        publish({ status: 'error', message: status === 401 || status === 403
          ? 'You do not have access to this session recap.'
          : status === 404 ? 'This session gallery is no longer available.' : 'Could not load the session recap. Try again.' });
      } finally {
        if (active) retrying.current = false;
      }
    }
    load();
    return () => { active = false; controller.abort(); };
  }, [photographerId, sessionId, selectedId, ticket, key]);

  // Do not show the previous actor/session while its replacement read is starting.
  const current = state.key === key ? state : { status: 'loading' };
  if (current.status === 'ready') {
    const age = Date.now() - new Date(current.data.gallery.created_at).getTime();
    return <>
      {age >= 48 * 3600000 && <p role="status" className="p-4 max-w-6xl mx-auto text-muted-foreground">
        This gallery is older than 48 hours. Its gallery and existing tools remain available below.
      </p>}
      <GalleryPage key={`${identity}:${current.data.gallery.id}`} initialRecapData={current.data} />
    </>;
  }
  return <section className="p-4 max-w-6xl mx-auto text-foreground">
    <h1 className="text-2xl font-bold mb-4">Session Recap</h1>
    {current.status === 'loading' ? <p role="status" aria-live="polite">Loading session recap...</p>
      : current.status === 'choose' ? <>
        <p className="text-muted-foreground mb-3">Choose a gallery for this session.</p>
        <div className="flex flex-col items-start gap-2">
          {current.matches.map(gallery => <Button key={gallery.id} variant="outline"
            className="max-w-full h-auto whitespace-normal text-left"
            onClick={() => setChoice({ identity, id: gallery.id })}>{gallery.title || 'Session gallery'}</Button>)}
        </div>
      </> : <>
        <p role="alert" className="mb-4 text-muted-foreground">{current.message}</p>
        {current.status === 'error' && <Button variant="outline" className="mr-3" onClick={() => {
          if (retrying.current) return;
          retrying.current = true;
          setChoice(null);
          setAttempt(value => value + 1);
        }}>Try again</Button>}
        <Link className="underline text-foreground" to="/gallery">Open Gallery Hub</Link>
      </>}
  </section>;
}
