-- Proposed additive migration. NOT executed on this host. Apply after 001-005
-- using the migration owner, with musitu_runtime as a distinct NON-OWNER role.
-- Explicit human approval is recorded without sending, queueing, or reserving
-- outbound WhatsApp messages. A separate consent-checked dispatch release is
-- required before any provider integration is allowed.
BEGIN;
CREATE TABLE musitu.draft_approvals (
 tenant_id uuid NOT NULL,
 draft_id uuid NOT NULL,
 actor_id text NOT NULL,
 approval_key text NOT NULL CHECK(length(trim(approval_key))>0 AND length(approval_key)<=180),
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,draft_id),
 UNIQUE(tenant_id,approval_key),
 FOREIGN KEY(tenant_id,draft_id) REFERENCES musitu.reply_drafts(tenant_id,draft_id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES musitu.memberships(tenant_id,actor_id)
);
ALTER TABLE musitu.draft_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE musitu.draft_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON musitu.draft_approvals
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON musitu.draft_approvals FROM PUBLIC;
-- Only the authenticated admin runtime may SELECT/INSERT review evidence.
-- No UPDATE/DELETE rights. Ingress role cannot read or write approvals.
GRANT SELECT,INSERT ON musitu.draft_approvals TO musitu_runtime;
COMMIT;
