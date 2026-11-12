# G1 only — live private Neon ↔ Cloudflare protected spending acceptance
**Status:** NO-GO / EXTERNAL AUTHORIZATION HOLD. This is an operator acceptance plan, NOT a production deployment instruction or a signed PASS receipt.
**Date:** 2026-11-12. **Source reference:** GitHub `evansmusitu/mft-axiom-build`; keep canonical `main` unchanged and source drafts unmerged.
**Independent authorities required:** Neon project owner, AWS private-network operator, Cloudflare Workers/Hyperdrive operator, PostgreSQL privileged migration owner and security acceptance reviewer. Record exact identities/custody privately, **not** public emails, passwords, connection strings or tokens.

## What was actually observed
- Connected Neon project is PostgreSQL **17** in **AWS us-east-2**, organization plan **Scale**. Its `main` branch is protected; `block_public_connections=true`, `block_vpc_connections=false`. An allowlist of broad shared Cloudflare CIDRs exists but DOES NOT provide private origin identity and must not be used to bypass the public block.
- One PostgreSQL role (**neondb_owner**) and one project member were returned by control-plane readback. NO dedicated runtime LOGIN or separate `NOLOGIN` definer was demonstrated. This is NOT a statement about any accounts outside the connected project.
- One authorized **read-only** Neon SQL attempt requesting only database/current role/server version and current `pg_stat_ssl` was rejected by Neon IP policy **before any SQL session**. Thus TLS, SQL privilege, installed functions, schema and ledger counters remain **unobserved**.
- No read-enabled Cloudflare account/VPC/Hyperdrive deployment connector is available in this review. No live binding manifest or worker route inventory has been independently authenticated.
- Synthetic PostgreSQL 17 tests of protected RPC/ledger and offline Hyperdrive preflight do **not** satisfy real networking or source-route acceptance.

## Network topology requiring independent approval
Cloudflare **Worker/Queue → Hyperdrive private-origin configuration → Workers VPC TCP Service → outbound Cloudflare Tunnel (`cloudflared`) in independently owned AWS us-east-2 VPC → AWS PrivateLink interface endpoint → Neon private PostgreSQL endpoint**.

Neon Private Networking offers AWS PrivateLink (Scale plan); Cloudflare Hyperdrive supports Workers VPC service origins. This topology is a **proposal** only. Scale-plan entitlement alone does not prove any private endpoint, Cloudflare Tunnel or DNS/CA configuration exists.

External references:
- https://neon.com/blog/aws-privatelink-for-neon-databases
- https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database-vpc/
- https://developers.cloudflare.com/workers-vpc/examples/private-database/
- https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/

