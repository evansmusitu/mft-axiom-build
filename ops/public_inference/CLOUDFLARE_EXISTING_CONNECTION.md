# MUSITU AXIOM — Recovered Cloudflare connection and safe reuse

Status: isolated read-only preflight implemented and tested offline; live account verification NOT PROVEN; $0 spending.

The latest dedicated Cloudflare connection instruction located in connected Drive is MFT_CLOUDFLARE_CONNECTION_AND_NEW_CHAT_EXECUTION_INSTRUCTIONS_2026-09-03.txt: https://drive.google.com/file/d/16Rv_KcMGqArAZaLdwZGVAzLsOiDi8o_T/view?usp=drivesdk

It records a Global API Key in cfk_ format, authenticated by X-Auth-Email plus X-Auth-Key, NOT Bearer. The original record belongs to Education Nexus and does not itself grant broader AXIOM permissions.

Fresh AXIOM live GitHub workflows cloudflare-control-plane.yml and cloudflare-access-audit.yml corroborate this established path: existing GitHub encrypted secrets CLOUDFLARE_EMAIL and CLOUDFLARE_GLOBAL_API_KEY injected only into a scoped runner, never copied to a prompt.

Drive also records a Wolfram external relay workaround for a blocked local network. Do not transmit the long-lived Global API Key to an unrelated relay. Reuse the established GitHub secrets -> runner -> Cloudflare direct HTTPS route.

The Python preflight makes only fixed HTTPS GET calls for active mftintelligence.com zone and its previously verified account identity. No Worker deployments, D1 writes, DNS changes, API token rotation, model inference, secrets rotation or production mutations.

The new workflow is manual-only, contents:read, pinned checkout, requires AXIOM_TRACK_B_ZERO_COST_CI_ALLOWED=true, and MUST NOT be run until no-charge included CI minutes with no billing overage are independently verified.

NOT PROVEN: live Cloudflare auth, Free account eligibility, Workers AI no-overage hard stop, customer data privacy, customer serving inference, S3/S4 authorization. Preserve public gateway disabled.


## Operational no-new-credential route (the established workflow)

The GitHub Actions workflow `.github/workflows/cloudflare-control-plane.yml` already exists on protected main and is executable through manual workflow dispatch. In the **isolated public-inference branch only**, its version is modified to be manual-dispatch only, to require the no-cost-CI eligibility flag, and to run `cloudflare_readonly.py` after the existing native Cloudflare zone lookup.

GitHub requires a new `workflow_dispatch` workflow to exist on the default branch to be runnable through the Actions UI. Therefore `.github/workflows/axiom-public-inference-cloudflare-readonly.yml` on the isolated branch is **reference-only**, not independently dispatchable. The established, default-branch-supported `cloudflare-control-plane.yml` is the executable path; the branch selector must target the isolated branch.

**Do not run** even the existing workflow until no-charge included Actions capacity/no-billing-overage is independently verified. No run was dispatched in this continuation.
