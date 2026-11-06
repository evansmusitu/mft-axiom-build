# Independent review: encrypted logical export of existing D1 candidate

**PASS for the bounded encrypted logical export only. No remaining P0–P2 blocker found.** This does not admit the candidate for writes, restore private production data to it, or qualify recovery, custody, migration or release.

Reviewed source `9838db06cde1e4add97b5da061905f2a1c5b3d56`, tree `609a23e496b77c583ed5321656eaefbc2f7ff333`, parent `1978cd977c470df6c9f7a72f548e1c2f142da3b1`. Independent exact-ref GitHub reads matched local source, public-recipient and test bytes, SHA-256 and Git blobs.

| Artifact | SHA-256 |
| --- | --- |
| Export reader | `35ef35223df6a459ce3ec9fd7eedaf04e64544642c985f618f3d740aea0d148c` |
| Public recipient | `d97bd50654cd7a02c55d25ebce421e1fc31642f1c4a57d2a24eafe9f5e328fd3` |
| Supplied tests | `17f6c5818a985cf9de950993a498bffe73e830f2f5b2ee5d5743081271f0b3b1` |
| Reviewed local workflow | `356f930c9bbbcfd87c04f6936e036f98e8b07d485dd71544a71f7ecab16a3899` |

Confirm published immutable workflow bytes match this hash before opening the credentialed PR. The workflow confines the token to one fixed-source step after checkout/hash checks and tests, gates opened-only/first-attempt execution to exact same-repository head/base branches and base SHA, pins checkout/upload actions, grants contents-read and disables persisted checkout credentials. Only the encrypted envelope and safe receipt are uploaded.

## Validation and scope

10 supplied tests and12 independent adversarial test methods passed with global fetch and node net/tls/http/https disabled. Logs: `backup-existing-tests-network-denied.log`, `backup-adversarial.log`; independent harness/guard: `backup-adversarial.test.mjs`, `backup-network-deny.mjs`. The static identity/workflow checks passed in `backup-static-verification.log`.

The disposable pipeline fixture replaces only the immutable name/catalog proof literals with synthetic proofs; the production module stays unchanged. Crypto tests separately use a synthetic RSA4096 pair held in memory. Probes verify token-free signed download, exact fixed SELECT/export requests, name/UUID/size/catalog/counter drift stopping before export, preflight zero-call failures, constant bookmark polling and changed-bookmark rejection, ten-poll exhaustion, response limits, safe provider errors, origin/userinfo/port/suffix rejection, deadline behavior, RSA/AES roundtrip and rejection of altered AAD/wrapped key/nonce/tag/ciphertext.

One initial reviewer assertion expected the raw lower-level size error; implementation deliberately returns the safe generic `BACKUP_EXPORT_UNAVAILABLE`. The reviewer assertion was corrected; the original log remains `backup-adversarial-initial-harness-expectation.log`. This was a harness expectation error, not a product correction.

The fixed candidate is `ccc473f1-fbb5-4b8d-8a24-45f3696ac10f`. The module verifies UUID/name and a1MB metadata-size bound, executes the exact catalog SELECT, requires zero-write confirmation and exact five-row catalog hash, then performs bounded polling export. There are no create/import/delete/schema/data/deploy/grant/billing paths. The signed HTTPS download is host-suffix allowlisted, gets no token/headers and refuses redirects. SQL remains in memory, then is encrypted with RSA4096-OAEP-SHA256 plus AES256GCM, with authenticated metadata. It is never written as plaintext or logged. The receipt excludes raw SQL, catalog/name labels, signed URLs, bookmarks, provider messages and token.

## Primary contract and limits

Official Wrangler at `66bc0d6f353904f8a203bcea9298d9f45fbd234a`, `packages/wrangler/src/d1/export.ts` blob `b87e6452ce92158205fe96595ef8a3d71063baeb`, and the official REST reference support the export path, polling format, d1 compatibility and signed download. The REST contract says the bookmark stays fixed during an export. Export can block queries while running; continued polling is required or it auto-cancels. This bounded review therefore describes an export operation, without claiming it has no availability effect.

Primary reference: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/ . The Wrangler snapshot is retained as `backup-extra-2.json`.

No provider calls or root-source edits were made by this reviewer. Actual export completion, durable Drive storage and decrypted recovery remain unobserved. Parent reports owner-only private-key Drive custody/ACL and download byte verification; this review did not access that private key or independently certify that custody. Preserve those existing proofs. A logical export is not restore qualification until actual decrypted restore and fidelity checks succeed. Current consumer observations still cannot prove globally unused/private status. All backup-saved/restore/migration/target/release flags remain false.

Root retains live drift and authority checks. PR1 remains separate, $0 and Paynow authority/customer data/q06/rollback origin persist. B27=`FAILED_IN_SYNTHETIC_ATTACK`; parity/superiority=`NOT_CERTIFIED`; unavailable final usage=`UNKNOWN`.
