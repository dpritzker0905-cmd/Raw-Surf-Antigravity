# Decision memo: a minimal moderation trail after a banned user deletes their account

Date: 2026-11-18. Status: DRAFT, uncommitted. Research only; no code or database was changed.
**This is not legal advice.** It is research to hand to counsel. Section 7 lists what a lawyer must confirm.
Source limits: the statute and article numbers below are from memory of the GDPR/CCPA texts and the sibling note
`T1-LEGAL-RESEARCH-2026-11-18.md` (which retrieved the GDPR and Cal. Civ. Code text). The "what platforms do" section
is general industry knowledge, NOT re-verified against live policies this session. Treat every pinpoint as "verify".

## 1. Answer in one paragraph

Yes. Keep a **small, separate, hashed "moderation tombstone"** for accounts that were **banned** when they asked to be
deleted: a keyed hash of the email, a reason code, the ban date, and a decision reference. Hold it for a fixed period
(recommended **24 months**), rely on **legitimate interest (Art. 6(1)(f))** for the anti-evasion part and
**Art. 17(3)(e) (legal claims)** for a short-lived defensive record, and tell people in the privacy policy, the ban
notice and the deletion confirmation. **Do not keep the real name or contact details** in the trail: the hash does the
matching job, a name adds risk and no matching power. Delete everything else on day 30 as today.

## 2. What the repo does today (read, not changed)

Sources: `backend/routes/compliance_pkg/gdpr.py` on this branch, and PR #1062 (`claude/account-deletion-grace`,
open, unmerged) for the 30-day flow. `violations.py` for moderation. `session_revocations` and `surf_truth_export` are
touched by #1057/#1062 only to sign people out and drop them from exports; they hold no moderation data.

- **#1062 flow.** "Delete my account" locks the account at once (suspended, sessions revoked), emails a restore link
  (SHA-256 of the token in `account_deletions`), and a daily job (03:40 UTC) runs `erase_account` after 30 days.
  `?immediate=true` erases at once. A moderation suspension or ban during the window sets `moderation_hold`, so a
  restore never lifts it.
- **What `erase_account` keeps.** Its own docstring: payment transactions, bookings, ToS acknowledgements and
  **ToS violations ("legal hold")**. So the advisor's premise ("erased fully on day 30, removing moderation evidence")
  is only half true. The violation rows survive. What is lost is the **ability to recognise the person again**:
  the profile email becomes `deleted_<id8>@deleted.rawsurf.app`, the name, username and password hash are cleared, and
  `is_banned` sits on a row nobody can match to a new sign-up.
- **Two problems with the current retention** (found while reading; both are fixable in the same change):
  1. `TosViolation` is kept **forever and in full**: `claimed_`/`actual_latitude/longitude`, an `evidence` JSON with
     coordinates, and free-text `description`/`title`. Precise location is the most sensitive field we hold and is
     not needed to defend a ban years later. Indefinite retention with no clock is weak under Art. 5(1)(e) and
     CCPA 1798.100(a)(3). "Legal hold" is a label, not a statute.
  2. The tombstone cannot be built after erasure: the email is overwritten in the same transaction. The hash has to be
     taken **before** step 6 (profile anonymisation) of `erase_account`.
- **Moderation writes** (`violations.py`): `is_banned`, `banned_at`, `suspended_reason`, strike counts, notification to
  the user. A permanent ban follows an automatic strike ladder (`calculate_strike_action`), so some bans are
  triggered by a rule, not a person (see Art. 22 note, section 3).
- The compliance package has **no** privacy-policy text and no retention schedule. I found no standalone privacy
  policy page under `frontend/src` in a shallow search (only `settings/PrivacySection.js`); locate or write one.

## 3. Legal research (summary, to verify)

**GDPR**
- *Art. 17(1)* erasure applies unless Art. 17(3) says otherwise. *17(3)* exceptions apply "to the extent processing is
  necessary": **(b)** compliance with a legal obligation under **EU or Member State law** (a contract term or our own
  policy does not count); **(e)** establishment, exercise or defence of legal claims. (e) is the natural home for a
  record kept to defend a ban decision; it needs a real prospect of a claim (appeal, chargeback, discrimination or
  consumer complaint), so it supports a **bounded** period, not "forever".
