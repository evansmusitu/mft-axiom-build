# Current hosted recovery state — 14 November 2026 — NOT_RELEASE

The owner confirmed Gate 1, directed progression to hosted database recovery,
provided recovery account `67469478aa9349fa0a57fe3a72da200a`, saved its GitHub
secret `AXIOM_D1_RECOVERY_CF_API_TOKEN`, and supplied the public X25519 DER whose
verified SHA-256 is `704a7351da66a21e0b35df4880df194f1cf0e17b161246671288141beae7262c`.
This current direction authorizes the bounded rehearsal. Do not repeat the
completed Windows owner-key recovery. Production governance migration and release
authority still retain their separate acceptance criteria.

## Actual provider results

- Newly created disposable D1 `be760b23-2ed1-47aa-92aa-9042ce917bb9`, exact name
  `axiom-idp-step1-disposable-restore-20261114-704a7351`; creation and actual empty
  schema were authenticated in [run 43590991156](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43590991156).
- Current existing staging/IdP source `ccc473f1-fbb5-4b8d-8a24-45f3696ac10f`, original
  account `93f395f5121954671f92fffa453d6b61`, 356,352 bytes. Full 28,985-byte user SQL
  was exported and sealed to the owner's actual public key. Plaintext SQL,
  private keys, tokens and signed storage URLs were never persisted in artifacts.
- The first two source replays stopped before import. The child-before-parent
  export issue was reproduced; all original failures and encrypted artifacts
  remain preserved in the owner continuation ZIP. The subsequent real bulk import
  completed in [run 43592749417](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43592749417),
  then its FK predicate stopped qualification. That original check did not retain
  raw responses, so its precise cause is UNDETERMINED. It is not relabelled PASS.
- Fresh verification of the completed import, without another ingest, passed in
  [run 43593117438](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43593117438),
  immutable head `e7de3a79b01a730b752ba8c77022013ac3a3ea63`. Schema, all typed table-row
  multisets and sequence state matched, with 77 explicit schema objects, 25
  fingerprinted tables including sequence state, and 25 total fingerprinted rows.
- Live hosted FK enforcement was 1, FK violations 0, rows_written 0 and
  changed_db false. Target probe marker was created and read back, then an in-place
  target-only Time Travel restore removed it. A complete export after rollback
  matched the original schema and every table. FK enforcement/check passed again.
- A separate final source export matched the original complete schema/data
  fingerprint. Source data was unchanged throughout the measured test window.

Provider artifact ZIP SHA-256:
`007805699e2f8baa29ce8202ba68be11bf049b932f165c5d153f81039147a3dd`.
Downloaded sanitized receipt SHA-256:
`82ab871ea31dc55eeabb79803bb03e4a2d8ee98d789bafb8a1d6c9e99480cf07`.
Current encrypted-backup JSON SHA-256:
`7377fca3044b3bf522c37e81cb575f445b8d4857850e9cc214a3e2bd0ee00cdc`.
Original SQL SHA-256:
`1daa973a46c012f9c61b36814bf339fe93ae374e418b7938bb86c36f1dcde627`.

The recovery account has no Workers or Pages consumers and no Workers Paid
subscription. Its pre-existing zero-base-price R2 plan is preserved; this work
does not qualify unrelated product charges or change billing settings. Source
and target tokens are confined to fixed role-specific operation allowlists.

## Acceptance boundaries

| Requirement | Current result |
| --- | --- |
| Current staging SQL export sealed to pinned owner public key | PASS |
| Real isolated hosted import and full schema/data/sequence parity | PASS |
| Live FK enforcement and integrity | PASS |
| Target-only marker, destructive rollback and full parity afterward | PASS |
| Independent final source data comparison | PASS |
| Owner-PC authenticated decryption of this actual ciphertext | PENDING OWNER DEVICE |
| Application-level tenant separation using recovered runtime | OPEN |
| Production OAuth recovery/migration safety acceptance | OPEN |
| Gate 2 overall | OPEN |
| Whole-product release | NOT_RELEASE |

The Windows verification packet uses the existing encrypted owner X25519 key
and native Node.js. It authenticates and decrypts this actual encrypted backup
in memory, checks its exact captured SQL hash, and produces only
`OWNER_BACKUP_DECRYPTION_PROOF.json`. No Ubuntu, WSL, Python, new key ceremony,
provider call or plaintext SQL file is required. Cloud CI can only run synthetic
cryptography, parse the script and verify cloud refusal. It cannot earn the
actual owner-device decryption result.

Main remains `c3c5aaab90e94f1ca84ac9903f9d481c23c4f350`; PR1 remains separate,
draft and unmerged at `8fc1fbb7c5ebbcc1604ecf24c5f4594f2d5667e3`. This review
branch remains draft. No production OAuth change, binding, deployment, paid
upgrade, merge, payment or release occurred. B27 and PR83 vetoes are unchanged.

## Windows owner-device verifier correction — 14 November 2026

The owner reached the passphrase prompt with the first package and received its
generic failure message. Windows PowerShell 5.1 has no ProcessStartInfo
StandardInputEncoding property. The original assignment failure was reproduced
under native Windows 5.1.20348.5773. The first package's cloud-refusal/parser tests
had stopped before executing that process-launch path; they did not qualify it.
The exact original owner exception was not recorded, so it is not asserted to
have been observed on the owner's PC. No private key or passphrase was provided.

Version 2 writes bounded UTF-8 directly through the anonymous process pipe. Its
actual shared launcher was exercised with synthetic encrypted X25519 PEM keys,
synthetic sealed SQL, Unicode passphrases, folders with spaces, wrong passwords
and timeout/cleanup checks in native Windows PowerShell 5.1 and PowerShell 7.6.10.
[Run 43597920610](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43597920610)
passed at immutable source head `0385f41294624aca294a23d4777adb6daf1270bb`, along
with 26 Node cryptography/input tests and the owner-only cloud refusal checks.
The broad candidate run 43597925998 passed. The earlier rejected workflow run
43597605529 remains preserved; it scheduled no jobs and earned no native result.

Version 2 also reports fixed failure codes and a sanitized
`OWNER_BACKUP_DIAGNOSTIC.json` containing the stage and runtime versions. It
records no private-key path, passphrase or SQL. The packet manifest still pins
the original owner key, authenticated backup, receipt and exact helper source.
The owner should extract the corrected complete packet into a new folder and
run the same root PS1 using the existing key and passphrase. No new key ceremony,
Cloudflare request, production change or repeated hosted import is needed.
Owner-device decryption of the actual ciphertext remains PENDING until observed.
