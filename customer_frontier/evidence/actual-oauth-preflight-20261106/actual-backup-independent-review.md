# Independent review: actual backup safe evidence

**Bounded safe evidence accepted. No material inconsistency found.** Evidence head `7e3e1e01116849ff27c0c1fc7c31a62a5e30eb0a`, tree `8276266a6deee1a11fed834f30ec369fa26e7713`, parent `f1113ef5a58f5824d73ddc62dd6e6a59be972509`.

Independent live GitHub reads confirm export run42284247771/job128120847672 succeeded after checking out reviewed source `9838db06cde1e4add97b5da061905f2a1c5b3d56`. Its emitted JSON exactly matches the committed export receipt: catalog zero-write confirmation, two export polls, fiveHTTP200 responses and a completed2429-byte encrypted envelope with SHA-256 `75dcf5fc255b79e19313eeb7794f58ed7a9fe92d8e45d28a3f45d23f1e2005aa`.

| Live and retained decoded log | Bytes | SHA-256 |
| --- | ---: | --- |
| Export42284247771 | 22,454 | `55355a094a5ab963786f0f7c62c8a28d4b89af007f82f78e59b629b121b7aeb9` |
| Source CI42284247249 | 145,003 | `9e86ecbc701392c731c49bf1be2c810cc6d43749a5417f522c2602ac48ab9b83` |

Both retained logs match freshly fetched job logs byte-for-byte and match the exact manifest digests. Source CI succeeded with210Node,134Python and16local workerd tests. Live metadata also confirms latest evidence-head CI42285211360 succeeded at `7e3e1e01…`.

Both retained local restore receipts agree with the comparison and with the trusted Actions envelope/source identity:680SQLbytes, four user objects, three tables, zero restored user rows and identical fingerprints. The aggregate fingerprint recomputes correctly from the retained per-table records. Drive backup and recipient readback receipts agree on envelope and recipient identity. Actions' earlier `backup_saved_to_drive=false` and the later Drive receipt's `true` describe separate phases and are consistent.

Both full Git trees were independently fetched without truncation. The evidence delta is18added paths plus one append-only qualification-document checkpoint, with no removals. All seven reviewed source/test/public-recipient files and the export workflow retain their reviewed Git blobs. The other982prior blob paths remain unchanged. All17retained independent-review artifacts match reviewer-local bytes; fetched safe receipts/logs match immutable Git blob identities. The historical qualification text remains an exact prefix of its updated document, and the appended checkpoint retains the gates.

Detailed verification is retained in `actual-backup-evidence-verification.log`, together with exact GitHub source responses.

This reviewer accessed no Cloudflare API, actual key, encrypted backup, private Drive item, plaintext SQL or private database. Export/CI logs were independently retrieved; actual private Drive ACL/readback and freshness/mode of the local processes remain operator attestations supported by consistent receipts and the prior source review. This acceptance does not independently witness those private operations or replace their custody proof.

Zero restored rows does not establish live-source row parity or an empty whole D1 database. Hosted/internal-metadata recovery, separate-host destructive recovery, target admission, customer/OAuth migration, tenant/IdP acceptance, custody, anti-rollback, integration, deploy and publication remain separate. All retained hosted/target/custody/live-parity/release qualification flags remain false. No root files were modified and no approval or waiver is requested.

PR1/$0/Paynow/customer-data/q06/rollback authority remain unchanged. B27=`FAILED_IN_SYNTHETIC_ATTACK`; parity/superiority=`NOT_CERTIFIED`; unavailable final usage=`UNKNOWN`.
