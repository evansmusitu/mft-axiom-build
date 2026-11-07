# Verification matrix — exact evidence / limitations, 2026-11-07

| Item | Independent source / checkpoint | Status | Important limit |
|---|---|---|---|
| Public product main | GitHub branch API: `b10a74b435feb25654d4cf67ba67d09602698a3e` | Verified at snapshot | Must re-read; public GitHub is live |
| PR #76 | Head `bd8adc82daf87c38a2d90894c6b297106eccb752`, check-runs 15/15 success | DRAFT, OPEN | Does not prove production billing |
| PR #81 | Head `5dd65a4a659730c4506cd5f350e29af793e5263e`, check-runs 6/6 | DRAFT, OPEN, STACKED | PostgreSQL independent-pool regression is not equivalent to live deployed multi-worker tests |
| PR #87 | Head `23deaf0af81934bac311a94db12aebda98ce54ba`, 6/6 | DRAFT, OPEN | Contracts/templates, not external signed approvals |
| PR #99 | Head `a32fe6c53ec90aad8361e4b8056e6d23bc446f4a`, 14/14 | DRAFT, OPEN | Preflight 11 offline tests; no Hyperdrive/Neon real connection |
| Private GitLab mirror | Private destination 180 branches + 1 tag, every tip hash matched GitLab; source remains private; user disconnected token+mirror | Git Git-ref parity verified | Does not migrate 23 issues/35 MRs, confidential comments, CI |
| Neon stage | Control-plane list/get: PG17, staged DB, protected branch, small quota, all 22 Cloudflare CIDRs allowlisted | Database CREATED, public access BLOCKED | Not yet connected or usable for SQL migration |
| Neon SQL and scoped role | Neon returned `This connection is trying to access this endpoint from a blocked network`; role creation made no changes | BLOCKED | Do not remove network protection as shortcut |
| Cloudflare stack | Owner: Workers only, no Tunnel, VPC/private server | Verified user configuration claim | Validate live account inventory before deployment |
| G1 mandatory deployed PG ledger | No deployed source/worker pool/config/role/schema evidence | NO-GO | Unmerged PR code only |
| G2 vendor invoice reconciliation | No approved vendor live usage/invoices | NO-GO | Do not invent price reconciliation |
| G3 approved credentialed evidence smoke | No signed real approved six-target smoke | NO-GO | No paid calls |
| G4 independent pen test | No accepted assessor report/retest | NO-GO | CI not penetration test |
| G5 operations, IAM, KMS, DR, ten streams | No independent current approvals | NO-GO | External operational acceptance |
| G6 full historical privacy archival | Private Git refs done; metadata/acceptance pending | PARTIAL | Issue #75 OPEN |

Validation command for the ZIP: run `(cd <unzipped-root> && sha256sum -c HANDOFF/SHA256SUMS.txt)` on a computer, or compute hashes with a trusted zip verifier; the new chat can also read the files through connected Drive.
