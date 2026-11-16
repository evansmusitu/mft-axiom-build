# MUSITU AXIOM — Gate 1 isolated Cloudflare Free account preflight

**Governed continuation only.** No original AXIOM repository paths should be overwritten; original Paid Cloudflare source remains unchanged. This package includes a metadata-only candidate checker, its 24 synthetic tests, and a CI workflow that explicitly refuses running with missing credentials. It does not create an account or database, export customer data, spend money, activate signer authority or close any gate.

**Context:** Prior authentic Paid-account source D1 metadata showed 356,352 bytes (13 Nov 2026). Cloudflare documents 500 MB Free per database, 5 GB Free account storage, 10 databases and 100,000 D1 row writes/day; capacity depends on backup/restore details not yet authorized or known.

**Potentially safe path (requires separate owner approval):** Existing owner can create an *additional* Cloudflare Free account using the official dashboard `https://dash.cloudflare.com/` (Accounts > Create Account). Cloudflare's 17 Sep 2026 policy says an active user age >=7 days and existing-account Super Administrator role qualify, up to five additional Free accounts. Verify eligibility in the owner session. Do NOT add a payment method, select Workers Paid, modify any existing account or provision any D1 database without explicit separate operation-specific authorization. Dashboard is the authoritative place to verify separate account, Free plan and absence of payment method; this checker cannot prove them from absent paid subscriptions alone.

**Read-only owner-run preflight (only after Free account exists, using separately scoped credentials):**

- `AXIOM_GATE1_OWNER_FREE_ACCOUNT_ID` = exact 32-character lowercase hex ID of the new Free account **not the existing Paid account**.
- `AXIOM_GATE1_OWNER_FREE_ACCOUNT_READ_TOKEN` = separately scoped read-only Cloudflare token with access only to new account's metadata, subscriptions and D1 list. Do not share token in chat, scripts, GitHub or uploaded evidence.
- `python3 customer_frontier/qualification/step1_gate1_free_isolated_account_readonly_20261114.py` from an owner-controlled local environment, with environment variables supplied transiently, or use equivalent PowerShell after installing Python. Do not run in GitHub with live credentials.

The preflight checks only GET account identity, `/subscriptions` and fully bounded D1 list; it records only sanitized metadata and SHA-256, and keeps `gate1_closed=false`, `target_creation_authorized=false`, `NOT_RELEASE` even if everything appears safe. It does not attest fresh Cloudflare MFA, external trust pin activation or owner authority. Owner's earlier 15-minute signed proposal expired and explicitly denied customer export, restore, D1 creation and production changes. PR216 retains two-signer runtime while PR241 remains a draft; governance changes must be independently reviewed.

**Exact remaining Gate 1 requirements:** owner controls Free target identity and MFA; second account independently proven Free with zero chargeable enabled services, no payment method or paid plan, isolated access and available capacity; enforce Free limits across the recovery run; provider readback; owner specific non-expired operation authorization and applicable reviewed runtime authority; fully retained evidence and no historical veto erasure. Current Paid account has no D1 hard USD 0 overage spending cap. In all cases this package is **NO_GO** and is not a recovery approval.

## Native Windows path (NO Python, Ubuntu or WSL)

The additional `Run_MUSITU_AXIOM_Gate1_Free_Readonly_Windows.ps1` and local `step1_gate1_free_isolated_account_readonly_20261114.mjs` support Windows PowerShell 5.1 and Node.js >=20. After an owner-created separate Free account exists, extract the complete updated package in a new private non-synced Windows folder; verify SHA-256 against independently retained manifest; then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\Run_MUSITU_AXIOM_Gate1_Free_Readonly_Windows.ps1"
```

It prompts locally for the new account ID and an **independently scoped read-only token**, hiding the token; does three strict authenticated GET requests only; saves a sanitized owner-local receipt under `%LOCALAPPDATA%/AXIOM_GATE1_NEW_FREE_READONLY`, removes temporary environment credentials, and never writes source customer data, performs account/resource creation, charges anything, or grants authority. It refuses GitHub CI and noninteractive execution. **Do not run it for the existing Paid account ID.** Read-only metadata success always means `GATE1_OPEN`, not owner/MFA or spending approval.
