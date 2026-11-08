BEGIN;
CREATE SCHEMA musitu_identity;
REVOKE ALL ON SCHEMA musitu_identity FROM PUBLIC;
CREATE TABLE musitu_identity.sessions(
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 encrypted_payload text NOT NULL CHECK(length(encrypted_payload)<=20000),
 expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false
);
ALTER TABLE musitu_identity.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE musitu_identity.sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY session_boundary ON musitu_identity.sessions
 USING(token_hash=NULLIF(current_setting('app.session_hash',true),''))
 WITH CHECK(token_hash=NULLIF(current_setting('app.session_hash',true),''));
REVOKE ALL ON musitu_identity.sessions FROM PUBLIC;
GRANT USAGE ON SCHEMA musitu_identity TO musitu_runtime;
GRANT SELECT,INSERT ON musitu_identity.sessions TO musitu_runtime;
GRANT UPDATE(revoked) ON musitu_identity.sessions TO musitu_runtime;
COMMIT;