Required owner-reviewed controls (the order is deliberate):
1. **Scope/finance before infrastructure:** record approved region, TTL, availability, max AWS/NAT/VPC/PrivateLink/Cloudflare/Neon spend, designated operator, immutable owner approval, full rollback and kill switch. Real infrastructure and cloud subscriptions can incur charges; this review authorizes **no creation or billing**.
2. **Neon private endpoint:** Neon admin verifies Private Networking entitlement and creates/associates a Neon VPC endpoint with the designated private AWS VPC only after approval. AWS operator creates a matching interface endpoint, locked security groups/DNS and demonstrably **no public ingress**; test AWS-private network resolution before any Cloudflare setup. Capture sanitized endpoint ID hash, region and VPC boundary; do not publish private DNS or credentials. Keep `block_public_connections=true`.
3. **Workers VPC service:** AWS/Cloudflare operators run `cloudflared` only in the approved private network, configure a TCP VPC Service pinned to the actual private endpoint host:5432, observe tunnel health, exact service ID and region. No public tunnel hostname route, no public SQL health endpoint. Ensure `verify_full` CA **and hostname** validation at the VPC Service/origin hop; this is NOT proven by TLS merely being enabled in PostgreSQL.
4. **Hyperdrive:** use its `--service-id` *private VPC service* location, not a public Neon hostname/Cloudflare shared egress CIDR fallback; owner-reviewed configuration has **query cache disabled**, bounded origin pool cap, exact private network service ID, secret stored only in Cloudflare secret store, no SQL telemetry or credentials in public logs. Record read-only sanitized Cloudflare API/Workers configuration digest. Validate every target Worker/Queue/cron path uses the authorized binding only.
5. **Privileged PostgreSQL role handoff:** with a **separately authorized** change window and rollback, provision `axiom_spend_definer NOLOGIN` as least-privileged, non-admin owner of only the reviewed `SECURITY DEFINER` `reserve`/`settle` functions, plus a separate restricted runtime LOGIN. Before applying, independently review exact SQL: `reasoning/phase2/sql/provider_spend_protected.sql` and `provider_spend_definer_handoff.sql`. Do not reuse `neondb_owner`/administrator for billing runtime; deny all direct table SELECT/DML, database/schema CREATE, role membership, PUBLIC execution, and improper default privileges. Owner grants exactly approved schema USAGE and exact signature EXECUTE. Do not treat source migrations as already installed.
6. **Real SQL/TLS read-only receipt:** only through the approved Cloudflare private route and least-privilege runtime, run a single bounded read-only probe (no raw secrets) with exact database/current role, `pg_stat_ssl.ssl` and `pg_stat_ssl.version` for **its own backend**; reject missing TLS or older than TLS 1.2. At the independent control plane, inspect VPC Service TLS `verify_full`, certificate chain/SAN identity, expected endpoint hostname and no public fallback. Query exact `pg_proc` owner/prosecdef/proconfig/proacl and runtime role privilege denial, including column-level grants; verify both SQL RPC signatures. A positive `pg_stat_ssl` alone does NOT attest the peer hostname or nonpublic route.
7. **Worker-wide central billing:** use fixed synthetic provider responses (no real OpenAI/Anthropic calls) through at least two independently deployed, distinct Worker instances and queue/cron entrypoints. Prove all paid compile/explain/repair paths are bound to the **same protected PostgreSQL organization + tenant ledger**, one concurrent reservation is denied before upstream, tenant and organization caps remain consistent under contention/failover, duplicate/ambiguous receipts never trigger automatic paid retry, direct DML denied, overage suspends, and no SQLite/admin PG fallback. Attach deployment SHA and anonymized evidence-digest for every route, never customer data.
8. **Independent signatures:** network owner, database operator, Cloudflare deployer and security reviewer accept the **same** exact source SHA, PostgreSQL schema/ACL digest, VPC service/Hyperdrive binding digest, Worker deployment manifest, signed measured concurrency captures and cost/rollback envelope. Security reviewer must validate provenance from provider-native readbacks, not only self-declared JSON.

## G1-only acceptance rule (all required, none currently verified)
| G1 check | Observed 2026-11-12 | Required for PASS |
| --- | --- | --- |
| Private AWS/Neon endpoint + Cloudflare Workers VPC/Tunnel routing | **MISSING REAL PROOF** | independently verified exact private endpoint and VPC service readbacks, public route denied |
| Real Hyperdrive TLS verify-full + `pg_stat_ssl` origin session | **BLOCKED BEFORE SQL** | actual TLS evidence + independent CA/SAN/hostname controls |
| Dedicated runtime and separate non-login function owner | **ONLY OWNER ROLE OBSERVED** | exact restricted role/member/ACL and `SECURITY DEFINER` SQL readbacks |
| Protected company/vendor + tenant caps and exact RPC scope | **SYNTHETIC CI ONLY** | real protected SQL transaction and denied direct DML readbacks |
| All deployed paid worker/queue/cron paths use one immutable ledger | **NO DEPLOYMENT INVENTORY** | control-plane manifest + per-route denial/identity proof |
| Cross-worker concurrency, overage/retry and failover | **SYNTHETIC CI ONLY** | bounded private staging test capturing atomicity and denials |
| Independent responsible-operator signed G1 receipt | **MISSING** | security and operators sign same versioned evidence, costs and rollback |

**Decision:** **G1 NO-GO**. Do not mark G1 accepted based on this packet, owner-only metadata, a source GREEN test, or a self-declared signed JSON object. No infrastructure, public ingress, SQL role, secret, provider spend, deployment or authorization was modified by writing this document.

## Closed staging source probe (not an authorization grant)
Draft #99 provides `reasoning/phase2/cloudflare-staging/src/probe.mjs` and a scheduled-only Worker. The additional G1 strict probe introduced in draft #239 requires `G1_REQUIRE_ORIGIN_TLS='true'` and checks one read-only `pg_catalog.pg_stat_ssl` row for the current backend. The default read-only diagnostic continues to report `productionBillingEnforced:false`. A strict probe's success still requires the separately verified Cloudflare VPC `verify_full` origin hostname evidence and all other table rows above before G1 signoff. Never enable public HTTP diagnostics; staged `fetch()` always returns 404.
