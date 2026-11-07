# AXIOM engineering continuation — frozen handoff (2026-11-07)

## 1. Canonical topology
- Public primary code/deployment repository: `evansmusitu/mft-axiom-build`, public `main` frozen check `b10a74b435feb25654d4cf67ba67d09602698a3e`.
- Original GitLab `evansmusitu/mft-axiom-build`, project ID `86647955`, **private** historical source, `main` last known `e43980a377a36bd8cc33d2a088a92021b82729c4`.
- Dedicated **private GitHub archival repository** holds exactly 180 GitLab branches and one tag, matching all tip SHAs after a verified push mirror on 2026-11-06. User then disabled mirroring and revoked the temporary GitHub access token. This did not migrate the private GitLab issues, merge requests, approvals, notes or pipeline artifacts; original GitLab remains private. Archive is *not* the public product destination.
- Latest public source history bundled as `SOURCE_HISTORY/public-github-all-refs.bundle`; live GitHub repo is the authority if it changes.

## 2. Open draft engineering work, tested but unmerged
| PR | Head SHA at checkpoint | Base | Exact-head status |
| --- | --- | --- | --- |
| [#76](https://github.com/evansmusitu/mft-axiom-build/pull/76) Phase 2.10A PostgreSQL ledger/provider budget & live-smoke import | `bd8adc82daf87c38a2d90894c6b297106eccb752` | public main | 15/15 successful |
| [#81](https://github.com/evansmusitu/mft-axiom-build/pull/81) Phase 2.10B shared organization vendor caps and two-pool concurrency | `5dd65a4a659730c4506cd5f350e29af793e5263e` | Phase 2.10A branch (stacked) | 6/6 successful |
| [#87](https://github.com/evansmusitu/mft-axiom-build/pull/87) six-gate evidence contract, privacy archival, Neon staging network runbook | `23deaf0af81934bac311a94db12aebda98ce54ba` | public main | 6/6 successful |
| [#99](https://github.com/evansmusitu/mft-axiom-build/pull/99) fail-closed Cloudflare Workers + Hyperdrive staging preflight | `a32fe6c53ec90aad8361e4b8056e6d23bc446f4a` | public main | 14/14 successful |

All four were still **DRAFT and OPEN** at snapshot. Recheck each before any changes, verify correct base/stacking, and do not equate successful checks with deployment acceptance.

## 3. Neon staging — real resource; not connected
- A Neon PostgreSQL **17**, US East 2, project named `MUSITU AXIOM Phase2 Staging` was created; dedicated `axiom_phase2_stage` database, protected main branch, limited 0.25 CU compute, idle suspension, consumption quotas.
- `block_public_connections=true` remains confirmed; allowlist contains 22 Cloudflare published CIDRs, without unrestricted 0.0.0.0/0. They are shared multi-tenant Cloudflare ranges and not independently secure identities.
- Actual `run_sql` check and attempted scoped `read_write` role creation were rejected by Neon with blocked-network error. No role was created, no schema installed, no tenant/vendor budget rows, no Hyperdrive binding, no Worker deployment and no live provider spending test. Only default owner exists.
- User uses **Cloudflare Workers only**, no Cloudflare Tunnel, VPC, or private server. Chosen architecture: standard **Hyperdrive → restricted internet-reachable Neon** for staging only, with TLS certificate validation, least-privilege credentials, Hyperdrive query cache disabled, time limits and operator-approved network exception/rollback. This is NOT a private link and requires an approved risk decision before public connectivity is opened.
- Draft #99 contains closed-HTTP `fetch()=404`, opt-in scheduled diagnostic, credential-safe logs, fixed read-only SQL and a database-side privileged-role check. The test set grew to **11** cases and exact-head 14/14 CI success; it has **not** contacted a real Neon database. Historical initial staging preflight had 9 tests; later security review added two role-privilege tests.
- Private SQL networking blocked role and migration provisioning even from Neon connector. Do not try to bypass by removing public block without prerequisite control/approval.

## 4. Release decision and critical six gates
Primary [release issue #74](https://github.com/evansmusitu/mft-axiom-build/issues/74) is OPEN. [History issue #75](https://github.com/evansmusitu/mft-axiom-build/issues/75) is OPEN. No approval exists to close either.

G1 — Deployed, production-wide mandatory PostgreSQL budget ledger across every worker/API with TLS, least privilege, verified schema/role, immutable org/tenant/vendor caps, fail-closed bypass tests, real concurrency/failover and deployment inventory. **BLOCKED**.

G2 — Real OpenAI/Anthropic charged usage and invoices compared against internal metering, versioned prices, abnormal-charge holds, finance sign-off. **BLOCKED**.

G3 — Credentialed, scope-authorized read-only live evidence/provider smoke across approved targets, no bypass of user/provider consent, capped costs, signed hashes and results. **BLOCKED**.

G4 — Independent penetration assessor's scoped report, remediation and retest, no unaccepted high/critical findings. **BLOCKED**.

G5 — Operational IdP/SSO/MFA, external KMS signer custody, TLS/mTLS worker identity, monitored staging/load/chaos/DR, ten roadmap stream approvals and reviewer release authority. **BLOCKED**.

G6 — Private GitLab Git-object mirror **complete at ref/tip parity (180/180 + 1/1)**, but GitLab 23 issues, 35 MRs, notes, approvals, attachments, CI metadata, privacy audit and independent owner sign-off remain **OPEN**; exact Git object ancestry has not been independently audited. Avoid describing full history archival as complete.

## 5. Suggested next actions in new chat
1. Re-read full handoff and connect GitHub/GitLab/Neon/Drive; verify current public main and 4 draft PR heads/checks, private archive visibility/ref equality, staging block and release issues.
2. Verify and review #99 negative privilege tests and Worker runtime compatibility. Do not merge while staging external network/security gate incomplete.
3. Make staged, source-anchored implementation plan for Phase 2.10A+B mandatory provider budgeting across every entrypoint. Ensure tests deny paid provider calls on bypass/unknown price/cap, real PostgreSQL independent pool transaction tests and robust fail-closed worker behavior.
4. For staging connectivity, obtain explicit operator-approved *controlled* network exception (if Internet reachable is chosen), private credential rotation and TLS attestations. A Workers-only estate without Tunnel/VPC cannot establish a private network to Neon's publicly-blocked host.
5. Use exact-head CI results, scoped security reviews, non-destructive PR flow, then collect actual external evidence. Keep main and live production unchanged until independent acceptance.
6. Preserve private source history archive and restricted GitLab metadata in private systems only; do not paste private branch names/notes/credentials in public PRs or Drive documents that could be shared.

## 6. Non-goals and honest limits
Product is not certified production-ready or a profit-guaranteed signal. No commands, workflow files or CI success records can replace authentic vendor invoices, independent testers, operator signoff or real live staging evidence. Continuity has to be confirmed by live tool reads in the next chat: source pins are snapshots, not a time machine.
