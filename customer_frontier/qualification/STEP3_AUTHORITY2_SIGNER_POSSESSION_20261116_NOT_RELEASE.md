# Authority 2 signer check — Windows, existing key only

This proves possession of the existing dedicated Authority 2 Ed25519 key by
signing a fresh, fixed-purpose public challenge. It does not repeat owner
backup recovery, generate keys, read customer SQL or contact any service.
Gate 3 remains OPEN; this alone cannot qualify hosted custody or deployment.

1. Extract this ZIP on your Windows PC. Use the same Node.js 20+ installation
   that ran your earlier backup verifier. Ubuntu, WSL and OpenSSL are not needed.
2. Open PowerShell in the extracted folder and run:

   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Run_MUSITU_AXIOM_Authority2_Signer_Check.ps1

3. Select your EXISTING Authority 2 encrypted Ed25519 private PEM on the PC.
   Keep it in its original owner-only local NTFS private folder. Do not copy it
   into this public packet and do not select the X25519 backup-decryption key.
   The separate recovery USB is not needed for this check.
4. Enter its existing passphrase in the local hidden prompt. The existing
   Windows helper's ASCII passphrase input format is used. The key is decrypted
   only inside the local Node process; no plaintext private key is written.
5. On PASS, upload ONLY the named OWNER_A2_SIGNER_POSSESSION_PROOF.json from
   the new results subfolder. It contains a public challenge, public key and
   signature. Never upload a private PEM, recovery USB contents or passphrase.

Expected public SPKI SHA-256:
6792c82b245cd45051052cc1b00eb5f99a99489829c3f0567c7c15f741389d8a

The challenge expires on 17 November 2026 at 06:17:47 UTC (08:17:47 Harare).
After expiry obtain a fresh packet; do not edit the challenge or change clocks.
The signature uses a separate possession-only domain and cannot be a normal
Authority 2 high-water permission. On return it must be checked against the
original issued challenge and trusted public pin. No runtime nonce/rollback
guarantee, administrator separation, MFA or hosted acceptance is claimed.

The wrapper refuses CI/redirected real-key use, shared/private cloud-sync
paths, reparse paths and private files readable by other NTFS principals.
It changes only a new public results directory, not your key or its ACL.
Wrong passwords or keys fail closed. Older results are never overwritten.
The packet includes no credentials and performs no upload or deployment.

The private initializer/retirement source approved by Evans remains pinned at
68799a41a367865649b833de649edcb26f77c0d3. Its disposable public config SHA-256
remains bc09d63349f611a71f0eef6c1ad1d00bd861454aeab7c41f9565056758f2f8e3.
This separate offline helper does not alter either approved runtime artifact.
