# MUSITU Store V2 — isolated Windows MSIX intake (2026-10-18)

**State: Phase 1 RUNNING; Windows delivery NOT production-qualified.**

`verify-msix.ps1` exposes `Test-MusituWindowsMsix` for offline,
operator-controlled review of a **native signed .msix**. A trusted operator
must supply the exact SHA-256, publisher certificate thumbprint, manifest
package name, Publisher DN, version and **trusted local Windows SDK
SignTool executable path** from an independently verified root-signed
catalog. Do not use developer-supplied expectations as trusted authority.

The candidate validates:

- Rooted local `.msix` regular file (no symlinks/reparse points, bounded size).
- Exact SHA-256 before and after inspection; mismatch fails closed.
- Bounded, DTD-disabled `AppxManifest.xml` archive read and exact signed
  name/publisher/version identity.
- Native Windows Authenticode trust status and expected signer certificate.
- A separate successful Windows SDK `signtool verify /pa /all` check.
- Result **REVIEW_REQUIRED** with publication and installation authority
  explicitly false. The function never changes certificate stores, starts
  an installer, publishes a package, charges a customer or grants entitlement.

The isolated GitHub Actions workflow
`.github/workflows/musitu-store-v2-windows-msix-ci.yml` runs on
`windows-2022`, constructs a real disposable MSIX via Windows
`makeappx`, signs it with a **temporary local CI-only cert**,
temporarily places that cert in the ephemeral runner's
`LocalMachine/TrustedPeople` store, and verifies it through
both Windows native Signature Tool and the intake function. Its
PowerShell security contract tests **one real positive signed MSIX and
eight negatives**, including unsigned package, incorrect SHA, signer,
manifest name, publisher, version and missing file. It also runs
a quick independent unsigned-file denial contract on Linux PowerShell.

The workflow removes the ephemeral certificate and temporary files
on exit; no production root key, applicant signature, actual publisher,
commerce resource or user device is involved. Never export/sign with
these CI-only credentials or treat the disposable package as a release.

## Execution requirements and remaining blockers

Requires real Windows with Windows SDK MakeAppx and SignTool. The
function currently proves signature and identity **intake**, not an OS
App Installer approval, actual MSIX installation, repair/update,
rollback, app startup, publisher legal ownership, universal architecture
support, package-signing service, device trust enrollment or Windows
Store partner certification. Self-signed CI signer trust is unsuitable
for public distribution; a real independently approved code-signing
certificate and deployment method are required.

Do not proceed to Windows customer rollout without Windows test devices,
trusted publisher onboarding, checked update paths, operating system
consent, certificate revocation handling, release governance and
commercial/compliance approval. Preserve V1 signed Store and
GitHub protected main/frozen OpenAI submission. Phase 2 remains PENDING.
