# MUSITU Connect + MUSITU Axiom — full commercial GA release

Status as of 27 October 2026: **OWNER ENGINEERING AUTHORIZATION GRANTED; GA NOT QUALIFIED / NOT RELEASED.**

This replaces pilot/beta as the *desired launch type*. It does not overwrite the
historic beta-release evidence, turn on admission, create customer credentials,
or allow unvalidated methane prediction in production. MUSITU Connect is the
enterprise interoperability platform; MUSITU Axiom is its downstream quantitative
engine. The previously authorized Connect-to-Axiom arithmetic runtime is
separately recorded enabled, and must be preserved during release activities.

## Non-optional production GA controls

The authoritative documentary register is
`qualification/musitu_connect_commercial_ga_release.json`. Run:

```sh
python qualification/validate_commercial_ga.py --audit
python qualification/validate_commercial_ga.py --enforce-ready
```

Audit mode succeeds for a *consistent blocked state*. Enforce-ready fails while
any required evidence or a separate release promotion is missing; neither mode
is an infrastructure deployment. Even a green documentary gate does **not**
independently authenticate the Cloudflare account, a provider log, a signer,
legal approval or a human incident acknowledgement. Operators must independently
verify the referenced evidence before any production action.

The requirements include isolated hosted Cloudflare D1 transaction/concurrency
and tenant isolation; separately scoped real customer identity, registration,
rotation, revocation and offboarding; real billing and refund reconciliation;
a documented backup/restore RPO/RTO exercise; delivered and *human acknowledged*
incident paging; production security, legal/privacy/DPA, commercial support
readiness; and a domain/MCP release review. No pilot or beta customer validation
is required by this **GA-specific** policy.

## Release-file parser integrity

A control marked QUALIFIED must identify a structurally valid HTTPS source
document or GitHub Actions evidence locator (including a path), a bounded
nonempty verifier identity, and a real UTC ISO-8601 verification timestamp
that is not future-dated. Credentials embedded in evidence URLs, empty
hostnames, non-HTTPS public links and impossible dates fail closed. These
checks validate pointer syntax and time only; they do not authenticate a
provider account, reviewer identity, legal approval, signed acceptance or
evidence integrity. Approval remains separately attested after external review.

Before evaluating any release evidence or approval signature, the non-enabling
GA validator reads at most 65,536 bytes of strict UTF-8 JSON and rejects
duplicate keys (including nested release flags), `NaN`, `Infinity`,
`-Infinity`, finite-number overflow such as `1e999`, oversized records
and unreadable JSON. Invalid records fail closed in audit and enforcement
modes. This prevents multiple interpretations of one approval document and
unbounded parsing; it **does not** establish the authenticity of the external
evidence and does not authorize customer admission.

## Release authorization integrity

The GA register is auditable documentary data, **not a production release
permission**. An all-`QUALIFIED` JSON record, even if it lists independent
verifier names and HTTPS evidence links, cannot promote customer access on its
own. The production approval is a 64-character SHA-256 HMAC
hex digest computed over the canonical UTF-8 JSON record **excluding**
`release.approval_hmac_sha256`. The byte sequence is
`json.dumps(record, sort_keys=True, separators=(',', ':'), ensure_ascii=False)`.
An independently controlled `MUSITU_GA_RELEASE_APPROVAL_KEY` (at least
32 UTF-8 bytes) must verify that digest. The approval key **must never** be
committed, exported with release artifacts or injected into ordinary CI.

A valid HMAC proves a release-approval key holder approved this exact record;
it **does not establish** whether a Cloudflare log, legal signature, incident
acknowledgement or a mine dataset is authentic. The holder must verify those
out-of-band, against immutable original source evidence, before approving.
The release checker never deploys, provisions tenants or opens registration.

The dedicated non-enabling workflow
`.github/workflows/musitu-commercial-ga-release-gate.yml` audits changes
on main and pull requests without privileged credentials. A green check means
only that the blocked policy is syntactically and logically consistent.

## Controlled progression

1. Maintain existing production compute; do not redirect, rotate, or overwrite
   its credentials during staging. Keep the frozen methane model and score
   thresholds unchanged and methane prediction research-only.
2. Provision isolated staging resources and run real hosted D1 scoped-identity,
   concurrent quota, idempotency, replay, revoke, tenant separation, resilience
   and rollback tests. Record provider account, database, commit and run IDs,
   test transactions, cleanup results, and evidence digests; exclude secrets.
3. Complete commercial customer lifecycle, charge capture/reconciliation,
   operations, legal/privacy and human signoff with independently checked records.
4. Promote through distinct release authorization and automated production checks.
   Keep issuance/public registration disabled if any control remains unproven.
5. Verify production health, failed unauthorized access, audited request-ID and
   ledger correlation, charges and refunds, human paging and rollback capability.

## Non-automatic live E2E

`musitu-connect-axiom-credentialed-e2e.yml` creates and deletes temporary
identity/usage records in an existing live Axiom D1 database. Its `push` trigger
was removed before the merge because a routine `main` merge must not cause
production data writes. It remains manually dispatchable for deliberately
scoped operator qualifications. This measure prevents an *automatic* write; it
does not qualify hosted Connect customer D1 or commercial launch.

## Research boundary

Commercial release of validated arithmetic/integration capabilities is
independent of the methane predictor. The pinned 54-feature LightGBM, 600 s
causal history, 180–360 s future horizon, 30 s stride, measured warning ≥ 1.0,
score threshold 0.022545819099925965 and at least 3/4 chronological fold
precision/recall/F2 requirements remain unchanged. No synthetic experiment
or owner authorization is independent operating-mine evidence.
