# AXIOM D1 recovery – independent post-Time Travel reread, 8 November 2026

**Result: PASS for read-only data integrity after synthetic Time Travel; NOT full destructive disaster recovery; NOT production OAuth; NOT RELEASE.**

- Source: customer staging D1 `ccc473f1-fbb5-4b8d-8a24-45f3696ac10f`, account `93f395f5121954671f92fffa453d6b61`.
- Isolated destination: `e36972b3-850d-4273-b934-2fa67587d9f1`, owner alternate account `c954f0c842a486d0388c05b19cd21e47`.
- Original hosted import: PR124, run `42455417454` PASS, source original SQL SHA `1daa973a46c012f9c61b36814bf339fe93ae374e418b7938bb86c36f1dcde627`, encrypted source envelope SHA `d8fdb7d06f27d3053799ba70eb2c4c12d2b5570eb9c5cf4724e7216908d0b3b3`.
- Independent hosted data recovery: PR126, run `42455817994` PASS, 25 user tables and 25 records equal, 13 indexes, 39 triggers and foreign key check zero.
- Real hosted synthetic-only Time Travel: PR128, run `42456316988` PASS. On isolated DB only, create one synthetic table/row, restore pre-probe bookmark exactly once, confirm probe gone and entire 25-record data digest unchanged. No actual customer rows deleted or updated.
- **Fresh independent read-only after rollback**: PR129, run `42456661318`, job `128657030040` **SUCCESS**, 56 provider requests, 2 metadata GET + 54 read-only SELECT with D1 write counters false/0/0. Source/target 25 tables, 25 rows, 13 indexes, 39 triggers, full private data digest equality, foreign key check zero. Private canonical row fingerprint SHA256 `72b27960c718c499f8890d44bccf405c90cef08f56e6149da4583b4b9b85a30a`. Never persisted row values.
- GitHub Actions artifact `13608171389`: ZIP **1,093 bytes**, SHA256 `1efc862cff93c05859e3ca5521b53a199759e27d38189e5610df837f2f5d7ffe`, CRC PASS, inner safe JSON SHA `c01822a10669a709780bbc270891a325ea439b9bf414d64ada77464b75c177ce`.
- Owner-only, unshared Drive private recovery folder `1AN3iDFBSHb0RDoL2-108PFE-Z0a7eo70`; uploaded ZIP at `1iVwlN9yDmff8wXLEOFgbr3MFKB6YTHXw`, https://drive.google.com/file/d/1iVwlN9yDmff8wXLEOFgbr3MFKB6YTHXw/view. Exact downloaded 1,093-byte ZIP SHA, inner SHA and CRC independently verified in active isolated workspace.
- **Deliberate destructive wipe-and-rebuild automation was not admitted or run**; hosted database-loss recovery, real production OAuth owner/account/IdP acceptance, execution cancellation/final usage, Paynow/device settlement, independent custody/anti-rollback B27 and PR83 live adapter security gate remain unqualified/blocked.
- PR1, PR83 and PR129 remain draft/unmerged. No charge, production OAuth schema/data change, merge, deployment or publication. Release authority **false**; budget $0.
