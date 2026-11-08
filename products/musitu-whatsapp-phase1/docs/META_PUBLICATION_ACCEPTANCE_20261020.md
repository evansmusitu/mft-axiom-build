# Meta app publication and real inbound checkpoint — 20 October 2026

User explicitly confirmed publishing MUSITU AI Employee Dev, app
`1096094346481018`, for real webhook testing. Clicked final Publish once. Meta
returned "Your app was successfully published", status Published and an Unpublish
control. No additional terms acceptance, CAPTCHA or credential change was shown.
This publishes the Meta integration app; it does not launch the private SaaS or
qualify real inbound, approved outbound delivery or production readiness.

After publication, the actual Step1 view confirms test sender +1 (555)663-7079,
phone ID1292923853915392 and messaging account1955690452095441. No token was
generated, recipient selected or Send message clicked. Step2/Configure Webhooks
shows the retained saved callback:
https://musitu-whatsapp-meta-receiver-20261015-ad7qjgbm7-evansmusitu.vercel.app/api/meta/webhook
Messages remains subscribed atv26.0; verify token remained masked and unread.
No callback, subscription, version, permission or account binding changed.

Read-only database baseline06:54:14.834UTC confirms ACTIVE synthetic acceptance
tenant986eb904-7296-46a9-9e9b-94074db9b547, VERIFIED exact test channel/WABA,
zero inbound events and zero stored messages. No raw recipient, content, secret,
session payload or hash was read.

Actual anonymous negative HTTP probes at the saved callback:
- GET without verification:400 INVALID_VERIFY_REQUEST.
- POST empty JSON without a signature:401 SIGNATURE_REJECTED.
- Receiver root:404 NOT_FOUND.
All responses retain no-store, no-referrer and restrictive security headers.
These are negative endpoint checks, not Meta-signed provider events. Independent
SQL06:57:37.064UTC still confirms zero inbound/messages and null latest event.
The GET result establishes configured handler admission, not database health.

Fresh private SaaS readback remains live=false, SSO enabled for all deployments,
with the same protected runtime deployment. Receiver project latest-deployment
metadata points at a different ready diagnostic deployment from the saved
callback; it was not confused with or reassigned to the actual callback.
Environment metadata was names/types/targets only, decrypt=false. An existing
META_ACCESS_TOKEN key remains listed; the prior runbook documents its value was
cleared. This turn did not decrypt/requalify that placeholder, install any sender
credential or claim its name absent. Do not put usable API credentials there.

Next genuine inbound test: the owner sends `MUSITU phase1 test 20261020` from the
already verified WhatsApp recipient to +1 5556637079. Then independently inspect
fresh callback status and the exact test-channel event/message rows. Do not
manufacture a Meta payload, disable signature verification, expand the recipient
allowlist or count dashboard fixtures as genuine traffic. No automatic response
is enabled by this publication. Outbound later requires scoped consent, human
approval and persistent provider-ID/receipt reconciliation; never blindly retry
unknown outcomes.

Phase1 is still incomplete: genuine Meta traffic, governed authenticated AI and
AXIOM service, owner revocation UI/direct replay/JWKS/mobile, unresolved exposed
QA-factor issue under no-reset, retention/deletion/legal qualification, scheduled
operations/recovery/alerts/second custodian and independent approval remain open.
No release attestation was changed. No model call, send, customer import, paid
upgrade, SaaS runtime redeploy or unrelated production change occurred.

Evidence: `evidence/20261020/meta-app-published.json`.
