import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { NotificationsPage } from '../../../../frontend/src/components/NotificationsPage';
import ProfileReviewsSection from '../../../../frontend/src/components/ProfileReviewsSection';

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode');
createRoot(document.getElementById('root')).render(
  <MemoryRouter>
    {mode === 'reviews'
      ? <main style={{ maxWidth: 700, margin: '24px auto', padding: 20 }}><ProfileReviewsSection profileUserId="fixture" theme={params.get('theme')} /></main>
      : <NotificationsPage />}
  </MemoryRouter>
);
