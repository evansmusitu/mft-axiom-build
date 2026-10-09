"""Crash/restart and concurrent admission regression for the isolated S0 ledger."""
import tempfile
import unittest
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from durable_scheduler import DurableS0Scheduler, LeaseDenied, TerminationUnverified

class DurableTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'state.sqlite3'
        self.now=1000.0
    def new(self):
        return DurableS0Scheduler(self.path,max_active=4,max_per_tenant=2,
                                   ttl_seconds=30,clock=lambda:self.now)
    def req(self,idx=0,tenant='alpha',**k):
        d={'schema':'musitu.axiom.trackb.s0-worker-request.v1',
           'tenant_id':tenant,'work_id':'work_'+str(idx),
           'workload_identity_id':'identity_'+tenant,
           'request_sha256':f'{idx+1:064x}',
           'worker_name':f'axiom-openhands-{idx:08d}',
           'risk_class':'S0','operation':'B1_ISOLATED_CONTAINER_SMOKE'}
        d.update(k)
        return d
    def test_persists_replay_and_cross_tenant_reject(self):
        a=self.new().acquire(self.req())
        self.assertEqual(self.new().acquire(self.req()),a)
        self.assertEqual(a['state'],'ACTIVE')
        self.assertFalse(a['production_authority'])
        with self.assertRaises(LeaseDenied):self.new().acquire(self.req(tenant='beta'))
    def test_multi_instance_parallel_cap_at_four(self):
        def act(n):
            try:return self.new().acquire(self.req(n,tenant=f'tenant{n}'))
            except LeaseDenied:return None
        with ThreadPoolExecutor(max_workers=12) as pool:
            out=list(pool.map(act,range(20)))
        self.assertEqual(sum(x is not None for x in out),4)
        self.assertEqual(self.new().active_count(),4)
    def test_per_tenant_cap_two(self):
        a=self.new()
        a.acquire(self.req(0))
        a.acquire(self.req(1))
        with self.assertRaises(LeaseDenied):a.acquire(self.req(2))
    def test_reject_s3_unsafe_identity_ttl(self):
        a=self.new()
        for d in (self.req(risk_class='S3'),self.req(operation='repository.write'),
                  self.req(tenant_id='../alice'),self.req(request_sha256='weak'),
                  self.req(extra='unknown')):
            with self.subTest(d=d),self.assertRaises(LeaseDenied):a.acquire(d)
        self.assertFalse(self.path.exists())
    def test_crash_recovery_revocation_releases_only_after_independent_readback(self):
        self.new().acquire(self.req())
        removed=[]
        self.now=1031
        records=self.new().reap_expired(terminate=lambda name:removed.append(name),
                                        verify_absent=lambda name:name in removed)
        self.assertEqual(len(records),1)
        self.assertEqual(records[0]['state'],'TERMINATED')
        self.assertEqual(self.new().active_count(),0)
        self.assertEqual(removed,['axiom-openhands-00000000'])
        self.new().acquire(self.req(1))
    def test_failed_termination_retains_slot_then_retries(self):
        one=DurableS0Scheduler(self.path,max_active=1,max_per_tenant=1,
                                ttl_seconds=30,clock=lambda:self.now)
        a=one.acquire(self.req())
        with self.assertRaises(TerminationUnverified):
            one.release(a['lease_id'],'alpha',terminate=lambda name:None,
                        verify_absent=lambda name:False)
        self.assertEqual(one.active_count(),1)
        with self.assertRaises(LeaseDenied):one.acquire(self.req(1,tenant='beta'))
        removed=[]
        r=self.new().release(a['lease_id'],'alpha',
                              terminate=lambda name:removed.append(name),
                              verify_absent=lambda name:name in removed)
        self.assertEqual(r['state'],'TERMINATED')
    def test_cross_tenant_revoke_denied(self):
        a=self.new().acquire(self.req())
        called=[]
        with self.assertRaises(LeaseDenied):
            self.new().release(a['lease_id'],'victim',
                               terminate=lambda name:called.append(name),
                               verify_absent=lambda name:True)
        self.assertEqual(called,[])

if __name__=='__main__':unittest.main()
