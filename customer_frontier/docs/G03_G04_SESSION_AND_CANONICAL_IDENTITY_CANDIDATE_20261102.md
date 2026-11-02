# G03/G04 isolated source candidate — NOT RELEASE

Objective: consume independently authenticated sessions and bind the same issuer,
subject, tenant and existing production customer UUID across the website and a
future ChatGPT OAuth integration. Actor: Codex builder, not independent security
authority. Branch: `build/axiom-customer-session-mapping-20261102`. Baseline:
PR #68 `2328e294f6ae7a13d383e81ae5bc7c875f489218`.

## Authority and drift before writes

Downloaded the owner's exact Drive ZIP and checksum. ZIP: 89,614,504 bytes,
SHA-256 `1e72e6b6c54fa202e80b3ce8eaaaea4291d2bee813cdf870840e5910b8ad76c0`.
Safe extraction and CRC passed. Original verifier markers freshly observed:

- `MUSITU_AXIOM_CUSTOMER_CONTINUATION_20261102_VERIFIED_NOT_RELEASE_PASS`
- `MUSITU_AXIOM_20261102_CONTINUATION_VERIFIED_NOT_RELEASE_PASS`
- `MUSITU_AXIOM_20261029_WHOLE_PRODUCT_HANDOFF_DEEP_VERIFY_PASS`
- `MUSITU_AXIOM_WHOLE_PRODUCT_20261025_OWNER_CUSTODY_HANDOFF_VERIFY_PASS`
- `MUSITU_AXIOM_20261024_HANDOFF_VERIFIED_NOT_RELEASE`
- `MUSITU_AXIOM_FINAL_PRODUCT_HANDOFF_VERIFY_PASS` (original Constitution authority)

Fresh connected GitHub reads: main `06cc5f74fb066c11f8d81390f424e58a2f9c261a`;
PRs #1, #57–#62, #67 and #68 all open, draft and unmerged with head refs matching
the current transfer. PR68 tree `08b5ef4ebb9d5b7d5e2ce6f92cc0eac286b17c91`;
CI `41506227846` successful. No AGENTS.md in that tree. No head drift found.
Older embedded commands have a stale 2-Nov ZIP size and older gate numbering;
the latest transfer's verified bytes and register control this work. PR metadata
can retain historical base SHAs; direct branch reads control current heads.

## ADR: separate session proof from canonical account authority

`identity_session.mjs` is a private-verifier client, not an IdP. Every call uses
a new 256-bit challenge, explicit audience/purpose and SHA-256 of credential,
HTTP method and complete request URL. Only cookie or bearer transport is allowed,
never both. Missing/ambiguous credentials are rejected before the verifier call.
No browser JSON, tenant header or role header is forwarded as identity proof.

The independently operated verifier must actually validate IdP signature/key
rotation, issuer, audience, state, nonce, S256 code exchange, browser session and
current revocation. The consumer requires those session assurances, verified
email/MFA, an opaque session ID and positive session version; rejects copied
responses, wrong issuer/audience/challenge/digest and invalid timestamps. Candidate
bounds: verification age 30 seconds, future skew 30 seconds, session lifetime
15 minutes, authentication age 12 hours. Independent security must approve these
bounds and the real provider contract before any deployment or admission flag.
The request uses a five-second abort signal; hosted timeout behavior is unproven.

Enrollment now uses the same challenge, issuer and session assurance checks
without requiring a tenant before first provisioning. Existing identities resolve
only through an original enrollment receipt with one active home. Arbitrary
enterprise memberships, suspended homes and conflicting proof reuse require
review; they cannot generate replacement tenants or owner roles.

`canonical_identity.mjs` contains a **private, unmounted** linking seam. A separate
qualified account-link authority must independently attest the existing production
`customers.id`, active customer, issuer/subject, selected tenant, explicit consent,
proof ID and authority identity. Legacy links additionally require independently
verified legacy ownership and its evidence ID. Never pass a raw legacy key to
this module, browser JSON, logs or receipts. Email equality is never ownership.

