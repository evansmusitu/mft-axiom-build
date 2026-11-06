# Independent staging catalog reader review

Reader verdict after repair: no unresolved P0-P2 source finding in the bounded two-request catalog observation. Final credentialed workflow admission remains pending replacement of the original08b5 checkout/hash pins with the repaired immutable commit and verified hashes. No hosted schema request was performed by this reviewer; the original faulty reader was not admitted by this review.

Reviewed scope: customer_frontier/qualification/cloudflare_customer_schema_readonly.py, its tests, and the new exact-source workflow under hosted-schema-readback/. Reads were limited to local source and immutable GitHub source retrieval. Artifact writes are confined to hosted-gate-review/schema-* files/directories. No account, root source, secret or hosted resource was mutated.

## Material finding, now repaired locally

P2, high confidence, evidence integrity: the original reader accepted provider meta{changes:0,rows_written:0,changed_db:true} as SCHEMA_CATALOG_OBSERVED and mutations0. This contradicted an explicit provider database-change flag. The fixed SQL itself remains catalog-only; no data-write or credential leak was demonstrated.

The original immutable source08b5c423b7819236ccb5adf17d20001bc9f393f7 was independently fetched from GitHub. Reader blob72860f15fab383e31368e1bf2bf50282b0131ba0 and test blob386866551ae6c483850e66abf3300797d92c879a are preserved as provider payloads in schema-fixed-initial-0.json and schema-fixed-initial-1.json. Exact original bytes were extracted from those payloads into schema-original/. schema-negative-initial.log preserves the original accepted outcome. schema-negative-repaired.py independently reproduces the original outcome from the frozen snapshot before checking the repair.

The repair now requires changed_db to be actual boolean False together with actual integer changes0 and rows_written0. It retains a valid boolean observation in query_changed_db. True, missing, null, string false, numeric0/0.0 and collection values remain INCOMPLETE with mutations unknown/null and no partial catalog output. The source has no fallback turning absent evidence into zero.

## Independent verification

- Original15 offline tests passed before the finding; they did not catch the contradictory changed_db field.
- Repaired18 tests passed: PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s customer_frontier/tests -p test_cloudflare_customer_schema_readonly.py -v. Raw log: schema-offline-repaired.log.
- Independent red/green script passed: schema-negative-repaired.py. Original snapshot accepted the contradictory flag; repaired source rejects all7 malformed/conflicting values plus a missing flag, and accepts explicit False plus both integer zeros. Raw log: schema-negative-repaired.log.
- The fixed query is one SELECT of type/name/tbl_name/sql from sqlite_master, with fixed object-type filter and deterministic ORDER BY. Existing SQLite authorizer test independently permits only catalog reads/SELECT/glob and denies customer reads and writes.
- Transport admits only the exact selected DB identity GET followed by one fixed POST query payload. Wrong DB/missing token stop before SQL; redirects and provider error bodies are not disclosed. Timeout20seconds and read cap2MB bound each request.
- Output contains allowlisted object names/types/table references and exact SQL/catalog hashes. Raw DDL, customer rows, provider exceptions and token are absent from output. Malformed row shapes, duplicate object names, unsupported identifiers, invalid definitions and result/envelope shapes fail closed. Parent presence is an observation only; it does not validate required table layouts or upgrade readiness.

Reviewed repaired reader SHA256:26cc14def42d1cd40c26d4099d791dca0904fbd070b9d619a28d8cf56804904a.
Reviewed repaired test SHA256:de7cdc95e1e6f07731387cc91a66ba86e9f7f89b5563676c54d875dd8b1a46ad.
Original workflow SHA256:4f0eb9a865d65d298306846ed50e7e67e7d29ad179009a26359ce64af5d9b100. Its frozen copy is schema-original-workflow.yml. It still names the superseded08b5 source and must not be used to run that reader after this finding.

## Workflow confinement reviewed

The workflow design uses opened-only PR events, same repository, exact isolated head branch, exact PR84 base branch/head1ff935b45f8387f99bad8f432520692f88fd9dc7 and first run attempt. It checks out an immutable source commit, verifies the source checkout plus reader/test SHA256s, runs offline tests before token injection, and gives CLOUDFLARE_API_TOKEN to one fixed reader command only. Actions are commit-pinned; checkout credentials do not persist; job permissions are contents:read. The replacement source and hashes must be independently compared with repaired bytes before the credentialed PR is triggered.

The actual earlier metadata success and source CI are parent-reported facts in this task and are not reclassified as schema acceptance by this review. SCHEMA_CATALOG_OBSERVED remains schema metadata, with backup_restore_qualified, hosted_migration_qualified and release_authority false. Raw DDL/data backup, dirty-row upgrade, rollback, canonical ownership, customer IdP login, custody and anti-rollback are outside this observation. The prior q06 scope remains separate; B27/parity/final-usage truth values remain unchanged.

Final admission update: independently fetched repaired immutable source29bfb5a81996226ae10b4d8dadbf106d2aab27df (treeb854d0afa98006eda14a9de3a8ab872ba1c91f9e, parent08b5). Both remote files exactly match reviewed repaired bytes/hashes. Final workflowSHA256e335fcc41ce36a6a23e6a3198a48ef864af4157aafaf728a9934697104d108ac differs only by replacing the old checkout/source/test pins with these repaired pins. YAML guards, action pins, fixed checkout, offline-test order and sole credential step passed independent assertions. No unresolved P0-P2 blocker remains for this exact two-request read-only observation. Recommendation: proceed with the final reviewed workflow; preserve failed/incomplete outcomes and all prior evidence. This supersedes the pending-workflow condition above, without qualifying backup or migration. Exact final receipt: schema-independent-review-final.json.
