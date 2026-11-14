# MUSITU AXIOM hosted recovery — 14 November 2026 — NOT_RELEASE

Gate 2's hosted recovery and native OAuth migration rehearsal have passed. The
remaining owner action is authenticated decryption of the separate production
OAuth ciphertext on the owner's Windows PC. Gate 2 remains OPEN until that exact
result is received and matched. The earlier Windows staging/IdP proof is already
accepted and must not be repeated.

## Acceptance register

| Requirement | Current result |
| --- | --- |
| Existing owner Windows key recovery | COMPLETE — do not repeat |
| Staging/IdP current encrypted backup, hosted restore and rollback | PASS |
| Owner decryption of the staging/IdP backup | PASS — attributed owner-terminal result |
| Canonical application tenant boundaries on recovered IdP D1 | PASS — 15 hosted checks |
| Native D1 atomic DDL/data rollback, contention and fresh-preview readback | PASS |
| Separate production OAuth target creation and empty-schema admission | PASS |
| Current production export sealed to the same pinned owner X25519 public key | PASS |
| Production-copy full schema/data/sequence restoration, restart and rollback | PASS |
| Reviewed 89-statement native OAuth batch on the recovered production copy | PASS |
| Deliberate late failure, idempotency, concurrent batches and fresh-session readback | PASS |
| Production-copy tenant pairing and both-token-family revocation | PASS — 15 checks |
| Owner decryption of this production OAuth ciphertext | PENDING — final Gate 2 owner step |
| Gate 2 overall | OPEN — WAIT_OWNER_PRODUCTION_BACKUP_DECRYPTION |
| Whole-product release | NOT_RELEASE |

## Distinct databases and snapshots

| Purpose | Database UUID |
| --- | --- |
| Existing staging/IdP source | `ccc473f1-fbb5-4b8d-8a24-45f3696ac10f` |
| Recovered staging/IdP copy | `be760b23-2ed1-47aa-92aa-9042ce917bb9` |
| Existing production OAuth source | `504029cc-f9a5-495e-818f-63c6144b4ea4` |
| New recovered production OAuth copy | `5c092b73-d093-483d-adf9-9883a8c2f063` |

Both sources remain in account `93f395f5121954671f92fffa453d6b61`.
Both isolated copies are in recovery account `67469478aa9349fa0a57fe3a72da200a`.
The production recovery target is named
`axiom-oauth-step2-disposable-restore-20261114-704a7351`. The retired missing
source UUID has not been reused. Source credentials have no mutation route in
these drivers; all migration and destructive tests operate only on the copies.

The accepted staging owner proof, observed at `2026-11-14T13:44:31.235Z`, matches
its actual 28,985-byte SQL and ciphertext hash. Its attributed terminal result
is retained in `owner_submitted_decryption_proof_20261114.json`. It does not
stand in for decryption of the different production OAuth backup.

Current production backup pins:

- Owner X25519 SPKI SHA-256: `704a7351da66a21e0b35df4880df194f1cf0e17b161246671288141beae7262c`.
- Ciphertext JSON SHA-256: `71011edc3c4c8919e72ddcab180dfc3caeccc2a322a9a316f30bb94d570d9af5`.
- SQL SHA-256: `081a0b922b337059ad1efe935924b7da01bcb1dd2a43cb666910b6dff14d5ee4`.
- SQL size: 2,666,698 bytes; 32 explicit schema objects; 5,055 fingerprinted rows.
- Complete data/sequence fingerprint: `7f4444dcc33740ff1c81ae1d9389ef07294b9ad85acc5b2b1712490af1739469`.
- Complete schema fingerprint: `df1ae1ca73513313bb351c50e859f5767a72306eff076ba0283e89b3c019c364`.

## Actual hosted witnesses

1. Staging restore/rollback passed in [43593117438](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43593117438).
   Recovered canonical application tenant checks passed in [43602865149](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43602865149).
2. Native D1 behavior passed in [43625803744](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43625803744),
   head `c4f4462509b64dcd489a22aad8b7fdac6508576f`: sequential DDL, late failure
   restoring UPDATE/CREATE/DROP, competing writers, fresh-preview persistence,
   target Time Travel and complete all-table cleanup parity.
3. The distinct OAuth target was created and confirmed empty in
   [43626383264](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43626383264).
4. Production recovery passed in [43627859736](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43627859736),
   head `c66ad1447a78f3c3cda12b86c38e8cf66eb3e09a`. Every schema object and typed
   row multiset, including sequence state, matched before and after restarting
   the copy at its own snapshot. Foreign-key enforcement was 1, violations 0.
   A target marker was then removed by destructive rollback, full parity passed
   again, and a final source export matched. There was no repeated ingestion.
