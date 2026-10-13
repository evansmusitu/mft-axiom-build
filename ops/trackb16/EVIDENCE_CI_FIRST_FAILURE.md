# B16 first real CI attempt — FAILED (preserved, 2026-10-13)

GitHub public standard-runner Actions run **38386711781**, head `b24d66d38dee7fa95d0fbde0318f5e2a38e898d4`.

- Authorized S0 test environment (no provider secrets): PASS.
- All 26-file original B16 SHA checks and 54 local Node tests: PASS.
- `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`: **FAILED**, npm Arborist error `Cannot read properties of null (reading 'edgesOut')`.
- `npm run test:workers`: **SKIPPED**, not a workerd failure and not a runtime PASS.
- Preserved external comparison: npm/cli issue #9787 documents equivalent Vitest 4.1.11 dependency resolution failure in affected npm versions.

Candidate repair is to pin npm 11.19.1 in disposable CI and pin direct dev dependencies; a fresh run must demonstrate test execution before it can earn Workers runtime PASS. This file does not substitute for GitHub job logs.
