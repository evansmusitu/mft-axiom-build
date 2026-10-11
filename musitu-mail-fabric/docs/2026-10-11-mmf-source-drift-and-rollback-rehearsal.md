# MMF shared Paynow — independent source-drift and rollback rehearsal evidence

**Scope:** `product/musitu-mail-fabric-isolated-20261009`. This is a non-production qualification of the two existing shared payment Workers, not authorization to launch or change shared Cloudflare infrastructure.

## Authenticated source baseline and current-read verification

`src/staging/mmf-current-cloudflare-drift-readonly.mjs` uses only GET on the two known script source URLs (twice for consistency) and their settings endpoints (once each). The comparison uses the authenticated, normalized executable source SHA-256 values from the original sealed GET-only backup. Script content, raw multipart bodies, authorization headers and all Worker secret values stay out of GitHub artifacts and console logs. The check fails closed on errors, divergent reads, unexpected account, missing Worker or source hash drift. A matching source hash means **unchanged script payload**, not product route enablement, merchant approval, or safe release.

The isolated GitHub Actions workflow runs this check with `contents: read`, no deployment, and uploads only bounded sanitized metadata. A drift check that succeeds reports both Worker hashes; a check that fails blocks its own CI run. `environment: axiom-support-production` is an existing environment used for authenticated GET-only audit and is not permission to deploy.

## Offline rollback rehearsal

`src/staging/mmf-offline-worker-rollback-rehearsal.mjs` consumes the previously encrypted source/settings snapshot **only after** local decryption with the owner's offline private RSA recovery key. It validates the original raw source wire hash, the normalized source hash, the pinned baseline, both required Worker names, and backup no-write flags. It prepares the source-grounded additive stage-only candidate in memory and simulates returning both Workers to the exact captured source bytes/settings JSON, comparing byte hashes. No live Cloudflare write or payment operation exists in this module. The owner's recovery key is not copied into the repository, handoff or provider logs.

Passing the offline rehearsal **does not** prove an operational Cloudflare rollback: non-exportable secret values cannot be recovered from GET settings, deployed routes/bindings or worker-version history may differ, and replaying a script could disrupt FMI, Chemistry or Axiom. Real shared-worker rollback requires a separate controlled canary/release protocol and independent approver sign-off.

## Release gate (hard BLOCK)

- Independent authorized security/release approver has not cryptographically signed this exact source digest and its restoration procedure.
- Existing merchant arrangement's MMF product rights and legal/settlement readiness are not verified.
- Named MMF-only tokens are not provisioned with documented custody/rotation and isolation from existing service secrets.
- The three intended MMF routes remain stage PROBE only; they do not execute real provider payments, signed callbacks, refunds or customer email.
- A real non-exportable-secret-safe rollback and regression rehearsal has not been performed in controlled Cloudflare canary.
- Payer authorization, provider approval, cash settlement verification and dual release approval remain absent.

**No production PUT/POST/PATCH/DELETE, merchant transaction, DNS change, public send or release is permitted by this audit.**