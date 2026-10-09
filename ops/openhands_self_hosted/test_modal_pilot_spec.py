"""Track B target-only Modal pilot planning tests, without any cloud account."""
import copy
import hashlib
import unittest

from modal_pilot_spec import plan_pilot, PilotPlanDenied

PINNED='ghcr.io/openhands/agent-server@sha256:' + 'a'*64


class ModalPilotPlanTests(unittest.TestCase):
    def create(self, **kwargs):
        base=dict(
            tenant_id='tenant_alpha',
            project_id='project_alpha',
            work_id='work_alpha',
            workload_id='worker_alpha',
            image=PINNED,
            ingress_cidr='8.8.8.8/32',
            cpu=1.0,
            memory_mib=2048,
            timeout_seconds=300,
        )
        base.update(kwargs)
        return plan_pilot(**base)

    def test_exact_resource_and_network_restrictions(self):
        plan=self.create()
        self.assertEqual(plan['schema'],'musitu.axiom.trackb.modal-pilot-spec.v1')
        kwargs=plan['sandbox_kwargs']
        self.assertEqual(kwargs['cpu'],(1.0,1.0))
        self.assertEqual(kwargs['memory'],(2048,2048))
        self.assertEqual(kwargs['timeout'],300)
        self.assertEqual(kwargs['idle_timeout'],120)
        self.assertEqual(kwargs['outbound_cidr_allowlist'],[])
        self.assertEqual(kwargs['outbound_domain_allowlist'],[])
        self.assertEqual(kwargs['inbound_cidr_allowlist'],['8.8.8.8/32'])
        self.assertEqual(kwargs['encrypted_ports'],[18765])
        self.assertEqual(kwargs['unencrypted_ports'],[])
        self.assertEqual(kwargs['secrets'],[])
        self.assertFalse(plan['production_authority'])
        self.assertFalse(plan['deployment_authorized'])
        self.assertEqual(plan['live_runtime_qualification'],'NOT_PROVEN')
        self.assertEqual(plan['image'],PINNED)
        self.assertIn('openhands.agent_server',plan['command'])

    def test_public_ingress_or_wildcard_not_accepted(self):
        for addr in ('0.0.0.0/0','::/0','10.0.0.1/8','127.0.0.1/8','2001:db8::/32','203.0.113.3','',None):
            with self.subTest(addr=addr),self.assertRaises(PilotPlanDenied):
                self.create(ingress_cidr=addr)

    def test_pinned_image_and_strict_limits_required(self):
        bad=[{'image':'ghcr.io/openhands/agent-server:latest'},
             {'image':'ghcr.io/openhands/agent-server@sha256:'+'x'*64},
             {'cpu':0},{'cpu':5},{'memory_mib':0},{'memory_mib':8192},
             {'timeout_seconds':0},{'timeout_seconds':3600},
             {'tenant_id':'../scope'},{'workload_id':'../../root'},
             {'project_id':'prod'},{'work_id':'work_alpha\nKEY=bad'}]
        for change in bad:
            with self.subTest(change=change),self.assertRaises(PilotPlanDenied):
                self.create(**change)

    def test_unique_scope_binds_sandbox_name(self):
        a=self.create()
        b=self.create(tenant_id='tenant_beta')
        self.assertNotEqual(a['sandbox_kwargs']['name'],b['sandbox_kwargs']['name'])
        self.assertTrue(a['sandbox_kwargs']['name'].startswith('axiom-oh-b1-'))
        self.assertEqual(a['plan_sha256'],hashlib.sha256(a['canonical_plan_json'].encode()).hexdigest())
        self.assertNotIn('secret',a['canonical_plan_json'].lower())

    def test_inert_spec_cannot_launch_modal_in_ci(self):
        a=self.create()
        self.assertEqual(a['required_next_gate'],'INDEPENDENT_S3_PROVISIONING_AUTHORIZATION')
        self.assertNotIn('app',a['sandbox_kwargs'])
        self.assertNotIn('image',a['sandbox_kwargs'])


if __name__=='__main__':
    unittest.main()
