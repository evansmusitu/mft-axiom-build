"""Fail-closed S0 worker lifecycle tests; not a production admission proof."""
import unittest
from concurrent.futures import ThreadPoolExecutor
from worker_leases import LeaseScheduler, AdmissionDenied, RevocationFailed


class WorkerLeaseTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000.0
        self.removed = []
        self.fail_revoke = False

        def terminate(name):
            if self.fail_revoke:
                raise RuntimeError('termination denied')
            self.removed.append(name)

        self.scheduler = LeaseScheduler(max_active=2, max_per_tenant=1,
                                        ttl_seconds=30, clock=lambda: self.now,
                                        terminate=terminate)

    def request(self, tenant='alpha', work='work1', idem='a' * 64, risk='S0'):
        return dict(tenant_id=tenant, project_id='project1', work_id=work,
                    workload_identity_id='identity_' + tenant,
                    request_sha256=idem, risk_class=risk,
                    operation='B1_ISOLATED_CONTAINER_SMOKE')

    def test_requires_exact_scoped_s0_request(self):
        for request in (self.request(risk='S3'),
                        {**self.request(), 'operation': 'repo.write'},
                        {**self.request(), 'credential': 'secret'},
                        {**self.request(), 'tenant_id': '../../victim'},
                        {**self.request(), 'request_sha256': 'weak'}):
            with self.subTest(request=request), self.assertRaises(AdmissionDenied):
                self.scheduler.acquire(request, 'axiom-openhands-abc12345')
        self.assertEqual(self.scheduler.active_count, 0)

    def test_per_tenant_and_global_caps_without_overflow(self):
        a = self.scheduler.acquire(self.request(), 'axiom-openhands-abc12345')
        self.assertEqual(a['runtime_qualification'], 'NOT_PROVEN')
        with self.assertRaises(AdmissionDenied):
            self.scheduler.acquire(self.request(work='work2', idem='b'*64),
                                   'axiom-openhands-zzzzzzzz')
        b = self.scheduler.acquire(self.request(tenant='beta', idem='c'*64),
                                   'axiom-openhands-def67890')
        self.assertEqual(self.scheduler.active_count, 2)
        with self.assertRaises(AdmissionDenied):
            self.scheduler.acquire(self.request(tenant='gamma', idem='d'*64),
                                   'axiom-openhands-98765432')
        self.assertEqual(len({a['lease_id'], b['lease_id']}), 2)

    def test_idempotent_replay_and_conflict(self):
        a = self.scheduler.acquire(self.request(), 'axiom-openhands-abc12345')
        self.assertEqual(a, self.scheduler.acquire(self.request(), 'axiom-openhands-abc12345'))
        with self.assertRaises(AdmissionDenied):
            self.scheduler.acquire(self.request(tenant='beta'), 'axiom-openhands-def67890')
        self.assertEqual(self.scheduler.active_count, 1)

    def test_cross_tenant_release_refused(self):
        a = self.scheduler.acquire(self.request(), 'axiom-openhands-abc12345')
        with self.assertRaises(AdmissionDenied):
            self.scheduler.release(a['lease_id'], 'beta')
        self.assertEqual(self.removed, [])
        self.assertEqual(self.scheduler.active_count, 1)
        self.scheduler.release(a['lease_id'], 'alpha')
        self.assertEqual(self.removed, ['axiom-openhands-abc12345'])
        self.assertEqual(self.scheduler.active_count, 0)

    def test_expiry_requires_termination_before_slot_reuse(self):
        self.scheduler.acquire(self.request(), 'axiom-openhands-abc12345')
        self.now += 31
        self.scheduler.reap_expired()
        self.assertEqual(self.removed, ['axiom-openhands-abc12345'])
        self.assertEqual(self.scheduler.active_count, 0)
        self.scheduler.acquire(self.request(work='work2', idem='b'*64),
                               'axiom-openhands-def67890')

    def test_failed_termination_never_frees_capacity(self):
        a = self.scheduler.acquire(self.request(), 'axiom-openhands-abc12345')
        self.fail_revoke = True
        with self.assertRaises(RevocationFailed):
            self.scheduler.release(a['lease_id'], 'alpha')
        self.assertEqual(self.scheduler.active_count, 1)
        self.assertEqual(self.scheduler.state(a['lease_id'])['state'], 'TERMINATION_FAILED')
        with self.assertRaises(AdmissionDenied):
            self.scheduler.acquire(self.request(work='work2', idem='b'*64),
                                   'axiom-openhands-99999999')
        self.fail_revoke = False
        self.scheduler.release(a['lease_id'], 'alpha')
        self.assertEqual(self.scheduler.active_count, 0)

    def test_concurrent_admission_cannot_exceed_global_limit(self):
        def attempt(i):
            try:
                return self.scheduler.acquire(
                    self.request(tenant=f'tenant{i}', idem=f'{i:064x}'),
                    f'axiom-openhands-{i:08d}')
            except AdmissionDenied:
                return None
        with ThreadPoolExecutor(max_workers=12) as pool:
            outcomes = list(pool.map(attempt, range(20)))
        self.assertEqual(sum(x is not None for x in outcomes), 2)
        self.assertEqual(self.scheduler.active_count, 2)

    def test_revoked_idempotency_key_cannot_restart_worker(self):
        a = self.scheduler.acquire(self.request(), 'axiom-openhands-abc12345')
        self.scheduler.release(a['lease_id'], 'alpha')
        with self.assertRaises(AdmissionDenied):
            self.scheduler.acquire(self.request(), 'axiom-openhands-abc12345')

    def test_no_secret_or_authority_claim(self):
        a = self.scheduler.acquire(self.request(), 'axiom-openhands-abc12345')
        for field in ('production_authority','release_authority',
                      'certification_authority','external_action_executed'):
            self.assertIs(a[field], False)
        self.assertNotIn('credential', str(a))
        self.assertEqual(a['risk_class'], 'S0')


if __name__ == '__main__':
    unittest.main()
