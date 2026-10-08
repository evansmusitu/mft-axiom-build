# MUSITU Axiom Secure Case Recovery — Production Handoff

`production_authority: false`

This branch contains an isolated, tested implementation of verified-identity case-access recovery. It is **not authorized for production deployment** by this handoff.

## Security model

The existing recovery code remains a bearer secret known only to the customer. MUSITU continues to store only its SHA-256 hash.

A customer may opt in to future recovery while they still possess the current recovery code:

1. The customer opens `https://support.mftintelligence.com/recovery/`.
2. Cloudflare Access authenticates the customer **before the recovery surface is served**.
3. The Worker independently validates the signed Access JWT.
4. Only an opaque SHA-256 identity binding derived from the verified Access issuer + subject is stored. No raw email, OTP, Access JWT, password, or raw subject is stored.
5. The customer presents the current recovery code once to bind that verified identity to the case.

If the code is later lost, the same verified identity may request rotation. Successful rotation replaces the stored recovery hash; the old recovery code is immediately invalid.

A case that was never identity-bound cannot be reset from a case ID alone.

## Sensitive cases

Cases already marked `human_approval_required` remain sensitive. A verified identity recovery attempt creates immutable recovery-request evidence and an operator notification. An operator may propose the existing `ACCOUNT_RECOVERY` sensitive action, but a **different independent approver** must approve it. The same operator cannot propose and approve.

An approved `ACCOUNT_RECOVERY` decision is consumable only once by a recovery-code rotation.

Before sensitive recovery is declared operational, production Access/operator bindings must contain a distinct independent approver identity in addition to the primary support operator.

## Required production release order

1. Revalidate protected `main`, PR #1, frozen OpenAI blobs, Claude distribution, the current public-support Worker, and the current operator Worker.
2. Take a fresh Cloudflare D1 **Time Travel** bookmark and record only its hash in public evidence.
3. Verify existing case/event/message/approval counts before any migration.
4. Create a dedicated Cloudflare Access self-hosted application for the exact protected path `support.mftintelligence.com/recovery/*`. It must require authenticated identity; do not use a Bypass policy.
5. Configure only the approved identity provider(s). The recovery Worker contract independently verifies the Access JWT, so unauthenticated requests fail closed even if edge policy is misconfigured.
6. Obtain the Access application audience and team domain, then configure the existing support Worker with:
   - `SUPPORT_RECOVERY_ACCESS_TEAM_DOMAIN`
   - `SUPPORT_RECOVERY_ACCESS_AUD`
7. Apply `support/schema.sql` as an **additive** D1 migration. Required new objects include recovery bindings, recovery requests, recovery rotations, indexes, and append-only triggers. Existing case, event, message, assignment, approval, decision, and notification counts must not decrease or mutate unexpectedly.
8. Build the canonical public support Worker bundle so it includes:
   - `support/recovery/index.html` served at `/recovery/` and `/recovery/index.html`
   - `support/recovery/app.js` served at `/recovery/app.js`
   - backend recovery requests under `/recovery/api/` routed to the support Worker handler.
9. Preserve the current `SUPPORT_DATA_KEY_B64` and `TURNSTILE_SECRET_KEY` by strict inherited bindings. Do not copy, reveal, rotate, or log either value merely to deploy recovery.
10. Keep `workers.dev=false` and preview URLs disabled.
11. Verify `robots.txt` contains `Disallow: /recovery/` and the recovery HTML returns `noindex,nofollow,noarchive`.
12. Run negative tests first: anonymous recovery UI/API denied; forged/wrong-audience/expired Access JWT denied; wrong identity denied; unbound case denied; current recovery code required for binding.
13. Run the opt-in happy path on a synthetic non-sensitive case: bind identity with current code → lose/forget code → same identity rotates → old code denied → new code opens thread.
14. Run sensitive-case governance with synthetic data: request generated → primary operator proposes `ACCOUNT_RECOVERY` → same-person approval denied → distinct independent approver approves → one rotation succeeds → approval reuse denied.
15. Verify all support regressions and protected states again before declaring recovery operational.

## Deliberately preserved boundaries

- Operators never receive or retrieve customer recovery codes.
- Case IDs alone never authorize recovery.
- Raw contact data is not added to the support case schema.
- No raw email, OTP, JWT, or Access subject is stored in recovery records.
- Existing encrypted customer narratives remain encrypted by the current support Worker key.
- Recovery records and rotations are append-only outside the existing authorized purge lifecycle.
- `main`, PR #1, frozen OpenAI submission assets, Claude distribution, and unrelated production surfaces remain outside this release.
