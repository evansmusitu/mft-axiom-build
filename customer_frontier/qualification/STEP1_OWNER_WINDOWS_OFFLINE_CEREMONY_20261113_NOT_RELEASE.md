# MUSITU AXIOM — Step 1 owner-device Windows path (NOT RELEASE)

Continuation-only proposal for **draft PR241**. This Windows path does not replace the 12 November governed whole product, the original PR216 admission gate, historical B27/PR83 vetoes, or owner MFA requirements. It is a Windows-native alternative to the Bash key ceremony and signing wrapper. **No Ubuntu or WSL.**

## Prerequisites

- Personal, trusted **Windows computer**, Windows PowerShell 5.1+ or PowerShell 7+, with a real interactive console; run completely offline, never inside GitHub Actions, remote cloud terminals, ChatGPT or shared machines.
- Locally installed **OpenSSL 3.x** and **Node.js 20+**, with `openssl.exe` and `node.exe` on PATH. The script aborts rather than downloading/installing packages or sending anything over the network.
- Choose a new local, private folder such as `C:\AXIOM_PRIVATE_KEYS_NOV2026` under an existing local-drive parent, **not OneDrive, Dropbox, Google Drive, UNC, mapped network drives, Git repository or cloud-synced storage**. If key ceremony fails after creating the folder, it remains marked `INCOMPLETE_NOT_AUTHORITY.txt` and must be securely handled; it cannot be rerun over itself.

## 1. Generate and safeguard owner keys offline

From the candidate source checkout (`customer_frontier/qualification/` contains the scripts and Node modules), on an isolated Windows device run:

```powershell
powershell.exe -NoProfile -File .\customer_frontier\qualification\step1_owner_windows_key_ceremony.ps1 -KeysRoot 'C:\AXIOM_PRIVATE_KEYS_NOV2026'
```

OpenSSL asks for **two different strong passphrases**. It creates encrypted Ed25519 and X25519 PKCS#8 PEMs, derives only public PEM/DER, and produces `public\OWNER_PUBLIC_PINS_NOT_ATTESTATION.json`. The script attempts an owner-only NTFS ACL with `icacls`; inspect it locally and secure a genuinely separate offline encrypted backup before any use. **Never upload or send `private\`, passwords, passphrases, PEM files, a ZIP of the private folder or raw recovery materials.** A locally generated receipt does **not** independently attest your identity, ownership, MFA, or recovery.

Independently review the **two public SPKI SHA-256 fingerprints**, then keep their approved copy in a separate trusted owner-controlled record (never derive "independent" trust by blindly trusting an unverified receipt).

## 2. Review and sign a short-lived policy proposal locally

After independent public-pin review, set **only public pins** in the secure local PowerShell session (replace placeholders):

```powershell
$env:AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256 = '<reviewed public Ed25519 SPKI SHA256 fingerprint>'
$env:AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256 = '<reviewed public X25519 SPKI SHA256 fingerprint>'
powershell.exe -NoProfile -File .\customer_frontier\qualification\step1_owner_windows_signed_proposal.ps1 -KeysRoot 'C:\AXIOM_PRIVATE_KEYS_NOV2026' -NewProposalRoot 'C:\AXIOM_PRIVATE_PROPOSAL_01'
```

Read the exact policy JSON on screen and enter its **full 64-character SHA-256** to confirm before OpenSSL uses the encrypted signing private key. The signature proposal is valid for **15 minutes** and can **never** authorize Cloudflare D1 creation, customer data export/import, spend, Step 2, or release. Do not upload signed permit as a substitute for real custody acceptance, or assume its timestamps extend beyond 15 minutes.

## 3. Restored-copy rehearsal and release gate

Once a genuinely separate encrypted backup exists, perform recovery proof on the owner-controlled device. The prior Python3-based restored-key rehearsal was designed for Unix permissions, and is **not yet certified on Windows**: do not claim the Windows recovery requirement satisfied by an untested chmod workaround. A native Windows restore ACL/recovery procedure remains required. Only public fingerprints and sanitized, non-secret evidence may be shared for review.

**Status: Step1 OPEN · Step2 PROHIBITED · B27/PR83 VETO PRESERVED · NOT_RELEASE.** No real owner key is in this package, in GitHub or in ChatGPT. No live database/export/restore changes were performed.
