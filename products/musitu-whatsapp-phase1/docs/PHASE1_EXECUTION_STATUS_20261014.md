# MUSITU WhatsApp AI Employee — private Phase 1 execution status

**Phase 1 remains IN PROGRESS. No public launch or customer messaging is authorized.**

Original v1.7.0 archive: `MUSITU_WHATSAPP_PHASE1_PER_LEASE_PRIVACY_V17_2026-10-13.zip`.
Verified SHA-256: `cdb198bf187e6812cadef49d6382c7eb65d215be0fc29689ab703c44ae235bb3`.
The archive's internal manifest passed before changes; baseline 196/196 tests passed.

## Reviewable source and staging

- Repository: `evansmusitu/mft-axiom-build`.
- Isolated branch: `saas/musitu-whatsapp-phase1-private-20261014`.
- Product directory: `products/musitu-whatsapp-phase1`.
- Draft review: https://github.com/evansmusitu/mft-axiom-build/pull/29 . Keep unmerged.
- Latest tested application source: `cd7640677409e7b43afab81f50ccb0e33fe107f1`.
- Private staging: https://musitu-whatsapp-phase1-private-20261014-p3fc22x4a-evansmusitu.vercel.app .
- Vercel deployment: `dpl_HAhooU9S2EJKDYnPA5uMkGBrvmE3`; target `staging`; provider state `READY`.
- All deployments have Vercel authentication protection. Chromium reached the Vercel login screen; authenticated dashboard acceptance is pending sign-in.

The final evidence/documentation commit may follow the tested application commit. Application code must be requalified if changed.

## Verified work

| Workstream | Actual evidence | Remaining qualification |
|---|---|---|
| PostgreSQL | Restricted direct runtime/ingress logins; 19 FORCE-RLS business tables; separate RLS identity sessions; 26 hosted native checks pass | Independent security review; wider load/failure testing |
| Identity | PKCE/state/nonce code, RS256/JWKS validation, online introspection and opaque encrypted DB sessions; native session revocation/isolation pass | No real Keycloak environment, browser login, MFA, issuer rotation or provider revocation flow qualified |
| Meta | Official webhook protocol, raw HMAC verification, restricted development recipient allowlist, encrypted persistence and synthetic status reconciliation | No SaaS Meta app binding, secret custody, genuine Meta callback, authorized development send or genuine receipt qualified |
| AI | Existing evidence-bound provider gateway, prompt privacy preflight, timeout and bounded response tests retained | No approved live model, credential, quality evaluation, quota/cost ledger or operational conversation-model integration |
| AXIOM | Genuine connected `arithmetic.evaluate` call for `(120+80+100)/3` returned 100; plugin reports 74 operations and 30 business products | SaaS service identity/transport is not connected; one operation is not qualification of all operations |
| Application | Next.js 16.4 build; owner/staff routes, onboarding/configuration, approved knowledge, resources/bookings, human handover, response approval, opt-outs, encrypted message reads and audit | Authenticated browser flows; actual user onboarding; real human replies; business channel ownership onboarding; UI/UX assessment |
| Infrastructure | Separate private Vercel project, HTTPS headers, encrypted environment secrets, database startup qualification, genuine DB restart and earlier snapshot restore | Expanded-schema backup/restore, automated retention, alerts/on-call and latest restore drill remain incomplete |
| Acceptance | 206 local automated tests pass; 26 real PostgreSQL integration checks pass; hosted data API rejects absent session with 403 | Full genuine-service end-to-end acceptance remains blocked |

## Evidence scope

`evidence/20261014/real-postgres-qualification-extended.json` is actual execution in Vercel's build environment against the named Neon sandbox. Both `current_user` and `session_user` were the restricted application identities. No Neon owner credentials were installed as runtime credentials.

The provider messages, contacts, business facts and status callbacks in that suite are **synthetic**. They validate real PostgreSQL behavior but do not prove Meta delivery, legal consent, model behavior or an actual merchant deployment. Ten concurrent bookings yielded one confirmed reservation and nine conflicts. Late `sent` did not downgrade a synthetic previously delivered attempt.

The database restart preserved 2 tenants, 1 booking, 4 inbound events, 1 approval and 3 audit records at that checkpoint. An earlier snapshot restore reproduced the same counts. The restore API unexpectedly finalized a swap; the original branch/default and endpoint were returned, the original data retained, and the restored copy retained without compute. Details are in `snapshot-restore.json`.

A newer snapshot attempt returned **snapshots limit exceeded**. No paid upgrade was selected and existing recovery evidence was preserved. The earlier snapshot predates the expanded 19-table schema; do not represent it as a complete backup of the latest candidate.

## Exact blockers

1. Browser needs Vercel sign-in to verify the protected application DOM and capture dashboard evidence.
2. No dedicated Keycloak host, realm, client, users and approved OIDC secrets are configured. Vercel protection is an outer hosting boundary, not business identity.
3. The observed Meta app is MFT AI NEXUS (`1775810357073694`). Its webhook and runtime were not changed. The SaaS needs a separate development binding/app and an authorized callback ingress that Meta can reach without opening the dashboard.
4. No approved no-charge model provider and secure provider credential are configured. No model API spending is authorized by the current candidate.
5. AXIOM's connected tool works, but its application service credential/interface has not been connected to this SaaS. Production AXIOM was not modified.
6. No provider sender/outbox has been qualified. Public and customer sending remain disabled; no live WhatsApp messages were sent for this SaaS.
7. Snapshot capacity blocks a newer backup, and monitoring alerts have no authorized destination or verified operational response.
8. No independent security assessor or full real-service acceptance sign-off has been obtained.

## Protected systems and publication

Only the named SaaS branch/product subtree, the isolated Neon project and separate Vercel project were changed. AXIOM main, frozen submissions, MAIL FABRIC branches, FMI and Nexus production configurations were not changed. This source repository is public: never add credentials, genuine customer data or confidential business documents to it.

No subscription purchase, paid upgrade or public promotion was performed. Provider billing was not independently audited; do not infer an invoice amount from this statement.
