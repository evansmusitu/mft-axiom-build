# MUSITU Intelligence — private enterprise data and privacy operations

**Status: engineering-only, NOT deployed.** No connected customer's information
has been imported into this feature. Do not claim legal or production acceptance
from passing isolated tests. Deployment requires independent owner/legal/privacy
and cloud-infrastructure approvals.

## Data inventory and trust boundaries

| D1 table | Fields relevant to privacy | Classification / intended purpose |
| --- | --- | --- |
| tenants | opaque tenant ID | namespace only; not itself authentication |
| tenant_memberships | tenant ID, Access subject, role, active/revoked | identifiable access control; checked on every request |
| tenant_artifacts | tenant and artifact ID, AES-GCM opaque bytes, IV, version, revision, updated_at | caller-side encrypted contents; server holds **no** decryption key |
| tenant_audit | tenant ID, artifact ID, signed subject, put/delete event, timestamp | minimal operational history; contains identity metadata, **not** plaintext |

Do not enter personal names, phone numbers, filenames, or other customer details
into the opaque tenant/artifact IDs. JWTs, passwords, and decryption keys must
never be logged. Encryption does **not** anonymize access/usage metadata.

## Consent and owner-managed access

- Provision a separate Cloudflare Access application and a distinct dedicated D1
  resource. There is no cloud customer account or login now.
- Authenticate by Access-signed identity, with explicit membership provisioned
  and reviewed by an independently authorized administrator. Untrusted JWT role
  claims are never authorization.
- Membership removal denies cloud endpoint access; it does **not** erase
  stored ciphertext, old audit history, client copies, or backups.
- Publish and approve purpose, retention, data-transfer geography,
  subprocessor roles, support contacts and complaint/erasure procedure **before**
  a genuine customer session. No privacy acceptance has yet been signed.

## Explicit user export and restore

1. The user initiates \`exportEncryptedBundle()\`; it fetches only ciphertext
   and revisioned metadata and authenticates each encrypted envelope on the
   *user's device*. It makes a best-effort second inventory scan to detect
   changes while exporting. This is **not an atomic snapshot**, and the feature
   does not save or upload the resulting JavaScript object.
2. \`inspectEncryptedBundle(bundle)\` validates and decrypt-authenticates the
   supplied same-tenant bundle completely **offline**. Its return value exposes
   only tenant ID, count and artifact IDs, not document text.
3. \`restoreEncryptedArtifact({bundle,id,acknowledgeCreateOnly:true})\`
   restores **one** explicitly selected same-tenant ciphertext to a missing ID.
   Validation happens before token acquisition. It snapshots authenticated
   ciphertext before awaiting externally provided identity callbacks.
   \`If-None-Match: *\` prevents overwriting an existing item. A 412 is a
   conflict, **not** an instruction to retry as an update.
4. No automatic bulk import or cross-tenant transfer, no local workspace-slot
   migration, no file writes, no hidden background sync or cookie login.
   Signed tenants are limited to 20 mutations per 60 seconds by D1; users can
   voluntarily restore further items later. There is no automatic scheduler.
5. The recovery CryptoKey must already be available securely to the caller.
   Key recovery, re-wrapping, passphrase derivation and escrow are **not**
   implemented. Losing the key can permanently lose plaintext access; neither
   operator nor Worker can decrypt these ciphertexts. Never imply a user can
   recover a key from an encrypted export alone.

## Deletion and audit-retention procedure (NOT LIVE)

- One document: signed owner/editor \`DELETE\` with last known strong \`If-Match\`
  removes the scoped ciphertext atomically and adds a **minimal audit event**.
  The server neither checks nor automatically deletes browser-local slots,
  exported backups or external copies.
- \`enterprise-audit-retention.mjs\` is an independent, unimported operator
  helper that only deletes a **single explicitly selected tenant's expired audit metadata** in bounded batches.
  There is **no HTTP route, cron, binding, automatic invocation or deployed
  retention operation**. \`execute:true\` is mandatory.
- Its **proposed 30-day** audit retention default and maximum 100-row batch
  are engineering controls, not a legally approved retention schedule. The
  privacy controller must choose and document the actual lawful interval
  before running against authorized test/production data.
- The operator must independently authorize the *specific database* and the
  cleanup window, verify backup/legal-hold policies, record row counts and
  successful reversibility tests. The helper does not authorize itself.

An administrator-provided, independently verified D1 object may be invoked
only from an approved maintenance context:

\`\`\`js
import {pruneTenantAudit} from './enterprise-audit-retention.mjs';
const now = Math.floor(Date.now()/1000);
const preview = await pruneTenantAudit(authorizedDedicatedD1,{now,tenantId:authorizedTenantId,retentionDays:30,batchSize:50});
// After documented authorization only:
const result = await pruneTenantAudit(authorizedDedicatedD1,{now,tenantId:authorizedTenantId,retentionDays:30,batchSize:50,execute:true});
\`\`\`

The required `authorizedTenantId` must be a verified opaque tenant identifier from an independently approved administrative context, **not** from a customer-controlled API parameter. Missing/malformed IDs fail closed; this utility does not allow a global or cross-tenant purge. The preview merely confirms configuration; it does **not** enumerate eligible
rows or make a legal-hold determination. \`deleted\` is a count, not proof
that all expired rows have been removed. A reviewed operator must continue
bounded batches as necessary; no automatic job currently exists.

## Unresolved release NO-GO requirements

Real Access/JWKS and D1 private-canary qualification; Access-session revocation
behavior; GET/authentication rate abuse controls; identity provider lifecycle;
password/key recovery and customer support; consent and erasure verification;
backup deletion/retention; DSAR authentication/export/complaint operations;
audit maintenance authorization; transfer geography and legal basis; billing
and capacity; incident response; reviewer/custodian acceptance; tested rollback.
No one should connect paying customers or production data before those gates.

## Tenant-wide erasure — reviewed operator-only prototype (NOT LIVE)

A separate, **unwired** `enterprise-tenant-erasure.mjs` utility models erasure of a *single verified tenant* from the dedicated enterprise D1 database. It is **not** a customer-facing endpoint, not scheduled, not wired into the Worker, not a DSAR approval, and not independently authorized to operate on any cloud database.

The caller must supply a validated tenant ID, an independently verified matching tenant ID, a non-secret authorization reference, explicit assertion that legal hold has been reviewed and cleared, the typed confirmation `ERASE <tenant_id>`, and `execute:true`. Omitting `execute:true` returns a dry-run result and issues no D1 queries. Explicit execution uses a single transactional D1 batch: delete this tenant's audit rows and delete its tenant record, cascading scoped memberships and encrypted artifacts. Missing tenant IDs and incomplete transaction results fail closed. Real SQLite tests exercise cross-tenant separation and rollback if the tenant delete fails after audit deletion.

**Important:** Caller-provided approvals are declarations, not identity verification or legal judgment. These fields must come from an independently authorized operator in a verified maintenance environment, NEVER directly from customer HTTP parameters. The D1 object must be the separately approved enterprise database. The utility cannot erase Cloudflare backups, exported bundles, cached ciphertext, unrelated browser-local slots, third-party processors, provider logs or already downloaded customer files. A complete deletion request requires a separately reviewed retention/backup/key policy, authenticated data-subject request and evidence of all affected storage locations.

The code is intended for isolated test data and must **not** be invoked against real tenant data before owner/privacy/custodian acceptance of erasure procedure and legal-hold responsibilities.
