# MUSITU Intelligence — authoritative cross-chat continuation checkpoint

Snapshot date: Tuesday 20 October 2026, Africa/Harare. Scope: MUSITU INTELLIGENCE website and its isolated Cloudflare Workers AI backend; not the entire MUSITU Axiom platform.

## Actual source pins

Website code: evansmusitu/evansmusitu.github.io, main commit 7eb670aa6fa4660ef8a0f033d23a472922eea9fe. Live public site https://evansmusitu.github.io/

Backend code: evansmusitu/mft-axiom-build, isolated branch feature/musitu-multidoc-evidence-20261020, commit 6147ceed65dcc4d7594913db16408669423738c3. DO NOT write to protected Axiom main.

Deployed Cloudflare Worker: https://musitu-intelligence-edge-20261019.mft-education-nexus-93f395f5.workers.dev

Existing canary Worker: https://musitu-intelligence-edge-capacity-canary-20261019.mft-education-nexus-93f395f5.workers.dev

Cloudflare account ID to CONFIRM before any change: 93f395f5121954671f92fffa453d6b61. Existing Cloudflare API credentials are confidential Actions secrets and are never in this package.

Private Google Drive handoff folder: https://drive.google.com/drive/folders/1YxjwUwWzZJzMC2CoSy-Mms8kXnAco0ZT

## Deployed capabilities (as documented in code and prior successful tests)

1. Static GitHub Pages responsive website and embedded MUSITU AI interface (frontend/index.html, assets/musitu-edge-chat.js and CSS).
2. Cloudflare Workers AI standard Meta Llama and deeper Qwen mode with distinct bounded rate controls, browser CORS checks and errors (backend/studio-edge/worker.mjs and wrangler configs).
3. Deterministic /api/calculate arithmetic parser with precision limitations (backend/studio-edge/math.mjs).
4. AI image generation with bounded prompt/output, mediated by the Worker.
5. Research from limited preselected public providers (Wikipedia and Hacker News) with source links, explicit limits and citation-index constraints; NOT open-ended real-time browsing.
6. DOI bibliographic discovery from Crossref; DOI registration and citation counts do not prove peer review or findings.
7. Local-only browser parsing for plain text, Markdown, CSV, JSON, selectable-text PDFs (<=2 MiB, <=20 pages), Word DOCX (<=1 MiB) using pinned, self-hosted PDF.js and Mammoth browser libraries. Scanned or encrypted PDFs are not supported.
8. Single-document excerpt analysis (<=4,800 characters) and local three-document comparison (<=1,500 selected characters/document); files themselves never upload to Worker, only explicit selected excerpts, no persistent file database.
9. Deterministic citation number auditing with D1/D2/D3 source labels, unsupported reference warnings, but NOT independent fact-checking.
10. Five opt-in separate local browser encrypted conversation workspaces; first slot retains original v1 localStorage key and encryption. AES-256-GCM with passphrase-derived key, manual save/unlock/export/import/delete; no central user accounts, device syncing, passphrase recovery, cloud file vault or server-held encrypted chat content.
11. Website site structure, Node unit tests, Chromium E2E through GitHub Actions, production asset audits and recurring no-inference synthetic monitor.
12. Current website snapshot may contain other client-side evidence/council workflows. Those are included in frontend/ because this is the COMPLETE website repository snapshot. They are not blanket proof of independent production cloud services or authorization to launch paid workloads.

## Verified release evidence

For pinned website main SHA 7eb670aa6fa4660ef8a0f033d23a472922eea9fe, GitHub Actions showed success for:
- Website published acceptance: https://github.com/evansmusitu/evansmusitu.github.io/actions/runs/39446877594
- Browser live AI site verification: https://github.com/evansmusitu/evansmusitu.github.io/actions/runs/39446678700
- Public website Pages release: https://github.com/evansmusitu/evansmusitu.github.io/actions/runs/39446678642
- Recurring production reliability watch: https://github.com/evansmusitu/evansmusitu.github.io/actions/runs/39446678591
- Website quality suite: https://github.com/evansmusitu/evansmusitu.github.io/actions/runs/39446678581
- GitHub Pages built-in build/deploy: https://github.com/evansmusitu/evansmusitu.github.io/actions/runs/39446677685
- Older verified backend multi-document live release run: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39401018840 . That proves an earlier release, not current runtime identity; inspect current Worker before claiming it is identical to backend commit.
- This package generation writes a fresh local unit-test VALIDATION_REPORT.txt.

## Runtime and deployment

Website full source and browser tests: frontend/.
Backend isolated Worker source: backend/studio-edge/.
Backend workflow references: backend/.github/workflows/.

Node.js 22. Source-level quick tests:
- From frontend/: node tests/site.test.mjs
- From frontend/: node --test tests/workspace-vault.test.mjs tests/workspace-slots.test.mjs tests/evidence-pack.test.mjs tests/local-evidence.test.mjs
- From backend/: node --test studio-edge/tests/*.test.mjs

For browser E2E, install pinned package.json dependencies and use existing website GitHub Actions. PDF.js and Mammoth are versioned in frontend/assets/vendor/ due to prior two-branch Pages build overwrite; never delete these files as incidental generated assets.

For backend deploy, use existing verified GitHub Actions canary path, not blind local CLI production deployment; confirm exact Cloudflare account and bindings. Isolated backend branch may not be the most recent future branch. All Cloudflare tokens remain in authorized secrets.

## Restrictions and limitations

- There is NO implemented authenticated centralized cloud workspace, no per-user tenant isolation, no independent enterprise security qualification, no globally coordinated hard spending cap.
- Never equate healthy metadata endpoint with an inference success, or matching source IDs with factually supported assertions.
- Browser localStorage vault protects encrypted data at rest against someone without the passphrase, but DOES NOT defend an unlocked browser or malicious scripts. Never store passwords, customer secrets or sensitive files in it.
- No proof of full-text PDF reasoning where only excerpts were sent. Scans require OCR.
- Do not reuse existing Neon project databases for website customer data without explicit separate privacy/security qualification.
- Do not reset MFA, credentials, share private Drive files, change billing, purchase credits, or deploy additional public products without permission.
- Do not modify frozen MUSITU Axiom main/OpenAI submission, PR #1, MUSITU Mail Fabric, MUSITU WhatsApp Phase 1, FMI, Education Nexus or other unrelated code in this cross-chat handoff. Relevant production website deployment was previously approved.

## Next chat execution process

1. Open the private Drive folder and read this ZIP plus exact new-chat command. Do not ask the user to restate previously supplied project history.
2. Verify both pinned commits against connected GitHub live heads, workflow status and public website assets; treat deviations as a genuine update, not automatic regression.
3. Re-run available deterministic unit tests. Use established browser CI or Work interactive browser if available. Do not claim desktop/browser control if only basic search is available.
4. Choose and implement the most valuable safe next increment: potential options include dedicated authenticated tenant/workspace system with new isolated storage, stronger full-document source retrieval with bounded costs, structured verified tool orchestration, and measured inference/security qualification. Complete one working capability, not a vague architecture proposal.
5. Work on isolated branches. Require CI green, actual canary inference for Worker changes, live website production acceptance for Pages changes, and rollback on failures. Never cross project boundaries.
6. Record exact GitHub SHAs, user-visible URLs, tests and limitations. On request, create an updated ZIP and continuation command in the same private Drive folder.

## Data exclusion

The ZIP includes source code and deployment *templates* only. It intentionally excludes personal encrypted browser vault contents, credentials, Cloudflare token values, current server/database contents, actual Meta user data, live customer WhatsApp messages and proprietary production operating logs. These cannot be recreated from source without authorized connections.
