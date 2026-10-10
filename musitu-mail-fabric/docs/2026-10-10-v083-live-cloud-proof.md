# MUSITU Mail Fabric v0.8.3 — Live Synthetic Cloud Qualification Evidence

Evidence date: 2026-10-10 UTC
Isolated source commit evaluated: `4a438bac93b8e6a0c55c44f93f9c8305b9ad1f7f`

## Verified live result

GitHub Actions: https://github.com/evansmusitu/mft-axiom-build/actions/runs/38027200745
Gate: `MMF_V082_CLOUD_FULL_DURABLE_TRANSACTION`
Result: **PASS**.

GitHub Actions observed real **private Cloudflare Queue** processing of a randomly generated synthetic probe. The Worker passed the message to the private SQLite-backed Durable Object, executed the full `DurableMailFabric` enqueue/claim/finalize path using an **in-process simulated provider only**, and exported a signed event chain. A separate GitHub runner independently verified that chain using the explicitly pinned synthetic staging Ed25519 SPKI SHA-256 fingerprint `19ca01d99a0189dd4829f5514392abaa55aeca5ef6188b7654e9f1dfcd370a71`.

The GitHub job read back public visibility flags after deploying and verified that the Worker remained non-public, `MMF_REAL_SEND_ENABLED=false`, `MMF_API_ENABLED=false`, and `MMF_WEBHOOK_ENABLED=false`. No customer email, mailbox delivery, SMTP provider or recipient data was used.

Job tests: 98 total; 97 passed, one optional test skipped, zero failed.

## Root-cause correction

Earlier attempted cloud runs left a synthetic transaction in `SENDING`, despite the local SQLite regression suite being green. Cloudflare's `SqlStorageCursor.rowsWritten` reports billed row writes (which include secondary-index writes), not the number of SQL rows affected. The staging D1 adapter had incorrectly returned `rowsWritten` as `meta.changes`. This made the durable claim reject a valid state transition.

A dedicated regression `test/durable-sql-write-count-v08.test.mjs` reproduced the defect with **seven billed writes but one changed message**. The DO adapter now reads `SELECT changes() AS n` immediately after each synchronous SQL statement. The final live cloud run confirms the fix in actual Cloudflare execution.

## Security limitations / external qualification

This is *not* a live mail delivery benchmark, independent external penetration test, customer-controlled KMS/HSM custody, full end-to-end real provider event roundtrip, legally qualified electronic delivery, or a verified Cloudflare-wide outage recovery test. Stage private keys are disposable synthetic-only Cloudflare Worker secrets and should not be used as customer signing roots.

The code now includes a dual-signed production authorization gate, sender ownership policy, durable minute/day/recipient ceilings, stale queue expiry, authenticated Resend event code, complaint/bounce suppression, and independent evidence verification. These security controls have unit/regression coverage but **have not all been exercised with live customer traffic**.

Required independent security assessor deliverable: dated signed report with source SHA, threat model, tested attack surface, independent critical/high findings and remediation confirmation. See `docs/2026-10-10-third-party-security-assessment-brief.md`.

Production remains **BLOCKED** pending separately held long-lived root/KMS keys with backups, authorized live real-provider event testing, real outage recovery, legal/privacy and customer approval, and independent security sign-off. The production release grant must not be issued until those controls are verified.

No protected AXIOM production branch, existing support Worker, DNS, OAuth, OpenAI submission or production customer data was changed.
