"""Read-only provider audit assertions; no provider access in this test module."""
import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock
from proxy_scope_readonly import audit_provider_readonly

APP="lifeline-mt5-analytics-isolated"
STORE1="lifeline-mt5-neon-stage-unwrap-key-20261021"
STORE2="lifeline-mt5-bridge-probe-20261021"

def fake_modal(*,billed="0",metered="0.3",url="https://lifeline-a.modal.run/",
               tokens=2,stores=None,environments=None):
    budget=SimpleNamespace(billed_cost=Decimal(billed),metered_cost=Decimal(metered))
    workspace=SimpleNamespace(
        billing=SimpleNamespace(summary=Mock(return_value=budget)),
        proxy_tokens=SimpleNamespace(list=Mock(return_value=[SimpleNamespace(token_id="private-id-"+str(i)) for i in range(tokens)]),
                                     create=Mock(side_effect=AssertionError("creation forbidden"))))
    objects=SimpleNamespace(list=Mock(return_value=[SimpleNamespace(name=x) for x in (
        ["default","team-private"] if environments is None else environments)]))
    secrets=SimpleNamespace(list=Mock(return_value=[SimpleNamespace(name=x) for x in
        ([STORE1,STORE2] if stores is None else stores)]))
    function=SimpleNamespace(get_web_url=Mock(return_value=url),remote=Mock(side_effect=AssertionError("no remote")))
    function_api=SimpleNamespace(from_name=Mock(return_value=function))
    modal=SimpleNamespace(Workspace=SimpleNamespace(from_context=Mock(return_value=workspace)),
                          Environment=SimpleNamespace(objects=objects),
                          Secret=SimpleNamespace(objects=secrets),Function=function_api)
    return modal,workspace,function

class ScopeReadOnlyTests(unittest.TestCase):
    def test_provider_metadata_does_not_authorize_proxy_cutover(self):
        modal,workspace,function=fake_modal()
        report=audit_provider_readonly(modal)
        self.assertTrue(report["workspace_billed_zero_at_check"])
        self.assertFalse(report["environment_level_proxy_scope_verified"])
        self.assertFalse(report["private_backend_cutover_authorized"])
        self.assertEqual(report["workspace_environment_count"],2)
        self.assertEqual(report["existing_proxy_token_count"],2)
        self.assertNotIn("private-id",str(report))
        workspace.proxy_tokens.create.assert_not_called()
        function.remote.assert_not_called()
    def test_free_plan_is_not_assumed_to_have_rbac_even_with_one_environment(self):
        modal,*_=fake_modal(environments=["default"],tokens=0)
        report=audit_provider_readonly(modal)
        self.assertFalse(report["free_starter_proxy_token_isolation_verified"])
    def test_positive_billed_cost_fails_closed(self):
        for amount in ("0.01","30","NaN","Infinity"):
            modal,*_=fake_modal(billed=amount)
            with self.assertRaisesRegex(RuntimeError,"evidence unavailable"):
                audit_provider_readonly(modal)
    def test_metered_over_guard_fails_closed(self):
        modal,*_=fake_modal(metered="6")
        with self.assertRaises(RuntimeError):audit_provider_readonly(modal)
    def test_untrusted_modal_origin_fails_closed(self):
        for url in ("https://evil.example/","http://lifeline.modal.run/",
                    "https://lifeline.modal.run/?api=key","https://alice:pwd@lifeline.modal.run"):
            modal,*_=fake_modal(url=url)
            with self.assertRaises(RuntimeError):audit_provider_readonly(modal)
    def test_missing_named_secret_store_fails_closed(self):
        modal,*_=fake_modal(stores=[STORE1])
        with self.assertRaises(RuntimeError):audit_provider_readonly(modal)
    def test_zero_environments_fails_closed(self):
        modal,*_=fake_modal(environments=[])
        with self.assertRaises(RuntimeError):audit_provider_readonly(modal)
    def test_provider_api_unexpectedly_exposes_secret_fails_closed(self):
        modal,workspace,_=fake_modal()
        workspace.proxy_tokens.list.return_value=[SimpleNamespace(token_secret="DO_NOT_LOG")]
        with self.assertRaises(RuntimeError) as cx:audit_provider_readonly(modal)
        self.assertNotIn("DO_NOT_LOG",str(cx.exception))

if __name__=="__main__":unittest.main()
