# MUSITU — Four-gate closure protocol (1 November 2026)

**Scope:** evidence collection and feature-branch readiness; not admission,
production deployment, legal signoff, or mine-safety qualification. Gate owners
must approve their own evidence. Do not reclassify synthetic tests or metadata
as independent physical mine evidence.

## 1. Independent frozen methane-model validation — blocked

The OpenML 42701 / Mendeley `yd7vw4c5mk` source is the known Polish development
corpus. Its November 2026 adapter telemetry replay passing on CI run
`41314438368` (9,199,930 rows scanned and 1,000,000 durable rows) proves a
bounded ingestion/replay contract, **not** independent model validation.

A separate, independently authenticated operating mine must supply licensed,
original full-resolution 1 Hz measurements for all 28 canonical sensors; hash
both source and canonical bytes; supply calibration, site, event and
chain-of-custody evidence; independently review physical methane exceedances;
and seal the chronological holdout before model access. Run the **unchanged**
model and manifest (SHA-256
`3b51f3318fb59d2555b66cbbd41e371f9f0241d2137e5166c77e685f9ab030eb`
/ `f57fab879104a8307f0b472fc106d61c1aa7cf440811229b2221b2266ee779bf`)
and the existing `independent_holdout_protocol.py` and
`independent_mine_readiness.py` screening gates, followed by independent
reviewer-verified scoring. Preserve 600 s past-only history, 180–360 s future
horizon, 30 s stride, measured methane threshold >=1.0, model score threshold
`0.022545819099925965`, 4 chronological folds with >=500 positive future
windows in each supported fold, >=3 supported folds passing, recall >=0.90,
precision >=0.10, and F2 >=1.05x hard-warning baseline. No recalibration,
resampling to fabricate missing channels, or methane prediction promotion.
Human source-rights, physical event and reviewer authentication is not
satisfied by a self-declared JSON record.

## 2. Cross-broker MQTT repeatability — new fail-closed experiment

The previous four-round benchmark met its pinned 2x speed target on GitHub run
`41315132591` (2.048833x) but **did not meet cross-broker repeatability**:
`repeatability_passed=false`, median broker throughput outcome inconclusive,
round outcomes `[LOSS, TIE, TIE, TIE]`. It was possible for CI to report a
successful workflow despite this distinction. The feature-branch regression
now requires `repeatability_passed is True` as well as the original throughput
frontier. The next prospective experiment runs 8 counterbalanced rounds of
1,000,000 MQTT events *per lane*, using the **same** 5% tie band and >=75%
consistent-round rule (therefore >=6 consistent rounds per dimension).
Original broker versions, QoS, batch size 3,000, seed, evidence archiving and
pinned pre-optimization baseline remain unchanged. Any failed or inconclusive
result remains blocked; do not rerun-until-green selectively or retrospectively
adjust the comparison rule. Use new raw evidence and fingerprint when judging
this experiment; success on a different source commit does not transfer.

## 3. Hosted D1 tenant isolation — blocked pending explicit authorization

`qualification/connect_d1_staging_preflight.py` only validates local metadata;
`tests/connect/test_customer_d1_local.mjs` exercises isolated workerd/Miniflare
fixtures. Neither qualifies Cloudflare hosted D1. Before an isolated, *non*
production remote session, obtain explicit authorization from the account and
security owners, an allowlisted staging account/database, isolated worker
binding, approved schema and rollback plan. Rehearse real remote D1 transaction
atomicity, same-credential concurrent quota races, cross-tenant access denial,
provisioning/revocation, audit-chain reconciliation and rollback with **only
synthetic test tenants**. Capture immutable run IDs and independent observer
review. No remote D1 mutation, migration, production Worker change, or real
credential creation is authorized by this document.

## 4. Customer beta and release approvals — blocked pending humans

`qualification/musitu_connect_beta_release_gate.json` intentionally remains
`BLOCKED_PENDING_CUSTOMER_AND_OPERATIONS_EVIDENCE`. The release packet must
contain authenticated tenant rotation/isolation and hosted D1 evidence, real
customer onboarding/offboarding acceptance, payload/rate/quota proof, paging
and named human acknowledgement, legal/privacy/DPA reviews, pilot customer
acceptance and six independent signoffs (product scope, security, operations,
legal/privacy, pilot owner and separate production release). A customer cannot
be admitted by engineering CI or a synthetic test. Keep the separate existing
authorized arithmetic Connect runtime operational and unchanged.

## Non-enabling closure rule

A green CI job does **not** authorize broader release. Independent reviewer
identity, mine rights and physical source are external; Cloudflare hosted D1
requires separate access/authorization; customer terms and operational signoffs
require accountable people. Mark each gate qualified only after its specific
verifiable evidence and accountable approval exist. Never replace the frozen
source, lower a metric threshold, manufacture signatures, or create live
customer identities to change a blocked status.
