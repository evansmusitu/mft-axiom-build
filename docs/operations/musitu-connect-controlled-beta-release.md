# MUSITU Connect — Controlled enterprise beta release gate

**Assessment: 21 October 2026. Status: BLOCKED for new customer admission and public commercial publication.**
This is a non-enabling feature-branch planning and engineering record, not a launch authorization.
Machine-readable gate: `qualification/musitu_connect_beta_release_gate.json`.

## The release we can accurately describe

MUSITU Connect is the enterprise interoperability/runtime layer; MUSITU Axiom is its
separately governed quantitative execution service. The initial proposed beta is an
**invitation-only API for canonical Mining intervention planning and one-record
Axiom arithmetic risk calculation**. It is not a production methane predictor,
a certified mine safety alarm, a customer industrial-control connector or a
general-purpose self-serve marketplace.

Current production Workers.dev endpoint:
`https://musitu-connect-production.mft-education-nexus-93f395f5.workers.dev`

**Production source is pinned to an older authorized rollout.** This feature branch
does not redeploy it. Existing production Connect-to-Axiom computation is enabled,
but its current shared internal service authorization must never be issued to new
customers or treated as tenant isolation. Public source availability also does
not create customer access rights.

## Release contract and newly hardened feature behavior

- `GET /health`: release, service and upstream configuration status; no login.
- `POST /api/mining/plan`: validated nonempty Mining rows and nonnegative budget,
  deterministic optimal selection **only if the bounded exact search completes**.
  Feature branch rejects more than 10,000 examined search states with HTTP 400
  `PLAN_SEARCH_LIMIT_EXCEEDED`, returning **no partial plan**.
- `POST /api/mining/risk`: exactly **one** Mining row and a run ID. Multiple
  rows now return HTTP 400 `RISK_SINGLE_ROW_REQUIRED` *before* external
  Axiom execution, instead of silently ignoring all but the first record.
  A successful call computes exposure × severity × likelihood using the
  existing separately authorized Axiom compute path. Not a methane forecast.
- Canonical contract: `contracts/connect.openapi.yaml`.
- Internal bearer authorization only; **no public customer credential scheme
  currently qualifies**. Contract is a restricted, feature-branch beta contract,
  not proof that the deployed Worker implements the changes.

These are compatibility changes from the current production source. Before
a separately approved rollout: profile worst-case compute and request sizes,
establish supported workload policy with security review, run isolated canary,
verify old clients' responses, retain rollback and validate live behavior.
Passing branch CI does **not** authorize a production update.

## Blocking engineering and operational controls

| Gate | Required proof | Current verified position |
| --- | --- | --- |
| Identity | Connect-specific per-organization credentials, expiry, revocation and rotation | Not demonstrated |
| Isolation | Cross-tenant records and accounting are inaccessible to other tenants | Not demonstrated |
| Limits | Enforced per-customer quotas, request byte limits and CPU/load testing | Not demonstrated |
| Onboarding | Invite, provision, suspend, rotate, revoke and erase an approved pilot account | Not demonstrated |
| Operations | Alert reaches a real, authorized on-call human; rollback and recovery drill | Not demonstrated (synthetic alert only) |
| Legal | Connect-specific terms, privacy and applicable DPA reviewed and approved | Not demonstrated |
| Partner evidence | Two owner-approved design partners complete a recorded end-to-end acceptance | Not demonstrated |
| Custom domain | Narrow Cloudflare permission without relaxing zone security | Deferred; Workers.dev currently available |
| ChatGPT distribution | Separate Connect MCP endpoint, authentication, publisher review and approval | Not started |
| Methane safety | Real independent mine evidence and frozen-protocol safety qualification | Blocked, out of beta scope |

Each gate requires independently reviewable evidence, not a manually flipped
boolean in a JSON file. Legal/commercial and real-world data authorization
must be signed by their respective owners. No customer names, private sensor
records or secrets should enter this public repository.

## Implementation sequence and acceptance tests

1. **P0 — Lock scope and behavior.** Keep `contracts/connect.openapi.yaml`
   synchronized with the actual Worker. Node contract tests must prove that
   multi-record risk is rejected *without* an Axiom call and that expensive
   searches cannot return a partial purported optimum. Run
   `node --test tests/connect/test_production_worker.mjs`.
2. **P0 — Separate customer identity.** Design a Connect-owned credential
   and tenant store with tenant-scoped permissions, expiry, revocation, rotation,
   quotas and usage correlation. The upstream Axiom key remains server-side.
   Verify two distinct fictional tenants, invalid/revoked credentials,
   cross-tenant denial and missing-secret fail-closed behavior in isolation.
3. **P0 — Operations/legal.** Establish named incident owners, human paging
   acknowledgement evidence, release rollback, data retention/deletion,
   a signed beta agreement, Connect-specific privacy/terms and a secure
   customer support channel. No production paging tests or sensitive messages
   without separate approval.
4. **P1 — Design partner gate.** With signed authorization, provision one
   pilot organization at a time; test approved customer workflows,
   usage attribution and safe offboarding; obtain the product, engineering,
   security, operations, legal and customer-owner signoffs before admitting
   additional customers.
5. **P2 — Public distribution.** Branding/domain, billing and Connect MCP
   publication follow a separate review and explicit go/no-go decision.
   Public plugin publication cannot be inferred from the Axiom plugin work.

Test the non-enabling release state with:
`python -m unittest tests.connect.test_beta_release_gate -v`.
Existing Connect CI also verifies `qualification/validate_production_admission.py`
and `qualification/verify_live_production_runtime.py`, but these protect
previously authorized production compute; they do **not** qualify new users.

## Rollout and authorization boundary

No change to `main`, no PR #9 merge, no deployment, no customer onboarding,
no live credentials, no customer mine telemetry, no charge collection, no
ChatGPT listing submission and **no production predictive methane use**
are authorized by this document or by the feature-branch engineering changes.
A later explicit release authorization is required for each external action.

**Recommended commercial path:** restricted two-customer design-partner beta
after the P0 gates, broader REST/API release after measured acceptance and
support readiness, and a separately reviewed Connect MCP plugin afterward.
