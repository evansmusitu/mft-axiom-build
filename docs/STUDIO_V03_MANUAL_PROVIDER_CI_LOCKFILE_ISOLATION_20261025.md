# Studio V0.3 — provider-secret CI launch isolation and reproducible handoff

25 October 2026. **Source-only change to `experiments/studio-enterprise-v03-sqlite-do-20261018`. Production cutover and billable rendering: NO-GO.**

## Regression, reproduced before the fix

The 20 October complete handoff workflow and 22 October provider-bound release read-only qualification workflow were eligible to run on routine pushes to the isolated development branch. Both injected Cloudflare API token secrets into CI. The former also used a mutable `npm install` dependency resolution and unpinned GitHub Actions dependencies; the latter also used unpinned actions. Regression tests initially failed for these conditions. A third regression exposed mutable actions and credential persistence in the otherwise offline Neon schema CI.

## Source-only hardening

- Removed `push` events from `.github/workflows/studio-complete-new-chat-handoff-20261020.yml` and `.github/workflows/studio-v03-release-readonly-qualification-20261022.yml`. Both now have **only `workflow_dispatch`**. They retain their read-only token and short 12-minute and 4-minute job timeouts. **A manual dispatch is an explicit request, not proof of provider safety or release authorization.**
- Pinned the referenced `actions/checkout`, `actions/setup-node`, `actions/setup-python`, and `actions/upload-artifact` actions to 40-hex commit revisions already used by the isolated Studio workflows. Both provider-secret workflows disable checkout credential persistence.
- Preserved the exact original Edge dependency lock from the verified prior handoff's `DEPENDENCIES/edge-package-lock.json` as three source-controlled, byte-exact fragments in `ops/verified_edge_lock_parts/` (the GitHub content transport cannot accept this large file atomically). `ops/studio_v03_restore_edge_lockfile.py` reconstructs and verifies the lock only on the manual runner. Its SHA-256 is `10f3c5d53d27ee3743a8e507089eb937af73f4a2c672573bdae958c9a3c5c9df`. The offline security workflow also monitors changes to these lock fragments. The manual complete handoff now uses `npm ci --ignore-scripts --no-audit --no-fund` instead of floating `npm install`; the lockfile root dependency set matches `edge/package.json`.
- Preserved the 5-minute `studio-v03-neon-schema-contract-20261021.yml` push trigger because it performs **offline source-only** tests without any Cloudflare/Neon/Modal credentials. Pinned its checkout/setup-node actions and disabled credential persistence. The 10-minute offline Studio security workflow remains available and read-only.
- Added `ops/tests/test_studio_v03_provider_ci_manual_only_20261025.py` with five tests asserting these fail-closed workflow properties.

## Limits and remaining hazards

This does **not** disable or audit every workflow in the wider repository. Many workflows on other experimentation branches have independent push triggers. Source-only changes do not modify GitHub Actions configuration on the default branch, and `workflow_dispatch` may not be available through the GitHub UI/API until that workflow is present on the repository's default branch. Do not merge or change the protected default branch merely to expose the dispatch button.

Manual GitHub Actions jobs can still use included or metered GitHub runner minutes and external registries. Pure offline CI on this branch still has push-trigger costs. The changes do **not** prove that previously eligible workflows did not run or consume time; exact-commit hosted CI success also remains unverified. Cloudflare API token variables must not be treated as independent proof of provider origin, nor read-only labels as proof that an operator-approved production gate has been met.

The historical source and original GitHub Actions handoff remain preserved in the complete ZIP. The registered GitHub branch is a development branch only. Live Cloudflare Access, SQLite DO, R2 objects, Studio V0.2, Neon production migration, Axiom main and paid Modal rendering were not touched.
