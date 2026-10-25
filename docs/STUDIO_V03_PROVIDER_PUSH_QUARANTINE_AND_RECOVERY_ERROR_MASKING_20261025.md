# Studio V0.3 — Quarantine automatic provider workflows and sanitize recovery failures

25 October 2026. Private source-only development on the isolated `experiments/studio-enterprise-v03-sqlite-do-20261018` branch. **Production migration, Access changes, paid GPU use, worker deployments, and customer-data mutation remain strictly NO-GO.**

## Why this batch exists

An inventory of the 83 existing workflow YAML files revealed that 33 allowed `push` on the isolated branch. Seven were intended runner-only source tests, while 26 referenced provider credentials and could run when their *own* workflow files were pushed. A static syntax scan found nine with recognizable provider mutation commands (for example, Wrangler deploy). The narrow path filters meant ordinary source changes generally would not trigger those 26, but a self-edit commit was still a dangerous, potentially billable, automatically initiated provider operation. Self-editing a deployment workflow was not an adequate owner authorization step.

A separate emergency SQLite recovery test demonstrated that provider exceptions raised from a lease, owner-approval probe, route read, authority proof or compare-and-swap were propagated as raw exception text. They could carry secrets or customer identifiers in error messages. An acknowledged Neon-to-SQLite route restoration does not justify exposing external provider error strings.

## Changes (all offline source changes)

- 26 previously self-triggered provider-dependent workflows now use `workflow_dispatch: {}` instead of their isolated-branch `push` event. They retain their job bodies and any existing provider prerequisites unchanged; **none of these jobs were executed** in this development batch. No protected default branch was modified.
- Seven source-only push-test workflows remain eligible on this branch; some exercise local `wrangler dev` and public *GET* checks. They can still consume GitHub Actions runner minutes; do **not** infer a zero-cost guarantee or hosted CI pass.
- A zero-dependency `ops/studio_v03_workflow_risk_inventory.py` statically classifies automatic trigger eligibility, source-embedded provider credential references, recognizable mutating commands and workflow self-edit risk. It writes a privacy-minimal JSON report without exporting tokens, provider responses, source contents or customer data. It is conservative and **does not implement the complete GitHub Actions YAML evaluator**, predict all `if:`/`paths:` eligibility, prove a workflow executed or verify billing.
- The offline Python regression contract fixes the exact 26 workflow file names and checks that no source-sensitive isolated-branch push trigger is reintroduced, while retaining the safe source-only workflows. It detects a self-triggered deployment fixture (red first), inline auto-events, remote branch exclusions, and ambiguous missing triggers.
- The source-only `guardedStudioCanaryEmergencyReturn` now maps exceptions from all owner/provider callback boundaries to fixed safe `STUDIO_RECOVERY_...` codes, including a post-return verifier failure and lost CAS acknowledgement; it preserves fenced SQLite route readback and never releases a lease if the route cannot be independently verified. The raw message is neither logged nor propagated.
- The recovery tests first failed against the previous source with private provider error text and now verify code-only failures, preservation of SQLite routing and correct exclusive-lease handling.

## Qualification and limitations

Commands from the product source root:

```text
node --test musitu_studio/neon/tests/*.test.mjs
node --test musitu_studio/edge/tests/v03_glb_*.test.mjs musitu_studio/edge/tests/v03_scene_preview.test.mjs
node --test musitu_studio/edge/tests/session.test.mjs musitu_studio/edge/tests/validation.test.mjs musitu_studio/edge/tests/v03_do_adapter.test.mjs musitu_studio/edge/tests/v03_scene_import_submission.test.mjs musitu_studio/edge/tests/v03_pitr_cron_diagnostic.test.mjs
python -m unittest discover -s ops/tests -p 'test_studio_*.py' -v
python -m unittest discover -s ops/tests -p 'test_god_mode_2099_*.py' -v
python ops/studio_v03_workflow_risk_inventory.py .
```

Do not treat this source-only audit as provider provenance or a billable-usage report. Workflows that are manual-only on this isolated branch may **not** be registered for `workflow_dispatch` unless their files are available on the repository's default branch; moving them there requires a separate, authorized review and is NOT part of this effort. Their preserved job bodies may still deploy, mutate Cloudflare settings, consume Actions minutes, or incur costs if intentionally dispatched in an eligible context. Owner approval and independently verified spending hard stops remain mandatory. A new workflow edit should be audited before push. Exact-HEAD GitHub Actions execution, private connectivity, R2 version provenance, real Blender frames, hosted restoration and Neon/Modal spend hard caps remain independently unverified.
