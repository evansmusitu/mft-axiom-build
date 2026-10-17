# MUSITU Enterprise 3D Studio — live CPU deployment and evidence receipt
**Date:** 2026-10-17. **Scope:** Existing GitHub + Cloudflare + Modal, isolated MUSITU Studio resources.

## Exact status — live CPU pilot, not fully certified enterprise platform
**LIVE:** dedicated Cloudflare Worker `musitu-studio-v02`, isolated R2 bucket `musitu-studio-v02-assets`, Cloudflare Access app `MUSITU Studio Android Control` on `studio.mftintelligence.com`, authenticated R2 CAS single-admin queue, real Modal app `musitu-studio-v02` CPU Blender execution.

**UNVERIFIED/NOT AVAILABLE:** successful interactive sign-in from a real Android phone on the public custom hostname; an actual approved job initiated through that public hostname; the Modal T4 GPU (Modal account rejected T4 deployment because a payment method was required); D1-backed enterprise multiadmin queue (existing Cloudflare token could not create the dedicated D1 database). No GPU render has been claimed.

## Live production readback
GitHub Actions: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39061504060
Verified remotely through authenticated Cloudflare API:
- Worker `musitu-studio-v02` deployed, staff-only Access app, correct custom domain, email-only allow policies.
- CPU dispatch enabled on deployed Worker under explicit owner authorization; GPU gate disabled.
- Worker configured to call the actual dedicated Modal HTTPS endpoint.
- R2 binding maps to **only** the Studio bucket; D1 absent.
- `STUDIO_LOCAL_TEST_ONLY` not present in live Worker; local testing bypass is disabled.
- `STUDIO_SESSION_ENABLED=true`, enabling 1-hour signed HttpOnly Secure SameSite=Strict staff cookies bound to the Cloudflare Access signed JWT. Separate protected admin key remains inside the Worker and is used to HMAC-sign sessions.
- No existing Axiom Worker, zone route, or production service modified.

## Actual provider render and persistence (NOT simulated)
1. Actual deployed Modal CPU Blender render via protected HTTPS job submission and callback-free /jobs/pull polling:
   https://github.com/evansmusitu/mft-axiom-build/actions/runs/39060405530
   - Real output validated: `scene.blend`, `scene.glb`, `preview.png`; SHA256 checked independently.
2. Actual independent upload into dedicated **remote Cloudflare R2**, remote GET and byte equality:
   https://github.com/evansmusitu/mft-axiom-build/actions/runs/39060544185
   - Remote R2 prefix: `qualifications/modal-cpu-pull-39060405530/`.
3. Actual Studio Worker code executed in Wrangler **local runtime with remote Cloudflare R2 binding**, dispatching directly to deployed Modal CPU and then persisting/downloading real Blender results:
   https://github.com/evansmusitu/mft-axiom-build/actions/runs/39060820517
   - State written only to `studio-control/qa-cloudflare-modal-20261017.json`; production live state `studio-control/v1/state.json` untouched.
   - Live Modal/R2 SHA receipts:
     - `scene.blend`: `09cb1d3b65b578bffc69949c910023a0ef743009b3a9cdd2f468965e550151ec`
     - `scene.glb`: `d55b57fddba027e1d7b870b5d6d745d35a00ec7013e174d56ccc91cce05ef4a3`
     - `preview.png`: `e71b9b5f443d88aee9dfabaccc19f78522ec987cdc05fd1b310d695403c2b5ff`
   - This establishes real **Worker code → Modal CPU → remote Cloudflare R2** operation. It does **not** establish an interactive browser-to-production-Worker path.
4. Signed Access staff sessions and Android UI passed 48/48 security and software checks and deploy build:
   https://github.com/evansmusitu/mft-axiom-build/actions/runs/39061172032
5. Live Studio Worker CPU activation succeeded:
   https://github.com/evansmusitu/mft-axiom-build/actions/runs/39061325303

## Public access issue requiring Cloudflare administrator
The production hostname is attached to the correct Studio Worker, but external probes (GitHub and Modal) receive Cloudflare HTTP 403 **Error 1010** *before* the Worker receives a request. Site owner rules cause Error 1010, not Worker response logic. The existing Cloudflare scoped token was denied write permission when attempting a **callback-only** Browser Integrity Check configuration rule (HTTP 403), and no global WAF protections were disabled. Normal human Android browser access remains unverified; it could differ from GitHub/Modal bot-like traffic.

Docs: https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/ and https://developers.cloudflare.com/waf/tools/browser-integrity-check/

A Cloudflare zone administrator with authorized security-settings access must inspect Cloudflare Security Events for the exact Error 1010 and, only if appropriate, create a narrowly scoped rule for the Studio route. **Do not disable BIC globally or modify existing Axiom routes.** Because the production CPU Worker uses Modal result polling, allowing Modal callbacks through Cloudflare is not required.

## Modal GPU qualification blocked by provider entitlement
Modal deployment of `gpu="T4"` was rejected with **"Please add a payment method to use T4 GPU functions"**. The CPU worker is live; GPU deployment/calls remain disabled. A billing-account administrator must resolve that prerequisite before an actual CUDA/OptiX GPU render can be qualified. The user's budget approval does not override Modal account entitlement.

## Operational limits and risk
- R2 CAS single-admin queue is a limited pilot, not a D1 transaction-backed multi-tenant enterprise queue. Limits: 100 projects, 100 jobs, five-megabyte bounded callback-file contract.
- CPU renders can generate Modal costs and R2 operations/storage may generate charges. The user authorized use of existing billing setup but provider-enforced $0 was not proved.
- Public Android access and external authenticated login have **not** been verified end-to-end.
- Production CPU dispatch still requires explicit job submission, manual approval, and explicit Dispatch click in the staff UI. No automatic render flood enabled.
- Permanent recovery, offsite backup/restore and SLA are not yet certified.
