# 2026-10-11 genuine Resend-origin qualification — external receiver proof

**Evidence class: GENUINE EXTERNAL PROVIDER, ISOLATED DISPOSABLE RECEIVER. This is NOT a MUSITU Mail Fabric live outbox round-trip and does NOT qualify production release.**

## Authority and scope
- User expressly authorized exactly one controlled transactional test send and a disposable callback with cleanup. Test sender/domain and recipient were approved; no real customer data.
- GitHub source branch `product/musitu-mail-fabric-isolated-20261009` at source baseline `db9e274e191c4b4b08bb479e41d291b0b5860177`; `main`, PR #1, Cloudflare existing workers, product live-delivery configuration, DNS and AXIOM production untouched.
- Disposable, separate Vercel hobby project `mmf-resend-qualification-20261011`, ID `prj_Fnvza5stBYN7dzoubBeJNcPcUNzc`. No custom DNS, no provider API keys stored in code, callback did not receive sender encryption/signing/privacy secrets.
- Disposable Resend webhook `e37b9965-a42d-4bdb-acd1-7671a13f885d`, subscribed to transactional events, endpoint `https://mmf-resend-qualification-20261011.vercel.app/api/resend-event`.

## Genuine provider action and acceptance
- Exactly one explicit provider send at 2026-10-11 05:20:49 UTC. Resend email ID `01a12968-14fa-7346-a6dd-e75b9a5490e7`. Email status: `delivered` (receiving server acceptance, NOT inbox placement/read).
- Resend generated original genuine `email.sent` event `msg_3KXFYCoSUrMBkTx1F1S6HAL9i5H` and original genuine `email.delivered` event `msg_3KXFYIY383N4S0Yeb5ysEZ6TKTH`.
- Isolated HTTPS receiver validated original raw bytes against endpoint-specific Svix HMAC-SHA256 signature, with ±300s timestamp bound and size cap, then logged ONLY event/message/payload hashes. No plaintext addresses, message content, secrets or tokens logged.
- Initial receiver deployment had a JavaScript truncation/syntax defect. Original Resend attempts returned HTTP 500. That failure is part of the evidence, not hidden. Corrected disposable receiver `dpl_7vR3SLzVspiJYF6VbbR2Fjinpe7u` yielded actual provider replay **HTTP 204** for each original provider event; no second email was sent.
- `email.delivered`: successful Resend delivery attempt ID `atmpt_3KXFh0LXznhYB5CINVlLfXqcH0B` at 05:22:00.932 UTC; redacted Vercel runtime log at 05:22:01.120 UTC: signed event hash `9462c7b086eabae1aa20d5b763a67a5ef8ebba602e72e8de814deab68b863eb1`, same message hash `f9cf73d24fee6392f21d3af38b0ec6e9d1d2f4bad715a9d495892bd04d1772a7`, exact signed raw body hash `b65794883081ed65071bc8cbc4d444a3ac01d60e849d82c067bb96102beb8f14`.
- `email.sent`: successful Resend delivery attempt ID `atmpt_3KXFmwatDQ9bTXG9XPYaGl1fHih` at 05:22:48.180 UTC; runtime log at 05:22:48.428 UTC: event hash `b1c0c37683c7c4ec89596ec3c9960cd70e207d26c1f2f1239b5eabbb57799d41`, same message hash, raw-body hash `b0fa3016227d9b63c5e3d5d38a9a4a2a7b66f832735d573ace1bcb0486c5158a`.
- Independently recomputed SHA-256 of both event IDs and the email ID and matched the Vercel redacted logs.

## Post-test containment
- Resend webhook status explicitly updated to **disabled**; provider readback confirmed `disabled`.
- Disposable Vercel project production runtime secret replaced with inactive marker and `MMF_QUALIFICATION_ACTIVE=false`. Deactivated production alias deployed to `dpl_m72nQhu7TcRGybYEedcuA8aUb2Yz`, readback state `READY`, handler always returns HTTP 410.
- Old immutable Vercel deployment URLs might remain until project deletion. Connected Vercel app lacks project deletion action. Disposable webhook remains **disabled, not deleted**: connected Resend remove action requires separate user double-check specifically naming the endpoint. Do not claim complete deletion or cryptographic revocation of all historical deployments.

## Interpretation and remaining blockers
- **PROVEN:** a real Resend controlled email produced genuine provider events, each accepted by an independent isolated receiver with verified signature and matching provider IDs.
- **NOT PROVEN:** actual MUSITU Mail Fabric live sender-to-outbox-to-linked-Worker reception/reconciliation, replay deduplication in persistent MMF state, bounce/complaint suppression from genuine controlled negative provider events, a permanent production webhook, customer delivery, operational production key custody, recovery, independent assessor-signed qualification, privacy compliance, security certification, business registration, customer billing or revenue.
- **NEXT:** complete isolated real provider-to-MMF durable-outbox integration on fresh dedicated resources with own authorization and test recipient; develop production KMS/HSM and independent operational/security/legal approvals. Keep production delivery OFF until separately authorized release.

The product's `MMF_PROVIDER_QUALIFICATION_JSON` guard must NOT be populated from this document: the requirement for an independent assessor to qualify full applicable evidence has not been met.
