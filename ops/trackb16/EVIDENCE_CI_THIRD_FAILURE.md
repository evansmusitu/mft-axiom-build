# B16 third genuine local Workers runtime attempt — FAILED (preserved, 2026-10-13)

GitHub public standard-runner Actions run **38387219321**, head `2fabdffdcdb8e428fafbcd03fd2e634fa1bd7e1c`.

- No provider secrets, no Cloudflare deployment, $0 public standard CI environment: PASS.
- Source SHA256 and 54 local Node tests: PASS.
- Candidate dependencies installed and actual Cloudflare workerd/Vitest test EXECUTED.
- **One workerd integration test assertion PASSED**, including actual SQLite Durable Object, concurrent reservations, persist/evict/reuse, revocation behavior and public 503.
- Entire **Vitest process FAILED (exit 1)** because 3 unhandled errors were raised by **expected rejected remote Durable Object RPCs**: `NONCANONICAL_DURABLE_OBJECT`, `WORKLOAD_REQUEST_SCHEMA_DENIED`, `ACCOUNT_STATE_DENIED`.
- Some quota cap failures were expected from 30 concurrent calls and were handled by Promise.allSettled, not an account overspend assertion failure.

Do not relabel the full run PASS. The candidate repair returns an explicit `dispatch_allowed:false` denial receipt for *known signed workload/quota rejection* while still propagating unexpected runtime failures; alternate invalid-object constructor rejection remains a separately preserved negative test, with no clean runtime attestation until that subprocess passes without unhandled errors. The original logs are GitHub Actions authority.
