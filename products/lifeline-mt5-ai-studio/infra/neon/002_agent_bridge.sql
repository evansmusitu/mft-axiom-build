-- Apply to a NEW isolated LIFELINE Neon database. Never to Axiom/WhatsApp/FMI/MMF.
-- Assumes a separate, non-owner lifeline_runtime role created through owner-controlled provisioning.
BEGIN;
CREATE SCHEMA IF NOT EXISTS lifeline;
CREATE TABLE IF NOT EXISTS lifeline.agent_jobs (
  job_id uuid PRIMARY KEY,
  tenant_subject text NOT NULL CHECK(length(tenant_subject) BETWEEN 1 AND 100),
  agent_id text NOT NULL CHECK(length(agent_id) BETWEEN 1 AND 100),
  job jsonb NOT NULL,
  state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','CLAIMED','COMPLETED')),
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS agent_jobs_queue_idx ON lifeline.agent_jobs(tenant_subject,agent_id,state,created_at);
ALTER TABLE lifeline.agent_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeline.agent_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_jobs_tenant ON lifeline.agent_jobs;
CREATE POLICY agent_jobs_tenant ON lifeline.agent_jobs FOR ALL
  USING (tenant_subject=current_setting('lifeline.tenant_subject',true))
  WITH CHECK (tenant_subject=current_setting('lifeline.tenant_subject',true));
CREATE TABLE IF NOT EXISTS lifeline.agent_nonces (
  tenant_subject text NOT NULL CHECK(length(tenant_subject) BETWEEN 1 AND 100),
  agent_id text NOT NULL,
  nonce text NOT NULL CHECK(length(nonce) BETWEEN 16 AND 100),
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_subject,agent_id,nonce)
);
ALTER TABLE lifeline.agent_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeline.agent_nonces FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_nonces_tenant ON lifeline.agent_nonces;
CREATE POLICY agent_nonces_tenant ON lifeline.agent_nonces FOR ALL
  USING (tenant_subject=current_setting('lifeline.tenant_subject',true))
  WITH CHECK (tenant_subject=current_setting('lifeline.tenant_subject',true));
COMMIT;
-- Only after separately creating dedicated NON-OWNER, NO-BYPASSRLS `lifeline_runtime` role:
-- GRANT USAGE ON SCHEMA lifeline TO lifeline_runtime;
-- GRANT SELECT,INSERT,UPDATE ON lifeline.agent_jobs TO lifeline_runtime;
-- GRANT INSERT ON lifeline.agent_nonces TO lifeline_runtime;
-- Ensure `lifeline_runtime` cannot CREATE in schema, cannot SET ROLE to owner,
-- and has no privileges on any other application tables.
