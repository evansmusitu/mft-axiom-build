# Phase 2.8D fixed-tool MCP evidence progress

Issue #20. Canonical GitLab baseline `12de41bdca982137c69ce2c32a36a6e5ef10aabd`. Feature `feature/phase2-8d-fixed-mcp-evidence`.

- Spec and trust boundary: `docs/specs/2026-11-01-phase2-8d-fixed-mcp-evidence.md`.
- RED missing module test `024c75bf`: pipeline 3015396725 FAILED as expected; earlier existing Phase1/PG checks unaffected.
- First implementation GREEN `82659a27`, pipeline 3015397988 SUCCESS.
- Dedicated P2.8D gate `042c0387` and CI compatibility source fingerprint `2c01dc94`: pipeline 3015400050 SUCCESS.
- Security regression RED `08378491`: delayed streaming body accepted past timeout in CI 3015401450; full-stream deadline GREEN `f6b67cd2`, fresh verification pending.
- Source review `reasoning/phase2/phase2_8d_security_review.md`; signed evidence acquisition integration covered by unit test.
- Mandatory remaining: exact-head green feature CI with all Phase1/Phase2/PG + P2.8D gate, MR-native CI, no-squash source-retaining merge, and postmerge main CI. No remote read-only side-effect, truth, deployment, trading or return guarantee.
