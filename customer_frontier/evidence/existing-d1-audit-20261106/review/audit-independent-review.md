# Independent review: existing D1 catalog and current binding audit

**PASS for the bounded read-only observation. No remaining P0–P2 blocker found.** This verdict does not admit a reuse target or qualify backup/restore, migration, custody, integration or release.

Reviewed source commit `5e69ebf3bcb73eebf183a462fa6d6314ccf87665`, tree `721d60e2dfe5a7c45810c930430f52c5d80f01a1`, parent `9ac48710a7aff5590fa4d79b852f6cdba6d14001`. Independent exact-ref GitHub reads matched local source/test bytes and Git blob identities.

| Reviewed artifact | SHA-256 |
| --- | --- |
| Reader | `cb9d2579e8fca36e91d0b999310569019c24e4cedef71c8ec3964b9a8186e90c` |
| Supplied tests | `405e8168a5575d2734108c7302d44fe9431e124bd7c6c983064df64798a2c05b` |
| Final local workflow | `db8fb19195ac32ee8fa5595cf34181758b0b5373dc63e009e8d4221ff1e41034` |

The workflow is reviewed as exact local bytes. Confirm that the published immutable workflow blob matches this hash before opening the credentialed PR. It checks out the fixed source above, verifies reader/test hashes, and runs the offline tests before the sole Cloudflare token step. Admission requires the same repository, exact audit/reuse branches, base commit `ab4d0aa0a670e59257d6e1bb779ea329c64ddff2`, opened event and first attempt. Checkout/upload actions are pinned, checkout credentials are not persisted, and repository contents permission is read only.

## Finding and correction

Initial source `9ac487…` ignored optional Pages `total_count`/`total_pages`. A synthetic response reporting three projects/two pages while returning only one project and then an empty page produced exit 0 and `OBSERVED_CURRENT_CONFIGS`. This P2 evidence-integrity finding was reported before hosted execution. The exact original source and fixture, stable repro and raw result remain under `audit-original/`, `audit-pagination-counter-repro.py` and `audit-pagination-counter-repro.log`.

Corrected source validates optional totals as nonnegative integers, checks cross-page stability, and reconciles them with the terminal observed aggregate. The original contradiction now returns exit 1 with Pages UNKNOWN. Missing optional totals still allow empty-terminal pagination; coherent totals remain accepted. Official REST pagination counters are optional, so absence alone is not a failure.

## Validation

- 20 supplied test methods passed with sockets denied; raw log `audit-corrected-existing-tests.log`.
- 15 independently authored adversarial test methods passed with sockets denied; harness/log `audit-adversarial.py` and `audit-adversarial.log`.
- Exact remote/local bytes, SHA-256, Git blobs, commit/tree/parent and final workflow admission/credential confinement checks passed; `audit-static-verification.log`.

Independent probes covered the repaired contradiction, optional totals present on only one page, type/stability failures, coherent/absent totals, positive D1 references on script/service/Pages surfaces, path injection, database identity mismatch, exact write-counter types, HTTP denial/redirect/error privacy, missing environments, Pages `id` and production/preview configurations, malformed catalogs, oversized/invalid JSON, deadline/missing-token behavior and redirect refusal.

The admitted request scope is the fixed account, three exact candidate metadata GETs and at most three exact `sqlite_master` catalog SELECT POSTs, plus bounded current Worker/service/Pages metadata GETs. Protected production OAuth, q06 and legacy production database IDs remain excluded. No provider calls or root-source changes were performed by this reviewer.

## Limits and retained authority

All target-admission, global-absence, backup/restore, hosted-migration and release flags remain false. Current Pages configs do not cover historical deployment binding snapshots; scans of listed Workers/services do not cover all external D1 consumers or deployment surfaces. A successful scan cannot establish globally unused/private status. Namespace preservation is not whole-database restore qualification. Root retains responsibility for live drift checks and preserving PR1's rejection, $0, Paynow authority, customer data, q06 and the production rollback origin.

B27 remains `FAILED_IN_SYNTHETIC_ATTACK`; parity/superiority remains `NOT_CERTIFIED`; unavailable final usage remains `UNKNOWN`.
