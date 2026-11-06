# Independent review: trusted offline D1 private intake

**PASS for trusted offline private user-SQL intake only. No remaining P0–P2 blocker found.** This source/test verdict does not establish actual backup recovery, live data parity, hosted D1 recovery, source custody or release authority.

Reviewed source `1d08639f7a1716a9ce6f7eb76847fb7364931695`, tree `efcf67eb396b3c711520d3f94f97c65610fd05f8`, parent `9838db06cde1e4add97b5da061905f2a1c5b3d56`. Independent exact-ref GitHub reads matched all four local source/test byte sequences, SHA-256 and Git blob identities. The prior export reader, public recipient, export tests and reviewed workflow remain byte-identical.

| Artifact | SHA-256 |
| --- | --- |
| Decrypt/intake module | `75bf7d0b73274242e0c7bff238073210dc0ac460daf6e466107c580b65cde386` |
| Private SQLite restore | `2f3bcf4f68c11ec8195f206f725a4f2fb06a4935eaba593d7492b2ba72250643` |
| Supplied Node tests | `04f60f00990dc8999ead9b43bd2e093b4c56d51369f6005a30299e9e3cd38021` |
| Supplied Python tests | `16e0d6053b58c4636d7ce5d4ec624d98f85b5544feb792ac71681a6358563bbc` |

3 supplied Node tests,6 supplied Python methods,5 independent Node tests and8 independent Python methods passed. Node global fetch/net/tls/http/https and Python sockets were denied. Logs and harnesses are retained as `intake-node-existing-tests.log`, `intake-python-existing-tests.log`, `intake-node-adversarial.log`, `intake-python-adversarial.log`, `intake-adversarial.test.mjs` and `intake-adversarial.py`. Identity checks passed in `intake-static-verification.log`.

Independent probes require trusted outer hash/source even for otherwise authenticated envelopes; reject unknown schemas/algorithms/fields, malformed Base64, every tampered authenticated field, mismatched header/SQL metadata and wrong provenance. A complete synthetic CLI fixture exercised decrypt→fixed Python stdin→fresh0600 SQLite/receipt, with overwrite and wrong-hash rejection. Only a synthetic recipient pin and synthetic expected-catalog proof were substituted in disposable private copies; production sources stayed unchanged, and the fixture/synthetic key were removed.

SQLite probes verified existing-file and symlink protection, private file mode even with umask0, ATTACH and VACUUM INTO denial after explicit COMMIT, extension/file-function and dangerous-PRAGMA denial, post-restore FK checks after a dump disables foreign keys, rejection of extra views/triggers/tables and schema drift, invalid-input rejection before file creation, and deterministic local fingerprints that change with data and ignore row order. No sibling file was created by the SQL escape probes.

The production CLI requires actual Actions envelope SHA and source SHA supplied from trusted evidence. Encryption to a public recipient does not prove origin. It validates exact envelope/header schemas, canonical Base64, database/catalog/recipient pins, RSA4096 public-key fingerprint, OAEP-SHA256/GCM and SQL bytes/hash before returning plaintext. SQL passes in memory to the fixed Python script through stdin with PATH-only environment and timeout. The fresh SQLite and receipt use0600/no-overwrite protection. No plaintext SQL file, raw row values, SQL, object labels or key contents are emitted.

No provider calls, root-source edits or actual private-key/backup/database access were performed by this reviewer. Actual intake remains unobserved. Local row counts and fingerprints are derived from restored SQL; they do not independently establish equality with live provider data. The proof excludes hosted D1/internal-metadata recovery and does not close separate-host destructive recovery, anti-rollback, custody, migration, target or release gates. A failed restore may leave its fresh private0600 partial database and must remain a failed recovery result. Preserve existing owner-key/Drive ACL evidence separately; this review did not inspect it.

All hosted-restore/target/release/independent-custody flags remain false. Root owns live drift and PR1/$0/Paynow/customer-data/q06/rollback authority checks. B27=`FAILED_IN_SYNTHETIC_ATTACK`; parity/superiority=`NOT_CERTIFIED`; unavailable final usage=`UNKNOWN`.
