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
nine negatives**, including unsigned package, incorrect SHA, signer,
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

## New real Windows OS installation and update qualification

A separate **disposable CI-only** harness now also verifies real Windows
AppX deployment behavior. It is not integrated with customer-facing
MUSITU Store, and its normal intake API still returns `REVIEW_REQUIRED`
with `permittedInstallation=false`.

On an isolated `windows-2022` hosted runner, the gated test harness:

1. Builds a genuine `MUSITU.Private.WindowsFixture` MSIX using
   Windows SDK MakeAppx and signs it with an ephemeral, test-only identity.
2. Re-verifies signed file SHA-256, signer, package name, version and
   publisher through the review-only `Test-MusituWindowsMsix`.
3. **Only after an explicit CI-only gate** invokes the Windows OS
   `Add-AppxPackage` deployment API for version `1.0.0.0`.
   An independent `Get-AppxPackage` test confirms actual installed
   package name, version, publisher, install path and signing certificate.
4. Independently builds/signs an update MSIX with version `1.0.0.1`.
   The update test refuses any existing installation other than the
   original disposable version `1.0.0.0` by the exact test publisher.
5. Applies the update via `Add-AppxPackage`. Independent Windows
   `Get-AppxPackage` verification confirms `1.0.0.1` is installed.
6. **Always** removes the disposable package using `Remove-AppxPackage`
   and checks that the expected package is absent. It separately deletes
   test certificate material and temporary source/signed packages.

**Verified success:** GitHub Actions run
`39148478007` at
`https://github.com/evansmusitu/mft-axiom-build/actions/runs/39148478007`.
The logs show
`MUSITU_WINDOWS_NATIVE_MSIX_OS_INSTALL_PASS`,
`MUSITU_WINDOWS_DISPOSABLE_UPGRADE_SIGNED=PASS`, and
`MUSITU_WINDOWS_NATIVE_MSIX_REMOVAL_PASS installed=false`
following the real Windows AppX operations.

The first test intentionally failed without an OS-installed package,
run `39147825737`. The signed-update version acceptance test then
failed before a real update, run `39148277384`, demonstrating the
test was sensitive to absent behavior. Native Windows PowerShell 5.1
compatibility issues (zip assembly resolution and `$IsWindows` variable)
were fixed as revealed by the real OS tests, not assumed from cross-
platform PowerShell Core checks.

## Windows SDK verifier custody and signed rollback regression

The offline MSIX review now fails closed if the supplied
`SignToolPath` points to a caller-controlled temporary executable,
**even if that executable is a byte-identical copy of Microsoft's
genuine `signtool.exe`**. The privileged caller's expected verifier
must be a non-reparse-point binary in the installed protected Windows
Kits SDK directory: `Program Files (x86)/Windows Kits/10/bin/<version>/x64/signtool.exe`.
It still independently checks Authenticode certificate identity and
package SHA-256; these checks do not substitute for a protected trusted
catalog or a production release signature authority.

**Red/green regression evidence:** the Windows OS accepted the genuine
SDK executable copied under the temporary runner directory as a supplied
review verifier (negative run `39150271123`); after the custody check
the same negative test was rejected and the complete native signed
package tests passed (`39150483196`). The acceptance suite now checks
**one positive signer and nine invalid cases**, including a misleading
SignTool copy outside the SDK.

After real OS installation and verified update to `1.0.0.1`, an
additional test attempts to invoke the gated disposable v1 installer
against the already-installed newer package. The Store harness rejects
this attempt **before calling** the Windows installer and independent
`Get-AppxPackage` confirms version `1.0.0.1` remains present.
This proves the isolated Store harness's *signed rollback gate*;
it does **not** establish OS-level downgrade behavior for all native
installers or cryptographic anti-rollback under operating-system
reinstallation. The current final focused workflow run:
`https://github.com/evansmusitu/mft-axiom-build/actions/runs/39150607273`
reported `MUSITU_WINDOWS_SIGNED_ROLLBACK_DENIED=PASS`, real
v1→v2 AppX installation, and mandatory package/certificate cleanup.

**Not production readiness:** This is an OS-mediated **automated,
ephemeral Windows CI fixture** installation and update, *not* a real
person consenting through Windows App Installer, not MUSITU Store's
production client and not a genuine independent publisher package.
The test-only self-signed certificate is deliberately removed. Live
distribution still needs a recognized issuer, approved root-signed
catalog, publisher ownership/legal review, true download/update UX,
physical retail-device testing, user consent, rollback/resilience
tests, monitoring, billing and explicit release authorization.
