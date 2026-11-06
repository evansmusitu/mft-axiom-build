# Independent staging session broker software review

Verdict: no unresolved P0-P2 source finding within the reviewed, unmounted software slice after repairs. The broader product and release remain unqualified. No source, provider, browser, account, network or deployment writes were performed by this reviewer.

Baseline: fb0e36b54ee211fd8cc1ed5d2b0867f7a588cdd7. Environment: Node v24.22.1, Python 3.12.14; SQLite via native Node test adapter. Compare final-source-sha256.json to pre-review-source.json for reviewed bytes. Original source and dependencies are preserved in original-source/.

## Findings and repair evidence

1. P2, confirmed: final private session read awaited after its timestamp was captured. A delayed final read returned200 for an expired session. Repaired to read the trusted monotonic clock after final I/O and reject expiry. Original replay returns200; repaired replay returns401. The existing consumer already checked expiry, so no end-to-end authorization bypass was demonstrated from this finding alone.
2. P2, confirmed under a documented D1 replica consistency model: the reused withSession(first-primary) object can serve subsequent SELECTs from replicas. A concurrent primary revocation between reads was missed, returning200 with revoked:false/version1 while durable primary state was revoked/version2. Repaired to use direct D1 bindings for primary reads; the same double is not entered and the revocation is observed, returning401. This is a faithful consistency-model reproduction, not a hosted D1 observation. Official source: https://developers.cloudflare.com/d1/worker-api/d1-database/ (withSession states that subsequent queries may use read replicas; without Sessions API queries stay primary), independently opened during review.
3. P2 reliability/freshness, confirmed: delayed mint-batch return produced303 and an already expired session cookie. Repaired to check trusted time after commit, return400 without a session cookie, revoke the unexposed durable credential, and preserve completed flow evidence. Original replay303/active/cookie; repaired400/revoked/no cookie. No bypass through active() was demonstrated.

Raw deterministic scripts and results:
- reproduce-original-snapshot.test.mjs / reproduce-original-snapshot.log:3 original behaviors reproduced against immutable snapshot.
- reproduce-repaired-source.test.mjs / reproduce-repaired-source.log:5 independent checks pass against final source (3 repaired cases, cap race, and reauthentication rollback).
- pre-review-source.json and original-source/: exact initial bytes preserved, not reconstructed.

## Requirement/risk evidence

| Risk | Fresh result |
|---|---|
| S256 flow, nonce, wrong browser, callback races/replay |27-focused test suite passed with synthetic signed provider responses and real local SQLite |
| Mint and flow commit atomicity | Existing injected completion-trigger failure rolls both back; independent reauthentication rollback preserves prior active session/proof200 |
| Durable flow/session restart | Close/reopen and second-connection tests passed |
| SQL mutation replay | Terminal transitions, replace, immutable identity and delete tests passed |
| Direct primary reads and concurrent revocation | Repaired replica-model replay returns401 with primary revoked/version2 |
| Final storage delays | Private assertion401; callback400/no cookie/new session revoked |
| Cookie and private binding scope | Host-only Secure HttpOnly SameSite=Lax cookie assertions; public verify path404; exact private audience and real existing caller contract pass |
| Storage cap |1024 lifetime flow cap denies further starts; independent1023+3 concurrent starts produced303/503/503 and final count1024 |
| Provider exchange confinement | Fixed issuer/token endpoint/client/callback; no secret override; redirect:error; malformed response rejection passed |
| Breadth regression |196 Node tests and54 Python tests passed; all JavaScript syntax checks passed |
| Comparative claim boundary | Benchmark gate status remains NOT_CERTIFIED |

## Commands and results

- node --test customer_frontier/tests/zitadel_session_broker.test.mjs:27 passed; log focused-final.log.
- node --test /workspace/scratch/cf664c251767/session-review/reproduce-repaired-source.test.mjs:5 passed; log reproduce-repaired-source.log.
- node --test customer_frontier/tests/*.test.mjs:196 passed,0 failed/skipped; log full-node-final.log.
- python3 -m unittest discover -s customer_frontier/tests -p 'test_*.py' -v:54 passed; log full-python-final.log.
- node --check across customer_control_plane/*.mjs and standalone_portal/portal.js: all passed (exit0).
- python3 customer_frontier/benchmarks/verify_benchmarks.py customer_frontier/benchmarks/frontier_manifest.json customer_frontier/benchmarks/observations_not_proven.json --output /workspace/scratch/cf664c251767/session-review/claim-gate-final.json: exit0, NOT_CERTIFIED.

## Qualification limits

This review uses local SQLite, synthetic tokens/provider responses, deterministic delays, and a replica consistency double. It does not exercise the Cloudflare Workers named entrypoint or real D1 runtime, real callback and customer authentication, provider-side revocation, canonical ownership/custody ceremonies, hosted schema/rollback application, external anti-rollback anchors, or deployment. Human security/custody and release gates remain independent and open. Direct primary reads establish the source's query ordering, not atomic authorization across session and customer databases. The1024 lifetime cap intentionally bounds staging storage and will stop new staging sign-ins when filled; it is not evidence of production abuse resistance or sustainable availability. Original findings are preserved even though repaired.

B27 remains FAILED_IN_SYNTHETIC_ATTACK; parity/superiority remain NOT_CERTIFIED; unavailable final usage remains UNKNOWN. No broader completion or release certification is made.

Portable evidence entrypoints for destination customer_frontier/evidence/idp-session-20261106/review/:
- portable-original.test.mjs uses only ./original-source/customer_frontier/... paths and preserves original behavioral expectations.
- portable-repaired.test.mjs uses ../../../customer_control_plane/... and ../../../tests/... paths to exercise the current repository implementation with denial expectations.
The portable copies only substitute paths; raw original scripts and logs remain unchanged. The coordinator must execute both after placing them at the destination.
