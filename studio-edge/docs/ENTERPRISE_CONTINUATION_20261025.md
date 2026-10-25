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
4. Latest whole-suite evidence before this document: GitHub Actions **#40165054578**, success with **154/154 Node tests**, real SQLite tenant isolation/revocation/storage/mutation contracts, and pinned production configuration guard. The action also successfully reran the standalone script.
5. Run only test-first, feature-branch-only, canary-first engineering. Keep the PR **draft**. Do not activate client imports in the public website or deploy an existing Worker.

## Delivered but deliberately NOT live
- Signed Cloudflare Access JWT verification, bounded and abortable JWKS resolution, D1 tenant membership checks on each operation; roles owner/editor/viewer; SQL-time revocation; no automatic tenant creation.
- Browser-controlled encrypted AES-256-GCM key (must be non-extractable), tenant/artifact AAD, random 96-bit IV. No server decryption, user key recovery, or browser-local slot migration.
- Bounded authenticated metadata pagination; encrypted GET, optimistic create/replace/delete; 50 artifacts per tenant; 20 successful mutations per tenant per 60 seconds in SQL.
- Disabled opt-in SDK: allowed **private-enterprise** Cloudflare Worker hostname patterns only, no credentials/cookies persisted, bounded network/response parsing, manual ciphertext export with final inventory drift scan, offline authenticated backup inspection and explicit single-item create-only restoration. No full atomic snapshot or automatic backup upload.
- Restore denies foreign/malformed/wrong-key ciphertext, rejects conflicting existing IDs without overwrites, and snapshots authenticated bytes against asynchronous token-callback mutation. Strict catalog and successful-mutation response validation is tested.
- Manual, **unwired** audit-retention helper with inert default, `execute:true` gate, **required explicit tenant ID**, proposed 30-day cutoff and 100-row SQL batch limit. Real SQLite regression tests confirm one tenant's cleanup cannot erase another's metadata. Legal retention approval remains outstanding.
- Offline end-to-end tests using actual SQLite and simulated signed identity; independent production/capacity Wrangler blob checks.

## Outstanding hard blockers: must not fake completion
- An independently authorized **new** Cloudflare Access application, separate Worker hostname, dedicated D1 database and actual team/audience bindings are unprovisioned.
- No real private canary signed identity, role revocation, key lifecycle, account recovery, regulated data handling or verified deployment and rollback has been exercised.
- Consent, approved audit retention and maintenance operator authority, tenant-wide deletion/export policy, privacy/controller review, verified operational quotas, cross-border data transfer and independent security/custodian approval still require responsible human decisions. The audit cleanup is not scheduled, deployed or approved.
- Do not buy services, expose secrets, activate cloud storage or cross-merge the Axiom/WhatsApp/MUSITU Store branches.

## Exact fresh-chat command

> Continue MUSITU Intelligence enterprise engineering from GitHub draft PR #34 on `feature/musitu-enterprise-tenant-workspace-20261024`, not from memory and not from a restart. Read `studio-edge/docs/ENTERPRISE_CONTINUATION_20261025.md`, `ENTERPRISE_WORKSPACE.md`, `ENTERPRISE_CANARY_ACCEPTANCE.md`, and `ENTERPRISE_PRIVACY_OPERATIONS.md` first; verify original website/backend pins, current feature HEAD, draft PR and last exact-SHA successful CI. Run the offline `bash studio-edge/scripts/verify-enterprise-workspace.sh` before writes. Continue only tested isolated feature-branch improvements, do not change production/customer data or deploy until independent Cloudflare Access/D1/privacy/security approval. Report implemented, tested, and blocked separately.

**This handoff is source-level engineering evidence, not proof that authenticated cloud tenancy is available to users.**

## Subsequent state after the original Oct 25 note
- From the prior 134-test checkpoint, additional enterprise-only commits add explicit offline encrypted recovery, real SQLite end-to-end restore/non-overwrite tests, strict client acknowledgments and ordered metadata, final backup revision inventory scan, and tenant-scoped operator-only privacy audit cleanup.
- At SHA `011671272c727152448441b6d2ee6b464b7eb993`, GitHub qualification #40165054578 passed 154/154 Node tests plus all SQLite and release-fence checks; AXIOM reasoning #40165054574 also passed. This file may generate a newer commit; **always resolve the exact current PR head and rerun/read its CI status**, not just this recorded SHA.
- Draft PR #34's body records the longer change history, and `ENTERPRISE_PRIVACY_OPERATIONS.md` documents data categories, encryption key-loss limits, explicit restore, controlled audit cleanup and open legal/privacy gates.
- No public website import, no live Worker redeploy, no Access/JWKS/D1 cloud tenancy, no paid resources, no customer data changes, no Axiom/other-product merge.
