-- CANDIDATE ONLY: this PostgreSQL migration has NOT been executed against
-- real Postgres. Must be tested on disposable Postgres 17 with a non-owner
-- service role, RLS and failure/restart scenarios before any deployment.
BEGIN;
CREATE TABLE musitu.faqs (
  tenant_id uuid NOT NULL REFERENCES musitu.tenants(id),
  faq_id uuid NOT NULL,
  normalized_question text NOT NULL CHECK(length(normalized_question) BETWEEN 1 AND 1000),
  answer text NOT NULL CHECK(length(answer) BETWEEN 1 AND 4000),
  PRIMARY KEY (tenant_id,faq_id),
  UNIQUE (tenant_id,normalized_question)
);
CREATE TABLE musitu.reply_drafts (
  tenant_id uuid NOT NULL REFERENCES musitu.tenants(id),
  draft_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  effect_key text NOT NULL,
  normalized_question text NOT NULL,
  source_faq_id uuid NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status='DRAFT'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,draft_id),
  UNIQUE (tenant_id,effect_key),
  FOREIGN KEY (tenant_id,conversation_id)
    REFERENCES musitu.conversations(tenant_id,conversation_id),
  FOREIGN KEY (tenant_id,source_faq_id)
    REFERENCES musitu.faqs(tenant_id,faq_id)
);
ALTER TABLE musitu.faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE musitu.faqs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON musitu.faqs
 USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE musitu.reply_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE musitu.reply_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON musitu.reply_drafts
 USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
COMMIT;

-- BEFORE EXECUTION:
-- * Dedicated migration role separate from non-owner runtime role.
-- * app.tenant_id set using SET LOCAL inside every authenticated transaction.
-- * Explicit grants, deny public/schema creation, revoke direct SQL access.
-- * Verify tenant ID is derived from signed inbound or OIDC+membership,
--   never an unauthenticated HTTP field.
-- * Two-tenant native PG isolation, exclusion, restart and pool-reuse tests.
-- * Normalize legacy local text tenant ids to UUIDs only in an isolated migration.
-- * Retention, consent, encryption and external send gates are not yet present.
