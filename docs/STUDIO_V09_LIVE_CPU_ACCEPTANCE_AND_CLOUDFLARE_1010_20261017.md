# MUSITU Studio v0.9 — live CPU / Cloudflare security acceptance (2026-10-17)

## Work verified on existing GitHub + Cloudflare + Modal

- **REAL MODAL CPU RENDER PASS**: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39060405530 — native Blender `.blend` (722,538 B), animated `.glb` (171,096 B), PNG (47,876 B); hashes recorded in `studio-modal-cpu-pull-evidence.json`. This test does **not** depend on a Cloudflare inbound callback.
- **REAL CLOUDFLARE R2 STORAGE PASS**: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39060544185 — those same three genuine Modal CPU outputs stored under an isolated prefix in existing dedicated bucket `musitu-studio-v02-assets`, read back with exact SHA-256 checks.
- **REAL CROSS-PROVIDER WORKER↔MODAL↔R2 PASS (bounded QA)**: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39060820517 — genuine Wrangler local Worker with **remote live R2 binding**, isolated QA state key, approved and dispatched a real CPU job to the **live Modal HTTP endpoint**, polled and downloaded three genuine Blender files with exact hash matches. The Worker runtime here was local: **this is not a publicly hosted browser-to-Worker acceptance**. 30 QA tests pass.
- **PRODUCTION STUDIO WORKER UPDATE PASS**: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39061325303 — deployed isolated `musitu-studio-v02` Worker with Access-bound short-lived staff sessions and CPU dispatch on, GPU dispatch off; 48 JS tests.
- **LIVE PRODUCTION CONFIG READBACK PASS**: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39061504060 — verified dedicated worker, isolated Access staff app, dedicated bucket, authenticated Modal endpoint, local-test bypass off, no D1 binding.
- **Android UI / staff session QA PASS**: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39061172032 — 48 JS tests plus Wrangler deploy dry-run. Still requires real Android browser login acceptance.

## Confirmed external blockers, not hidden behind production labels

- **CLOUDFLARE ERROR 1010**: public automated browser and callback requests receive Cloudflare's HTML block **before Worker code**. Do not claim external Android browser acceptance. Read-only live diagnostics: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39065129067.
- Cloudflare zone `mftintelligence.com` has `security_level=under_attack`, `browser_check=on`; **10 configuration rules** present, **zero Studio-scoped BIC exclusions**. Existing scoped API token received **HTTP 403** on an attempt to append a dedicated config rule. The plan is not independently classified; **Cloudflare Free allows 10 configuration rules**. Do **not** edit or delete Axiom's existing rules, and do not disable Under Attack globally. Alternative Page Rules listing via existing API token returned HTTP 400.
- Preferred correction, only after Cloudflare account admin has **Config Rules: Edit** scope and free rule capacity: a highly scoped setting rule for `studio.mftintelligence.com`, with `security_level=essentially_off` and `bic=false`, while **preserving the existing Cloudflare Access staff-only application**. For callbacks use a separate exact-host + POST-path rule only if needed; CPU control already works with Modal polling, avoiding inbound callback. Test public login and 401/403 boundaries after modification.
- **MODAL NVIDIA T4 GPU**: Modal rejected function registration with **payment method required**. No GPU rendering or CUDA verification has happened; do not treat CPU proof as GPU readiness.
- **D1**: dedicated Studio D1 not created due missing write permission. Current R2 CAS is an isolated **single-admin pilot**, not an enterprise transactional multi-admin queue. Multi-user RBAC and backup/restore drill remain outstanding.
- **Spending**: real Modal compute and R2 operations executed with user authorization; absence of a verified workspace/Cloudflare hard billing cap means no categorical $0 invoicing guarantee.

## Deployment source and evidence custody

Isolated GitHub branch `experiments/studio-remote-r2-modal-e2e-20261017` in `evansmusitu/mft-axiom-build`.
The evidence ZIP contains source, live CPU Blender binaries, remote R2 hash receipts, and account-scope security inventory.
Backups are in the user's existing MUSITU Blender Google Drive folder, without creating a new cloud provider or touching Axiom's production branch.

**Acceptance**: Modal CPU and R2 production services deployed with live cross-provider QA successfully verified; Android-hosted E2E and NVIDIA GPU remain unverified. Do not label the entire enterprise studio fully operational.
