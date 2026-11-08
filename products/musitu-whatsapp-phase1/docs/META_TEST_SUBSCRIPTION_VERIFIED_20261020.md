# Correct MUSITU token and test subscription verified — 20 October 2026

User Saved at10:44:35 Africa/Harare. Metadata-only read found the existing sensitive Preview credential updated at08:43:58.496UTC. The agent did not read, decrypt, copy or replace its value.

The reviewed operator ran once in protected staging deployment `dpl_DSixupSFu7QKCRrs8TEB9KT2UAyR`, pinned to `df0a36f3a93b2038e7c45f611bf24918a408a769`. At08:45:29.251UTC the provider returned HTTP200 for all five requests: app identity, exact test phone, subscriber prestate, one additive POST and independent subscriber readback. Issuing app is the intended MUSITU `1096094346481018`. The exact test WABA is `1955690452095441` and phone ID `1292923853915392`.

Status `SUBSCRIBED_READBACK_VERIFIED`: one existing subscriber before and two afterward, with the MUSITU app present. Every previous subscriber ID and complete metadata digest is preserved; only the expected app was added. The POST acknowledged success. No callback override, subscriber deletion, message send, credential transfer or automatic retry occurred. Do not infer the other subscriber's identity from its count.

The one-off command is not the normal build. The default PostgreSQL qualification build was restored immediately after requesting this deployment. The deployment reached READY. Afterward the stable SaaS alias was explicitly reasserted and independently read back to qualified `dpl_5knoGVDGtSy3PSVxWk2dCFBNm2to`; assign_alias reported the same old deployment ID. No diagnostic runtime was promoted to stable. The dedicated receiver was unchanged.

At08:46:25.115UTC the exact acceptance tenant still had zero inbound events and zero messages, latest inbound null. Receiver logs08:36:01.791–08:46:01.791UTC had no matches. An initial unqualified-table SQL query failed because the table requires the musitu schema; the corrected schema-qualified read above succeeded. No write resulted from either query.

This closes the wrong-app credential and absent test-account subscription blockers. It does not prove signed inbound delivery or database persistence. Request a fresh owner synthetic WhatsApp message after the subscription, then correlate actual callback and encrypted storage before claiming receipt. Earlier messages are not assumed to replay. Outbound/receipts, governed AI, remaining identity/security, privacy and operational gates remain open; Phase1 is INCOMPLETE. The no-reset instruction remains binding.

Validation: no runtime source changed. The prior298/298 full tests and131 syntax checks apply to this same operator source. Fresh manifest validation accompanies this evidence update. Provider success above is actual execution, not a unit-test inference.

Sanitized evidence: `evidence/20261020/musitu-test-subscription-verified.json`.
