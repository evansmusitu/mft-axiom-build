# FA-20 — Staging → Canary → Production → Continuous Repair — Pre-write Intent

Status: AUTHORITY_FROZEN_FOR_RELEASE_CONTROL_QUALIFICATION

## Frozen source and authority

- source branch: `frontier/axiom-final-product-fa19-20260916`
- source commit: `9de2da15d9e532eff9f992354d25995ff9a76c7a`
- FA-19 qualification run: `35076311386` — PASS
- authority basis: user direction to continue to FA-20, scoped to implementation and read-only qualification
- staging authority: absent; exact future confirmation is `START FA20 STAGING AND CANARY`
- production authority: absent; staging consent cannot authorize production
- paid-provider keys: not required for FA-20 release-control qualification

The accepted FA-16 tablet boundary remains `DEFERRED_PENDING_FUTURE_CUSTOMER`. FA-19 paid-provider comparison sessions remain `DEFERRED_NO_PAID_PROVIDER_ACCESS`. Neither deferral blocks release-control implementation, and neither may be relabeled as completed evidence.

## Immutable rollback origin

The existing production app remains live and retained until a future candidate completes the governed path. Its sealed rollback evidence is:

- production hostname: `axiom.mftintelligence.com`
- service: `musitu-axiom-fa13-production-ui-edge`
- exact source candidate: `4c99c4ccbc4a9e34f4e446f30c31f4d428359818`
- release run: `35052550238`, attempt 2
- evidence SHA-256: `d82dae88d967a5c466c03dd5698ec575f05c5434230494d2fa39fb7bfba4afa8`
- status: `PASS_PRODUCTION_PROMOTED_AND_MONITORED`

## Release truth boundary

The release order is fixed as development → tests → adversarial → staging → smoke → canary → rollback rehearsal → staging restored → production → monitoring → rollback proof → production restored → evidence sealed.

This initial FA-20 candidate implements and independently verifies that control plane only. It cannot execute staging or production. A later, separate authority file must bind isolated staging/canary to an already qualified exact candidate. After successful preproduction evidence, production still requires a new exact-SHA S4 request, the literal human confirmation `APPROVE FA20 S4 PRODUCTION PROMOTION`, and a distinct independent-verifier release approval.

Continuous repair is fail-closed: incidents become hash-bound Work Contracts, high/critical incidents require rollback, repairs cannot silently patch production, and every repair produces a new candidate that re-enters the full qualification path.

Expected result of this slice:

`FA20_RELEASE_CONTROL_VERIFIED_STAGING_AUTHORITY_PENDING`

with `old_app_retained=true`, `staging_executed=false`, `production_executed=false`, `phase_exit_earned=false`, `production_authority=false`, `WOLFRAM_PARITY=NOT_CERTIFIED`, and `SUPERIORITY=NOT_CERTIFIED`.
