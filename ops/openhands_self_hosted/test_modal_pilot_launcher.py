"""S3 Modal provisioning gateway tests, using a fake SDK; never contacts Modal."""
import hashlib
import hmac
import json
import unittest

from modal_pilot_spec import plan_pilot
from modal_pilot_launcher import launch_approved_pilot, ProvisioningNotAuthorized

KEY=b'independent-fa11-security-authorization-key'
IMAGE='ghcr.io/openhands/agent-server@sha256:'+'a'*64


class FakeSandbox:
    def __init__(self):
        self.object_id='sb-test-opaque-id'
        self.terminated=False
    def poll(self):
        return 0 if self.terminated else None
    def terminate(self,wait=False):
        self.terminated=True


class FakeModalSDK:
    class Sandbox:
        calls=[]
        active=None
        @classmethod
        def create(cls,*args,**kwargs):
            cls.calls.append((args,kwargs))
            cls.active=FakeSandbox()
            return cls.active


def authorized(plan, **changes):
    a={
       'schema':'musitu.axiom.trackb.modal-provision-approval.v1',
       'plan_sha256':plan['plan_sha256'],
       'risk_class':'S3',
       'operation':'PROVISION_ISOLATED_MODAL_SANDBOX',
       'builder_id':'axiom-builder-identity',
       'independent_human_approver_id':'separate-human-approver',
       'not_before_unix':1000,
       'expires_unix':1050,
       'production_authority':False,
       'release_authority':False,
       'certification_authority':False,
    }
    a.update(changes)
    return a


def signature(a):
    return hmac.new(KEY,json.dumps(a,sort_keys=True,separators=(',',':')).encode(),
                    hashlib.sha256).hexdigest()


class LauncherTests(unittest.TestCase):
    def setUp(self):
        FakeModalSDK.Sandbox.calls=[]
        self.plan=plan_pilot(
            tenant_id='tenant_alpha',project_id='project_alpha',work_id='work_alpha',
            workload_id='worker_alpha',image=IMAGE,ingress_cidr='8.8.8.8/32')
        self.image=object()
        self.app=object()
        self.ephemeral_session=object()

    def launch(self, approval=None, sig=None, plan=None):
        approval=authorized(self.plan) if approval is None else approval
        return launch_approved_pilot(
            plan=self.plan if plan is None else plan,
            approval=approval,
            signature=signature(approval) if sig is None else sig,
            independent_signing_key=KEY, modal_sdk=FakeModalSDK,
            isolated_app=self.app,pinned_image=self.image,
            ephemeral_session_secret=self.ephemeral_session,
            clock=lambda:1020)

    def test_exact_authorized_spec_and_opaque_secret_handle_only(self):
        receipt=self.launch()
        self.assertEqual(len(FakeModalSDK.Sandbox.calls),1)
        args,kwargs=FakeModalSDK.Sandbox.calls[0]
        self.assertEqual(args,tuple(self.plan['command']))
        self.assertIs(kwargs['app'],self.app)
        self.assertIs(kwargs['image'],self.image)
        self.assertEqual(kwargs['secrets'],[self.ephemeral_session])
        self.assertEqual(kwargs['inbound_cidr_allowlist'],['8.8.8.8/32'])
        self.assertEqual(kwargs['outbound_domain_allowlist'],[])
        self.assertEqual(receipt['sandbox_id'],'sb-test-opaque-id')
        self.assertEqual(receipt['external_action_executed'],True)
        self.assertEqual(receipt['live_runtime_qualification'],'NOT_PROVEN')
        self.assertFalse(receipt['production_authority'])
        self.assertNotIn('ephemeral_session',repr(receipt))

    def test_tamper_or_bad_signature_blocks_before_create(self):
        for approval,sig in [
            (authorized(self.plan,plan_sha256='f'*64),None),
            (authorized(self.plan,production_authority=True),None),
            (authorized(self.plan,risk_class='S4'),None),
            (authorized(self.plan,independent_human_approver_id='axiom-builder-identity'),None),
            (authorized(self.plan,expires_unix=1019),None),
            (authorized(self.plan,expires_unix=2000),None),
            (authorized(self.plan), 'f'*64),
        ]:
            with self.subTest(approval=approval),self.assertRaises(ProvisioningNotAuthorized):
                self.launch(approval,sig)
        self.assertEqual(FakeModalSDK.Sandbox.calls,[])

    def test_changed_resources_in_plan_blocked_even_if_digest_unchanged(self):
        tampered={**self.plan,'sandbox_kwargs':{**self.plan['sandbox_kwargs'],'cpu':(100,100)}}
        with self.assertRaises(ProvisioningNotAuthorized):
            self.launch(plan=tampered)
        self.assertEqual(FakeModalSDK.Sandbox.calls,[])

    def test_no_secret_handle_blocks_spending(self):
        with self.assertRaises(ProvisioningNotAuthorized):
            launch_approved_pilot(
                plan=self.plan,approval=authorized(self.plan),
                signature=signature(authorized(self.plan)),independent_signing_key=KEY,
                modal_sdk=FakeModalSDK,isolated_app=self.app,
                pinned_image=self.image,ephemeral_session_secret=None,clock=lambda:1020)
        self.assertEqual(FakeModalSDK.Sandbox.calls,[])


if __name__=='__main__':
    unittest.main()
