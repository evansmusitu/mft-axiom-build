# MUSITU AXIOM B16 — ISOLATED S0 CANDIDATE (2026-10-13)

## AUTHORITY — NO DEPLOYMENT, NO AUTHORITATIVE REPOSITORY WRITE

Prepared outside `evansmusitu/mft-axiom-build` in the conversation sandbox.
Source prerequisite: `frontier/axiom-trackb-b15-do-sqlite-s0-20261012` at SHA
`1b5cbfbcb1866986bcbd069f958da2223a00d5fb`.
Original B15 code is REFERENCED, NOT REBUILT. Integrate only after the authoritative whole-product handoff is recovered and verified.
The public `fetch()` handler fails closed with HTTP 503. No provider calls, no live Cloudflare runtime testing or production authorization.

## Real status

- Offline `node --test` identity unit tests: refer to captured transcript in `EVIDENCE_OFFLINE_S0.txt`.
- `node --check` pure JS syntax: refer to captured transcript.
- Workers Vitest integration tests: **NOT RUN**. This sandbox has no Cloudflare Vitest/Miniflare package or external network.
- B14: separately verified bounded two-live-agent test PASS; not broad autonomous production proof.
- B15 SQLite: sibling source manifest 7/7 verified independently, its 23 original local tests were previously recorded as PASS; no runtime certification.
- B15 PostgreSQL: separate diverged branch; 13 CI tests previously PASS; not merged with B15 DO.
- Global quota, provider remaining, production identity gateway: NOT CERTIFIED.

## What this candidate changes

- Unique canonical name `axiom.quota.b16.v1:<trusted-account>:<trusted-UTC-day>`.
- The object itself rejects wrong account/day, non-named `newUniqueId` or `idFromString`-style name-less contexts, or alternative named keys.
- Rechecks on every RPC, so day rollover stops service until new bucket is derived by trusted routing.
- Offline deterministic naming and invalid-name tests.
- Genuine runtime tests prescribed using current `@cloudflare/vitest-plugin` v1, not the renamed `@cloudflare/vitest-pool-workers` package.

## Integration controls

1. Mandatory outer whole-product B14 ZIP and checksum verification is still unavailable; do NOT push to GitHub based on this standalone candidate.
2. Re-read current live main, PR #1 and both B15 branch heads before an authorized write; create fresh isolated branch from B15 DO, not from main.
3. Validate dependency versions and create an integrity-pinned lockfile via network-enabled runner before using `npm ci`.
4. From repository root, place this candidate directory at `ops/trackb16/` on that isolated branch.
5. Run `cd ops/trackb16 && npm ci && npm run test:identity && npm run test:workers` only with verified lockfile in isolated CI. No `wrangler deploy` or provider secret.
6. Capture logs, cryptographically seal the evidence, review by independent security verifier, do NOT self-certify.
7. The provided Ed25519 private JWK is publicly visible and exists for SYNTHETIC TESTS ONLY; never use it in a real authorizer.

## Remaining critical gates

- Real Workers runtime test must PASS, especially actual Durable Object SQLite SQL transaction API and object-name behavior.
- Test deliberately forged alternate binding / duplicate object key, per-day routing, revocation, eviction and crash, and workload identity verification. Complete outage / rollback proof.
- Strong independent broker workload authorization; the signed grant alone is insufficient.
- Provider quota evidence is advisory and does not demonstrate a guaranteed $0 commercial budget under arbitrary workloads.
- Full customer-facing scale is UNQUALIFIED. Do not promote to S3 or S4.

Primary Cloudflare docs:
- https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/
- https://developers.cloudflare.com/changelog/post/2026-08-19-vitest-plugin/
- https://developers.cloudflare.com/changelog/post/2026-03-15-durable-object-id-name/
- https://developers.cloudflare.com/durable-objects/api/namespace/

## 2026-10-13 S0 routing hardening (isolated revision)

An independent review found that merely providing a `canonicalName()` function
was insufficient: no **trusted internal broker routing function** actually
selected the canonical account/day Durable Object. Added `routeQuota(env,clock)`
that invokes **only** `getByName(canonicalAccountDay)`, validates binding and
RPC stub presence, and never falls back to `newUniqueId()` or an attacker-
selected bucket name. It remains a candidate library seam only and does not
make the public HTTP route functional.

Evidence includes a recorded red/green TDD cycle and eight new tests (28 total
node tests). Run `python3 VERIFY_B16_LOCAL.py` from the `ops/trackb16` folder.
The verifier only establishes S0 local integrity/syntax/tests, NOT real Workers
runtime correctness, cloud authentication or zero-cost Cloudflare admission.

The synthetic Ed25519 key in the test fixture is public and only applicable to
the local candidate; **never use these bindings to authorize any live model
request**. The Workers Vitest test remains unexecuted while network/dependency
availability prevents installing `@cloudflare/vitest-plugin` and Vitest. There
is no `package-lock.json`, so `npm ci` is deliberately not reported as run.


## 2026-10-13 additional S0 stub-origin hardening (this package)

Read-only documentation verification established `getByName()` named-stub identity
(`stub.name`) and `ctx.id.name` semantics in current Cloudflare documentation:

- https://developers.cloudflare.com/durable-objects/api/stub/
- https://developers.cloudflare.com/changelog/post/2026-03-15-durable-object-id-name/
- https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/

The trusted route now requires that the returned stub has exactly the requested
canonical `stub.name`, and rejects any conflicting reported `stub.id.name`.
The previous test verifying missing `reserve`/`revoke` is still present, with a
valid matching name in its fixture to isolate the missing-RPC failure condition.

Recorded red-green local TDD evidence: `EVIDENCE_RED_STUB_BINDING.log`
contains three expected failures (stub substitution allowed); after the
implementation correction `EVIDENCE_GREEN_STUB_BINDING.log` records
11/11 focused PASS. `EVIDENCE_FULL_NODE_TESTS.log` records 31/31 full
identity+routing tests PASS. The dormant real Workers runtime integration test
is now configured to exercise the actual `routeQuota()` seam using two real
stubs; only its syntax was checked locally. **It was NOT executed against workerd.**

External npm package acquisition is still blocked: `npm install --offline
--package-lock-only` failed `ENOTCACHED` for `@cloudflare/vitest-plugin`,
recorded in `EVIDENCE_OFFLINE_DEPENDENCY_RESOLUTION.log`. No lockfile was
manufactured; no cloud infrastructure or production service was changed.

No GitHub writes permitted until the mandatory 2026-10-12 B14 whole-product
handoff outer ZIP and sibling checksum can be independently verified.
