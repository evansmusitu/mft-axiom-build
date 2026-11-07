-- JARVIS staging schema only. REQUIRES isolated database and separate migration owner.
-- Pre-create role jarvis_runtime NOLOGIN/LOGIN as appropriate, NO BYPASSRLS, NOT TABLE OWNER.
BEGIN;
CREATE SCHEMA IF NOT EXISTS jarvis;
CREATE TABLE IF NOT EXISTS jarvis.sessions (
 session_id varchar(70) PRIMARY KEY, tenant_id text NOT NULL,
 stage text NOT NULL, data_json jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jarvis.leads (
 lead_id varchar(70) PRIMARY KEY, tenant_id text NOT NULL,
 session_id varchar(70) NOT NULL REFERENCES jarvis.sessions(session_id),
 name text NOT NULL, need text NOT NULL, budget text NOT NULL,
 timeline text NOT NULL, contact text NOT NULL,
 consent boolean NOT NULL DEFAULT false, status text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_tenant_time_idx ON jarvis.leads(tenant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS jarvis.audit (
 evidence_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id text NOT NULL, session_id varchar(70) NOT NULL,
 event text NOT NULL, detail_json jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_tenant_evidence_idx ON jarvis.audit(tenant_id,evidence_id DESC);
ALTER TABLE jarvis.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE jarvis.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE jarvis.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE jarvis.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE jarvis.leads FORCE ROW LEVEL SECURITY;
ALTER TABLE jarvis.audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jarvis_sessions_tenant ON jarvis.sessions;
DROP POLICY IF EXISTS jarvis_leads_tenant ON jarvis.leads;
DROP POLICY IF EXISTS jarvis_audit_tenant ON jarvis.audit;
CREATE POLICY jarvis_sessions_tenant ON jarvis.sessions FOR ALL
 USING (tenant_id = current_setting('app.tenant_id',true))
 WITH CHECK (tenant_id = current_setting('app.tenant_id',true));
CREATE POLICY jarvis_leads_tenant ON jarvis.leads FOR ALL
 USING (tenant_id = current_setting('app.tenant_id',true))
 WITH CHECK (tenant_id = current_setting('app.tenant_id',true));
CREATE POLICY jarvis_audit_tenant ON jarvis.audit FOR ALL
 USING (tenant_id = current_setting('app.tenant_id',true))
 WITH CHECK (tenant_id = current_setting('app.tenant_id',true));
GRANT USAGE ON SCHEMA jarvis TO jarvis_runtime;
GRANT SELECT,INSERT,UPDATE ON jarvis.sessions,jarvis.leads TO jarvis_runtime;
GRANT SELECT,INSERT ON jarvis.audit TO jarvis_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA jarvis TO jarvis_runtime;
COMMIT;