The local mapping is unique by identity, customer UUID and proof ID. SQL prevents
rewrites/deletion and makes revocation terminal. Its receipt hashes non-secret
approval metadata. Insert rechecks active membership/tenant at the mutation.
Idempotent retries require the same approved link receipt; UUID substitutions,
proof reuse and tenant changes are conflicts, including after lost acknowledgement.
No role is copied from the verifier; database membership controls role.

Website `GET /v1/customer/identity` and candidate `resolveOAuthCustomer()` resolve
the same durable mapping. Missing mapping returns `canonical_mapping_required`;
revoked mappings, memberships and suspended tenants deny access. The OAuth helper
requires its distinct `axiom-chatgpt-oauth` audience and is deliberately **not wired
to production token minting**. Existing `/me` remains a tenant profile, not proof
of production-customer continuity. Canonical consumers must use the new seam.

## Migration, compatibility and rollback

`canonical_identity.sql` is an additive candidate included verbatim in initial
`schema.sql`. Upgrade testing starts with the prior schema and existing rows,
applies the new migration twice and checks referential integrity. It never
autolinks old identities, creates production customers, changes roles, provisions
entitlements or creates another merchant/subscription authority. Missing schema
or unapproved mappings fail closed; there is no permissive legacy fallback.

No hosted database was accessed or migrated. Before staging: approved isolated
D1, dirty-row preflight/quarantine plan, snapshot/restore, D1 concurrency/restart,
independent migration acceptance and owner authorization. Do not infer SQLite
semantics as hosted D1 proof. Rollback this source candidate by abandoning its
isolated branch; production remains the rollback origin. Do not delete mapping
or evidence rows to undo a live identity decision. Account recovery/relinking,
multi-IdP and enterprise home changes require separately reviewed authority.

## Verification and remaining gates

New security regressions first ran against PR68: G03 2 pass / 5 fail; G04 0 pass /
6 fail, including accepted response replay, missing assurance and arbitrary
existing-tenant selection. Missing new linking seam was recorded as absent
implementation, not a live exploit. Original logs are retained under `evidence/`.
The first integrated run had 108/110 passes: one old expectation required a
SQLite uniqueness error rather than the new explicit proof-conflict denial, and
one old enrollment fixture lacked the now-required pinned/bound session. Both
fixture changes preserve their original denial and zero-write assertions.

Local Node 24: **117/117 passed**, zero failures/skips. Python 3.12: **20/20 passed**.
GitHub CI must independently run the Node 22 and Python 3.12 workflow on the
committed candidate. A separate code review is required before further integration.
Those are source checks, not authenticated external security acceptance.

G03 real provider, G04 actual production mapping/migration, G05 live ChatGPT OAuth,
G06 staging D1, real five-object execution/usage, existing Paynow reconciliation,
privacy/support fulfillment, physical devices, independent custody/recovery/veto,
and full release remain unearned. No provider, billing, identity authority, live
credential, main, PR1 or production change is performed by this candidate.
B27 remains `FAILED_IN_SYNTHETIC_ATTACK`. Superiority and Wolfram parity remain
`NOT_CERTIFIED`. Cash spend is $0; no inference or provider mutations.

## Separate code-review correction

The separate reviewer reproduced a Medium database-contract defect: with SQLite
`recursive_triggers=0`, `INSERT OR REPLACE` could bypass delete triggers and
replace a revoked mapping. A new regression failed with `IntegrityError not
raised` before repair. A BEFORE INSERT collision guard now rejects reused
identity, customer UUID or proof ID before implicit deletion. The red log is
retained as `evidence/g03-g04-20261102/g04-review-replace-red.log`. This finding
was fixed rather than dismissed because the present application uses plain
INSERT. Hosted timeout/cancellation behavior remains unproven; the exception
transport test was renamed to describe its actual coverage.
