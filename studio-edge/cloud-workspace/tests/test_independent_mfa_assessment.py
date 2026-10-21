"""Negative-first mock of read-only Cloudflare independent MFA assessment."""
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

HERE=Path(__file__).parent
sys.path.insert(0,str(HERE))
spec=importlib.util.spec_from_file_location("mfa",HERE/"independent_mfa_assessment.py")
mfa=importlib.util.module_from_spec(spec);spec.loader.exec_module(mfa)
ID="11111111-2222-4333-8444-555555555555"

class Reply:
    status=200
    def __init__(self,result):
        self.data=json.dumps({"success":True,"result":result}).encode()
    def read(self,limit):return self.data
    def __enter__(self):return self
    def __exit__(self,*args):return False
class Api:
    def __init__(self,org_methods=None,app_mfa=None):
        self.calls=[]
        self.org={"auth_domain":"tenant.cloudflareaccess.com",
                  "mfa_config":{"allowed_authenticators":org_methods if org_methods is not None else []},
                  "mfa_required_for_all_apps":False,
                  "owner_email":"DO_NOT_EXPORT_OWNER@EXAMPLE.COM"}
        self.app={"id":ID,"aud":"valid_expected_audience","name":mfa.APP_NAME,"domain":mfa.HOST,
                  "type":"self_hosted","app_launcher_visible":False,
                  "allow_authenticate_via_warp":False,"options_preflight_bypass":False,
                  "mfa_config":app_mfa or {},
                  "contact_email":"DO_NOT_EXPORT_PRIVATE@EXAMPLE.COM"}
        self.policies=[]
    def __call__(self,req,timeout=18):
        url=req.full_url;self.calls.append((req.get_method(),url))
        assert req.get_method()=="GET",("unexpected write",url)
        if "/zones?" in url:return Reply([{"name":mfa.DOMAIN,"status":"active",
                                            "account":{"id":mfa.ACCOUNT}}])
        if url.endswith("/access/apps?page=1&per_page=100"):
            # Access hold requires full-page inventory.
            raw={"success":True,"result":[self.app],"result_info":{"total_count":1}}
            return BareReply(raw)
        if url.endswith("/access/apps/"+ID):return Reply(self.app)
        if url.endswith("/access/apps/"+ID+"/policies"):return Reply(self.policies)
        if url.endswith("/access/organizations"):return Reply(self.org)
        raise AssertionError("unexpected endpoint "+url)
class BareReply(Reply):
    def __init__(self,raw):self.data=json.dumps(raw).encode()

class TestIndependentMfa(unittest.TestCase):
    def test_org_and_app_controls_can_be_ready_but_never_assert_owner_login(self):
        api=Api(["totp","security_key"],{"mfa_disabled":False,
                                        "session_duration":"0m",
                                        "allowed_authenticators":["totp"]})
        result=mfa.inspect("fake-token",opener=api)
        self.assertTrue(result["organization_independent_mfa_available"])
        self.assertTrue(result["application_configuration_ready_for_owner_test"])
        self.assertFalse(result["owner_interactive_mfa_verified"])
        self.assertFalse(result["owner_access_allowed"])
        self.assertFalse(result["write_performed"])
        self.assertEqual([t for t,_ in api.calls],["GET"]*len(api.calls))
        output=json.dumps(result)
        self.assertNotIn("DO_NOT_EXPORT",output)
        self.assertNotIn("valid_expected_audience",output)
        self.assertEqual(result["owner_mfa_enrollment_url"],"https://tenant.cloudflareaccess.com/AddMfaDevice")
    def test_no_org_authenticators_never_meets_mfa_readiness(self):
        api=Api([],{"mfa_disabled":False,"session_duration":"0m"})
        result=mfa.inspect("fake",opener=api)
        self.assertFalse(result["organization_independent_mfa_available"])
        self.assertFalse(result["application_configuration_ready_for_owner_test"])
    def test_app_opt_out_never_counts_as_qualified(self):
        api=Api(["totp"],{"mfa_disabled":True,"session_duration":"0m"})
        r=mfa.inspect("fake",opener=api)
        self.assertFalse(r["application_mfa_not_disabled"])
        self.assertFalse(r["application_configuration_ready_for_owner_test"])
    def test_inherited_global_setting_not_alone_enough(self):
        api=Api(["totp"],{})
        api.org["mfa_required_for_all_apps"]=True
        r=mfa.inspect("fake",opener=api)
        self.assertTrue(r["organization_global_mfa_required"])
        self.assertFalse(r["application_explicit_mfa_enforced"])
        self.assertFalse(r["application_configuration_ready_for_owner_test"])
    def test_missing_app_policy_or_denied_access_is_fatal_not_success(self):
        api=Api(["totp"])
        api.policies=[{"decision":"allow"}]
        with self.assertRaisesRegex(mfa.HoldBlocked,"ACCESS_POLICY_NOT_EMPTY"):
            mfa.inspect("fake",opener=api)
    def test_bad_org_format_fails_closed(self):
        for config in ({"allowed_authenticators":"totp"},["totp"],
                       {"allowed_authenticators":[123]}):
            api=Api(["totp"])
            api.org["mfa_config"]=config
            with self.assertRaises(mfa.HoldBlocked):
                mfa.inspect("fake",opener=api)
    def test_wrong_org_team_domain_never_reports_mfa(self):
        api=Api(["totp"])
        api.org["auth_domain"]="untrusted.example.com"
        with self.assertRaisesRegex(mfa.HoldBlocked,"TEAM_DOMAIN_UNPROVEN"):
            mfa.inspect("fake",opener=api)
    def test_org_settings_are_never_mutated(self):
        api=Api(["totp"])
        mfa.inspect("fake",opener=api)
        self.assertTrue(all(method=="GET" for method,_ in api.calls))
    def test_wrong_account_and_missing_token_refuse_without_network(self):
        for env in ({},{"EXPECTED_ACCOUNT_ID":mfa.ACCOUNT},
                    {"CLOUDFLARE_API_TOKEN":"present"}):
            with patch.dict("os.environ",env,clear=True):
                self.assertEqual(mfa.main(),2)

if __name__=="__main__":unittest.main()
