# mft-axiom-build
Good news always


## MUSITU Connect

This branch contains the general-purpose MUSITU Connect enterprise interoperability and adapter platform and its first Mining Adapter. MUSITU Connect is the integration/runtime layer; MUSITU Axiom remains the downstream quantitative engine.

Infrastructure lock: `infra/versions.lock`

Current controlled state:
- Infrastructure qualification: **QUALIFIED**
- Controlled Connect → Axiom bridge: **QUALIFIED**
- Credentialed request-ID E2E: **QUALIFIED**
- OAuth authorization-code / S256 PKCE admission control: **QUALIFIED (composed evidence)**
- Secret rotation/recovery, rollback, canary and bounded SLO controls: **QUALIFIED**
- Dedicated non-fixture Axiom service identity: **QUALIFIED**
- Production promotion authorization: **AUTHORIZED**
- Production runtime authorization: **AUTHORIZED**
- Production runtime: **ENABLED and VERIFIED**
- Production Connect → Axiom integration: **ENABLED and VERIFIED**
- PR #9: **intentionally unmerged**

Production runtime endpoint:
`https://musitu-connect-production.mft-education-nexus-93f395f5.workers.dev`

The production rollout was canary-first and fail-closed. The isolated canary and the production Worker both verified authenticated deterministic planning, the Mining-derived Axiom result `3.348`, and exact Connect request-ID correlation in the Axiom usage ledger. Unauthenticated production planning is rejected with HTTP 401. Failed rollout attempts demonstrated automatic cleanup/rollback before the successful activation.

The preferred custom hostname `connect.musitu.com` remains deferred because the active Cloudflare account cannot currently create the narrowly scoped machine-transport rule required for that hostname without weakening zone security. No global security policy was weakened. The stable Workers.dev endpoint is therefore the verified production surface.

Production admission remains conceptually separate from runtime activation: `ProductionAdmissionPolicy` never enables the runtime itself. Runtime activation required separate explicit authorization and independently validated live rollout evidence.

Gate record: `qualification/musitu_connect_gate.json`
