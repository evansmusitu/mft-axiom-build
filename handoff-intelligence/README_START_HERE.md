# MUSITU Intelligence — complete product handoff

Snapshot date: 20 October 2026 (Africa/Harare).

START HERE: Read handoff/CURRENT_STATE_AND_NEXT_STEPS.md, handoff/SOURCE_MANIFEST.json, handoff/VALIDATION_REPORT.txt and handoff/EXACT_NEW_CHAT_COMMAND.txt.

This ZIP contains the exact versioned source of the public MUSITU Intelligence website and the isolated Cloudflare Workers AI Edge application, with deployment workflows, tests, self-hosted PDF/Word parsers, and a cross-chat continuation brief.

Layout:
- frontend/ — full website repository snapshot at commit 7eb670aa6fa4660ef8a0f033d23a472922eea9fe, including all GitHub Actions workflows and tests.
- backend/studio-edge/ — isolated AI Worker, all tools, models, Wrangler configuration and regression/live smoke tests at backend commit 6147ceed65dcc4d7594913db16408669423738c3.
- backend/.github/workflows/ — selected Edge deployment workflows from the backend branch.
- handoff/ — project checkpoint, source manifest, reproducible validation and exact new chat command.
- SHA256SUMS.txt — archive content integrity.

Verification after extracting ZIP into any directory: run sha256sum -c SHA256SUMS.txt from the extracted archive root.

Excluded intentionally: private secrets, local .env files, git internals, node_modules, connected cloud customer data, personal browser encrypted vaults, unrelated MUSITU Axiom services, and other projects. This is a reproducible source snapshot, NOT an offline copy of live cloud databases, deployed model weights or user sessions.
