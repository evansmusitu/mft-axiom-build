# mft-axiom-build
Good news always


## MUSITU Connect

This branch contains the general-purpose MUSITU Connect enterprise adapter platform and its first Mining Adapter. MUSITU Connect is the enterprise interoperability layer; MUSITU Axiom remains a downstream quantitative engine.

Infrastructure lock: `infra/versions.lock`

Current controlled state:
- Infrastructure qualification: **QUALIFIED**
- Controlled Connect → Axiom bridge: **QUALIFIED**
- Credentialed live request-ID E2E: **QUALIFIED**
- OAuth authorization-code / S256 PKCE admission control: **QUALIFIED (composed evidence)**
- Secret rotation/recovery rehearsal: **QUALIFIED on isolated canary**
- Rollback rehearsal: **QUALIFIED on isolated canary**
- Canary + bounded SLO + synthetic alert signal: **QUALIFIED on isolated canary**
- Non-fixture production Axiom identity: **BLOCKED — no dedicated Connect credential assigned**
- Production Axiom runtime enablement: **BLOCKED**

Production admission is intentionally separate from runtime enablement. All current technical admission controls except the non-fixture production identity are qualified. A read-only preflight confirms active non-fixture Axiom identities exist, but CI has no dedicated MUSITU Connect account key/bearer and no admin control secret to provision one through the supported path.

Direct production D1 identity insertion is intentionally prohibited. Once an authorized dedicated Connect credential is assigned, the preflight is designed to execute a canonical Connect → Axiom request and require exact Axiom usage-ledger request-ID correlation before the final technical identity control can qualify.

Even after technical readiness becomes green, an explicit promotion authorization is still required, and the admission policy itself never enables the production runtime.

Gate record: `qualification/musitu_connect_gate.json`
