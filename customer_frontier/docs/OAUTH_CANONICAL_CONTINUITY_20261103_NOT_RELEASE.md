# Customer OAuth continuity — 3 November 2026, NOT RELEASE

## Change contract and source reconciliation

Owner requested completion of real IdP, production account ownership, staging,
execution/payment/device acceptance and custody. Existing isolated $0 engineering
authority continues; identity grants, consequential hosted migrations/deployment,
real charges and release still require scoped approval and independent gates.

Branch: `build/axiom-customer-oauth-continuity-20261103`.
Base: PR70 `627e075e400e4c24a9ba4fa944e19e207da8b23c`.
Reuse source: PR66 `cac0cced651bc5f107f2c38e60ed28db329f85e4`.
Fresh connected reads found no head drift in main, PR1, PR66 or PR70. All named
PRs remain draft/unmerged. Nine added PR66 files were recovered by exact Git
blob content; existing PR70 files were retained. No AGENTS.md was found.

The separate candidate stacks previously had no enforced relationship between
website canonical mapping and OAuth code/token admission. Their combined old
tests passed 134/134, which did not establish integration. New cross-surface
regressions reproduced those gaps before repair. Evidence replays the exact
unmodified PR66 additions on PR70 with the new tests: 1/7 passed, 6/7 failed.
This is an offline regression baseline, not a live attack or provider proof.

## Implemented candidate behavior

- One shared private session contract, replacing the stale embedded copy in
  the OAuth candidate. Its per-request challenge and credential/request digest
  now include the server-selected OAuth flow ID. Exact issuer, audience,
  flow, verified email/MFA and freshness are required. PR65's stronger five-minute
  recent-authentication and proof-lifetime bounds are retained for consent.
- The existing OAuth/customer database mapping must agree with the website's
  canonical customer UUID, issuer/subject, tenant and active membership. Browser
  IDs, general IdP administrator roles and email equality do not link accounts.
  Missing/unavailable canonical storage or conflicting mappings deny consent.
- Canonical authority is rechecked for code exchange, refresh and UserInfo.
  During mint, a second check after token persistence prevents the tested
  revocation interleaving from returning credentials. Unexposed keys and both
  token records are revoked while immutable linkage evidence remains.
- OAuth identity/code/token mappings reject conflicting INSERT/REPLACE before
  implicit deletion, preserving the terminal-revocation contract under SQLite's
  default `recursive_triggers=0`.
- Legacy account-key behavior remains a distinct candidate path. No production
  OAuth file, public MCP surface, merchant, prices or customer records are changed.

The candidate now imports shared modules and must be bundled for any separately
approved staging deployment. It is not a replacement raw module for the existing
single-file production deployment.

## Storage, revocation and rollback limits

`AXIOM_DB` and `CUSTOMER_DB` are distinct bindings; the new integration fixture uses
two separate SQLite databases. There is no cross-database foreign key or atomic
distributed transaction claim. Existing legacy tests also exercise colocated
offline stores. Real D1 leases, races, outages and restore still require hosted
qualification. Post-mint denial attempts local credential revocation; if that
write fails, no token response is returned, but recovery/operator containment
must be independently qualified before deployment.

Revoking the OAuth identity link still invalidates its API keys through the
reused same-D1 triggers. Canonical website revocation now denies this candidate's
OAuth consent/code/refresh/UserInfo routes. **Direct MCP denial from a revocation
originating in the separate canonical database is not yet established:** it needs
an approved event/introspection integration and actual cross-worker acceptance.
Do not claim global logout, immediate distributed revocation or B27 repaired.

The source rollback is to abandon this isolated branch. No hosted migration was
applied. Live identity records must never be deleted/relinked to undo a release;
use separately approved recovery and preserved evidence. Production remains the
rollback origin.

## Fresh external observations

The owner selected an existing IdP. Saved provider-origin evidence identifies
`https://musitu-whatsapp-staging-mpqgsc.eu1.zitadel.cloud`, used by the separate
WhatsApp project. Public discovery returned HTTP200 with exact issuer and S256;
fresh readback and public JWKS status/digests are in
`evidence/oauth-continuity-20261103/external-readback.json`. These public endpoints
do not prove an authenticated AXIOM session, its MFA, account ownership or custody.
The console requires secure owner sign-in. No credential was retrieved/exported.

Reuse the instance only with a separately approved AXIOM application/audience,
exact staging callback, scoped secrets and service bindings. Never reuse the
WhatsApp application's credentials or inherit its tenant/security acceptance.
New application/security grants remain approval actions.

The connected production arithmetic operation returned 12 for 7+5 through an
existing account. The response's `verified` field was null and it contained no
usage or five-object receipt. This proves bounded computation only, not fresh
customer onboarding, payment, metering or end-to-end acceptance. The private
operator's provider status reported UNAVAILABLE with external/production
authority false. No provider inference was requested.

## Verification and the next real gates

Local verification after separate review: 149/149 Node, 20/20 Python, JavaScript syntax. Includes two
databases, canonical mismatch/revocation/unavailability, copied assertions,
revocation after code and during mint, token refresh/UserInfo, REPLACE defense
and all preserved financial/tenant tests. Separate source review and exact-tree
GitHub CI must pass before further integration. A source review is not an
authenticated human verifier or independent security-authority acceptance.

The remaining real acceptance actions are:

1. Secure owner IdP login and readback of the existing instance, MFA/recovery and
   client inventory. Prepare the exact AXIOM application change for approval;
   qualify signed tokens, session/revocation and service bindings on the approved
   staging callback. Public metadata alone does not close G03.
2. Independent owner/account authority verifies existing production customer UUID
   and legacy ownership; explicitly approves staged mapping and consent evidence.
   No auto-link, synthetic ownership proof or new billing authority.
3. Approve named isolated staging databases/Workers and $0 hard bounds, then
   snapshot, migrate, restore and run real OAuth/MCP/tenant/revocation tests.
4. Obtain real five-object usage/evidence receipts, approved existing Paynow
   sandbox/financial evidence and physical-device/reviewer acceptance. No charges
   or claim of real settlement from an offline fixture or arithmetic call.
5. Separately administered operator key/recovery custody and authenticated verifier
   veto, nonrollbackable monotonic history and destructive replay/recovery proof.
   Existing operator appointment alone cannot establish those properties.

B27 remains `FAILED_IN_SYNTHETIC_ATTACK`. Wolfram parity and superiority remain
`NOT_CERTIFIED`. Whole-product breadth and all previous failure evidence remain.
No main write, PR1 merge, public release, hosted mutation or security grant.

## Separate review and repairs

The reviewer independently reproduced a High inherited legacy-suspension defect:
an unredeemed legacy code could mint credentials after customer disablement.
All grant/mint/UserInfo paths now independently require an active customer;
database eligibility guards prevent suspension racing with token persistence.
The legacy compatibility case still passes for active customers.

A separate Medium database-contract defect paired identity A with customer B's
code/key and then allowed linked parent reassignment. Exact parent/customer
matching, linked-parent identity immutability, parent REPLACE guards and terminal
linked-key revocation repair it. Red logs and the review accumulator are retained.
The reviewer re-ran 149 Node and 20 Python tests and found no unresolved material
source-review blocker. These are fresh-fixture source results, not an upgrade
approval or replacement for dirty-row/previous-schema/hosted migration testing.
