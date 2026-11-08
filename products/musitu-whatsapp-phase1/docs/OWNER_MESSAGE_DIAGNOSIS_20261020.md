# Owner message diagnosis — 20 October 2026

Meta's actual test-event UI confirms the owner's exact synthetic message,
`MUSITU phase1 test 20261020`, on the correct WABA/phone and verified owner number.
The displayed event time is09:11:48 (UI timezone unstated); embedded provider
send time is07:11:45UTC. Raw sender/contact/profile/account data and provider ID
are not retained in repository evidence. Only exact-match booleans and a one-way
provider-message-ID digest are recorded. This is a genuine user-originated Meta
event observation, not evidence of transport into our receiver.

Read-only PostgreSQL at07:12:56.033UTC shows zero inbound events/messages. At
07:20:33.486UTC inbound stillzero/latestnull. Receiver logs over06:53–07:13 show
only our earlier negative probes, and07:08:54–07:18:54 show no matching callbacks.
Do not relabel Meta's UI event as successful application persistence.

Added an operator-only read diagnostic, scripts/read-meta-waba-subscription.mjs.
It permits only two fixed GET requests: exact test WABA phone IDs, then subscribed
apps if and only if the phone is exclusively the expected test phone. It does not
follow paging/redirects, mutate subscriptions, send messages, retry or emit raw
provider errors/payloads. Responses are size/time bounded and error telemetry is
numeric only. Unknown response shapes and partial pages cannot assert absence.
Meta's official Postman collection documents the separate subscribed_apps GET:
https://www.postman.com/meta/whatsapp-business-platform/request/tl2wk2j/get-all-subscriptions-for-a-waba

Five focused new tests plus four existing Meta-read tests pass (9/9), covering
fixed destinations/GET-only, exact app matching, partial/unknown responses,
wrong-channel denial, oversized/invalid/transport failures and secret suppression.
Verifier/syntax pass; source manifest391 before this evidence update. No unrelated
full-suite repeat. Initial file-write attempt used a duplicated workdir-relative
path, failed without changing files, then was corrected with absolute patches.

Executed the committed diagnostic inside the protected application's existing
Preview credential environment, never decrypting or printing its token. READY
staging diagnosticdpl_7duHnVaLqYkqiXm1s2TphhhGkqXM, sourcea5c4f297c4acf874471119a15a207efaa4042ee2,
reports at07:17:27.495UTC: first phone GET HTTP401, code190/subcode463. The saved
token is rejected with the expiry subcode. Subscription GET was NOT reached;
whether the app is subscribed to the WABA remains UNVERIFIED. Token expiry blocks
the management diagnostic; it is not established as the cause of absent inbound
webhook delivery. The later Next build succeeded; that does not turn the denied
Graph read into a qualification pass. No database qualification was rerun by that
one-off diagnostic build.

The deployment automatically moved the stable alias. After READY it was restored
to the previous qualified protected runtimedpl_5knoGVDGtSy3PSVxWk2dCFBNm2to and
independently read back. The default build was explicitly restored to
`node scripts/staging-postgres-qualification.mjs && npm run build`. SSOall/livefalse
remain. The diagnostic remains a separately inspectable protected deployment;
no production promotion, receiver deployment or public token proxy was created.

Prepared actual Meta Step1 Generate token view and existing protected SaaS
META_ACCESS_TOKEN Preview setting (value never revealed). Browser credential
replacement requires the user to perform generation/copy/entry/submission.
The current Vercel row is masked and marked Config/Needs Attention; when saving
the replacement use Secret/sensitive storage if available without a paid upgrade,
retaining Preview scope. Do not put a usable API token in the public receiver.
No credential was generated, entered, submitted, reset or copied by the agent.
Keep the grant limited to the existing Test WhatsApp Business Account; do not add
production Nexus assets or future-account access. Do not paste a token into chat.

After the user saves a replacement, run the read-only diagnostic once from the
protected environment and inspect its complete sanitized result. If the exact
app is missing from the test WABA subscription, prepare the scoped addition and
readback; do not remove/overwrite other subscriptions or change Nexus. The current
mission/runbook prohibits unapproved WABA subscription changes. Do not ask the
owner to resend repeatedly until provider routing is understood. Full acceptance,
security and operations gates remain open.

Evidence: evidence/20261020/owner-message-diagnosis.json. No new provider send,
model call, WABA write, credential reset, charge or unrelated product change.