- *Art. 6(1)(f)* legitimate interest. Recital 47 names preventing fraud as a legitimate interest and Recital 49 names
  network and information security. Three-part test (purpose, necessity, balancing) must be written down as a short
  **legitimate-interests assessment** (LIA). The user can object under *Art. 21*; for a ban-evasion list we would
  decline only with "compelling legitimate grounds", and must say so. If the objection is upheld, *Art. 17(1)(c)*
  follows.
- *Art. 5(1)(c) minimisation, 5(1)(e) storage limitation, 5(2) accountability.* These decide the design: smallest
  set of fields, a fixed clock, and a documented reason per field. Hashing is **pseudonymisation, not anonymisation**
  (Recital 26): the tombstone is still personal data, the user still has access/objection rights, and it must be
  findable by us (match their verified email's hash) to honour them.
- *Art. 10* (criminal offences): keep reason codes at "breach of our terms" level, never "committed fraud/assault".
  A coded allegation of crime may trigger Art. 10 and needs a different basis.
- *Art. 22*: an automatic strike-ladder ban with legal or similarly significant effect is a "solely automated"
  decision risk. Keep a human in the loop on the ban and on any re-registration block (a hash match should **flag for
  human review**, not auto-reject).
- *Arts. 13(1)(d), 13(2)(a), 13(2)(b)-(d)*: the notice must state the legitimate interest, the retention period (or the
  criteria), and the rights including objection and complaint to an authority.
- *EU Digital Services Act* (if we are an online platform for EU users and not exempt as a micro/small enterprise):
  statement of reasons to the user on restrictions (Art. 17) and an internal complaint route (Art. 20) are separate
  duties that also argue for keeping a decision record. Counsel to confirm applicability.
- Regulators have generally tolerated a **minimal suppression list** (a hash and a flag) where a person's erasure or
  objection would otherwise defeat the purpose (the same idea as an email-marketing suppression list). Keeping the
  **full file** is not tolerated. This is the pattern the memo copies.

**CCPA/CPRA (California)**
- *1798.105(a)* right to delete, with exceptions in *1798.105(d)*: **(2)** to help ensure security and integrity,
  including detecting and protecting against malicious, deceptive, fraudulent or illegal activity (the best fit for
  an anti-evasion hash); **(8)** comply with a legal obligation; **(7)** solely internal uses reasonably aligned with
  consumer expectations. *1798.145(a)* also allows retention to comply with law and to exercise or defend legal claims
  (verify the subsection). *1798.105(c)(2)* lets a business keep a confidential record of deletion requests
  (per the sibling note).
- The security exception covers "to the extent reasonably necessary and proportionate", so the same minimal-and-bounded
  design applies. Retention must be disclosed per category at or before collection (*1798.100(a)(3)*), and a precise
  geolocation field (radius 1,850 ft) is sensitive personal information (*1798.140(w), (ae)*): another reason to
  scrub the GPS columns at erasure.
- A hashed identifier is still a "unique identifier" (*1798.140(aj)*) and "personal information": the data stays in
  scope of access, correction and disclosure rights.

**What large platforms do (general knowledge; not re-verified)**
- Common pattern: keep a **hash of the email, phone number or device identifier** of banned accounts and block or
  review new sign-ups that match; keep the **reason and date**; keep it for a **defined window** (commonly months to a
  few years; a longer or indefinite period for the most severe categories such as child-safety, fraud, or terrorism
  content, often tied to a legal duty or law-enforcement preservation request).
- Public policies of the large networks and chat/community platforms say, in substance, that data of enforced
  accounts may be kept after deletion "to prevent abuse, enforce our terms, and comply with law". They disclose this in
  the privacy policy and in the deletion help page, not only in the terms.
- Small marketplaces typically keep: banned email hash, payment-instrument fingerprint (via the processor), IP/device
  signals for a short time. IP and device signals are personal data with a worse balancing result; this memo leaves
  them out of v1.

## 4. Recommended design

Principle: a **separate append-only table**, service-role only (same RLS lock as `account_deletions` in #1062), not a
column on the profile and not a copy of `tos_violations`.

| Field | Content | Notes |
|---|---|---|
| `id`, `created_at` | surrogate key, timestamp | |
| `email_hmac` | HMAC-SHA256 of the **normalised** email (lowercase; strip `+tag`; Gmail dots) | Keyed hash: a plain SHA-256 of an email can be reversed by guessing. Key is an env var NAME (suggest `MODERATION_HASH_KEY`) in Render only; never in a tracked file. A second `email_hmac_alt` is not needed |
| `phone_hmac` | same, only if phone is a sign-up identifier | Skip if phone is not collected (the current erase code references a phone field that is not a real column) |
| `reason_code` | enum: `tos_repeat`, `location_fraud`, `payment_fraud`, `harassment`, `spam`, `other_tos` | Terms-breach level only (Art. 10); no free text |
| `action`, `banned_at` | `permanent_ban` / `suspension`, date from `Profile.banned_at` | |
| `decision_ref` | id of the violation row and admin who decided (admin id, not a name) | Lets us show a human decided; supports DSA statement of reasons |
| `delete_requested_at`, `tombstoned_at` | dates | Shows lawful sequencing |
| `retain_until` | `tombstoned_at + 24 months` | Daily job deletes rows past this date |
| `legal_hold` | bool + `hold_reason` (neutral) | Set by an admin only when a claim or authority request exists; suspends deletion |

**Not kept in the tombstone:** real name, address, phone, username, avatar, IP, device ID, GPS, message or post content,
the evidence blob, payment numbers. The financial rows we must keep for tax already hold what tax law needs; do not
copy them. If a real dispute arises, counsel can reach the name through those retained financial/booking records
under a legal hold, so keeping the name in the moderation trail adds risk (name is not unique, false matches,
over-collection, bigger breach impact) and no benefit.

**Second tier: a short defensive record.** Instead of leaving `tos_violations` untouched forever, at erasure:
- strip `claimed_/actual_latitude/longitude`, the GPS in `evidence`, and free text (keep `violation_type`, `severity`,
  `strike_points`, `action_taken`, dates, `reviewed_by`);
- keep that scrubbed row for **12 months after the erasure date** (basis: Art. 17(3)(e) / CCPA 1798.145(a) legal
  claims), longer only under `legal_hold`; then delete it, leaving only the Tier-A tombstone until its own date.
This keeps "we banned them on date X for reason Y, human-reviewed" provable and drops the sensitive evidence.

**Where it runs.** Inside `erase_account`, in the same transaction and **before** the profile is anonymised:
if `profile.is_banned` (or an active permanent-ban strike state) write the tombstone, then scrub the violation rows,
then anonymise as today. Also cover the `?immediate=true` path (same function) and an `Art. 17(3)(e)`
exception: `purge_due` should **skip and flag** an account that has an open, unresolved moderation case at day 30.
Do not create a tombstone for users who were not banned; a normal leaver leaves nothing behind.

**At sign-up.** Hash the normalised new email with the same key; on a match, **hold the registration for human review**
(never silently reject, never reveal why in detail; a short "we can't create this account, contact support" message).
Be honest in the design review: email evasion is trivial (any new address), so the practical benefit is deterrence
and cutting casual repeat offenders. Weigh it against the false-positive and DPIA cost; adding payment-fingerprint or
device matching is a larger privacy step and needs its own LIA.

**Rights handling.** Access/objection requests are matched by hashing the requester's **verified** email: we can find
and show the record. Document a standard answer for objection ("kept for X months under legitimate interest, reason
Y"). An upheld appeal deletes the tombstone and flips the violation to "overturned" before day 30.

**Keys and backups.** Key in Render env; rotating it orphans old hashes (accept, or re-hash during the 24-month
window). Loss of the key only loses matching. Backups: tombstone expiry must also apply to backups within the
backup retention period (state it in the notice). The existing `session_revocations` table is separate and untouched.

## 5. Legal basis table

| Processing | EU/UK basis | California | Period |
|---|---|---|---|
| Hash + reason + date, to stop evasion | Art. 6(1)(f), balanced by LIA; objection right | 1798.105(d)(2) security/integrity | 24 months from erasure |
| Scrubbed violation record, to defend a decision | Art. 17(3)(e) with Art. 6(1)(f) | 1798.145(a) / 105(d)(8) as counsel advises | 12 months from erasure (+ hold) |
| Payments, bookings, acknowledgements | Art. 6(1)(c) tax/accounting law, Art. 17(3)(b) | 1798.105(d)(8) | Statutory period (counsel: set per country; today unbounded) |
| Name or contact in the trail | Not recommended | Not recommended | n/a |

## 6. Policy wording to add (draft; counsel to edit; [Company] to fill)

**Privacy policy, new section "If your account is banned and you delete it"**
> If we have banned your account for breaking our Terms and you ask us to delete your account, we delete your profile,
> posts, photos, messages and other personal content as described above. We keep a small record so that people we
> have banned cannot simply come back, and so we can show why we acted. The record contains: an irreversible,
> keyed (hashed) form of your email address, the category of the rule you broke, the date of the decision and an
> internal reference to the reviewer. It does not contain your name, location, photos or messages. We keep it for
> 24 months after your deletion, then delete it. Our legal basis is our legitimate interest in preventing abuse and
> fraud (GDPR Art. 6(1)(f)). A shortened version of the decision record is kept for 12 months to defend against legal
> claims; if a legal claim or a request from an authority is pending we keep it until it ends. Because this record is
> still personal data, you can ask us to show it, or object to it, by writing to [contact]; if you think the ban was
> wrong, you can appeal at [link]. If you are in California, we rely on the security and fraud-prevention and legal
> exceptions to deletion. You can complain to your data-protection authority.

**Ban notice and the deletion confirmation / restore email (one sentence each)**
> "Because your account was banned, deleting it will not remove a hashed copy of your email, the reason and the date
> of the ban. We keep these for 24 months to prevent abuse. Details: [privacy policy link]."

**Also update:** the privacy notice's retention table (new rows), the processing register (Art. 30), the LIA, the
Delete-account screen copy (`DeleteAccountSection.js` in #1062 promises "permanently deleted"; add the exception), the
`retained` list returned by the route, and the data-export route (`/compliance/data-export/{user_id}`), which should
include the tombstone when someone requests access.

## 7. What a lawyer must confirm

1. That 24 months and 12 months are defensible per jurisdiction (EU member state limitation periods vary; the
   practical limit is "necessary", so shorter may be safer; severe categories may justify longer).
2. Which of Art. 17(3)(e) and Art. 6(1)(f) is the better basis for each row, and that a hash of an email meets the
   necessity test where evasion by a new address is easy.
3. Whether a human-reviewed ban list and the automatic strike ladder trigger Art. 22 or DSA Arts. 17/20, and whether
   we are exempt as a small enterprise.
4. Whether any reason code could be read as criminal-offence data (Art. 10) or special-category data.
5. California: the exact subsections of 1798.105(d) and 1798.145(a) to cite, the sensitive-PI position of the
   (scrubbed) location data, and the retention-disclosure wording.
6. Whether "legal hold" on the existing violations and the financial rows has a statutory source or must get a
   defined period per country; today it is unbounded.
7. Whether UK, other EU states or other US states (a statute requiring or forbidding ban records) apply.
8. Controller identity, EU/UK representative or DPO, and the transfer position for Supabase, Render, Netlify, Resend.
9. Backup and processor deletion timelines, and the wording of the objection and appeal process.
10. Whether to include payment-fingerprint or device matching later (needs its own LIA and likely a DPIA).

## 8. Follow-up work, if David approves (not started)

Small change in a separate PR to `dev`, stacked after #1062: new `moderation_tombstones` table (service-role RLS),
a pure function `hash_email()` with a unit test (same input, same hash; `+tag` and Gmail dots normalise), the
tombstone write plus violation-row scrub inside `erase_account`, a daily expiry job, `purge_due` skipping an
account with an open case, and the policy and UI copy above. Tests: banned user's erasure leaves a tombstone and no
GPS; a non-banned user's leaves none; expiry deletes; a hold blocks deletion; sign-up with a matching email goes to
review. New test floors must follow the shrink-only CI rule in `CLAUDE.md`. No secret value goes in any tracked
file: only the env var name.
