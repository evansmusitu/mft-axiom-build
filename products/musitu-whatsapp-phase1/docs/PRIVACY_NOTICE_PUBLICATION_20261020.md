# Isolated public notices and Meta settings — 20 October 2026

Subsequent status: the user confirmed the isolated Meta publication and it
succeeded. See `META_PUBLICATION_ACCEPTANCE_20261020.md`. The original preparation
checkpoint below is retained with its observation-time scope.

Completed the user-approved operator/contact decision: Evans Musitu;
evansmusitu5@gmail.com. Published only static informational privacy and deletion
instructions. The private SaaS is not launched; Phase 1 remains incomplete.

- Privacy: https://musitu-privacy-notice.vercel.app/privacy
- Deletion: https://musitu-privacy-notice.vercel.app/data-deletion
- Separate project `prj_Yu5kIBesDFgUTUGAPLSwW6Kz00Az`, READY deployment
  `dpl_3T6H8BkA3idtn8cQ7xenqsACAqHY`, production target for notices only.
- Source `e29c9394d0896845c8f4120a11754c53b63dcd14` under
  `deployments/privacy-notice/`. Git-link creation failed with an integration
  error; no integration/access expansion was attempted. Corrected by creating
  an unlinked static project and uploading four committed static/config files.
  Deployment readback metadata is empty, so provenance uses independent body
  digests rather than an invented server-side Git association.

Anonymous HTTP requests without cookies, bearer tokens or Vercel bypasses returned
200 for both pages. SHA-256 of each response equals the committed local HTML.
Root resolves to `/privacy`; `/api/health` and `/api/meta/webhook` return404 on
this notice project. Security headers include restrictive CSP, no-referrer,
nosniff and camera/microphone/geolocation denial; no Set-Cookie. Browser navigation
renders both pages and their links. Project environment readback is empty.
The source verifier now also checks completeness of this new deployment directory.
No full SaaS suite/redeploy was needed for independent static notices.

Meta app `1096094346481018` (MUSITU AI Employee Dev): entered these two URLs in
Basic settings, retaining Data deletion instructions URL mode, clicked Save
Changes, reloaded and independently read both values back. No app secret,
verify token, subscription, callback, recipient or additional permission changed.
The final Publish view now says all required app settings are complete and its
final Publish button is enabled. That button has NOT been clicked. Read-only
use-case review shows public_profile, whatsapp_business_management and
whatsapp_business_messaging Ready for testing, with displayed API counts2/1/0.
This is not App Review approval or real messaging qualification.

The notice states current manual request handling, 30-day visibility rather than
physical erasure, separate backups, current providers and human-reviewed AI.
Production retention/deletion/export qualification, transfer/provider agreements
and legal review remain open. `PRIVACY_REQUEST_OPERATIONS_20261020.md` defines
manual handling; no request was processed, email sent or record erased.

Fresh SaaS project readback remains live=false and SSO enabled for all deployments.
Runtime `3f7eb7b3be8d65a51e13e09387035c4e8ae5043c` and its protected deployment
remain unchanged. Dedicated Meta receiver and unrelated production products were
not modified. Existing release-gate attestation remains unchanged/blocked.

Next concrete action: final Publish on this isolated Meta app, followed by a
fresh result readback and bounded owner-controlled WhatsApp acceptance. Publishing
may permit real Meta event delivery to the already-configured callback. Browser
confirmation policy requires action-time confirmation for this security-sensitive
access change; broad advance approval does not replace that confirmation. Prepare
and show the exact review view before asking. Keep private SaaS SSO, the existing
test recipient boundary and human/outbound gates. No public SaaS promotion,
customer import, paid upgrade or credential reset is included.

Evidence: `evidence/20261020/privacy-notice-publication.json`. Separate remaining
release gates include owner revocation UI/direct replay/JWKS/mobile, unresolved
QA-factor exposure, real Meta traffic, authenticated governed AI/AXIOM access,
expiring AI credential, scheduled recovery/alerts and independent approval.
