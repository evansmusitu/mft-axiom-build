Historical PR241 description captured on 14 November 2026.

This snapshot preserves the previous governance/evidence narrative. Its older
Gate1/Step2 status statements predate the owner's later confirmation and express
direction to proceed with hosted recovery. Read HOSTED_RECOVERY_CURRENT_20261114_NOT_RELEASE.md
for the actual current state. This historical text grants no current authority.

## Scope — separate owner-control candidate only (NOT RELEASE)

Implements a **new, isolated, offline policy-proposal verifier** for the owner's explicit 12 November 2026 decision to become AXIOM's sole recovery/security/release authority. This PR targets the exact PR216 Step 1 draft branch, **not main**, and does **not** merge PR216, PR192, PR217 or PR1.

Authoritative owner-directed amendment: https://drive.google.com/file/d/1OSIwJiF2qr-yIe0gD9atYaZUo_1Mdlj0/view (SHA-256 cb7f43e1e6b3c28afb88de5a08696dc7b650565a78394eda98e2498c099fb9d5).

### Added code (3 new files; 0 modified or deleted original files)
- owner-only exact-plan Ed25519 proposal verifier, external owner SPKI pins for signature and X25519 recipient, hard USD0 / account / D1 UUID / nonce / time / risk acceptance checks, always NO_GO for provider mutation
- 13 negative and positive owner-policy tests
- 1 synthetic owner-controlled X25519 backup-envelope interoperability test using the **unchanged** PR216 X25519/HKDF/AES-GCM implementation

### Fresh local verification against immutable PR216 source
- Node: **47/47** passed (33 original + 14 new)
- Python synthetic SQL restore: **7/7** passed
- Source compare: exactly 3 added paths relative to PR216 SHA `59e48ac02c49cb11d3082db4a623c9c82ff740a1`.
- Full patch and SHA-256 manifest preserved privately in the authoritative 12 November Drive handoff folder, SHA-256 `c8d9774d68eed2c866d6f5a40c51f47e96dc1179203a07e96f83dd01e1743e67`.

### Deliberately NOT achieved
- This does not activate owner-only authorization in production or modify PR216's two-signature runtime gate. Historical independent-custodian criteria are **UNMET / POLICY SUPERSEDED NOT PASS**.
- Owner MFA, actual owner-held keys and custody, authentic Cloudflare D1 permissions and no-additional-cost evidence, exact-current encrypted backup, disposable hosted target, independent data-parity verification and tenant isolation remain OPEN.
- B27 synthetic CAS failure run 42848525619 and PR83 full-stack failure run 42292436148 remain VETOES.
- NO D1 creation, SQL export, worker deployment, OAuth migration, customer data access, charge, release or production mutation.
- Preserve five permanent AXIOM objects: Project, Work, Agent, Artifact, Evidence.

**Do not merge until explicit owner integration approval, control migration plan, evidence reconciliation and full technical review. Keep Step 1 OPEN, Step 2 prohibited, and final status NOT_RELEASE.**

### 12 November live metadata GET-only follow-up

Additional **fourth new file**: `.github/workflows/axiom-step1-owner-provider-readonly-20261112.yml`. It is pinned to this isolated review branch, GET-only, with no SQL/export/target creation, and explicit NOT_RELEASE flags. No existing files changed.

GitHub run https://github.com/evansmusitu/mft-axiom-build/actions/runs/43273373842 **SUCCESS**; downloaded sanitized artifact ID 13968069063 and independently verified its SHA-256. Authenticated Cloudflare GET responses: original source D1 UUID matches, 11 existing D1 databases, Workers subscription Paid. **Cost-free disposable restore is NOT qualified, no authorized target, no encrypted-current backup or hosted parity; Step1 remains OPEN.**

New customer candidate CI run https://github.com/evansmusitu/mft-axiom-build/actions/runs/43273383699 **SUCCESS**. Immutable full reviewed delta in the authoritative private Drive folder: `MUSITU_AXIOM_STEP1_OWNER_CONTROL_LIVE_DELTA_20261112_NOT_RELEASE.zip`, SHA-256 `be7a81eaff7ea3b5b1b042c5f160026fa48b595674c2d2cbed54f161aaee1abf`.

**No original code overwritten; branch still DRAFT. No D1 mutation and no release.**

### 12 November — exact GET-only catalog, historical OAuth DR discrepancy (NOT RELEASE)

New source on this **same isolated draft branch** (original files untouched): `customer_frontier/qualification/step1_owner_target_catalog_readonly.py`, its 16-test suite, and two pinned GET-only workflows. The fully paginated audit checks every reported D1 name/UUID, authenticates original source detail, and confirms current Workers Paid membership. **Only the database-quantity component** is within Cloudflare's published 100,000 included Paid DBs (11 observed); SQL and storage billing are unqualified. Proposed name `axiom-idp-step1-disposable-restore-20261112-11563925` is absent from one fully validated page; it is **not approved, signed, created, or safe to use yet**.

