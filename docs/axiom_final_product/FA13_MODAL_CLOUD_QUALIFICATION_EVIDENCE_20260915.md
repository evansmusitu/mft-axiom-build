# FA-13 Modal Cloud Qualification Evidence — 2026-09-15

Status: `AGENT_FLEET_AND_CLOUD_HANDOFF_EXTERNALLY_VERIFIED`

This evidence is additive to `FA13_ENGINEERING_COMMAND_CENTER.md`. It does **not** seal FA-13. The frozen acceptance matrix remains authoritative, and the phase remains blocked until every required row is satisfied.

## Authority binding

- Repository: `evansmusitu/mft-axiom-build`
- Qualification branch: `frontier/axiom-final-product-fa13-20260915`
- Qualified source head: `e65a4b55f917f19d9e9fc3d5c43b2d15d1aa7422`
- Sealed FA-12 ancestor: `4b818f04cd722f1e2e620e0e42da7200def1897c`
- Frozen prewrite: `docs/axiom_final_product/FA13_PREWRITE_INTENT.md`
- `main` was not modified.
- PR #1 remained OPEN, DRAFT and UNMERGED.

## Preserved failed qualification attempts

1. Run `34967661121`, job `104375891515`, head `e772e2a05986f93bd5cb2e64f34ad70274fd979b`: **FAILURE** before Modal execution. Cause: shallow checkout did not contain sealed FA-12 ancestor, so `git merge-base --is-ancestor` failed closed. Repair: retain the ancestry gate and use full checkout history (`fetch-depth: 0`).
2. Run `34968039299`, job `104377147307`, head `dd7b2eb09d06472ae8aba33e822088d851f2345c`: **FAILURE** after a real Modal execution and receipt verification. Cause: invalid JavaScript static-import syntax in the GitHub-side matrix binder. Repair: use repository-relative static imports. No acceptance row was promoted by the failed run.

Neither failure was relabeled PASS or removed.

## Successful current-head qualification

- Workflow: `MUSITU Axiom FA-13 Modal Cloud Qualification`
- Run: `34968221042`
- Job: `104377743987`
- Exact qualified head: `e65a4b55f917f19d9e9fc3d5c43b2d15d1aa7422`
- Result: **SUCCESS**
- GitHub token permissions: `Contents: read`, `Metadata: read`
- Checkout: `persist-credentials: false`
- Modal credentials came only from existing GitHub Actions secrets `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`.
- The external workload received no Modal/GitHub secret material.
- Risk class: `S0`
- Remote scopes: `hash:input`, `verify:handoff`, `emit:receipt`
- Remote execution budget: 90 seconds, max one container, CPU/memory bounded.
- Modal isolation: network blocked, Modal-resource access restricted, single-use container.
- Repository write: false.
- External side effect: false.
- Production authority: false.
- Background Modal `FunctionCall` execution was proven and returned an externally hash-bound receipt.

External qualification receipt:

- provider: `MODAL`
- source: `modal:fc-01M2JG5CYS2KC61RJA0PPH6NR8`
- verifier: `github-actions-modal-receipt-verifier`
- captured at: `2026-09-15T12:20:17Z`
- external execution evidence SHA-256: `c865daeae17f43056fd219d24e3bc75e5537dda2cc177ad804462946b86a1b1c`

## Actions artifact verification

Artifact ID: `10395952955`

Artifact name: `musitu-axiom-fa13-modal-cloud-qualification`

Artifact ZIP SHA-256 reported by GitHub and independently recomputed after download:

`5fe1b67b362d5a2578a4bb7ab11596ccc0283fd8af4ce170c8ad0870fb853fb5`

ZIP integrity: **PASS**.

Internal manifest checks independently recomputed:

- `fa13-handoff-package.json`: `ffc598214a0d1ea40a6280b554f41b280beaba0ebdf7410aec110ff6b2e0113a`
- `fa13-modal-execution-receipt.json`: `8a31e86397e296ac57da3796fbd31bb80a693edd3e0cde641a40947cad20b302`
- `fa13-modal-external-qualification.json`: `b3f9bdebfe8eb7efe6bd6aeb074fcab5c610c2ccf8c6bf12a3cbe9c118c3ae3d`
- `fa13-cloud-qualified-snapshot.json`: `902877e931abc65aaa07abda3e36659b483e3c52d9b3813ee42da3ba944fba73`
- `fa13-cloud-qualified-verification.json`: `22e6fd141ffe229b9c6f169a89cdb575a7019b55c3d6bcb4f6b211bdba0a6105`

The evidence-secret absence gate passed before artifact upload.

## Matrix result

The exact FA-13 verifier result for the successful external qualification is:

- implementation verification: `PASS`
- acceptance matrix: `BLOCKED`
- `agent_fleet`: `IMPLEMENTED_VERIFIED`
- `cloud_handoff`: `IMPLEMENTED_VERIFIED`
- `IDE`: `PARTIAL`
- `deployment`: `IMPLEMENTED_BLOCKED_EXTERNAL`
- `enterprise`: `IMPLEMENTED_BLOCKED_EXTERNAL`
- `security`: `IMPLEMENTED_BLOCKED_EXTERNAL`

All other already-earned implementation rows remain `IMPLEMENTED_VERIFIED` for their claimed scope.

Remaining unsatisfied rows are exactly:

`IDE`, `deployment`, `enterprise`, `security`.

## Claim boundary

This evidence authorizes the statement that the FA-13 `agent_fleet` and `cloud_handoff` rows have current-head external Modal execution evidence under the frozen matrix contract.

It does **not** authorize:

- `FA-13 PASSED` or `FA-13 SEALED`;
- Windsurf/Devin parity or superiority;
- production deployment qualification;
- external enterprise SSO qualification;
- independent red-team qualification;
- Wolfram parity;
- any superiority claim.

Production authority remains false.