# Separate read-only code review — source level only

Reviewer: separate Codex reviewer `review_customer_identity`, dispatched using
the requesting-code-review skill with no session history or write authority.
Baseline `2328e294f6ae7a13d383e81ae5bc7c875f489218`; initial candidate tree
`7f0d03adeb6eac022435cd04f326fac0e6fa299d` (local commit `990d773af84f7ad9f8ad2ffe35a485eb559f38cb`,
remote same-tree commit `16cc28dd57ef95edd9c1992877760e0e71177ed4`), followed by a
focused review of the SQL/schema collision guard and migration regression.

## Findings accumulator

**Medium / high confidence — FIXED.** Initial UPDATE/DELETE triggers allowed
`INSERT OR REPLACE` to erase a revoked mapping and insert an active replacement
under SQLite's default `recursive_triggers=0`. The reviewer independently
reproduced changed customer UUID/proof, active replacement status, and clean
foreign-key checks. This required database-write access; no current public HTTP
exploit was established. The builder added a red regression (retained log), then
a BEFORE INSERT collision guard for identity, customer UUID and proof ID. The
reviewer confirmed that replacement is rejected and the revoked row survives.
The original finding remains recorded even though the repair passes.

No additional verified material defect was reported for challenge replay,
credential/request binding, issuer/audience/time validation, enrollment home,
mapping qualification/consent/legacy ownership, role derivation or tested
revocation races.

Fresh reviewer execution after repair: Node 24.22.1 **117/117**; Python 3.12.14
**20/20**; focused migration **3/3**. The misleading timeout test name was
corrected: it exercises immediate exceptions/malformed response/outage, not
elapsed/hung transport cancellation. Hosted timeout remains unproven.

## Verdict and limit

No unresolved material source-review finding after the repair. Continued
isolated draft integration may proceed after committing reviewed changes and
fresh CI. **Partial specification acceptance at local source/test level**.

This software review is not authenticated human verifier acceptance, independent
key custody, IdP provider qualification, hosted D1 proof, security-authority
approval, B27 acceptance, or release certification. Real IdP/OIDC/revocation,
hosted timeout/cancellation, actual production UUID ownership, D1 migration,
concurrency/recovery and live OAuth remain external gates. The reviewer performed
no external system, credential, billing, deployment, merge or main/PR1 action.
