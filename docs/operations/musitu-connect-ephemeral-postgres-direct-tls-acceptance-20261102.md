# MUSITU Connect — direct PostgreSQL transport TLS, isolated acceptance

**Date:** 2026-11-02  
**Verdict:** PASS for disposable PostgreSQL-17 **direct client-to-database** transport, not hosted Neon or a deployed Worker. **Customer release remains blocked.**

## What this closes

The earlier loopback HTTPS test verified the application's HTTP client/server TLS but used an unencrypted local PostgreSQL connection behind the HTTP listener. It did not prove the database transport. This additional test separately checks a PostgreSQL client `sslmode=verify-full` with server-certificate trust, hostname validation, `channel_binding=require` (SCRAM), and encrypted `pg_stat_ssl` session readback.

The new fixture uses an ephemeral PostgreSQL 17 GitHub Actions service, not a hosted Neon endpoint. It prepares a short-lived self-signed certificate containing an IP subject alternative name for `127.0.0.1`. The service is configured for SSL, with an explicit `hostnossl` rejection rule; the client pins the ephemeral certificate as its trust root. A separate independently generated untrusted certificate is used as a negative test. No private certificate/key is committed. The test's connection string is a disposable hard-coded loopback service credential, not a production or hosted-Neon secret.

The isolated CI test `tests/connect/test_neon_pg_tls_direct_integration.py` requires an exact disposable Postgres DSN and validates:

1. The wrong CA cannot authenticate the server.
2. An incorrect certificate hostname with `hostaddr=127.0.0.1` cannot authenticate the server.
3. A plaintext PostgreSQL connection is rejected by the CI server's access rules.
4. Both owner-control and real restricted `musitu_ci_app` SQL sessions report `pg_stat_ssl.ssl=true` with a TLS version and negotiated cipher.
5. `channel_binding=require` succeeds for authenticated SCRAM client connections, and the restricted login has no ability to query stored token digests.
6. A real admission via `connect_qualification.admit` succeeds, then replay returns a conflict, a new over-quota attempt fails, and event/daily/minute counters remain exactly 1/1/1.

The test never enables any customer route, performs a remote schema migration, contacts production, or changes the frozen predictive methane model.

## Reproducible red/green evidence

- **RED:** feature commit `de330adb730e0ed849d499efd018119cb3588c94`, GitHub workflow run `41393704038`; the original isolated PostgreSQL service accepted a plaintext connection and the test failed specifically with `AssertionError: PLAINTEXT_POSTGRES_ACCEPTED`. This demonstrates the negative test is effective.
- **GREEN:** commit `5092cb2d6743dda88adc5bb740761f1a363ce0f5`, GitHub Neon run `41393858138` successful, emitting:
  - `NEON_EPHEMERAL_POSTGRES_TLS_VERIFY_FULL=PASS`
  - `NEON_EPHEMERAL_POSTGRES_SCRAM_CHANNEL_BINDING=PASS`
  - `NEON_EPHEMERAL_POSTGRES_REJECTS_WRONG_CA_HOST_AND_PLAINTEXT=PASS`
  - `NEON_EPHEMERAL_POSTGRES_TLS_RESTRICTED_ADMISSION=PASS`
  - `HOSTED_NEON_DIRECT_CLIENT_TLS_VERIFIED=false`
- **Suite integration:** General Connect discovery initially failed because the standalone file's top-level `psycopg` import was unavailable outside its specialized CI step. This was corrected by lazy import in commit `47c95ba62f0e8795a1b5cf22f87330a120446a71`; general Connect workflow `41393989419` and dedicated Neon workflow `41393989396` then completed successfully. The initial failure is retained, not obscured.

The CI setup is isolated and should **never** be pointed at a reusable or hosted database. An independent, reviewed hosted-Neon database connection test would require explicit owner approval, a bounded isolated secret, approved network access, pinning or validation of a trusted CA, external hostname verification on that same direct application session, fail-closed connection handling, and separate security sign-off.

## Explicit non-claims

- The hosted Neon MCP SQL-session observation is not evidence of TLS for a direct external application client.
- A disposable self-signed CI certificate does not prove hosted-Neon's external trust chain.
- `psycopg` libpq channel-binding acceptance does not yet qualify Node/Cloudflare Workers' own SQL transport.
- This does not prove Internet/WAF/proxy origin identity, hosted availability/failover, secret storage, distributed exactly-once business execution, or a deployed Worker-to-Neon route.
- No independent physical mine holdout has been accepted and no product, operations, security, legal, pilot or release owner has signed off.

**Non-enabling release flags:** `worker_to_hosted_neon_tls_staging_acceptance_completed=false`, `actual_external_client_neon_tls_hostname_verified=false`, new customer admission/public listing/production methane prediction **false**. Main and the existing production Worker remain unchanged.

CI: https://github.com/evansmusitu/mft-axiom-build/actions/runs/41393989396

PostgreSQL reference: https://www.postgresql.org/docs/17/libpq-ssl.html and https://www.postgresql.org/docs/17/libpq-connect.html
