# MUSITU Mail Fabric v0.8.3 — Cloudflare SQLite affected-row correctness

During private, synthetic-only, real Cloudflare Queue → Durable Object → Mail Fabric processing, the message incorrectly remained in SENDING. A new regression test proved the bug: SqlStorageCursor.rowsWritten is a billing metric that may count secondary-index writes; the original D1 compatibility layer mistakenly used it as the number of SQL rows modified.

A real one-row UPDATE can report seven billed rows. This made DurableMailFabric.claim incorrectly treat the successful transition to SENDING as not claimed, leaving the transaction stranded. The revised private Durable Object RPC obtains the SQLite affected row count through `SELECT changes() AS n` synchronously immediately after SQL execution. This count, not billed rowsWritten, becomes `meta.changes` in the D1-compatible adapter.

**Scope:** isolated stage plus shared software library; no production AXIOM resources or customer email changed. Regression: `test/durable-sql-write-count-v08.test.mjs` initially failed on the observed defect (7 vs 1), then must pass after the correction. Cloud CI must separately prove the actual transaction reaches simulated provider acceptance, durable payload erasure and a receipt independently verified against a pinned synthetic-stage Ed25519 key. Until that external cloud gate passes, this remains unqualified for production.

No claim of inbox delivery or independent third-party security certification is made.
