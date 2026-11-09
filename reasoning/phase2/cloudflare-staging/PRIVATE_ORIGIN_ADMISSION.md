# MUSITU AXIOM Phase 2 — private-origin metadata admission (NO RELEASE)

**Draft / offline only. This package cannot deploy, provision a Cloudflare or AWS resource, modify Neon, run SQL, authorize a paid provider call, or certify connectivity.**

The private path under review is:

`Cloudflare Worker -> cache-disabled Hyperdrive -> Workers VPC TCP Service -> healthy cloudflared Tunnel -> approved AWS us-east-2 VPC -> Neon AWS PrivateLink endpoint -> Neon PostgreSQL 17`.

Cloudflare documents [Hyperdrive over Workers VPC](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database-vpc/): the VPC Service supplies TLS verification and its service ID is the Hyperdrive origin, so a public-origin connection string is not an acceptable substitute. Cloudflare's [Hyperdrive query caching docs](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/) establish caching as enabled by default and advise disabling caching for billing, access-control and fresh reads. [Neon private networking](https://neon.com/docs/guides/neon-private-networking) requires an eligible organization, a VPC endpoint in the same region, correctly ordered endpoint authorization/private DNS and suitable administration rights.

## Gate policy

`private_origin_admission.evaluate(snapshot)` accepts an *untrusted* cross-provider metadata dictionary and returns only allowlisted blocker codes, never source values or credentials. It checks:

- Exact pinned Neon staging project, region, protected branch, database, public-network block, VPC allowance and existence of a dedicated restricted runtime role. Mere role-name existence does **not** prove privileges.
- Healthy Cloudflare Tunnel and TCP Workers VPC service matching PostgreSQL port 5432, hostname-based routing and the same tunnel identity; explicit `verify_full` TLS, or Cloudflare's documented default if service TLS settings are omitted. This does **not** prove the live TLS handshake or hostname validity.
- Hyperdrive origin using the **same VPC service ID**, exact staging database and non-owner runtime login; no public-host fallback; caching explicitly disabled; locally conservative `5–20` soft connection limit; no incompatible public-origin `mtls` settings.
- One exactly named `HYPERDRIVE` binding on the dedicated staging diagnostic Worker, resolving to the same configuration ID.

The function always reports **`network_verified=false`, `authorized_to_deploy=false`, `production_release_qualified=false`**. Even complete configuration metadata yields only `METADATA_CANDIDATE_INDEPENDENT_EVIDENCE_REQUIRED`, with unresolved live TLS, runtime SQL ACL and protected spending-ledger assurance. **The evaluator is not an authorization decision and its input can be forged.** Future authenticated, signed, short-lived provider attestations and independent acceptance must be verified by a separate operator-controlled system, never by accepting a boolean from this code.

## Required external order; nothing here performs it

1. Secure explicit security/finance approvals for ongoing AWS VPC, PrivateLink and a persistent `cloudflared` host. Do not select a charged tier or build VPC infrastructure as part of this draft.
2. Configure Neon PrivateLink for a dedicated same-region AWS VPC, following Neon organization Admin and DNS ordering requirements. Preserve `block_public_connections=true`; do **not** allowlist generic Cloudflare/GitHub public IPs or reuse the `neondb_owner` login.
3. Provision and monitor the private Tunnel and Workers VPC TCP service. Use `verify_full` and a hostname with matching trusted certificate; do **not** downgrade to `verify_ca` or `disabled` to force a pass.
4. After independently reviewed operator approval, apply `reasoning/phase2/sql/postgres.sql`, `reasoning/phase2/sql/provider_spend_protected.sql` and the separately governed definer handoff in the correct order. Create a dedicated non-owner runtime login with **only** exact protected schema USAGE/function EXECUTE and no direct billing table SELECT/DML or elevated role privileges. Never apply migrations automatically or as the runtime role.
5. Create a Hyperdrive configuration with `--service-id` and `--caching-disabled`, approved secret handling and tight connection limits, then deploy a non-public staging-only diagnostic Worker with a pinned Hyperdrive binding. Do not enable any paid provider route.
6. Independently verify private AWS path, origin hostname TLS, short-lived secret handling, real PostgreSQL 17 catalog ACLs, protected functions, row-lock correctness, negative cross-customer tests, independent financial spend receipts, and fail-closed retry/rollback. Only signed external release authority may reconsider issue #74; **NO-GO** remains until then.

Synthetic tests (no secrets or network):

```sh
python3 -m unittest -v test_private_origin_admission.py
```

The currently observed staged resources lack a healthy Tunnel, any checked Hyperdrive config/binding, and the dedicated Neon runtime role. That is why **no live connection or deployment is claimed**.
