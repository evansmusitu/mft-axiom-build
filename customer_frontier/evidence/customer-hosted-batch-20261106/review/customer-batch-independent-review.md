# Customer hosted batch: hold at code-only draft

**Full hosted-write review incomplete within the user window. No hosted credential/run recommendation.** The20:59:18UTC window ended; final regression completed at20:59:27UTC.

Initial source `a47efb8c2e6e4fa37c241dc81c7d2b8bc6a3d5f9` had a confirmed P2 blocker: any first-batch exception counted as rollback evidence. A real SQLite adapter with a synthetic pre-execution transient failure then applied the forward schema and reported atomic rollback true. The original source, independent repro and log are preserved in `customer-batch-original-worker.mjs`, `customer-batch-transient-repro.test.mjs` and `customer-batch-transient-repro.log`; see `customer-batch-initial-blocker.md`.

The narrow repair is independently verified at `3d7fba395a051421e1ceacb06ee5c425830d9421`, tree `8167f00900ce1bb6164c4cbcc04859629942b9e4`, parent `a47efb8…`. It requires the specifically named intended CHECK failure before proceeding and retains catalog rollback checks. Exact remote/local Worker/test bytes and hashes matched; corrected local workflow SHA-256 is `3797d63862214742a00d53b0eee4e7fe51ba7a77250e6a10a6e74f89ab339bcd`.

Four supplied corrected tests pass. An independent added regression tests transient busy and unrelated CHECK failures; each rejects after one batch without a tenants table or forward application. Five total methods pass in `customer-batch-fixed-regression.log`. Exact identities are retained in `customer-batch-fixed-identities.json`.

This closes the identified source defect only. The complete hosted driver/write and final workflow admission review did not finish within the window, so the correction does not constitute a hosted-run recommendation. Keep the root's proposed code-only draft/hold. No provider calls or root-source edits were performed by this reviewer, and no actual hosted result is inferred.

No customer/hosted recovery, production OAuth, integration or release gate is qualified. Preserve PR1,$0,Paynow,customer/q06 data, rollback origin and existing evidence/status authorities.