5. The unchanged reviewed plan passed local preflight against the actual recovered
   production snapshot in [43629137820](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43629137820).
   Its 21 original regressions also passed. Plan SHA-256 remains
   `6946e796539e6787033e20f1d0afdcb5259a130ca77be6e3c5afb60b5dc9888a`.
6. Native real-data rehearsal passed in [43630591859](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43630591859),
   head `aad7aa8c311bdf330c9e21257ae5ac8f9cb4e6dc`. The exact 89 statements were
   applied in one native `D1Database.batch` on the copy. A deliberate failure
   after the complete plan rolled back all original schema/data. Successful
   upgrade preserved every original customer table; expected version metadata
   was checked separately. Idempotent reapply and two concurrent batches left
   the complete upgraded state unchanged. A new preview session read it back.
   Fifteen tenant/revocation checks used two existing copied customer records
   with synthetic fixture principals, including cross-customer denial and
   revocation of a copied key plus both token families. Full rollback restored
   the original 32-object/5,055-row baseline, FK enforcement remained 1 with
   zero violations, and a separate source export matched the original data.

Those fixture principals do not prove real customer login, IdP assurance or
ChatGPT/website continuity; Gate 4 retains those requirements. No copied customer
identifier, credential, plaintext SQL, private key or signed preview/storage URL
was retained in evidence. The tests do not migrate the production database.

## Preserved failures and bounded recovery

The original generic preview HTTP 403 lacked a retained numeric provider cause
and remains unresolved as to its original cause. After the owner's token update,
[43624602504](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43624602504)
identified code 10063, missing workers.dev registration. Only the empty recovery
account received the fixed recovery subdomain. Subsequent optional exchange and
transport stops remain recorded. A later actual native run passed independently;
no earlier failed run was relabelled PASS.

Production import [43627158324](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43627158324)
completed but reported FK enforcement 0 and therefore stopped. That exact receipt
and its original encrypted artifact remain retained. The completed import was
fully compared, then restored to its own matched snapshot before fresh FK=1 and
zero-violation observations. The original failure is not erased by that later
qualified recovery.

Recovery admission verifies the Workers Free plan and empty Worker/Pages
consumer catalogs. Existing R2 subscription metadata is preserved. The fixed
account workers.dev registration is retained for recovery previews; no permanent
Worker deployment or application route was performed. Lost mutation replies are
not blindly retried. Original provider ZIPs are retained in an owner-private
Drive folder; see `provider_archive_index_20261114.json`. The qualified production
archive was downloaded from Drive and matched its original size and SHA-256.

## Final owner-device step

Extract `MUSITU_AXIOM_PRODUCTION_OAUTH_BACKUP_VERIFY_WINDOWS_20261114.zip` into a new
folder and run the root script with the existing encrypted key and passphrase:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Run_MUSITU_AXIOM_Verify_Production_OAuth_Backup.ps1
```

Return only `OWNER_PROD_OAUTH_BACKUP_DECRYPTION_PROOF.json`. The verifier authenticates
this production ciphertext, decrypts only in memory, checks the exact SQL hash
and length, writes no plaintext SQL and performs zero provider operations.

[43631467558](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43631467558)
passed 27 synthetic crypto/input checks plus the actual shared process transport
under native Windows PowerShell 5.1.20348.5773 and PowerShell 7.6.10, using a
synthetic SQL payload at least as large as this production snapshot. Unicode
passphrases, paths with spaces, wrong-password refusal, timeout cleanup and cloud
refusal passed. CI did not operate the owner's key or earn actual owner
production-backup decryption. The packet's four runtime file hashes are pinned
by manifest SHA-256 `ccd607ba89f8980290af4c97cd24c41bdd22c2541195bcae564e667759332025`.
No Ubuntu, WSL, Python installation or new key ceremony is required on the PC.

## Governance and continuation

Main remains `c3c5aaab90e94f1ca84ac9903f9d481c23c4f350`. PR1 remains separate,
draft and unmerged at `8fc1fbb7c5ebbcc1604ecf24c5f4594f2d5667e3`. PR241 remains
draft on its existing Step1 base. No production sole-owner governance activation,
OAuth cutover, paid upgrade, merge, payment or release occurred. B27 and PR83
vetoes are unchanged. Preserve the prior narrative in
`HOSTED_RECOVERY_PRIOR_WINDOWS_AND_STAGING_CHECKPOINT_20261114.md`, every failed
receipt and the accepted staging owner proof. Advance to Gate 3 only after this
production owner result genuinely matches and Gate 2 is recorded complete.
