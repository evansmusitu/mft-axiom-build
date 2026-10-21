"""Private, restricted Neon credential qualification via Modal's encrypted Secret.

No web endpoint, user query API, writes, broker operations, general SQL execution,
or database URL printing. This is a single internal acceptance function.
"""
from __future__ import annotations
import modal

app=modal.App("lifeline-mt5-neon-rls-probe-isolated")
image=(modal.Image.debian_slim(python_version="3.12")
       .pip_install("cryptography>=44,<47","psycopg[binary]>=3.2,<4")
       .add_local_file("products/lifeline-mt5-ai-studio/infra/modal/neon_envelope.json",
                       "/opt/lifeline/neon_envelope.json",copy=True))

@app.function(
    name="verify_restricted_role",image=image,
    secrets=[modal.Secret.from_name("lifeline-mt5-neon-stage-unwrap-key-20261021",
                                    required_keys=["RSA_PRIVATE_PEM_B64"])],
    cpu=0.125,memory=256,min_containers=0,max_containers=1,
    scaledown_window=10,timeout=40,
)
def verify_restricted_role():
    import base64, json, os
    from pathlib import Path
    from urllib.parse import urlsplit
    import psycopg
    from cryptography.hazmat.primitives import serialization, hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    try:
        sealed=json.loads(Path('/opt/lifeline/neon_envelope.json').read_text())
        if sealed.get("schema")!="lifeline.secret_envelope.rsa_oaep_sha256.v1":
            raise ValueError("unexpected envelope")
        key=serialization.load_pem_private_key(
            base64.b64decode(os.environ["RSA_PRIVATE_PEM_B64"]),password=None)
        plain=key.decrypt(base64.b64decode(sealed["ciphertext_b64"]),
              padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),
                  algorithm=hashes.SHA256(),label=None))
        dsn=plain.decode("utf-8")
        url=urlsplit(dsn)
        if (url.scheme!="postgresql" or
            url.username!="lifeline_stage_app" or
            url.hostname is None or not url.hostname.endswith(".neon.tech") or
            url.path!="/lifeline_mt5_stage" or
            url.fragment):
            raise ValueError("unexpected database identity")
        report={"schema":"lifeline.modal_neon_exact_login.v1",
                "connected":False,"restricted_role":False,
                "row_level_security":False,"tenant_isolation":False,
                "database_write_attempted":False,"live_trading":False,
                "credential_exposed":False}
        # Supplied sslmode='verify-full' OVERRIDES the URL's weaker 'require'.
        with psycopg.connect(dsn,sslmode="verify-full",connect_timeout=12,
                             autocommit=True,prepare_threshold=None) as conn:
            row=conn.execute("SELECT current_user, rolbypassrls, rolcreaterole, rolsuper "
                             "FROM pg_roles WHERE rolname=current_user").fetchone()
            if row is None or row[0]!="lifeline_stage_app" or any(row[1:]):
                raise ValueError("database role is privileged")
            report["restricted_role"]=True
            required=["lifeline.research_receipts","lifeline.agent_jobs","lifeline.agent_nonces"]
            if not all(conn.execute("SELECT row_security_active(%s::regclass)",(table,)).fetchone()[0]
                       for table in required):
                raise ValueError("tenant RLS missing")
            report["row_level_security"]=True
            def in_tenant(tenant):
                with conn.transaction():
                    conn.execute("SELECT set_config('lifeline.tenant_subject',%s,true)",(tenant,))
                    own=conn.execute("SELECT COUNT(*) FROM lifeline.agent_jobs WHERE tenant_subject=%s",
                                     (tenant,)).fetchone()[0]
                    outside=conn.execute("SELECT COUNT(*) FROM lifeline.agent_jobs WHERE tenant_subject<>%s",
                                     (tenant,)).fetchone()[0]
                    if outside!=0:
                        raise ValueError("cross tenant visibility")
                    return own
            a,b=in_tenant("test_tenant_A"),in_tenant("test_tenant_B")
            # Real test fixtures already exist from the previous Neon security pass.
            if a<1 or b<1:
                raise ValueError("tenant fixtures missing")
            report.update(connected=True,tenant_isolation=True,
                          tenant_a_synthetic_rows=a,tenant_b_synthetic_rows=b)
        return report
    except Exception:
        # Suppress underlying driver errors (which sometimes include connection URLs).
        raise RuntimeError("private Neon restricted-login qualification failed; inspect stage configuration") from None