- First stricter run [43276322049](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43276322049) **FAILED**, exposing historic OAuth DR UUID missing from current full D1 inventory. Failure preserved, not overridden.
- Corrected run [43276676734](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43276676734) **SUCCESS** (16/16 offline tests; provider catalog receipt verified), but status remains `RESERVED_OAUTH_DR_NOT_LISTED_RECONCILIATION_NO_GO`.
- Exact historical reserved OAuth DR metadata probe [43277041579](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43277041579) **SUCCESS**, provider HTTP **404**, status `DETAIL_NOT_FOUND_RECONCILIATION_NO_GO`. This is visibility/inventory drift; it **does not prove deletion or permission scope**, and does not authorize reuse.
- Whole incremental receipt/source package saved at [private Drive](https://drive.google.com/file/d/1zGt-qtXvVmQggTz9ZuZMa-2Joe49QT0D/view), byte size **53,020**, SHA-256 `e7995fa4b8b0f7045720ef9af3c700e1ba0de580a669ee18d74826e6fd9cb681`. Verified by download/readback and `VERIFY_INCREMENTAL_DELTA.py` with exact `MUSITU_AXIOM_STEP1_OWNER_CATALOG_RECONCILIATION_DELTA_SHA256_PASS_NOT_RELEASE`.

**Result: NO D1 mutation, export, restore, new infrastructure, credentials, branch merges, charges or release. Step 1 OPEN; production identity, Step 2, PR83/B27 vetoes remain locked.**



### Additional bounded OAuth DR history audit — NOT RELEASE

GitHub GET-only Cloudflare audit workflow [43277891293](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43277891293) returned **0 matching events** for historical reserved D1 UUID `c023a0a0-472a-4178-ad07-02f1d6b2e122` over **2026-11-09 through 2026-11-12T18:15:20Z**; 1 complete provider audit page. The absence of matching events in this **limited window and permission scope does not prove original deletion, retention history, or resource ownership**. Existing 404/detail-list discrepancy remains `NO_GO`. The read-only workflow is new, restricted to this draft branch, and exports only sanitized aggregate counts/digest.

Immutable follow-on evidence package: [private Drive](https://drive.google.com/file/d/1IGkRijXRKlPFts66j9JOZftFfe3iEZ1a/view) (59,946 bytes, SHA-256 `bb7f5af7984e9671af0f5c9b172dfd68b2cf1f02fc98ce8a5c5be65664826bbb`). Archive CRC, per-file SHA-256 manifest, extract-and-verify marker, and Drive roundtrip confirmed. Contains the original failed catalog run and all later receipts. **No provider mutations, customer rows, payments, merge or release.**


### 12 November later: source bookmark, account analytics, offline owner custody (NOT RELEASE)

- New read-only Cloudflare source metadata+Time Travel bookmark run [43293408372](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43293408372) **SUCCESS**: original D1 UUID matched and current bookmark hashed at 2026-11-12T19:45:30Z. **Raw bookmark not stored; no backup, no parity or restore.**
- New fixed GraphQL read-only **query** (HTTP POST transport; never a mutation/SQL) [43294082441](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43294082441) **SUCCESS**: November 1–12 observed D1 rows read, rows written, and storage each below 50% of the published included Paid-plan allowance, sampling/storage coverage 11 databases. **NOT** an exact subscription billing-period proof (renewal day unknown), current invoice proof, or enforceable hard $0 cap. `zero_additional_spend_qualified=false`.
- New owner-device-only OpenSSL Ed25519 + X25519 private-key ceremony and 6 synthetic tests, plus offline runbook. The actual owner's keys are **not generated or held in GitHub/ChatGPT**; require owner-run local ceremony, authenticated owner MFA, separately pinned public trust roots and sealed recovery controls before use.
- This turn ran **48 local Python tests** (old catalog 16, bookmark 11, billing 15, key ceremony 6) all PASS. GitHub candidate run [43294949327](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43294949327) **SUCCESS** at head `06bb9a50b4c312306828e3461600f651d2b48b64`.
- Full additive SHA-256-verified 70,482-byte continuation delta saved in the authoritative private Drive folder: https://drive.google.com/file/d/1x8dep5ebKGhVt6_BLSHpYQ3CIhC6C-I2/view, SHA-256 `c081916b2be283a4aebc2b94c046d84845ff9ffb78102e1582457ba830be40f1`, verify `MUSITU_AXIOM_STEP1_OWNER_BOOKMARK_BILLING_KEYS_SHA256_PASS_NOT_RELEASE`. Historical failures and original full handoff remain preserved.

**NO source D1 changes, new databases, SQL customer rows, backup exports, hosted restores, owner keys generated in cloud, production identity activation, draft merges, release or authorized incremental spend. Step 1 OPEN, Step 2 prohibited, NOT_RELEASE.**


### Owner public trust-pin preflight (12 Nov 2026 — NOT RELEASE)

Isolated draft head `facdca6a7ddb33d763ae3a43893d899fbdb8a91b` adds **4 new files, 0 modified files**, preserving PR216's existing two-signature code, all earlier failures, and protected `main`. The new pure Node offline verifier checks genuine Ed25519 and X25519 public SPKI DER type/canonicality and that the prior owner ceremony's unqualified receipt matches externally reviewed public trust SHA-256 pins. It refuses self-certification, key substitution, noncanonical/duplicate JSON, forged gate flags, missing independent trust roots, malformed inputs and private-key material. **Even successful public-pin verification returns `PUBLIC_PINS_MATCH_EXTERNAL_TRUST_PRECHECK_ONLY_NO_GO`.**

- Local 14/14 Node negative/positive tests PASS, fresh verified from extracted packet.
- GitHub no-secrets offline run [43298924748](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43298924748) **SUCCESS** at exact head `facdca6a7ddb33d763ae3a43893d899fbdb8a91b`.
- Signed-off owner MFA, actual owner-controlled key ceremony/possession and disaster recovery, external pin authority, exact signed scoped recovery plan, hard USD0 provider-backed cap, customer-data export consent, current encrypted SQL backup, disposable target, hosted parity, tenant least-privilege remain **NOT QUALIFIED**.
- New additive, NOT_RELEASE packet saved in [authoritative private Drive folder](https://drive.google.com/file/d/1YV3GzvZHVlhFjHsJmUHPmRoi1-obKWMe/view), 15,037 bytes, ZIP SHA-256 `c5123f4134a1dc916291bd34c0eeb22ecc60d9e6790e1059a7fbeec03b19b112`, downloaded and verified with `MUSITU_AXIOM_STEP1_OWNER_PUBLIC_PIN_PREFLIGHT_SHA256_PASS_NOT_RELEASE`. This packet is additive to the preserved whole-product ZIP; does not replace it.
- Cloudflare current docs clarify Workers Paid D1 overage charges for rows/storage and included database quota, while D1 Time Travel restoration does not clone/fork a source. Neither historical usage bands nor Time Travel justifies a live paid-tier new target under hard $0 additional-spend governance.

NO new Cloudflare resources, source D1 mutations, SQL exports, hosted restores, key uploads, secret changes, draft merges, release, or additional spend authorized. Historical independent custody remains **UNMET_POLICY_SUPERSEDED_NOT_PASS**, B27 synthetic CAS FAIL and PR83 full-stack FAIL. **Step 1 OPEN; Step 2 PROHIBITED; NOT_RELEASE.**


### 12 November owner-device exact signed proposal bridge (ADD ONLY; NOT RELEASE)

Added **five new files** on the isolated PR241 branch (no changes to pre-existing source), pinned Git head `eff251e376c1a32bb819778f52240ffc7203bd15`. The offline-only owner-device proposal builder prepares a canonical 15-minute proposal with a random nonce and proposed new disposable target name, zero spend, no SQL export/restore or production effect; a local Bash/OpenSSL signer uses the **owner's encrypted local Ed25519 key** (only when the owner runs it on a secure device), and the verifier checks the exact payload signature plus separately reviewed Ed25519 and X25519 public-SPKI fingerprints. A passing signature remains `OWNER_SIGNATURE_VALID_PROPOSAL_ONLY_NO_GO` and **cannot authorize D1 changes**.

- Fresh combined local regression: **61/61 PASS** (original PR216 admission+encrypted SQL suites, prior public-pin suite and 14 new offline signer tests). Synthetic OpenSSL interop PASS. No real owner private keys created, read, uploaded or used.
- New [owner-device offline workflow 43302752676](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43302752676) **SUCCESS** and [customer candidate gate 43302762582](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43302762582) **SUCCESS** at the exact current head.
- SHA-256 checked additive continuation ZIP https://drive.google.com/file/d/1SzbitAN6LCR3k4ZUWaUrr9ayVpfGwEaD/view (18,032 bytes, `67f04ae3fc5972e02e5babb2fbd734cb7382c065105a1ccd2ff7e89424e22686`); companion https://drive.google.com/file/d/1P2EbyG_Mmnbso8hMBaEPefrO8IRKadRB/view. Download/roundtrip verifier yields `MUSITU_AXIOM_STEP1_OWNER_SIGNED_PROPOSAL_SHA256_PASS_NOT_RELEASE`.

**Not yet earned:** actual owner-held key ceremony and independent/public pin activation, owner identity/MFA, genuinely signed real-owner plan, cost-safe new disposable target, current encrypted D1 SQL backup, hosted parity/tenant-isolation acceptance, production OAuth. The original PR216 two-signer runtime stays unchanged. Historical independence remains `UNMET_POLICY_SUPERSEDED_NOT_PASS`; B27 synthetic CAS FAIL and PR83 full-stack FAIL remain. No D1 writes, database creation, SQL export, deployment, merge, payment or release. `Step1 OPEN`, `Step2 PROHIBITED`, `NOT_RELEASE`.


### Owner-device exact SHA review confirmation follow-up (NOT RELEASE)

- Hardened `customer_frontier/qualification/step1_owner_device_sign_proposal.sh`: prints exact canonical recovery proposal, requires explicit typed **full SHA-256** before invoking OpenSSL, rechecks payload digest before and after signing. Mismatch, non-interactive use, missing public trust pins or modified payload deny before admission.
- Added `customer_frontier/tests/test_step1_owner_device_sign_confirmation.py` with six mocked-only cases: approval/rejection, non-TTY, missing pin, hash drift, blank review.
- **First GitHub offline test run [43314387166](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43314387166) FAILED** due to the test pointing at the wrong repository path. The broad candidate run [43314429785](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43314429785) failed for that same test-path reason. Both failures remain in GitHub evidence.
- Corrected test path without changing any fail-closed expectations. Local tests 6/6 PASS; GitHub offline signer run [43314589022](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43314589022) **SUCCESS**, broad candidate [43314608125](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43314608125) **SUCCESS** at exact commit `59e5d32c588211851cbe5eeb0abc537c5c3d8f6c`.
- SHA-256 verified 4,699-byte incremental patch in authoritative private Drive: https://drive.google.com/file/d/1bnBFhoumCCZ1sw_lIkpy3W0I31kCpM_s/view, SHA-256 `d442db2476cea244c9118b37eb0de468d281730163d5523ac169dcac9ca864eb`; independent roundtrip validation PASS.
- This **does not** prove real owner MFA, private key custody or signed owner operation. PR216's two-signer runtime remains unchanged. No Cloudflare customer-data export, D1 mutation, new database, charge, hosted restore, token upload, branch merge, Step2 advancement or release. B27 and PR83 vetoes remain. **Step1 OPEN; NOT_RELEASE.**


### 13 November extended historical OAuth DR GET-only audit — still NOT RELEASE
- Added isolated read-only GitHub Actions source `.github/workflows/axiom-step1-reserved-d1-full-history-audit-20261113.yml` at head `6522daad64f7c3d453a757c719fc06fb140e174c`. Only GET, no customer data/query/SQL/D1 writes.
- GitHub workflow [43318314600](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43318314600) completed successfully. Its sanitized 2026-09-01 → 2026-11-12 22:16 UTC audit returned **zero matching events** for the reserved historical OAuth DR UUID. Provider receipt has full one-page pagination and `NO_AUDIT_EVENTS_OR_SCOPE_UNQUALIFIED_NO_GO`. Zero events do **not** prove historical D1 deletion, user ownership, visibility or suitability as a recovery target.
- Authenticated Cloudflare direct historical UUID check remains HTTP 404. **Never reuse that UUID or any existing product database** without genuinely qualified hosted authority; no such authority has been given.
- Authoritative private Drive verified follow-up: https://drive.google.com/file/d/1mf7H0TQ67uAMEca3yZsw-i2HJNS6Zn88/view. 7,867 bytes, SHA-256 `993db83f58f38e3f68d3a1c049f93d23eca2d339acc7a59f6df65d402203f47c`, downloaded and verified CRC, manifest, and `MUSITU_AXIOM_STEP1_EXTENDED_D1_AUDIT_20261113_VERIFIED_NOT_RELEASE_PASS`.
- Official Cloudflare D1 docs confirm Time Travel restore is **destructive in place**, not a new-target clone. Correct isolated recovery design requires separately permitted source SQL export, offline owner-key encryption, newly qualified disposable D1, and hosted import with full parity and tenant separation. Billing and owner-custody remain unqualified; nothing has been created/exported/charged.
- Owner-managed security policy still requires the owner's genuine *offline* key ceremony and public trust-pin verification. New proposal signatures still grant no D1 mutation authority. PR216 original two-signature runtime is unchanged, PR83 and B27 failures remain vetoes, PR1 stays separate. **Step1 OPEN · Step2 PROHIBITED · NOT_RELEASE**.


### 13 November owner restored-key offline recovery rehearsal (NOT RELEASE)
- Added **only four files** to this existing isolated draft, with zero previous source changes relative to parent `6522daad64f7c3d453a757c719fc06fb140e174c`: offline owner-device recovery script, 15 synthetic tests, read-only CI, and owner runbook.
- It proves **synthetically** that an encrypted Ed25519 signing PEM and X25519 recipient PEM can be restored from a separate path, match separately pinned public SPKI fingerprints, sign a 64-byte random challenge and perform synthetic X25519 key agreement. Owner genuine keys must be used **only on owner's own secure offline computer**. Recovery proof receipts still explicitly state physical media, independent execution, MFA, production trust pins, customer backup and hosted recovery `false`.
- Security denials cover missing or substituted pins, unencrypted/mode-exposed keys, symlinks, hardlinks to original keys, same-path reuse, invalid output locations, noninteractive/CI usage, wrong owner confirmation, and crypto mismatches. No private PEM body or decrypted private key is read into Python (only the encrypted PEM header is inspected), no Cloudflare calls, SQL, D1 writes, charges, release or Step 2.
- Local Python tests **15/15 PASS**, plus interactive synthetic ephemeral-key proof. GitHub targeted CI [43323769491](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43323769491) **SUCCESS** and broad customer candidate CI [43323775234](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43323775234) **SUCCESS**, both pinned to head `39c4d96eca904bf1a11f663457fb3f7f2215a4e1`.
- Exact source blob SHA-1 Git identities independently matched local bytes (4/4).
- Immutable SHA-256 verified additive ZIP in the authoritative private Drive folder [OWNER_RESTORED_KEY_REHEARSAL_20261113_NOT_RELEASE.zip](https://drive.google.com/file/d/1hQuG8EDfDOBod4Kw_od7zya_XufLZrum/view): **15,339 bytes**, SHA-256 `e9b6f0c8f841c8813c1e0448d54fef5860261ffe7c785523e5195ae8562c3d26`, downloaded and verified with `MUSITU_AXIOM_STEP1_OWNER_RESTORED_KEYS_REHEARSAL_VERIFIED_NOT_RELEASE_PASS`.
- The real owner-device ceremony and actual restored-copy proof remain **UNPERFORMED/UNQUALIFIED**. Historic reserved OAuth DR UUID 404 remains quarantined. Cloudflare exact $0 recovery guarantee, encrypted-current SQL export, approved new disposable target, hosted restore parity, B27 and PR83 technical vetoes remain open. Original PR216 two-signer runtime untouched. No main changes. **Step1 OPEN · Step2 PROHIBITED · NOT_RELEASE**.


### 13 November owner-signed proposal local nonce replay checkpoint (OFFLINE ONLY, NOT RELEASE)
- Added six new files, zero prior source modifications. Commit 95f204f6a6d707dcbe21f55d2471dd730402fa96; parent 39c4d96eca904bf1a11f663457fb3f7f2215a4e1. Exact Git blob IDs match independently hashed local source bytes (6/6).
- Trusted Node verifier checks exact Ed25519 owner proposal, external signer + recipient SPKI pins, original D1, amendment SHA and NOT_RELEASE veto. Python reserves nonce and exact plan hash transactionally in owner-private SQLite with BEGIN IMMEDIATE, synchronous=FULL, unique constraints and restrictive permissions. Replay, plan/source substitution, forged schema, symlink and concurrent attempts fail. No private owner keys, SQL, Cloudflare credential or provider mutation.
- Important negative demonstration: restoring an old local SQLite snapshot allows historical nonce replay. The module always sets global_anti_rollback_qualified=false and never authorizes D1 creation or release. The Python store alone does not authenticate signatures.
- Fresh local tests: 18 Python + 9 Node = 27/27 PASS. GitHub targeted CI [43373439839](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43373439839) SUCCESS; broad candidate CI [43373445221](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43373445221) SUCCESS at exact commit 95f204f6a6d707dcbe21f55d2471dd730402fa96.
- Additive private Drive delta: https://drive.google.com/file/d/1weoLoWc9u5ftR1CN0Zi3z_Jz00IClvyw/view; 21,431 bytes, SHA256 4e1754aed42d4146198a45b30fd644af88f346ce7b4b3ecfc2a9138f8710bdea. Roundtrip ZIP CRC, internal SHA256 manifest and verification marker MUSITU_AXIOM_STEP1_OWNER_LOCAL_NONCE_REPLAY_VERIFIED_NOT_RELEASE_PASS all confirmed.
- ACTUAL personal owner keys/recovery and MFA unverified. Hosted durable nonce + global rollback, current encrypted customer backup, qualified isolated new D1, hard $0 additional spend, hosted parity and tenant isolation remain OPEN. Historical DR UUID 404/quarantined; B27 and PR83 failure vetoes unchanged; PR216 two-human runtime unchanged. No D1 creation/export/migration/charge/merge/release.
**Step 1 OPEN · Step 2 PROHIBITED · NOT_RELEASE.**

### 13 November Windows owner device offline ceremony — candidate only, NOT RELEASE

- Added 6 additive files on the same isolated draft: native PowerShell Windows key ceremony and signed proposal, public-only DER receipt helper, synthetic tests, constrained Windows/Ubuntu CI, and runbook. Existing PR216/PR241 recovery implementation unchanged relative to commit `9ea43de11a86b173a8c1f79356ed9fdee27edd02` (no deletions).
- Windows owner computer needs interactive Windows PowerShell 5.1+/7+, OpenSSL 3.x and Node.js 20+ **installed locally**; **no Ubuntu, WSL, cloud browser or secrets in GitHub**. Ceremony rejects cloud sync folders, mapped/network drive targets, existing directories, Git worktrees, non-Fixed drives, missing prerequisites, CI and noninteractive use. Attempts NTFS owner-only ACLs and creates only **locally encrypted** Ed25519 and X25519 private PEM keys. Owner signature requires independently verified public SPKI trust pins, exact 64-hex payload digest typed by owner, then local OpenSSL passphrase. All receipts remain NO_GO.
- GitHub synthetic + Windows [CI 43382059836](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43382059836) **SUCCESS** at head `cd174936328a50c894596a8ad5b8770713628b0d`: **6/6** public-key verifier tests passed; PowerShell scripts parse on native Windows runner; CI execution/owner-key creation/signing explicitly denied. Broader earlier candidate run [43381564346](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43381564346) **SUCCESS**.
- Complete exact source-only Windows offline ZIP with all 3 existing dependencies plus new scripts is in authoritative private Drive: https://drive.google.com/file/d/11yzMrX8f9f7r861PFFpLH7o5IIrUUP83/view, size **20,606** bytes, SHA256 `eaf50667e5903daa52e271e266bb903bb8c11ca88402247b1bbd3f54d29dc085`. Downloaded independently and rechecked ZIP CRC and all 8 manifest hashes. No private keys, passphrases, customer records, Cloudflare credentials or customer SQL in package.
- **No actual owner key ceremony or independently verified MFA/recovery was performed.** Windows physical restored-media rehearsal is not yet qualified. Exact zero-additional-spend guarantee, new disposable D1 admission, customer backup export and hosted restore parity remain OPEN. Reserved historical OAuth DR UUID stays quarantined (HTTP 404), B27/PR83 failures preserved, Step2 prohibited, NO production mutations, costs or release. **NOT_RELEASE**.


### 13 November Windows restored-key CI refusal fix — isolated GitHub verification, NOT_RELEASE

- The new synthetic Windows restored-owner-keys CI on commit `3485d33ede6b91581575bb520f002114209774b2` originally FAILED: [43382943731](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43382943731). Historical failing run preserved.
- Investigation found PowerShell `Write-Error` under `$ErrorActionPreference='Stop'` bypassed intended `exit 2`, and GitHub's `pwsh` wrapper inherited a legitimate child `LASTEXITCODE=2` as its final job exit. We corrected both **without bypassing owner-device refusal**. The workflow now requires exact exit 2, exact `INTERACTIVE_OWNER_WINDOWS_DEVICE_ONLY` refusal marker and no generated key/recovery output before explicitly completing CI successfully.
- Fresh [Windows synthetic workflow 43383598533](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43383598533) **SUCCESS**, and [broad AXIOM candidate 43383604193](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43383604193) **SUCCESS** at exact draft SHA `40c45e84ab15b2a4d7903ea8db395d1c363738a1`.
- This validates the **security denial in CI**, not real owner custody or restore. We have not created real private keys, attested physical owner MFA, created D1, exported SQL, migrated production OAuth, incurred charges, merged protected branches or released. Remaining Step1 hosted recovery and exact $0 guarantee stay unqualified. B27 and PR83 vetoes preserved. **Step1 OPEN; NOT_RELEASE**.


### 13 November one-run Windows offline orchestrator — draft-only, NOT_RELEASE

- Added `Run_MUSITU_AXIOM_Windows_Owner_Offline.ps1`, a native Windows PowerShell 5.1+/7+ **interactive owner-device only** orchestrator (NO Ubuntu, WSL, Python, provider calls or auto install). It verifies the exact eight-file 13-Nov source manifest against its pinned SHA-256, checks native Node 20+/OpenSSL 3, uses the existing encrypted Ed25519/X25519 key ceremony and exact SHA-reviewed signed proposal, requires separate offline backup media and a disconnect/reconnect proof, makes an ACL-protected local restore, verifies restored ED25519 challenge signing and synthetic X25519 derivation. Public trusted pins must be separately reviewed and entered. Never overwrites private key directories or uploads private key material. Always records real MFA, hosted recovery, spend ceiling and release as **UNQUALIFIED / NOT_RELEASE**.
- Windows CI run [43386799424](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43386799424) **SUCCESS** at commit `66cce2a865c352dc70d57f8bc6aceece07f4be96`: PowerShell syntax and exact CI-only refusal (exit 2, CLOUD_RUNNER_FORBIDDEN), without real keys or device access. Original eight source-node tests 6/6 PASS locally; script full interactive key ceremony is **NOT performed** by GitHub.
- Source standalone PS1 SHA256: `ef520cce008b78f928d1b8adf8aea9d140575e4dd52ccad66b2c9c4ad6cb2e5e`. Exact eleven-file offline package SHA256: `1202fded6f62be3c9871e419f269c67011136c5678ffb2d4e077903f1eaf4004` (29,058 bytes), ZIP CRC and all eight original package hashes independently verified after Drive roundtrip.
- Authoritative private Drive one-run package: https://drive.google.com/file/d/1Udy8sAbETzUF1L_2I_kyJ8mhdHchSja_/view ; standalone script: https://drive.google.com/file/d/1oCjD1BD7AF0avSbzSHjfZA2Tr5B00cbK/view .
- No source database operation, customer SQL export, OAuth migration, spending, draft merge or release. Actual owner MFA/physical media custody and any hosted restore remain OPEN. PR216 two-signer runtime unchanged; PR83/B27 vetoes preserved. **Step1 OPEN · Step2 PROHIBITED · NOT_RELEASE**.


### 13 Nov 2026 Windows NTFS restored-PEM ACL correction — draft, NO_GO, no real keys

- Owner-controlled Windows transcript: the separate USB backup was safely disconnected/reconnected, encrypted PEM SHA-256 hashes matched, then the locally restored encrypted PEM became unreadable after recursive `icacls /inheritance:r /grant:r SID:(OI)(CI)F /T`. **No actual passphrase or private key was received or used in CI.** Root cause is file-level effective ACL not directory permissions; existing owner files and E: backup must remain untouched.
- In isolated draft we hardened the one-run orchestrator's file ACE to explicit current SID `F`, protect inheritance, verify no additional Allow principals, and test local read-open without echoing content. Hardened the Windows ceremony cleanup marker and short-lived proposal JSON file ACE likewise. Exact source provenance and prior ZIP hashes preserved in v2 package. Prior failures retained in workflow history.
- Windows synthetic NTFS ACL + PS parser gate url43425051762https://github.com/evansmusitu/mft-axiom-build/actions/runs/43425051762 **SUCCESS**; broad candidate CI url43425061155https://github.com/evansmusitu/mft-axiom-build/actions/runs/43425061155 **SUCCESS**, both at draft commit `861412bfb7fc978c748dad1e66cf2fb2edc97ffc`. These do **not** prove live owner-device execution, MFA or hosted D1.
- Corrected complete Windows-only v2 ZIP: private Drive https://drive.google.com/file/d/1_ubW1biwGRis4hiRE9NO2eUM49wYTiGY/view, **31,501 bytes**, SHA256 `35931d4a6c74053a4d1f97cbb2e32d726b6b5807f31096a8ca0f85c903b6036c`. Downloaded copy matched size/hash; ZIP CRC and all 8 pinned code hashes passed. Includes `ACL_FIX_PROVENANCE_NOT_RELEASE.json`. No key materials.
- Owner must unzip v2 in a NEW unsynced directory (do NOT mix with v1), run with existing `-KeysRoot "$env:LOCALAPPDATA\\AXIOM_PRIVATE_KEYS_NOV2026_RETRY_20261113_135446"` and `-BackupRoot "E:\\AXIOM_BACKUP_NOV2026"`. New restored-copy dir is used; no old key overwrite. Owner will reconfirm reviewed public pins, physical USB disconnect/reconnect and local passphrases.
- **Step1 still OPEN · Step2 PROHIBITED · NOT_RELEASE**. No D1, production OAuth, spend, merge or release. PR1 separate; PR83 and B27 veto evidence preserved.


### 13 Nov hosted D1 exact owner-candidate GET-only preflight — NOT RELEASE

- After the owner completed the *local* Windows USB restored-Ed25519/X25519 recovery and signed proposal, a **new additive GET-only Cloudflare audit** on this isolated branch checked the exact owner-proposed disposable target name `axiom-idp-step1-disposable-restore-20261113-a39dbdca` and the pinned original source. It did **not** read identity SQL, export customer data, mutate database or spend.
- Provider-authenticated GitHub run https://github.com/evansmusitu/mft-axiom-build/actions/runs/43432363684 **SUCCESS** at draft SHA `5459faada5c826510eb2f86073c1df8a92d1a4b9`; its actual sanitized receipt SHA-256 `7fb8ff2740f2be6a957f2456acb55287bafa26f7be42ca2ff15b70dea7d1d08a` was downloaded and ZIP CRC and digest verified locally.
- At 2026-11-13T13:17:18.372809Z: source D1 detail HTTP 200 UUID matched; full 11-entry provider D1 catalog complete; exact proposed target name **absent** (not created or authorized); Workers Paid subscription active; historical OAuth reserved DR UUID still **not listed** with detail HTTP 404. The catalog name-only absence is not a reservation, financial clearance, or target custody approval.
- Private Drive evidence: https://drive.google.com/file/d/1EPXB33ydZRoksnwiyN_RJSpYzHzzi_w2/view, **1,245 bytes** zipped; archive SHA-256 `7343ce3f090d9f80553004d21bcbc67115fd4c90147719e139c8b298726a9be3`. Companion SHA in same Drive folder. No owner private keys or customer rows in archive.
- **STILL NO_GO**: current invoice/billing-period + provider-enforced **hard $0 additional spend guarantee**, independently attested owner MFA/authority and external trust-pin activation, narrowly scoped valid owner proposal permitting a *different, explicitly authorized* provider operation, encrypted current customer SQL backup with export approval, new isolated D1 provisioning approval, hosted import and readback parity, tenant isolation, tested rollback, independent custody/B27 and PR83. Owner-signed 15-minute proposal explicitly says `customer_data_export_authorized=false`, `customer_data_restore_authorized=false`, `production_changes=false`; signing cannot create D1. Original PR216 two-signer runtime unchanged. No production changes, D1 creation, export, merge, charges or release. **Step1 OPEN · Step2 PROHIBITED · NOT_RELEASE**.


### 13 November Gate1 current billed-usage, spend policies and MFA GET-only verification

**Owner's rule: no Gate2 until Gate1 independently closed.** All following were obtained with existing Cloudflare token via bounded GET-only calls on this isolated DRAFT branch. No account settings, billing, identity, SQL, source database, customer records, secrets, worker bindings, production or spend were changed.

1. Exact GET-only billing probe: [run 43475821539](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43475821539) **SUCCESS**, 20/20 synthetic negative/positive tests PASS, provider HTTP 200 for spend policies, billing-cycle info, rated billable usage and Workers subscriptions, at SHA `724be804911dd2746b71bf6c877af2a74a297986`. **0 configured spend policies** (no enabled Workers or Durable Objects `usage_block`), billing-cycle anchor seen, **60 current rated records all reporting BilledCost 0 at snapshot**, Paid Workers active. This **does not** guarantee future D1 charges are zero. Cloudflare official 2026 Spend Policy API supports only `workers` and `durable_objects`, with a minimum one-cent threshold; it is not an enforceable hard $0 D1 cap. Budget alerts are informational.
2. Exact GET-only MFA posture: [run 43476975569](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43476975569) **SUCCESS**, 16/16 synthetic tests. Cloudflare account metadata ID matched and account-wide mandatory 2FA setting **false**; full account members catalog complete with **one accepted member and that member's 2FA true**. API token `GET /user` **HTTP 403**; owner physical MFA and identity-to-key binding still unqualified. Initial exact-match role metric undercounted; corrected to name-pattern match, with 17/17 tests and live [run 43477967658](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43477967658) **SUCCESS**, one matching super-admin role. Role name match is not independent owner identity or proof of MFA challenge.
3. Latest broad candidate run on Gate1 MFA audit head `6b2812e46cd4d58ae7642cc2c3826474097fbf39`: [43476984622](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43476984622) **SUCCESS**. Current MFA corrected head `28be4c228912e92b5236971043f201fb32b6d2d3`.
4. Verified by local ZIP CRC and per-receipt SHA256: billing receipt `9a27a7c084818ffdbc401cbc94108629be19c41dd7b99cb2aa0cde8a18af0084`, archive `9575539d54885fc7142d8bde8fae052cbbc8cb1fbbace808ce5592300942abe1`, private Drive https://drive.google.com/file/d/1f4oWk-Fcm4zjnTv1qtoO2qVc5bzoeDiB/view. MFA v1 receipt `7a85ce7567e5db9ff8800797ddcdfea126bb2a2fc45f89385682eefec55f57a5`, archive `55c0cc2bf523a2c7fd26f392e96dae6a7af008e1f4f4ff36cf42575360ba455a`, private Drive https://drive.google.com/file/d/1siET0_jAvdon8ON_nH0xamzgpESFk5tH/view. No private keys, account emails or invoices in evidence.
5. Gmail metadata cross-check: historical Cloudflare invoice notification emails dated **24 Sep** and **24 Oct 2026** each showed **$0.00**, consistent with but not proof of future no-overage. No email was sent.

**Remain OPEN in Gate1**: independently authenticated owner MFA challenge, identity-to-signer trust-root activation, approved sole-owner runtime governance (PR216 still two-signature and PR241 only proposal), provider-backed hard USD0 incremental D1 limit or owner-approved alternative truly enforced Free-plan isolation, and new explicit operation-specific approval. Owner's existing 15-minute proposal expired and explicitly denies D1 creation, SQL export, restore and production changes. Do not repeat the completed Windows key ceremony. Do not enable account-wide 2FA or change Cloudflare billing without fresh owner authorization. Do not progress to Gate2. **Gate1 OPEN; Step1 OPEN; Step2 PROHIBITED; NOT_RELEASE.**


### 14 November Gate1 isolated Free account validation — additive only, NOT RELEASE

**No gate transition:** owner-directed request remains Gate1 only, do NOT progress to Step1 hosted D1 recovery or any other gate until independently closed.

- Provider-paid-source D1 `ccc473f1-fbb5-4b8d-8a24-45f3696ac10f` was **356,352 bytes** (Nov13 GET source size audit [43480265054](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43480265054), 19 synthetic tests PASS). This is below published 500 MB Free-plan per-database limit, not proof of import row-write budget, customer consent or target account capacity. No SQL/rows were read.
- Cloudflare official docs 2026-09-17 allow up to five new Free accounts for active user age >=7 days and current Super Administrator; actual owner eligibility not independently authenticated. Cloudflare Free D1 enforces free read/write limits; unlike Paid account there is no billable D1 overage, but account may have other chargeable products and must remain strictly isolated. Sources: https://developers.cloudflare.com/fundamentals/account/create-account/ ; https://developers.cloudflare.com/d1/platform/limits/ ; https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/.
- Added four files to draft at head `b406a87fe3e1a3706852d4d433487f6c037c6f74`: source-only GET candidate verifier, 24 adversarial synthetic tests, pinned isolated GitHub CI and owner runbook. Explicitly rejects the existing Paid account ID, identity mismatches, partial catalogs, any D1 references to source, all active Paid/Trial subscriptions, unbounded source/target inference, credential omissions, unsafe API paths, and keeps `gate1_closed=false, target_creation_authorized=false, customer_export_authorized=false, release_status=NOT_RELEASE` even for fully favorable synthetic metadata.
- Fresh targeted GitHub [run 43577123257](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43577123257) **SUCCESS** on draft at exact head: 24/24 offline synthetic tests PASS; no owner account token/ID in CI and missing-account case exits 2 with explicit NO_GO. Local tests and ZIP CRC/manifests also PASS. Standalone verified 9,308-byte package with SHA-256 `dae43e6a05b9dbbc35b9af77ad63d732f1e9e0ec78f559fda2fb98eb668b9738` uploaded privately https://drive.google.com/file/d/1lz7rrI-ak0xwXCSfw6B2_0mYMgs73fhM/view. **Contains no keys, tokens, customer data or authority**.
- **Live validation not performed:** no distinct owner-verified Free account ID/token provided; creating an account or changing billing/settings was not authorized by the previous 15-min signed proposal. Active Workers Paid account still has 0 spend policies and no D1 hard $0 cap. Actual owner MFA / key-to-identity binding and production runtime two-signer migration remain unqualified. Free account candidate script does NOT verify Free plan from absence of active paid subscriptions, no payment method, or future charges. No Cloudflare mutations, GitHub merges, spending, SQL, exports, or release.

**Gate1 OPEN · Step1 OPEN · Step2 PROHIBITED · NOT_RELEASE.**

