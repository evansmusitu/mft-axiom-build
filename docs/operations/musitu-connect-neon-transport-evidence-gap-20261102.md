# MUSITU Connect — external database TLS acceptance boundary (2026-11-02)

**Security status: NOT QUALIFIED for deployed application transport.**
This is not a claim that Neon's public PostgreSQL endpoint accepts
unencrypted external connections.

## Direct observations

- Project: isolated synthetic `morning-bread-51442570`; branch
  `br-fragrant-shape-b4egv2ux`; database `connect_qualification`.
- Authenticated SQL role: `musitu_connect_sql_invoker_20261101` (SQL-created,
  no inherited superuser group, no direct application-table access).
- A read-only `pg_stat_ssl` query from the **Neon MCP connector's**
  `run_sql` SQL session returned `ssl=false` with null version/cipher.
- There was no external PostgreSQL client with `sslmode=verify-full` in this
  check, and no TLS trust-chain or hostname verification was observed from
  a deployed or direct external application. The connector can use a separate
  provider control plane/proxy; this query alone does not characterize the
  Internet-facing PostgreSQL transport.
- Both `block_public_connections=true` and
  `block_vpc_connections=true` were independently read back immediately
  after the bounded SQL test. The test did not expose raw passwords.
- Neon's published external transport contract says it **requires TLS**
  on external connections and recommends `sslmode=verify-full` and
  `channel_binding=require` where supported:
  https://neon.com/docs/connect/connect-securely .
  Provider documentation is not a substitute for our own client acceptance.

## Separate tests that have passed

- Disposable loopback HTTPS test, temporary self-signed certificate with
  the client's explicit trusted CA, verified IP-hostname SAN and a negative
  wrong-hostname / untrusted-certificate case:
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/41386633451
- Ephemeral PostgreSQL 17 restricted LOGIN and quota/replay/credential
  rotation/fail-closed HTTP tests:
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/41386185680
- Hosted **database** SQL role/quota/concurrency/revocation/rollback
  contract:
  `docs/operations/musitu-connect-hosted-neon-restricted-role-acceptance-20261101.md`

These are different tests and **cannot be combined** to assert an externally
deployed HTTPS application using verified TLS to hosted PostgreSQL.

## Exact completion criteria for future approved isolated staging

1. Authorized owner-approved isolated runtime connection and secret rotation,
   with no connection string or private credential in Git or CI output.
2. Real external client TLS verification of server hostname, certificate
   chain and certificate validity (`sslmode=verify-full` or an
   equivalent explicitly configured driver option); reject disabled or
   forged/untrusted TLS, and require channel binding when supported.
3. Verify database identity `current_user`, project, branch and database
   against an independently supplied allowlist, alongside `pg_stat_ssl`
   **from that same direct connection**. Require `ssl=true` there.
4. Real isolated HTTPS Worker/API-to-Neon integration under the reviewed
   restricted application role. Test secret rotation, lost acknowledgments,
   retry identity, quota limits, immutable audit consistency and rollback
   under independent client connections, with explicit network fault tests.
5. Independent security reviewer acceptance, operational escalation and
   a separate accountable production authorization.

Until every item is satisfied, set
`worker_to_hosted_neon_tls_staging_acceptance_completed=false`.
Customer admission, production Worker migration and public listing remain
prohibited. A green ephemeral TLS test or Neon MCP query is **not**
an enabling acceptance signal.
