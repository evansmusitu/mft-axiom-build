# 8 November 2026 — actual hosted isolated D1 recovery-chain evidence, NOT RELEASE

This document preserves only the verified operator cross-source checksum comparison, not independent custody certification.

## Grounded run chain
- Original AXIOM customer staging D1: `ccc473f1-fbb5-4b8d-8a24-45f3696ac10f` in Cloudflare account `93f395f5121954671f92fffa453d6b61`. No original/source writes during either audit.
- Isolated owner disposable recovery target: `e36972b3-850d-4273-b934-2fa67587d9f1` in *different* Cloudflare account `c954f0c842a486d0388c05b19cd21e47`.
- Prior actual hosted original SQL snapshot import: PR124, run `42455417454`; independently checked readback: PR126, run `42455817994`.
- Synthetic target-only point-in-time destructive Time Travel rollback: PR128, run `42456316988`, **SUCCESS**. A single synthetic probe table and record were removed by provider rollback; unchanged original user data was compared before and after. NOT a full database delete-and-recreate.
- Separate independent subsequent source/restored-target read-only parity: PR129, run `42456661318`, job `128657030040`, **SUCCESS**. 25 user tables, 25 rows, 13 indexes and 39 triggers match; 54 D1 query operations are provider-attested zero-write, 56 total requests, FK checks zero. Raw user row values never persisted to evidence.

## Re-downloaded GitHub Actions vs private Drive ZIP comparison
* PR128 Actions artifact `13608130504`, owner-only Drive file `1P9btWeYqttm2AUFbDWP0sEgp7KoMlvZw`: both 1,056 bytes, byte-identical, SHA-256 `8cb2e86edc35b080c87ed8330d41e8dc2d4b58bf5154ab3fae9c7aa9c827eb16`, CRC PASS.
* PR129 Actions artifact `13608171389`, owner-only Drive file `1IQyyVbq7GNOo9_vPxVrVKcKTLCVBd7tQ`: both 1,093 bytes, **outer ZIP SHA differs**, GitHub `1efc862cff93c05859e3ca5521b53a199759e27d38189e5610df837f2f5d7ffe`; Drive `376b1a22aadd24e892bd309603b617ff485fc612b2e0c1ce9738f6ec3673bd36`. The difference is ZIP entry date/time metadata (GitHub `06:55:28`, Drive `06:42:32`); BOTH contained entries have **identical content bytes** and matching CRC, including the JSON receipt SHA-256 `c01822a10669a709780bbc270891a325ea439b9bf414d64ada77464b75c177ce`. Thus exact inner evidence-content integrity PASSES; do NOT assert byte-identical outer archives for PR129.
* Both pairs' JSON and SHA companion contents were checked, no row values were present. Private Drive folder `1AN3iDFBSHb0RDoL2-108PFE-Z0a7eo70` returned `shared=false`, visibility `not_shared` for these evidence files.
* Independently constructed local cross-source manifest and nested receipt ZIP, 3,709 bytes, SHA-256 `0b14b19c36370b25fde376dba496df6694372c7b47d0d1bd781fdb9f86c259cc`. Uploaded to owner-only Drive file `1RTQDKEAbBAPWSOq64TAdn9KcZzyzXNvB`; downloaded and verified the **exact outer SHA-256**, inner CRC and contents. [Private evidence package](https://drive.google.com/file/d/1RTQDKEAbBAPWSOq64TAdn9KcZzyzXNvB/view).

## Non-waivable remaining gates
- This is NOT a full isolated database-loss deletion/recreation, independent destructive DR certification, complete production OAuth schema upgrade/rollback, independently attested custody, B27 recovery or security clearance, real customer ownership/login continuity, provider cancellation/final usage, Paynow settlement/refunds, devices, or external frontier benchmarks.
- PR1 and PR83 remain independent DRAFT/unmerged. PR83's deliberate full-stack security veto is intact. B27 `FAILED_IN_SYNTHETIC_ATTACK`. No public launch, mergers, production migrations, Paynow operations or new spending. `release_authority=false`.

All assertions are bounded to actual observed runner receipts and local connector-mediated downloads; differing ZIP timestamps are preserved, not silently normalized into false byte-level identity.
