# AXIOM Step 1 — Windows-native recovery test for EXISTING owner keys

**CONTINUATION ONLY · DRAFT PR241 · NOT_RELEASE**. This adds only the previously missing Windows restored-backup test. It **reuses** the Windows owner-key ceremony `step1_owner_windows_key_ceremony.ps1`, Windows signing `step1_owner_windows_signed_proposal.ps1`, and their original Ed25519/X25519 encrypted PKCS#8 PEM format. It does **not** introduce a competing ceremony, alter prior source, or change production permissions. No Ubuntu, WSL, Python or system OpenSSL is needed for the restoration test itself; **Node.js 20+**, Windows PowerShell 5.1+, and a local fixed NTFS disk are required.

This is an owner-device **local test only**. The supplied source does not read customer SQL, contact Cloudflare, invoke GitHub secrets, create D1 databases, admit OAuth migrations, spend funds, or change releases. GitHub Actions runs **synthetic ephemeral keys only**, never real owner keys. The physical-key owner must run the real ceremony personally.

## Preconditions

1. Run the **existing** Windows owner-device offline ceremony on a secure, non-cloud-synced personal Windows PC. It generates encrypted PEMs in `private/` and public DER files in `public/`. Do not upload private PEMs or passphrases to any app, Drive, GitHub or ChatGPT.
2. Make a genuinely separate offline protected backup of the two encrypted PEMs. Restore a **copy** of those ciphertext PEM files to a new local NTFS directory, e.g. `C:\AXIOM_RESTORED_PRIVATE\private\...`. The original key folder remains separate. Restrict the restored directory, its `private/` child and the restored PEM files to the **logged-in owner only** using NTFS ACLs; this launcher refuses shared or inherited group-readable folders. Do not move or operate on the only original.
3. Independently review the two public DER SHA-256 fingerprints. The existing ceremony's own receipt does **not** constitute independent approval, and no runtime trust root or MFA is automatically qualified. Set the existing approved **public** pins in your *local* PowerShell session:

```powershell
$env:AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256 = '<separately reviewed public Ed25519 SPKI SHA-256>'
$env:AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256 = '<separately reviewed public X25519 SPKI SHA-256>'
```

## Run the local Windows restored-key rehearsal

From the exact PR241 source checkout, on your own secure Windows device:

```powershell
powershell.exe -NoProfile -File .\customer_frontier\qualification\step1_owner_windows_restored_keys.ps1 `
  -KeysRoot 'C:\AXIOM_PRIVATE_KEYS_NOV2026' `
  -RestoredRoot 'C:\AXIOM_RESTORED_PRIVATE' `
  -NewProofRoot 'C:\AXIOM_RESTORED_PROOF_NEW'
```

Choose a **never-used output directory**. The PowerShell wrapper verifies owner-only NTFS access and refuses CI, redirected terminals, network drives, cloud-sync paths, symlinks/junctions and unsafe reused directories. Node masks password entry, verifies the restored encrypted Ed25519 and X25519 keys against the original public SPKI DER and separately reviewed public pins, tests an Ed25519 random challenge signature and synthetic X25519 key agreement, and writes one minimal `NO_GO` receipt to the new local proof folder.

Do not upload your private folder, restored ciphertext, passphrases, decrypted key material, raw challenge, shared secret, or an owner-ledger SQLite database. Public fingerprints and sanitized, explicitly non-authoritative receipts are safe to review only through your approved workflow.

## What remains unqualified

Even a successful personal rehearsal is **not** proof of separate physical-media durability, real account-ownership and MFA, recovery after actual device destruction, hosted rollback protection or globally durable nonces. Cloudflare exact zero-additional-spend admission, a current scoped encrypted SQL export, newly qualified disposable D1, hosted restore parity and tenant isolation remain **OPEN**. Historical OAuth DR UUID still returns 404 and remains quarantined. PR216's two-signer runtime is unchanged, while the owner's new sole-authority policy remains a draft-controlled transition. PR83 and B27 failures remain vetoes; PR1 stays separate.

**Step 1 OPEN · Step 2 PROHIBITED · NOT_RELEASE.**
