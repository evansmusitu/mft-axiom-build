# MUSITU Studio — Cloudflare host-only unblock, independently read back (18 October 2026)

## Exact source and change boundary

Original SHA-verified handoff: `9439cdae2fbb8073c6300558ae01441d12d1425d`; isolated source branch `experiments/studio-remote-r2-modal-e2e-20261017`. No Axiom default/main, Worker deployment, D1, global zone security setting, R2, Modal workload or existing Axiom rule was intentionally changed in this milestone.

### Verified root cause

1. [Cloudflare Analytics Ray forensics / run 39102603417](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39102603417) 2026-10-18 06:02 UTC, **4/4 tests passing**, two exact Ray filters successfully queried (HTTP 200). Both observed probe Ray IDs returned `source=securitylevel`, `action=managed_challenge`, 2026-10-18 05:45:54 UTC. This proves **the immediate challenge on those two probes**, not necessarily every historical human Error 1010.
2. [Configuration quota / run 39102823818](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39102823818) read-only: current Cloudflare plan **Free**, configuration rules **10/10**, no room for another configuration rule. Existing Axiom rules were not removed, merged or modified to create capacity.
3. Cloudflare docs permit a custom WAF `skip` rule targeting only product `securityLevel`. Free zone custom WAF rules allow five; before change, one existed. Therefore a **separate hostname-only WAF custom rule** was the safe, free mechanism; **no global Under Attack mode adjustment** was made.

### Protected production change

[Host-only guarded remediation / run 39103096340](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39103096340) at 2026-10-18 06:10 UTC: **3/3 regression tests passing** and live preflight confirmed isolated Worker domain, staff-only Cloudflare Access with email-only allow rules and no bypass, signed session enabled, GPU disabled, and WAF slot available.

One custom WAF rule added under the existing **zone custom firewall** ruleset, with exact expression:

```
(http.host eq "studio.mftintelligence.com")
```

Action: `skip`, parameters `{"products":["securityLevel"]}`, logging enabled; no `bic` or other security product skip. Rule creation returned Cloudflare HTTP **200**; immediate provider GET verified exactly one matching new enabled rule; all prior WAF rules retained unchanged; pre/post counts 1 → 2. Browser Integrity Check still ON, zone Security Level globally still `under_attack`, configuration rules remained 10.

### Fresh independent acceptance **after** change

- Re-ran [Cloudflare edge first-hop inventory 39101667632 attempt 2](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39101667632) at 2026-10-18 06:11 UTC: **2/2 tests pass**. Both normal and Android Chrome-like GETs to `https://studio.mftintelligence.com/` now returned **HTTP 302 to Cloudflare Access login**, with no Cloudflare mitigation/challenge and no Error 1010. This verifies the previously failing first hop, not an actual phone sign-in.
- Re-ran [live Worker/Access/R2 inventory 39061504060 attempt 2](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39061504060) at 2026-10-18 06:11 UTC: deployed dedicated Studio Worker, isolated hostname, signed staff session, email-only Access allow rules, dedicated R2 binding, Modal URL, CPU dispatch and approval gates, and GPU off all passed. Fresh revised check run [39103253192](https://github.com/evansmusitu/mft-axiom-build/actions/runs/39103253192) updated stale `BLOCKED_BY_CF_ERROR_1010` static receipt to honest `NOT_YET_VERIFIED_REQUIRES_REAL_STAFF_ANDROID_BROWSER_SESSION`.
- Original real CPU / Worker-runtime / remote R2 historical acceptance remains valid as recorded in the original handoff. It is **not** misrepresented as an end-user browser production render.

## External proof still needed

One actual approved-staff Android browser visit/sign-in to `https://studio.mftintelligence.com/`, then leave optional token blank, press **Connect / Refresh**, create a project, use the supplied CPU scene, **Submit for approval → Approve → Dispatch → Check render**, then download `scene.blend`, `scene.glb` and `preview.png` and verify provider-side hashes. No authorization bypass, browser-emulation, or token sharing is acceptable. If Access sign-in remains blocked on the real phone, collect only error number + Ray ID + approximate UTC time, not callback URL or tokens.

Remaining non-browser blockers: D1 Create permission for production transactional queue; R2 CAS remains single-admin pilot. GPU T4 remains unqualified without Modal payment method/entitlement and independently proven billing control. Do not charge GPU or claim full enterprise certification.

## Release integrity

No Studio Worker or Modal new code deployment in this milestone. Only isolated GitHub source commits and one exact-host Cloudflare custom WAF rule. All verification artifacts were obtained from live provider-backed GitHub Actions, with ZIP artifact digest and content checked. Keep the globally configured Under Attack mode and all Axiom/other host policies unchanged.

Rollback authority: remove **only the new exact-expression custom WAF rule**, not any preexisting rule, if it is shown to harm the Studio security posture. Do not roll back globally.