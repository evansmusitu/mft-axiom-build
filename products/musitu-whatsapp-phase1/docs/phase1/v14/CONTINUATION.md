# MUSITU WhatsApp SaaS — Phase 1 v1.4.0 qualification continuation

**Date:** 2026-10-13. **Environment:** Private localhost/SQLite and injected integrations. **Commercial release:** BLOCKED.

## Work performed

This pass extends v1.3.0 without changing any remote AXIOM, FMI or MAIL FABRIC deployment. It closes observed security defects in owner-approved FAQ selection, unpinned model gateway destinations, webhook slow/incomplete or oversized uploads, indefinite provider persistence hangs, and local signed-message replay identity. The local store now has a tenant/actor-signed append-only action audit with an OWNER/ADMIN-only read surface and private dashboard panel. All actionable HTTP and offline business operations remain restricted by existing authorization and consent controls. No Meta provider sending or payment capability has been enabled.

## Scope and limitations

- **Database:** local persistence remains SQLite. The existing Neon PostgreSQL 17 isolated sandbox demonstrated actual synthetic booking exclusion and idempotency constraints in prior v1.2.0 work. Its connected owner role was found to bypass RLS; an authorized restricted role is missing. v1.3.0 behavioral RLS gates remain unqualified on native PostgreSQL. Do not deploy with owner-role credentials.
- **Authentication:** locally signed RS256 test tokens and pinned issuer/AUD/JWKS verification. No live production Keycloak realm, full refresh/revocation, MFA or customer provisioning.
- **Meta:** signed-format callbacks and GET handshake through a loopback server, no authorized Meta account connected or real provider callbacks tested. Message send is disabled.
- **AI:** injected model transport only. FAQ selection requires explicit source approval and a pinned HTTPS origin. No real provider independently privacy-qualified or charged.
- **Audit:** the HMAC chain detects in-place edits when its key remains private, but not a privileged truncation of the final chain tail. A production-grade append-only offsite anchor, export, rotation, retention policy and independent audit must be added. PostgreSQL action audit is not implemented.
- **Dashboard:** plain HTML/JS private console; **not** an installed Next.js production build. Browser testing uses an injected local bridge due restricted Chrome navigation.

## Release decision

**BLOCKED** until a genuinely least-privilege Postgres role passes row-level security and concurrent booking qualification, an independent operator configures and verifies Keycloak and Meta dev credentials, real delivery/opt-out/retention tests pass, the model/AXIOM gateway is service-authenticated and audited, operations/backup/restore/monitoring succeed, and a documented production release approval occurs. Local tests cannot change that decision.

## Verification commands

```
npm run verify
npm run demo
npm run demo:next
npm run meta:protocol:demo
npm run browser:smoke
npm run release:gate   # expected exit status 2 — blocked
```

The source manifest and ZIP SHA-256 are reproducible; see `SOURCE_MANIFEST.sha256` and the external `<archive>.sha256` file. The outer digest is a checksum, not a cryptographic attestation by a trusted signer.
