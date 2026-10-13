# B16 fourth GitHub Actions attempt — PARTIAL POSITIVE, OVERALL FAILED

Date: 2026-10-13 UTC. Isolated S0 branch `frontier/axiom-trackb-b16-workers-vitest-s0-20261013`.
Commit `cd61fc01a992edd62889fdae70be8540cdaf6986`.
GitHub Actions run `38387907202`; executor job `115264131752`.

Live evidence recorded from GitHub job logs:

- Protected S0 secrets absent and public route disabled: PASS.
- Local source manifest, syntax, 58 Node tests: PASS.
- Ephemeral npm package resolution and Workers Vitest startup: PASS.
- `npm run test:workers` **clean PASS** with 1/1 actual Workerd/SQLite Durable Object integration test; marker `AXIOM_B16_REAL_LOCAL_WORKER_POSITIVE_S0_PASS_NOT_PRODUCTION` earned for its bounded positive test only.
- `npm run test:workers:negative`: **FAILED** at process level despite its asserted 1/1 test pass, because Vitest reported an *unhandled remote rejection* `ScopeDenied: NONCANONICAL_DURABLE_OBJECT` during construction of an attacker-named Durable Object. A test assertion passing while the test process exits 1 is not a gate PASS.
- Overall CI run: **FAILED**, preserved. No model calls, no deployment, no production effects.

Candidate repair: an attacker-named Durable Object must remain inert (no SQLite quota ledger initialized); `reserve` and `revoke` return an explicit `DENIED`, `dispatch_allowed:false`, `reason:NONCANONICAL_DURABLE_OBJECT` receipt rather than throwing from its constructor. The real local Workerd negative test now also checks absence of the `quota_meta` table. Unexpected errors still propagate. Requalify with a *new* real workerd run before claiming any security PASS.
