# MUSITU AXIOM — Recovered Cloudflare connection and safe reuse

Status: isolated read-only preflight implemented and tested offline; live account verification NOT PROVEN; $0 spending.

The latest dedicated Cloudflare connection instruction located in connected Drive is MFT_CLOUDFLARE_CONNECTION_AND_NEW_CHAT_EXECUTION_INSTRUCTIONS_2026-09-03.txt: https://drive.google.com/file/d/16Rv_KcMGqArAZaLdwZGVAzLsOiDi8o_T/view?usp=drivesdk

It records a Global API Key in cfk_ format, authenticated by X-Auth-Email plus X-Auth-Key, NOT Bearer. The original record belongs to Education Nexus and does not itself grant broader AXIOM permissions.

Fresh AXIOM live GitHub workflows cloudflare-control-plane.yml and cloudflare-access-audit.yml corroborate this established path: existing GitHub encrypted secrets CLOUDFLARE_EMAIL and CLOUDFLARE_GLOBAL_API_KEY injected only into a scoped runner, never copied to a prompt.

Drive also records a Wolfram external relay workaround for a blocked local network. Do not transmit the long-lived Global API Key to an unrelated relay. Reuse the established GitHub secrets -> runner -> Cloudflare direct HTTPS route.

The Python preflight makes only fixed HTTPS GET calls for active mftintelligence.com zone and its previously verified account identity. No Worker deployments, D1 writes, DNS changes, API token rotation, model inference, secrets rotation or production mutations.

The new workflow is manual-only, contents:read, pinned checkout, requires AXIOM_TRACK_B_ZERO_COST_CI_ALLOWED=true, and MUST NOT be run until no-charge included CI minutes with no billing overage are independently verified.

NOT PROVEN: live Cloudflare auth, Free account eligibility, Workers AI no-overage hard stop, customer data privacy, customer serving inference, S3/S4 authorization. Preserve public gateway disabled.
