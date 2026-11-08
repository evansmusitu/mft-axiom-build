# v1.4.0 — verification record (2026-10-13)

Fresh local `npm run verify`: **149 tests passed, 0 failed** and **58 JS syntax checks passed** before packaging. The source hash manifest was regenerated after all changes; clean extraction verification should be run independently against the sealed ZIP.

TDD regression logs in `docs/v14-*.log` record expected red failures prior to the new implementations and green passes afterward. Verified local cases include: explicit FAQ approval, model-origin pinning, oversized and incomplete webhook uploads, persistence operation deadlines, signed-message replay fingerprint verification through SQLite reopen, tenant-specific action audit with HMAC integrity checks, authorized audit HTTP access, and direct-stage payload/event bounds.

Real Chromium (Playwright local request bridge) passed authenticated login, tenant metrics, action audit view, draft view, human handover, disconnect data clearing and cross-tenant forbidden access. The fixture and browser paths are **not live customer traffic**. Local synthetic Meta handshake accepted valid traffic and rejected forged signatures, with **zero real sends** and **zero payments**.

`npm run release:gate` reported `PHASE1_RELEASE_BLOCKED` (expected process exit **2**) with 10 live integrations/approval gates unfulfilled. This is a success of the *fail-closed safety check*, not Phase 1 completion.

Native PostgreSQL role qualification remains blocked because the isolated Neon database owner has `BYPASSRLS`, and no authorized non-privileged application role has passed native tenant-behavior tests. Do not use the owner as an application role. Native Keycloak, real Meta test WhatsApp number, authorized outbound delivery, model provider, AXIOM service identity, Next.js deployment, Chatwoot inbox, and monitoring/backup recovery remain incomplete.

The ZIP's outer SHA-256 checksum is a transport integrity value, not an independent security attestation. No external system was modified in this iteration.
