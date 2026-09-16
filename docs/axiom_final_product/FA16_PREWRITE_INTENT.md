# FA-16 — Mobile / PWA / Offline / Reconnect — Pre-write Intent

Status: AUTHORITY_FROZEN_FOR_IMPLEMENTATION

## Frozen source authority

The authoritative final-product program defines FA-16 as:

- Class: Implementation.
- Scope: supervision-first mobile, PWA installability, safe offline queue/replay and a real-device matrix.
- Gate: **Never fake tablet.**

Live verified implementation parent:

- branch: `frontier/axiom-final-product-fa15-20260916`
- commit: `ab96c4347cd8ffd2a694c791d40932f175eb880d`
- FA-15 ordered builder/test/security/independent-verifier qualification: PASS.

FA-15 verification does not authorize FA-16 production, publication, external execution, cloud sync, physical-device claims or phase exit.

## Required observable behavior

1. Mobile is a distinct supervision surface with Home, Projects, Work, Agents and You as its primary navigation.
2. Mobile supports capture/start/monitor/approve/steer/read/evidence/interruption workflows while heavy Build authoring remains desktop-first.
3. The application exposes a same-origin manifest and service worker with an offline navigation shell.
4. Sensitive/API/auth/session/billing/health responses are network-only and are never cached by the service worker.
5. PWA installation is claimed only after a browser install signal or standalone display mode; prompt availability is not installation proof.
6. Offline persistence accepts only explicitly allow-listed local S0/S1 drafts and rejects external, public, destructive, secret-bearing or higher-risk work.
7. Every queued record binds payload, idempotency key and frozen authority with SHA-256 integrity evidence.
8. Browser `online` is only a signal. Reconnect must also prove same-origin reachability before replay.
9. Replay revalidates the exact frozen scope and remains local; no queued draft may become an external side effect.
10. Duplicate replay returns the original receipt rather than repeating the side effect.
11. Emulation, viewport size, user agent and CI are software evidence only. They cannot satisfy `REAL_DEVICE`.
12. Physical-device phase exit requires all required scenarios plus a distinct external attestation verifier.

## Security boundary

Offline data is not authority. Stale approvals, retrieved content and queued records cannot widen scope. Service-worker caches may contain only non-sensitive same-origin application-shell resources. Tokens, cookies, secret values, API responses, user sessions, enterprise data and billing data are never deliberate cache inputs.

The candidate contains no deployment credentials, repository-write token, production authority or external scheduler/executor.

## Truth boundary

This implementation may earn:

`SOFTWARE_IMPLEMENTATION_VERIFIED_PHASE_EXIT_BLOCKED_REAL_DEVICE`

It may not earn the full FA-16 phase exit without genuine physical-device evidence. The repository truth is therefore:

- `PWA_INSTALL=IMPLEMENTED_PENDING_BROWSER_QUALIFICATION`
- `OFFLINE_RECONNECT=IMPLEMENTED_PENDING_INDEPENDENT_VERIFICATION`
- `REAL_DEVICE=NOT_PROVEN`
- `phase_exit_earned=false`
- `production_authority=false`

Historical legacy Phase 14 remains unchanged/incomplete. `WOLFRAM_PARITY=NOT_CERTIFIED` and `SUPERIORITY=NOT_CERTIFIED` remain unchanged.

## Required ordered qualification

`BUILDER → TESTS → SECURITY/ADVERSARIAL REVIEW → INDEPENDENT VERIFIER → POLICY GATE`

The independent verifier must be credential-free and read-only. It may verify the software implementation, but it must preserve the real-device blocker and may not authorize production.

