"""Offline acceptance of the deny-all, idempotent Access application bootstrap."""
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

F=Path(__file__).parent/"access_hold_bootstrap.py"
spec=importlib.util.spec_from_file_location("hold_module",F)
hold=importlib.util.module_from_spec(spec)
spec.loader.exec_module(hold)
IDENT="11111111-2222-4333-8444-555555555555"

class Reply:
    status=200
    def __init__(self,fields):
        self.body=json.dumps({"success":True,**fields}).encode()
    def __enter__(self):return self
    def __exit__(self,*a):return False
    def read(self,n):return self.body

class Cloudflare:
    def __init__(self):
        self.calls=[]
        self.apps=[]
        self.policy=[]
        self.account=hold.ACCOUNT
        self.fail_at=0
        self.public_rewrites=[]
    def __call__(self,request,timeout=18):
        method,url=request.get_method(),request.full_url
        payload=json.loads(request.data) if request.data else None
        self.calls.append((method,url,payload))
        if len(self.calls)==self.fail_at:return Reply({"success":False,"result":None})
        if method=="GET" and "/zones?" in url:
            return Reply({"result":[{"name":hold.DOMAIN,"status":"active",
                                      "account":{"id":self.account}}]})
        base=f"/accounts/{hold.ACCOUNT}/access/apps"
        assert base in url, (method,url)
        if method=="GET" and url.endswith("apps?page=1&per_page=100"):
            return Reply({"result":self.apps,
                          "result_info":{"total_count":len(self.apps)}})
        if method=="POST" and url.endswith(base):
            assert payload and payload["type"]=="self_hosted"
            assert payload["policies"]==[]
            assert payload["domain"]==hold.HOST
            assert payload["app_launcher_visible"] is False
            assert payload["allow_authenticate_via_warp"] is False
            assert payload["options_preflight_bypass"] is False
            self.apps.append(self.make_app())
            return Reply({"result":self.apps[-1]})
        if method=="GET" and url.endswith(f"/{IDENT}"):
            return Reply({"result":self.apps[-1]})
        if method=="GET" and url.endswith(f"/{IDENT}/policies"):
            return Reply({"result":self.policy})
        raise AssertionError((method,url))
    def make_app(self,**updates):
        return {"id":IDENT,"aud":"a-long-verified-audience-id","name":hold.APP_NAME,
                "domain":hold.HOST,"type":"self_hosted","app_launcher_visible":False,
                "allow_authenticate_via_warp":False,"options_preflight_bypass":False,
                **updates}
    @property
    def posts(self):return [x for x in self.calls if x[0]=="POST"]

class Tests(unittest.TestCase):
    def test_can_create_exactly_one_denied_private_app_and_readback_policies(self):
        cf=Cloudflare()
        result=hold.bootstrap("not-a-real-token",opener=cf)
        self.assertEqual(result["state"],"CREATED_DENY_ALL")
        self.assertEqual(result["access_policies"],0)
        self.assertFalse(result["mfa_verified"])
        self.assertEqual(len(cf.posts),1)
        self.assertEqual(cf.posts[0][2]["policies"],[])
        self.assertNotIn("workspace.mftintelligence.com",cf.posts[0][1])
    def test_existing_properly_denied_app_never_changes(self):
        cf=Cloudflare()
        cf.apps=[cf.make_app()]
        result=hold.bootstrap("mock",opener=cf)
        self.assertEqual(result["state"],"EXISTS_DENY_ALL")
        self.assertEqual(cf.posts,[])
    def test_wrong_account_and_zone_denied_before_any_write(self):
        cf=Cloudflare();cf.account="unknown-account"
        with self.assertRaisesRegex(hold.HoldBlocked,"ACCOUNT_ZONE"):
            hold.bootstrap("mock",opener=cf)
        self.assertEqual(cf.posts,[])
    def test_existing_other_app_on_hostname_denied_without_changes(self):
        cf=Cloudflare()
        cf.apps=[cf.make_app(name="other unrelated existing app")]
        with self.assertRaisesRegex(hold.HoldBlocked,"COLLISION"):
            hold.bootstrap("mock",opener=cf)
        self.assertEqual(cf.posts,[])
    def test_overlapping_access_app_destinations_and_wildcards_block(self):
        for value in ("*.mftintelligence.com","https://workspace.mftintelligence.com/account"):
            cf=Cloudflare()
            cf.apps=[cf.make_app(domain="other.example.com",
                                 destinations=[{"type":"public","uri":value}])]
            with self.assertRaisesRegex(hold.HoldBlocked,"COLLISION"):
                hold.bootstrap("mock",opener=cf)
            self.assertEqual(cf.posts,[])
    def test_allow_or_bypass_policy_at_readback_blocks_qualification(self):
        for decision in ("allow","bypass","service_auth","deny"):
            cf=Cloudflare()
            cf.apps=[cf.make_app()]
            cf.policy=[{"decision":decision,"include":[{"everyone":{}}]}]
            with self.assertRaisesRegex(hold.HoldBlocked,"ACCESS_POLICY_NOT_EMPTY"):
                hold.bootstrap("mock",opener=cf)
            self.assertEqual(cf.posts,[])
    def test_created_app_must_readback_no_policy(self):
        cf=Cloudflare();cf.policy=[{"decision":"allow","include":[{"everyone":{}}]}]
        with self.assertRaisesRegex(hold.HoldBlocked,"ACCESS_POLICY_NOT_EMPTY"):
            hold.bootstrap("mock",opener=cf)
        self.assertEqual(len(cf.posts),1) # deliberately do not retry or auto-modify
    def test_api_error_prevents_write_and_no_auto_retry(self):
        cf=Cloudflare();cf.fail_at=2
        with self.assertRaisesRegex(hold.HoldBlocked,"API_REJECTED"):
            hold.bootstrap("mock",opener=cf)
        self.assertEqual(cf.posts,[])
    def test_response_without_false_stays_blocked(self):
        for key in ("allow_authenticate_via_warp","options_preflight_bypass","app_launcher_visible"):
            cf=Cloudflare();cf.apps=[cf.make_app(**{key:True})]
            with self.assertRaisesRegex(hold.HoldBlocked,"APP_READBACK_NOT_DENY_ONLY"):
                hold.bootstrap("mock",opener=cf)
            self.assertEqual(cf.posts,[])
    def test_credential_scope_must_match_canonical_apps_only(self):
        cf=Cloudflare()
        for path,method in [
            ("/accounts/wrong/access/apps","POST"),
            (f"/accounts/{hold.ACCOUNT}/access/apps/{IDENT}","POST"),
            (f"/accounts/{hold.ACCOUNT}/access/policies","POST"),
            ("/zones?name=mftintelligence.com","POST"),
        ]:
            with self.assertRaises(hold.HoldBlocked):
                hold.api(method,path,"mock",{},opener=cf)
        self.assertEqual(cf.calls,[])
    def test_guarded_entrypoint_refuses_implicit_creation(self):
        for env in ({},{'EXPECTED_ACCOUNT_ID':hold.ACCOUNT,
                       'EXPECTED_DOMAIN':hold.DOMAIN},
                    {'MUSITU_ACCESS_HOLD_INTENT':"CREATE_DENY_ALL_ONLY"}):
            with patch.dict("os.environ",env,clear=True):
                self.assertEqual(hold.main(),2)

if __name__=="__main__":
    unittest.main()
