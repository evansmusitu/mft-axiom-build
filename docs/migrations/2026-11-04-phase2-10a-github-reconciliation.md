# Phase 2.10A — GitLab engineering to GitHub continuation

Date: 2026-11-04. **Draft / release NO-GO.**

## Source and provenance

- GitLab private engineering project: `evansmusitu/mft-axiom-build` (ID 86647955).
- Merged GitLab Phase 2.9C baseline: `e43980a377a36bd8cc33d2a088a92021b82729c4`.
- Unmerged GitLab Phase 2.10A draft MR !36: `345a0ce86d3ee5e947c84dc93e62c35f45cbe9e8`.
- GitHub merged baseline: PR #72, merge commit `b10a74b435feb25654d4cf67ba67d09602698a3e`.
- Active continuation: GitHub draft PR #76; earlier same-content draft PR #73 is superseded. Preserve both source branches, do not squash GitLab history in-place.

The 22 changed files in GitLab draft were brought into PR #76 as a snapshot. At the initial import, all 164 `reasoning/phase2/` files matched GitLab blob IDs and zero unrelated GitHub paths changed. Later commits on PR #76 add independent GitHub test-first fixes; these deliberately diverge from the frozen GitLab source.

The original GitLab commit topology, branches, tags, issues, CI metadata and audit history **have not been mirrored**. This snapshot must never be described as a full provenance migration. Track a separately approved, private-to-public reviewed archival migration under GitHub issue #75; keep GitLab as read-only reference.

## GitHub qualification progress

- Corrected the read-only staging load tool's missing/unreadable manifest handling to return safe `CONFIG_INVALID`. Existing negative test first failed on GitHub, then passed after the fix.
- Added explicit regression tests that reject direct OpenAI/Anthropic adapter registration at both the trusted model compilation and explanation services. A GitHub test-only commit showed the expected `Missing expected exception` failure.
- Added a trusted-budget-decorator registration check (including explanation tenant binding) and updated the Phase 2.4B conformance gate to use deterministic metered test adapters without real vendor calls.
- GitHub Actions verified 11 passing checks on implementation commit `3666efda94982e27b595d868a188705b580ba9b5`, including Phase 1, Phase 2 all gates, PostgreSQL 17, Connect qualification, and brand guard. This is **not** real-provider or security certification.

## Unresolved release-critical work

- PostgreSQL ledger adoption remains configurable; all production workers are not yet independently proven to share a trusted central cost authority. The paid-provider registration guard is scoped to adapter manifests declaring OpenAI/Anthropic and cannot establish physical vendor billing accuracy.
- Real credentialed model/evidence/compute smoke tests, billing invoice reconciliation, organization-level worst-case spend caps, SSO/MFA, HSM/KMS custody, backup/restore, operational chaos tests and independently authorized penetration review need owner-controlled staging and external evidence.
- GitHub issue #74 remains the production release NO-GO checklist. No automated trading or guaranteed outcomes.

No production secrets, raw provider responses, or customer data should be put in GitHub commits, artifacts, issues or PR comments.
