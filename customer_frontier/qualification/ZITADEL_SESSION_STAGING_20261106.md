# Durable staging identity session candidate — NOT RELEASE

This change continues PR78 at `67de1a9d915914ce74d6d6012dc426fc66df6190`
(`d972b6164de4fb0d3bdbaf445cccc5b768219fab`). It supplies the previously
missing origin-local callback/session behavior. It does not qualify the hosted
provider, provision a canonical production account or integrate any PR.

## Boundary and observable behavior

- Browser entrypoint: only the registered
  `https://axiom-customer-staging.mftintelligence.com` origin; GET `/auth/start`
  and `/auth/callback`, POST `/auth/logout` with exact Origin.
- Fixed ZITADEL client/issuer/callback inherited from the actually created
  staging client recorded in PR78. Code exchange has no client secret and
  accepts no caller-selected provider, audience or redirect destination.
- Random state, nonce and S256 verifier are bound to one host-only browser flow
  cookie. Durable state/browser hashes identify an AES-GCM encrypted payload;
  authenticated data binds the ciphertext to this version, origin and flow.
- Conditional claim gives one callback winner before provider redemption.
  Failed or ambiguous redemption remains consumed. Crashed `processing` flows
  require a new login, never a repeated exchange. A wrong browser cannot burn
  the legitimate pending flow.
- Provider signatures, nonce, MFA, verified subject-bound UserInfo and freshness
  use the PR78 cryptographic verifier. Session and flow completion commit in one
  batch. A slow commit cannot report success after expiry; any unexposed minted
  credential is durably revoked on the failure path.
- Only a random session credential goes into `__Host-axiom_customer` with
  Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain. Storage contains its
  SHA-256, subject, issuer, times, flow reference and terminal revocation state;
  no raw provider token, email, browser credential, role or customer UUID.
- Sessions end no later than five minutes after the signed authentication time.
  Logout is local durable session revocation, not provider-wide SSO logout.
- Private verification is available only through the separately named Worker
  entrypoint. The public fetch handler never dispatches a private route based
  on a request header or URL. It checks the current session twice around an
  independent canonical-link/membership/tenant read and checks time again after
  the last storage await. Direct D1 bindings are used for primary reads; a
  reused first-primary session could otherwise permit later stale replica reads.
- No canonical mapping is inferred from email or provider role. Existing active
  canonical mapping and active membership/tenant are required for an assertion.
  No enrollment, ownership or `production_qualified` assertion is emitted.
- This entrypoint refuses OAuth audience assertions. A staging host-only cookie
  cannot establish production OAuth origin continuity. The separate reviewed
  cross-origin handoff is still required.
- A fixed lifetime cap of 1,024 flows bounds anonymous staging storage writes.
  Exhaustion fails closed without minting cookies or expanding paid resources.
  No deletion, retention job, rate-limit infrastructure or capacity upgrade is
  implicitly authorized. Resource quotas and edge request limits remain a
  hosted admission condition; this cap is not a production abuse-control claim.

## Schema and rollback conditions

`zitadel_session_broker_candidate.sql` is a fresh staging namespace candidate,
not an existing-schema OAuth upgrade and not a replacement for PR77. It contains
no `IF NOT EXISTS`: an existing table/trigger collision must stop application
for schema/body review. SQL prevents flow identity changes and replay, session
identity edits, credential resurrection, REPLACE collisions and evidence
deletion. Existing customer/OAuth data is not rewritten.

Before any hosted application: identify the exact approved staging DB and
schema, retain backup provenance, prove restore in isolation, inspect dirty
rows and trigger bodies, test atomic claim/RETURNING and batch rollback on real
D1, and independently accept the forward and rollback plan. Never restore old
auth state into service without the separately proven monotonic revocation /
anti-rollback authority. SQLite tests do not establish hosted D1 guarantees.

## Admission and remaining gates

Default behavior is closed. No deployment config, route, secret or qualification
flag is enabled by this change. `CUSTOMER_IDP_STAGING_ADMITTED`,
`CUSTOMER_IDP_BINDING_ADMITTED`, the independently held encryption key and the
two exact DB bindings are inputs to be admitted after real evidence. A source
environment variable or green synthetic test is not that evidence.

The Worker wrapper has syntax validation only until a real Workers runtime is
qualified. Required external evidence still includes provider metadata/key
readback, an actual owner callback, two real device/browser sessions, negative
state/nonce/replay checks, private binding isolation, local/global logout and
recovery policy, signing-key custody, fresh canonical production account
ownership, approved hosted D1 migrations/backup/restore/isolation, production
OAuth origin handoff, execution/payment and independent custody/anti-rollback.

The separately admitted execution provider was freshly read as `UNAVAILABLE`,
with external execution authority false and production authority false. No paid
inference, payment, hosted SQL, deployment, merge or publication is performed.
Existing Paynow authority and production rollback origin remain unchanged.

Main and PR1/77/78 were checked before writes: main `b10a74b435feb25654d4cf67ba67d09602698a3e`,
PR1 `8fc1fbb7c5ebbcc1604ecf24c5f4594f2d5667e3` (draft/unmerged),
PR77 `4bb938d679a384cc2e499c09569a55c6b880a5fb`, PR78 as above. No new drift.
The separately recorded PR1 rejection remains binding and unbypassed.

`B27=FAILED_IN_SYNTHETIC_ATTACK`; parity/superiority `NOT_CERTIFIED`;
unavailable final usage `UNKNOWN`. Full product breadth is retained in the
remote base tree; this is a bounded identity change, not a product replacement.

## Reproducible verification

Run the repository workflow commands: `node --check` for control-plane modules,
`node --test customer_frontier/tests/*.test.mjs`, Python unittest discovery and
the frontier benchmark verifier. The added tests use real RSA signatures and
real local SQLite, including physical close/reopen, races, failure rollback,
revocation and time advancing across storage operations. Provider transport,
admission flags, tenant/ownership records and keys in those tests are synthetic.
They must never be reused as live qualification or account-ownership receipts.

Separate review reproductions and exact rejected source snapshots are retained
under `customer_frontier/evidence/idp-session-20261106/`. Fresh final test/CI
results belong to the accompanying validation receipt and draft PR. Automated
source review is not independent human custody or a release approval.

Primary API references consulted 2026-11-06:
https://developers.cloudflare.com/d1/worker-api/d1-database/
https://developers.cloudflare.com/d1/worker-api/prepared-statements/
https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
