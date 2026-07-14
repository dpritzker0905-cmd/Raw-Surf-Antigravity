# SECURITY REVIEW 2026-07-14 — public storage buckets (notation + phased plan, NOT yet executed)

**Status: NOTATION.** User asked (2026-07-14) for the public buckets to be notated for securing.
Nothing here has been flipped — read "Why not a blind flip" before executing anything.
Companion debt doc: `HANDOFF-2026-07-12-USERID-AUTH-ARCHITECTURE-BOLA-REVIEW.md` (same philosophy:
enumerate → guardrail → migrate lane-by-lane; never one big flip).

## Context: what just shipped (the pattern to copy)
The CDN ratings lane (2026-07-14) needed anonymous read of ONE object. Instead of a public bucket,
it shipped as a **scoped RLS policy on the private bucket** (`supabase_scripts/
storage_rls_spot_ratings_scoped_read.sql`): exposure = exactly one named key, revocable by dropping
one policy. That is the target posture for everything below: **no bucket-level public read; every
anonymous exposure is an explicit, named, revocable policy (or a signed URL).**

## Forensic inventory (prod, 2026-07-14 ~02:30Z)
RLS is ENABLED on storage.objects with (before today) ZERO policies — all client reads ride the
`public=true` bucket bypass; all writes go through the backend service key. Object names are
UUIDv4 (unguessable — no enumeration risk; the exposure class is "a leaked URL works forever and
cannot be revoked").

| Bucket | Objects | MB | Content class | Verdict |
|---|---|---|---|---|
| `chat_media` | 39 | 104 | **PRIVATE 1:1 chat media + voice notes** | **P1 — private content world-readable** |
| `crew_chat` | 2 | ~0 | **PRIVATE crew-chat media** | **P1 (same class, tiny blast radius)** |
| `stories` | 10 | 46 | User stories (ephemeral-intent; public-ish product surface) | P2 — product intent probably "followers", storage says "world, forever" |
| `feed` | 95 | 255 | User feed posts (public product surface) | P3 — public-by-design; keep public read OR move to policy for revocability |
| `gallery` | 57 | 257 | User galleries | P2/P3 — depends whether private galleries exist (check `surfer_gallery_items` visibility model) |
| `videos` | 12 | 41 | User videos (session clips) | P2/P3 — same question as gallery |
| `avatars` | 8 | 7 | Profile avatars | P3 — conventionally public |
| `general` | 47 | 39 | Mixed uploads (`routes/uploads/core.py` default lane) | **P2 — mixed = unclassifiable = risky by default; audit contents first** |
| `conditions` | 7 | 2 | Surf-conditions photos (public product surface) | P3 |
| `weather-products` | 7,888 | 3,565 | Pipeline artifacts | Already private + 1 scoped policy (the target posture) |

## The load-bearing constraint (why NOT a blind flip)
`upload_to_supabase_storage` (routes/uploads/core.py:90, services/media_upload.py) returns
`get_public_url(...)` and those URLs are **persisted in DB rows and client caches**. Flipping a
bucket private 404s every stored URL instantly — chat histories, feeds, avatars all break. So each
bucket migration is a THREE-part change: (1) storage posture, (2) URL minting (signed URLs or an
authed proxy route), (3) **backfill of already-persisted URLs**. That's why this is a phased
program, not tonight's change. ⚠️ Also note routes/uploads/core.py:103 auto-creates buckets
`public: True` at upload time — the footgun that mints NEW public buckets.

## Phased plan (jacobian-ordered: guardrails first, smallest blast radius first)
1. **Stop the bleeding (zero-risk, do first):** change the `create_bucket(..., public: True)`
   default in routes/uploads/core.py + services/media_upload.py to `public: False` for NEW buckets
   (existing buckets unaffected — create_bucket already no-ops on them). Add a CI/health check that
   pages when a bucket not on the approved-public allowlist is public (mirror of the L2-writer-gate
   pattern).
2. **P1 `chat_media` + `crew_chat`:** private content must not be world-readable. Serve via
   short-lived signed URLs minted at message-render time (supabase createSignedUrl, TTL ~1h) or an
   authed proxy route reusing the existing chat-membership checks (BOLA doc §6 bridge). Backfill:
   rewrite stored public URLs to storage keys (URL → key is mechanical), then flip the bucket.
   39 + 2 objects — the smallest real migration; do it first as the template.
3. **P2 `general`:** audit the 47 objects, reclassify into purpose buckets, retire it.
4. **P2 `stories` / `gallery` / `videos`:** decide the product contract (who may view?) with the
   user, then either keep public-by-design (documented) or apply the chat_media template.
5. **P3 `avatars` / `feed` / `conditions`:** public-by-design; document that as an explicit
   decision on the allowlist from step 1. Optional hardening: move them to scoped SELECT policies
   anyway so "public" is a named policy, not a bucket bit.
6. **Cost guard (all public surfaces):** any anonymously readable object is a cache-bust egress
   lever (`?cb=` params defeat the CDN). Consider Supabase egress alerts; this is inherent to
   public storage, not introduced by any single lane.

## Answer to "is securing them all the best path?"
Yes for POSTURE (default-private, explicit named exposures, guardrail against new public buckets)
— that's steps 1–3 and they are pure wins. But "secure everything" ≠ "make everything private":
avatars/feed/conditions are public product surfaces; forcing signed URLs there adds latency,
cache-misses, and complexity for no threat-model gain. The honest target is: **nothing is public
by accident, everything public is public on purpose, on a list, revocable.**
