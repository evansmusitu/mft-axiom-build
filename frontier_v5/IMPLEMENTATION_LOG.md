# Implementation log

- Created isolated v5 frontier branch from sealed v4 production SHA.
- Added safety invariants, research ledger, submission boundary and execution state.
- Next: build actual skill packages and validation assets.
- 2026-09-27: Restored the sealed v4 MCP core byte-for-byte on the frontier branch; production MCP/auth surface remains unchanged.
- 2026-09-27: Restored the pinned OpenAI publication-readiness document required by the frontier protection gate.
- 2026-11-24: Correction to the 2026-09-27 entries. The PR #1 branch did change `auth/` and `mcp/` and deployed them to production through push-triggered workflows, and its full-stack CI wrote fixtures into the production database.
- 2026-11-24: Split `frontier_v5/` out of PR #1 onto a fresh branch from `main`. Removed the production-writing and self-certifying scripts. Replaced 33 gate workflows with one secret-free CI workflow plus an isolation contract. Fixed the audit's security, determinism and gate-integrity findings with regression tests, and made the objective ledger honest (`NOT_MET`).
