# Actual encrypted backup and local restore completed

Run42284247771/job128120847672 executed independently reviewed export source
9838db06cde1e4add97b5da061905f2a1c5b3d56 at PR92 headf1113ef5. Fixed candidate
ccc473f1-fbb5-4b8d-8a24-45f3696ac10f identity and exact catalog checks passed.
The catalog SELECT confirmed changed_db=false/changes0/rows_written0. Five
requests returned200: metadata, catalog, two export polls and signed download.
The export completed with no schema/data mutation. No production/q06 target was
exported, no hosted migration or deployment occurred.

The encrypted2429-byte envelope SHA256 is
75dcf5fc255b79e19313eeb7794f58ed7a9fe92d8e45d28a3f45d23f1e2005aa.
The Actions ZIP digest and integrity were verified before safe extraction.
The ciphertext was saved to the owner-only private recovery Drive folder,
downloaded afresh and matched byte-for-byte. The private recipient key's
owner-only ACL and downloaded byte match were verified separately. No private
key, plaintext SQL, row values or private DB labels were published.

Independently reviewed intake source1d08639f7a1716a9ce6f7eb76847fb7364931695
was admitted only after all four local hashes matched its exact remote review.
Actual intake used the trusted real Actions envelope hash/source, Drive-readback
ciphertext and Drive-readback private recipient. Two fresh local processes each
decrypted and restored the680-byte SQL into a new0600 SQLite file. Both passed
exact user-catalog, integrity and foreign-key checks and produced identical
user-data fingerprints. The exported/restored user scope contains three tables,
one index and zero user rows. This is not independently observed live-source row
parity, hosted D1/internal-metadata recovery or separate-host destruction proof.

Source CI42284247249/job128120846119 passed210 Node,134 Python and16 local
workerd tests. Export review passed10 supplied+12 independent methods. Offline
intake review passed3 Node+6 Python supplied and5 Node+8 Python independent
methods, including a full synthetic CLI. All actual safe receipts, exact raw
decoded logs and the final reviews are retained. Plaintext private SQLite files
and encrypted backup/key material remain outside the public repository.

## Still required for customer storage

Fresh target reservation/scope and collision preflight; a reviewed private D1
batch runner; actual hosted rollback-before-forward tests; reviewed customer/IdP
schema application; real tenant isolation, revocation, budgets and worker restart
acceptance. Existing-schema OAuth-v2 qualification still requires actual OAuth
schema/data authority and ONE real D1Database.batch, including rejection of dirty
rows and unknown triggers. Do not substitute empty fixture parents for the real
OAuth component. Production application remains gated separately.

No target admission, hosted restore/migration qualification, independent custody,
whole-product integration, merge, deploy or publication is granted by this check.
PR1 remains separate with its safety rejection. Preserve $0, Paynow authority,
customer/q06 data, full breadth and production rollback origin. B27 remains
FAILED_IN_SYNTHETIC_ATTACK; parity/superiority NOT_CERTIFIED; final usage UNKNOWN.
