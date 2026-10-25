# Guardian levels (minors policy, owner-approved 2026-10-24)

One model decides what a child account may do: the child's **guardian level** and **age band**, read from one place
(`backend/services/guardian_levels.py`, `guardian_level(db, child)`). No other code decides "is this person a
parent" or "what may this child do".

## Levels

| Level | Meaning | How it is reached |
|---|---|---|
| **L0** | No confirmed guardian | default |
| **L1** | Linked | an adult account **and** a two-sided confirmation (below) |
| **L2** | Verified | an L1 guardian who is also a proven adult (`parent_age_verified`: ID check; card transaction arrives with the parent-first program) |

A link is **confirmed** when `profiles.parent_id` names the guardian **and** `parent_link_approved` is true, and a
verified `grom_guardians` row records it. A `parent_id` on its own is a claim and carries no authority.
`is_confirmed_guardian(child, user_id)` is the only test guardian routes use.

"Is a parent" means *has at least one confirmed link*. `profiles.is_grom_parent` is a server-owned cache of that fact
(maintained in `services/guardian_links.py`); no profile route can set it, and it never grants access to a child.

## Two-sided confirmation

Both sides must act, in either direction. Neither ever links on its own.

- **Child code.** The child's account asks for a code (`POST /grom-hq/guardian-code`) and gives it to the adult, who
  redeems it (`POST /grom-hq/link-by-code`).
- **Parent invite.** The adult proposes (`POST /grom-hq/link-grom`); the child's account confirms
  (`POST /grom-hq/guardian-invites/{id}/confirm`) or declines.

Every proof is single-use, bound to one child, valid 48 hours, stored only as a keyed hash (codes), and killed when
the link is made. An adult must be a non-child account and, if a birthdate is on file, 18 or older.
Delivery of an invite goes through `guardian_links.register_invite_delivery`: today an in-app notification; the email
service registers a second channel there. Nothing in the linking code sends email.

## Age bands

`under_13`, `13_15`, `16_17`, `adult`, `unknown`. A gate that must decide treats `unknown` as `under_13`.

## What each level unlocks (policy; PR 2 enforces it)

| Band | L0 | L1 | L2 |
|---|---|---|---|
| under 13 | view only; **no self-registration**, parent-first only | view only plus what the guardian switches on | public showcase and photos only by separate guardian consent; money via purchase requests |
| 13-15 | locked down: browse only | messaging and commenting | public profile, photo/likeness features, anything money-related (money also via purchase-request approval) |
| 16-17 | locked down: browse only | most features, guardian notified | as L1, money still via purchase requests |

## Existing routes by level (all under `/api/grom-hq` unless noted)

| Route | Who | Needs |
|---|---|---|
| `guardian-code`, `guardian-invites` (list, confirm, decline) | the child | the child's own token; no level |
| `link-by-code`, `link-grom` | an adult | an adult token and a child-side proof; produces L1 |
| `grom-status/{id}` | the child or confirmed guardian | reports level and band |
| `linked-groms`, `family-activity`, `activity`, `spending-summary` | guardian | confirmed link (L1) |
| `update-parental-controls`, `spending-controls`, `toggle-competition` | guardian | confirmed link (L1) |
| `purchase-request` (child) / `purchase-requests/*/approve, deny` (guardian) | child / guardian | confirmed link; money stays on this approval at every level |
| `unlink-grom`, `can-grom-unlink` | guardian | confirmed link and password |
| `create-age-verification`, `verify-age-complete` | guardian | produces L2 |
| `demo-verify-age` | local tests only | unreachable on any deployment (see below) |
| `media-policy`, pending media, privacy cap, approve, make-private (`media_privacy`, `protected_media`) | guardian | verified guardian (L1; media ceilings follow L2 rules in PR 2) |
| gallery tagging of a child, Grom subscription payments (`/api/...`) | guardian | confirmed link |
| `admin/guardian-exposure` | admin | admin token; counts only |

## Legacy accounts

Children linked before two-sided proof existed keep their link but have no `grom_guardians` row, so they are counted as
`confirmed_legacy` in the exposure report. Unlinked children stay restricted (view-only for 12 and under). The report
(`GET /api/grom-hq/admin/guardian-exposure`, or `python scripts/guardian_exposure_report.py`) returns numbers only,
and masks any cell of 1-4 as `<5`. What to do with legacy links is the owner's decision.

## Demo verification

`demo-verify-age` grants L2 with no real check. It answers 404 unless `ALLOW_GROM_DEMO_VERIFY=true` **and** the
process positively asserts it is local or a test (`core.security.dev_identity_allowed`). On a deployment (RENDER
and the other markers), with `ENV=production`, or with nothing set, it is unreachable.

## Open (counsel / later programs)

Which levels satisfy COPPA for which features; two-guardian disagreement and step-parent rules; the link ending
automatically at 18; the parent-first creation of under-13 profiles and the card-transaction proof (P3).
