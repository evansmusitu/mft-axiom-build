# Single-file Windows signer launcher — NOT_RELEASE

Outcome: one downloadable .ps1 embeds the exact public signer packet, verifies and safely extracts it into a new owner-only fixed-NTFS directory, invokes the unchanged reviewed Windows helper interactively, verifies its public signature, and opens a return-only folder containing just OWNER_A2_SIGNER_POSSESSION_PROOF.json.

This packaging changes no Authority2 signer, key pin, approved source/configuration, original helper, provider resource or gate. The owner still selects the existing encrypted Ed25519 PEM and enters its passphrase in the reviewed local hidden prompt. No private file is exported, uploaded, moved, ACL-edited or passed to builder CI. No installer, credential download, network request, automatic provider mutation or authority/custody certificate is added.

Public inspection is a separate non-signing mode; it cannot call the owner helper or create a signature. Default execution rejects CI, redirected streams and noninteractive use before creating output. The package verifier checks the pinned ZIP digest, exact file inventory, member hashes, public key fingerprint and pinned approved context. Owner execution also requires a fresh challenge; it never changes clocks or extends expiry. Existing evidence/results are never overwritten.

Unchanged Gate3 requirements remain: verified key correspondence, actual administrator/build credential/recovery separation, unused disposable namespace, a fresh operator-reviewed immutable genesis commitment, private hosted initialization and retirement, and real separate-host destructive/replay acceptance. No script may substitute synthetic results or flags for those observations. B27 FAILED_IN_SYNTHETIC_ATTACK; whole product NOT_RELEASE. PR1 and the production rollback origin remain untouched.

Validation: independent Python packaging tests; actual Windows PowerShell5.1/7 public-mode extraction and packet checks; actual Windows CI owner-mode denial and corrupt-payload denial. Owner-key execution remains unverified until the real public signature is returned. Gate3 cannot close from this launcher or its CI alone.
