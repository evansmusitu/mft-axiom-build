# Fixed existing D1 backup before any migration

The owner authorized reuse of an existing database. Actual PR90 catalog/Worker
and PR91 current Pages observations select candidate
ccc473f1-fbb5-4b8d-8a24-45f3696ac10f for private backup assessment. Current
observations found no matching Worker/service/current-Pages reference; they do
not prove global absence or historical Pages coverage. Preserve all existing
three user tables and index. The production OAuth and shared q06 targets stay
separate and are not queried by this operation.

Independent review of export source9838db06cde1e4add97b5da061905f2a1c5b3d56
passed10 supplied and12 independent adversarial tests offline with network
denied. No remaining P0–P2 blocker was found for the bounded encrypted logical
export. Workflow356f930c9bbbcfd87c04f6936e036f98e8b07d485dd71544a71f7ecab16a3899
must match published bytes before opening. Exact identities, proof hashes,
test logs, original harness expectation error and final review are retained.

Recheck fixed UUID/name, size below1MB and the exact five-object catalog hash;
require changed_db=false and numeric zero write counters. Then use the official
D1 polling export with d1 compatibility, at most ten attempts, constant bookmark
and180second deadline. Download only the allowlisted signed HTTPS export with
no credential/headers/redirect. Export may briefly block queries while running;
it is an availability-affecting backup operation, not a data/schema migration.

Encrypt SQL directly in memory with AES256GCM and RSA4096-OAEP-SHA256 to the
fixed owner public recipient. Only ciphertext and a safe receipt can become
Actions artifacts. No SQL, private key, raw catalog, signed URL, bookmark,
provider message or credential is logged or committed. The coordinator verified
the private recipient key's owner-only Drive ACL and downloaded byte equality;
this establishes recipient retrieval, not independent custody qualification.

Actual completion and durable encrypted Drive storage are still required.
Authenticated encryption alone does not prove export origin: offline intake
must match the trusted envelope hash and source from the real Actions receipt,
as well as the recipient, GCM tag and plaintext SQL hash. The separate offline
intake candidate1d08639f7a1716a9ce6f7eb76847fb7364931695 has3 Node and6 Python
tests passing locally; its independent acceptance and actual restore remain
pending. A local user-SQL restore is not hosted D1 recovery or release evidence.

No create/import/delete/schema/data/deploy/grant/billing operation exists in the
export. No target admission, hosted migration, merge or publication is granted.
Preserve $0, customer data, q06, Paynow, full breadth, production rollback origin
and PR1's separate safety rejection. B27=FAILED_IN_SYNTHETIC_ATTACK;
parity/superiority=NOT_CERTIFIED; unavailable final usage=UNKNOWN.

## Actual continuation checkpoint

The pre-run pending statements above are historical preparation. Actual export
42284247771 completed, ciphertext was saved to owner-only Drive and its download
matched. The separate intake review passed; two actual fresh local restores
matched exact user catalogs and data fingerprints. See the retained actual
backup/local-restore report and receipts. Hosted recovery, target admission,
customer/OAuth migration and release qualification remain false. Source CI
42284247249 passed210 Node,134 Python and16 local workerd tests.
