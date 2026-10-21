"""Offline negative cases for the Access-denied, unrouted Worker deployment."""
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location("disabled_deploy_gate",HERE/"disabled_deploy_gate.py")
import sys
sys.path.insert(0,str(HERE))
gate=importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
ID="11111111-2222-4333-8444-555555555555"

class Reply:
    status=200
    def __init__(self,result,extra=None):
        self.content=json.dumps({"success":True,"result":result,**(extra or {})}).encode()
    def read(self,n):return self.content
    def __enter__(self):return self
    def __exit__(self,*args):return False

class Cloudflare:
    def __init__(self):
        self.hold={
            "id":ID,"aud":"example-long-app-audience","type":"self_hosted",
            "domain":gate.HOST,"name":gate.APP_NAME,"app_launcher_visible":False,
            "allow_authenticate_via_warp":False,"options_preflight_bypass":False}
        self.app_policies=[]
        self.workers=[]
        self.subdomain={"enabled":False,"previews_enabled":False}
        self.calls=[]
        self.account=gate.ACCOUNT
    def __call__(self,request,timeout=18):
        url=request.full_url
        self.calls.append((request.get_method(),url))
        if request.get_method()!="GET":raise AssertionError("Unexpected write: "+url)
        if "/zones?" in url:
            return Reply([{"name":gate.DOMAIN,"status":"active","account":{"id":self.account}}])
        if url.endswith("/access/apps?page=1&per_page=100"):
            return Reply([self.hold],{"result_info":{"total_count":1}})
        if url.endswith("/access/apps/"+ID):return Reply(self.hold)
        if url.endswith("/access/apps/"+ID+"/policies"):return Reply(self.app_policies)
        if url.endswith("/workers/scripts"):return Reply(self.workers,{"result_info":{"total_count":len(self.workers)}})
        if url.endswith("/workers/scripts/"+gate.WORKER+"/subdomain"):return Reply(self.subdomain)
        raise AssertionError("Unexpected URL: "+url)
    def assert_reads_only(self,test):
        test.assertTrue(self.calls)
        test.assertTrue(all(method=="GET" for method,_ in self.calls))

class TestDisabledWorkerGate(unittest.TestCase):
    def test_preflight_accepts_only_a_new_script_and_exact_deny_all_access(self):
        f=Cloudflare()
        r=gate.qualify("preflight","fake",opener=f)
        self.assertEqual(r["status"],"PRIVATE_DISABLED_DEPLOY_PREFLIGHT")
        self.assertTrue(r["can_deploy_new_script"])
        self.assertFalse(r["service_enabled"])
        f.assert_reads_only(self)
    def test_preflight_denies_existing_script_to_avoid_replacement(self):
        f=Cloudflare();f.workers=[{"id":gate.WORKER}]
        with self.assertRaisesRegex(gate.HoldBlocked,"WORKER_NAME_ALREADY_OCCUPIED"):
            gate.qualify("preflight","fake",opener=f)
        f.assert_reads_only(self)
    def test_postdeploy_needs_unique_script_and_private_no_preview(self):
        f=Cloudflare();f.workers=[{"id":gate.WORKER}]
        result=gate.qualify("postdeploy","fake",opener=f)
        self.assertEqual(result["status"],"PRIVATE_DISABLED_DEPLOY_READBACK")
        self.assertFalse(result["workers_dev_enabled"])
        self.assertFalse(result["preview_urls_enabled"])
        f.assert_reads_only(self)
    def test_public_workers_dev_or_preview_fails_readback(self):
        for value in ({"enabled":True,"previews_enabled":False},
                      {"enabled":False,"previews_enabled":True}):
            f=Cloudflare();f.workers=[{"id":gate.WORKER}];f.subdomain=value
            with self.assertRaisesRegex(gate.HoldBlocked,"WORKER_SUBDOMAIN_OR_PREVIEW_EXPOSED"):
                gate.qualify("postdeploy","fake",opener=f)
            f.assert_reads_only(self)
    def test_postdeploy_missing_worker_fails_closed(self):
        f=Cloudflare()
        with self.assertRaisesRegex(gate.HoldBlocked,"WORKER_NOT_UNIQUELY_CREATED"):
            gate.qualify("postdeploy","fake",opener=f)
    def test_existing_allow_and_bypass_policy_never_qualify(self):
        for choice in ("allow","bypass","service_auth"):
            f=Cloudflare();f.app_policies=[{"decision":choice}]
            with self.assertRaisesRegex(gate.HoldBlocked,"ACCESS_POLICY_NOT_EMPTY"):
                gate.qualify("preflight","fake",opener=f)
            f.assert_reads_only(self)
    def test_wrong_zone_account_fails_before_script_lookup(self):
        f=Cloudflare();f.account="another-cloudflare-account"
        with self.assertRaisesRegex(gate.HoldBlocked,"ACCOUNT_ZONE_MISMATCH"):
            gate.qualify("preflight","fake",opener=f)
        self.assertFalse(any("/workers/scripts" in u for _,u in f.calls))
    def test_unexpected_duplicate_access_name_fails_closed(self):
        f=Cloudflare();f.hold["name"]="Unrecognized Access application"
        with self.assertRaisesRegex(gate.HoldBlocked,"ACCESS_HOLD_NOT_UNIQUE"):
            gate.qualify("preflight","fake",opener=f)
    def test_scope_guards_for_workers_no_writes(self):
        f=Cloudflare()
        with self.assertRaisesRegex(gate.HoldBlocked,"WORKER_API_SCOPE_DENIED"):
            gate.workers_get("/accounts/wrong/workers/scripts","fake",opener=f)
        self.assertEqual(f.calls,[])
    def test_no_env_guard_or_missing_credential_never_attempts_live_read(self):
        for env in ({},{"EXPECTED_ACCOUNT_ID":gate.ACCOUNT,"EXPECTED_DOMAIN":gate.DOMAIN},
                    {"WORKSPACE_DISABLE_DEPLOY_INTENT":"CREATE_UNROUTED_DISABLED_ONLY"}):
            with patch.dict("os.environ",env,clear=True):
                self.assertEqual(gate.main(),2)

if __name__=="__main__":
    unittest.main()
