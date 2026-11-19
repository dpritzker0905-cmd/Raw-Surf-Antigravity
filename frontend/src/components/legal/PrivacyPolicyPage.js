/**
 * PrivacyPolicyPage - the public privacy notice at /privacy (no sign-in needed).
 *
 * It renders the ACTIVE Privacy Policy that admins publish in Compliance > Legal documents > Privacy Policy, served by
 * the public GET /compliance/tos-content/current?doc_type=privacy with the company tokens already filled from
 * Company details ({company} -> the legal entity name). The forecast-data consent links here as its privacy notice
 * (Company details "Privacy notice link", default /privacy).
 *
 * Themes: semantic tokens only (background/card/border/foreground/muted-foreground/primary), which light, dark and
 * beach all define, so the page follows whichever theme is active. Accessibility: one h1, an h2 per section, the
 * loading state as role=status, a failure as role=alert, a real link back.
 */
import React, { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient';

export default function PrivacyPolicyPage() {
  const [doc, setDoc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    apiClient.get('/compliance/tos-content/current?doc_type=privacy')
      .then((res) => { if (live) setDoc(res.data); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground" data-testid="privacy-page">
      <article className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">Privacy Policy</h1>
          {doc && (
            <p className="text-sm text-muted-foreground">
              {doc.company ? `${doc.company} · ` : ''}Version {doc.version}
              {doc.effective_date ? ` · Effective ${doc.effective_date}` : ''}
            </p>
          )}
        </header>
        {!doc && !failed && <p role="status" className="text-sm text-muted-foreground">Loading the privacy policy…</p>}
        {failed && (
          <p role="alert" className="rounded-lg border border-border bg-card p-3 text-sm text-foreground">
            The privacy policy could not be loaded. Please try again, or find it in Settings &gt; Legal in the app.
          </p>
        )}
        {doc && (doc.sections || []).map((s, i) => (
          <section key={i} className="rounded-xl border border-border bg-card p-4" aria-labelledby={`privacy-s-${i}`}>
            <h2 id={`privacy-s-${i}`} className="mb-2 text-base font-semibold text-foreground">{s.title}</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{s.body}</p>
          </section>
        ))}
        <p>
          <a href="/" className="text-sm font-medium text-primary underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-ring rounded">
            Back to Raw Surf
          </a>
        </p>
      </article>
    </main>
  );
}
