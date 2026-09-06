#!/usr/bin/env python3
"""Create the additive MUSITU Axiom OAuth UserInfo candidate.

The patch is deliberately anchor-based and fails before producing a candidate if the
canonical OAuth source has drifted. It never reads or writes credentials.
"""
from __future__ import annotations

import pathlib
import sys


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return source.replace(old, new, 1)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: patch_oauth_userinfo.py SOURCE OUTPUT")
    src = pathlib.Path(sys.argv[1])
    out = pathlib.Path(sys.argv[2])
    source = src.read_text()

    source = replace_once(
        source,
        'const SCOPES=new Set(["axiom.execute","billing.read","billing.write"]);',
        'const SCOPES=new Set(["axiom.execute","billing.read","billing.write","openid","email"]);',
        "scope-set",
    )

    source = replace_once(
        source,
        'revocation_endpoint:c.issuer+"/oauth/revoke",response_types_supported:',
        'revocation_endpoint:c.issuer+"/oauth/revoke",userinfo_endpoint:c.issuer+"/oauth/userinfo",response_types_supported:',
        "discovery-userinfo",
    )

    userinfo = r'''function bearer(req){const a=req.headers.get("authorization")||"";return a.startsWith("Bearer ")&&a.length>12?a.slice(7):""}
function scopeSet(raw){return new Set(String(raw||"").split(/\s+/).filter(Boolean))}
async function userinfo(req,c){const tok=bearer(req);if(!tok)return j(401,{error:"invalid_token"},{"www-authenticate":'Bearer error="invalid_token"'});const h=await sha256(tok),now=iso();const row=await one(c.db,"SELECT a.customer_id,a.issuer,a.resource,a.scope,a.expires_at,a.revoked_at,k.status AS key_status,k.expires_at AS key_expires,k.revoked_at AS key_revoked,cu.email,i.email_verified_at FROM oauth_access_tokens a JOIN api_keys k ON k.id=a.api_key_id JOIN customers cu ON cu.id=a.customer_id LEFT JOIN oauth_identity_claims i ON i.customer_id=a.customer_id WHERE a.token_hash=?1 LIMIT 1",[h]);if(!row||row.revoked_at||row.key_revoked||row.key_status!=="active"||row.expires_at<=now||(row.key_expires&&row.key_expires<=now)||row.issuer!==c.issuer||row.resource!==c.resource)return j(401,{error:"invalid_token"},{"www-authenticate":'Bearer error="invalid_token"'});const ss=scopeSet(row.scope);if(!ss.has("openid")||!ss.has("email"))return j(403,{error:"insufficient_scope"},{"www-authenticate":'Bearer error="insufficient_scope", scope="openid email"'});const sub=await sha256(c.issuer+"\n"+row.customer_id),mail=String(row.email||"");return j(200,{sub,email:mail,email_verified:Boolean(mail&&row.email_verified_at)})}
'''
    source = replace_once(
        source,
        "async function revoke(req,c){",
        userinfo + "async function revoke(req,c){",
        "userinfo-function",
    )

    source = replace_once(
        source,
        'if(u.pathname==="/oauth/revoke"&&req.method==="POST")return revoke(req,c);',
        'if(u.pathname==="/oauth/userinfo"&&(req.method==="GET"||req.method==="POST"))return userinfo(req,c);if(u.pathname==="/oauth/revoke"&&req.method==="POST")return revoke(req,c);',
        "userinfo-route",
    )

    source = replace_once(
        source,
        'pkce_s256:true,public_client_token_auth:"none",registered_clients:',
        'pkce_s256:true,userinfo:true,identity_scopes:["openid","email"],public_client_token_auth:"none",registered_clients:',
        "health-userinfo",
    )

    required = [
        '"openid","email"',
        'userinfo_endpoint:c.issuer+"/oauth/userinfo"',
        'async function userinfo(req,c)',
        'u.pathname==="/oauth/userinfo"',
        'email_verified:Boolean(mail&&row.email_verified_at)',
        'scope="openid email"',
    ]
    missing = [item for item in required if item not in source]
    if missing:
        raise SystemExit("candidate verification failed: " + " | ".join(missing))

    out.write_text(source)
    print("MUSITU_OAUTH_USERINFO_CANDIDATE_READY")


if __name__ == "__main__":
    main()
