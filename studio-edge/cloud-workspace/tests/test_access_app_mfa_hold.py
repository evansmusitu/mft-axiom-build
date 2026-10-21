"""Negative and idempotent guards for application-only independent MFA changes."""
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).parent
sys.path.insert(0,str(HERE))
spec=importlib.util.spec_from_file_location("mfa_hold",HERE/"access_app_mfa_hold.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
UID="11111111-2222-4333-8444-555555555555"

class Reply:
    status=200
    def __init__(self,body):
        self.body=json.dumps({"success":True,**body}).encode()
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def read(self,n):return self.body
class Cloudflare:
    def __init__(self):
        self.calls=[]
        self.org_methods=["totp","security_key"]
        self.zone=m.ACCOUNT
        self.policies=[]
        self.app={
            "allow_authenticate_via_warp":False,"allowed_idps":[],
            "app_launcher_visible":False,"aud":"expected-audience-value",
            "auto_redirect_to_identity":False,"created_at":"2026-10-20T01:00:00Z",
            "destinations":[],"domain":m.HOST,
            "eager_redirect_cookie_setting":False,"enable_binding_cookie":False,
            "http_only_cookie_attribute":True,
            "id":UID,"name":m.APP_NAME,
            "options_preflight_bypass":False,"policies":[],
            "self_hosted_domains":[],"session_duration":"15m",
            "tags":[],"type":"self_hosted","uid":UID,
            "updated_at":"2026-10-20T01:00:00Z"}
        self.mutate_other=False
    def __call__(self,req,timeout=18):
        url=req.full_url;method=req.get_method()
        data=json.loads(req.data) if req.data else None
        self.calls.append((method,url,data))
        if method=="GET" and "/zones?" in url:
            return Reply({"result":[{"name":m.DOMAIN,"account":{"id":self.zone},"status":"active"}]})
        if method=="GET" and url.endswith("/access/apps?page=1&per_page=100"):
            return Reply({"result":[self.app],"result_info":{"total_count":1}})
        if method=="GET" and url.endswith("/access/apps/"+UID):
            return Reply({"result":self.app})
        if method=="GET" and url.endswith("/access/apps/"+UID+"/policies"):
            return Reply({"result":self.policies})
        if method=="GET" and url.endswith("/access/organizations"):
            return Reply({"result":{"auth_domain":"team.cloudflareaccess.com",
                                    "mfa_config":{"allowed_authenticators":self.org_methods}}})
        if method=="PUT" and url.endswith("/access/apps/"+UID):
            assert data["mfa_config"]==m.MFA
            assert data["policies"]==[]
            assert all(name not in data for name in ("id","aud","uid","created_at","updated_at"))
            assert data["http_only_cookie_attribute"] is True
            assert data["options_preflight_bypass"] is False
            for key,val in data.items():
                if key=="mfa_config":self.app[key]=val
                else:self.app[key]=val
            if self.mutate_other:self.app["session_duration"]="99h"
            return Reply({"result":self.app})
        raise AssertionError((method,url))
    @property
    def puts(self):return [x for x in self.calls if x[0]=="PUT"]

class TestMfaHold(unittest.TestCase):
    def test_creates_stricter_app_mfa_once_without_allow_policy_or_org_change(self):
        cf=Cloudflare()
        output=m.harden("fake-token",opener=cf)
        self.assertEqual(output["state"],"APP_ONLY_MFA_RESTRICTED")
        self.assertFalse(output["owner_login_test_passed"])
        self.assertEqual(output["allow_policies"],0)
        self.assertFalse(output["organization_mfa_changed"])
        self.assertEqual(len(cf.puts),1)
        self.assertEqual(cf.app["mfa_config"],m.MFA)
        self.assertFalse(cf.app["app_launcher_visible"])
        self.assertTrue(all(x[0] in ("GET","PUT") for x in cf.calls))
    def test_repeated_invocation_is_read_only(self):
        cf=Cloudflare();cf.app["mfa_config"]=m.MFA.copy()
        state=m.harden("fake-token",opener=cf)
        self.assertEqual(state["state"],"ALREADY_MFA_RESTRICTED")
        self.assertEqual(cf.puts,[])
    def test_existing_nonmatching_mfa_blocks_without_write(self):
        cf=Cloudflare();cf.app["mfa_config"]={"mfa_disabled":True}
        with self.assertRaisesRegex(m.HoldBlocked,"MFA_CONFIG_ALREADY_SET_DIFFERENTLY"):
            m.harden("fake-token",opener=cf)
        self.assertEqual(cf.puts,[])
    def test_org_without_both_second_factors_blocks_without_write(self):
        cf=Cloudflare();cf.org_methods=["totp"]
        with self.assertRaisesRegex(m.HoldBlocked,"INDEPENDENT_MFA_NOT_ENABLED_AT_ORG"):
            m.harden("fake-token",opener=cf)
        self.assertEqual(cf.puts,[])
    def test_unknown_response_field_blocks_before_update(self):
        cf=Cloudflare();cf.app["unrecognized_new_security_option"]="value"
        with self.assertRaisesRegex(m.HoldBlocked,"UNKNOWN_ACCESS_APP_API_FIELDS"):
            m.harden("fake-token",opener=cf)
        self.assertEqual(cf.puts,[])
    def test_allow_bypass_or_service_auth_policy_blocks_before_put(self):
        for action in ["allow","bypass","service_auth"]:
            cf=Cloudflare();cf.policies=[{"decision":action}]
            with self.assertRaisesRegex(m.HoldBlocked,"ACCESS_POLICY_NOT_EMPTY"):
                m.harden("fake-token",opener=cf)
            self.assertEqual(cf.puts,[])
    def test_wrong_zone_account_cannot_modify_anything(self):
        cf=Cloudflare();cf.zone="different"
        with self.assertRaisesRegex(m.HoldBlocked,"ACCOUNT_ZONE_MISMATCH"):
            m.harden("fake-token",opener=cf)
        self.assertEqual(cf.puts,[])
    def test_unexpected_unrelated_field_mutation_causes_hard_readback_failure_no_retry(self):
        cf=Cloudflare();cf.mutate_other=True
        with self.assertRaisesRegex(m.HoldBlocked,"APP_OTHER_CONFIG_CHANGED"):
            m.harden("fake-token",opener=cf)
        self.assertEqual(len(cf.puts),1)
    def test_no_api_approval_guard_cannot_write(self):
        for env in ({},{"EXPECTED_ACCOUNT_ID":m.ACCOUNT,"EXPECTED_DOMAIN":m.DOMAIN},
                    {"MUSITU_ACCESS_MFA_HOLD_INTENT":"APP_ONLY_MFA_NO_ALLOW"}):
            with patch.dict("os.environ",env,clear=True):
                self.assertEqual(m.main(),2)

if __name__=="__main__":unittest.main()
