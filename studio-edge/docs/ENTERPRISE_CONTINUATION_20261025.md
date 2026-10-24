# MUSITU Intelligence — verified continuation instruction, 25 October 2026

This is a CONTINUATION of the existing MUSITU Intelligence product, not a rebuild, release, migration, or change to its original marketplace/AI vision.

## Authoritative connected sources
- GitHub repository: `evansmusitu/mft-axiom-build`
- Only editable enterprise branch: `feature/musitu-enterprise-tenant-workspace-20261024`
- Open **draft** PR: https://github.com/evansmusitu/mft-axiom-build/pull/34 (base: `feature/musitu-multidoc-evidence-20261020`).
- Frozen original backend baseline SHA: `6147ceed65dcc4d7594913db16408669423738c3`.
- Public website repository `evansmusitu/evansmusitu.github.io`, pinned `main` SHA: `13492fd3befd12af761d49399d6c6ed30d63ee2b`.
- Enterprise code and acceptance: `studio-edge/enterprise-workspace.mjs`, `studio-edge/enterprise-client.mjs`, `studio-edge/client-encrypted-artifact.mjs`, `studio-edge/docs/ENTERPRISE_WORKSPACE.md`, `studio-edge/docs/ENTERPRISE_CANARY_ACCEPTANCE.md`.
- Four new enterprise-only SQL migrations `studio-edge/migrations/0001`–`0004`. Never run them against any shared D1, AXIOM/customer Neon, or production project.

## Verification before next change
1. Fetch PR #34 head, exact base SHA and draft state; fetch latest CI runs, identify the latest **successful run for the exact branch HEAD**.
2. Compare original backend multidoc branch against `6147ceed...`; compare website `main` against `13492fd...`. Do not proceed with assumptions if either has changed.
3. Run `bash studio-edge/scripts/verify-enterprise-workspace.sh` in the checked-out backend branch. It runs syntax, all worker/client adversarial tests, real SQLite contracts, and the no-deploy release guard.
4. Latest whole-suite evidence before this document: GitHub Actions **#40143421524**, success with **134/134 tests**, real SQLite tenant isolation/revocation/storage/mutation contracts, and pinned production configuration guard. The action also successfully reran the standalone script.
5. Run only test-first, feature-branch-only, canary-first engineering. Keep the PR **draft**. Do not activate client imports in the public website or deploy an existing Worker.

## Delivered but deliberately NOT live
- Signed Cloudflare Access JWT verification, bounded and abortable JWKS resolution, D1 tenant membership checks on each operation; roles owner/editor/viewer; SQL-time revocation; no automatic tenant creation.
- Browser-controlled encrypted AES-256-GCM key (must be non-extractable), tenant/artifact AAD, random 96-bit IV. No server decryption, user key recovery, or browser-local slot migration.
- Bounded authenticated metadata pagination; encrypted GET, optimistic create/replace/delete; 50 artifacts per tenant; 20 successful mutations per tenant per 60 seconds in SQL.
- Disabled opt-in SDK: allowed **private-enterprise** Cloudflare Worker hostname patterns only, no credentials/cookies persisted, bounded network and response parsing, guarded manual ciphertext portability export.
- Offline end-to-end tests using actual SQLite and simulated signed identity; independent production/capacity Wrangler blob checks.

## Outstanding hard blockers: must not fake completion
- An independently authorized **new** Cloudflare Access application, separate Worker hostname, dedicated D1 database and actual team/audience bindings are unprovisioned.
- No real private canary signed identity, role revocation, key lifecycle, account recovery, regulated data handling or verified deployment and rollback has been exercised.
- Consent, audit retention, tenant-wide deletion/export policy, privacy/controller review, verified operational quotas and independent security/custodian approval still require responsible human decisions.
- Do not buy services, expose secrets, activate cloud storage or cross-merge the Axiom/WhatsApp/MUSITU Store branches.

## Exact fresh-chat command

> Continue MUSITU Intelligence enterprise engineering from GitHub draft PR #34 on `feature/musitu-enterprise-tenant-workspace-20261024`, not from memory and not from a restart. Read `studio-edge/docs/ENTERPRISE_CONTINUATION_20261025.md`, `ENTERPRISE_WORKSPACE.md`, and `ENTERPRISE_CANARY_ACCEPTANCE.md` first; verify original website/backend pins, current feature HEAD, draft PR and last exact-SHA successful CI. Run the offline `bash studio-edge/scripts/verify-enterprise-workspace.sh` before writes. Continue only tested isolated feature-branch improvements, do not change production/customer data or deploy until independent Cloudflare Access/D1/privacy/security approval. Report implemented, tested, and blocked separately.

**This handoff is source-level engineering evidence, not proof that authenticated cloud tenancy is available to users.**
