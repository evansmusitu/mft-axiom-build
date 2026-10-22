"""S0 initialization is explicit and not available to ordinary ledger operations."""
from pathlib import Path
import tempfile
import unittest
from ops.openhands_qualification.mission_ledger import MissionLedger, RecoveryHold, LedgerDenied

H = 'd'*64
REQUEST = {'schema':'musitu.axiom.openhands.mission.s0.v1','tenant_id':'test',
           'work_id':'operation','workload_identity_id':'actor','request_sha256':H,
           'risk_class':'S0','production_authority':False}

class ExplicitBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.root.chmod(0o700)
        self.db = str(self.root / 'mission.sqlite3')

    def test_status_on_empty_store_is_read_only_and_hold(self):
        self.assertEqual(MissionLedger(self.db).status(), 'RECOVERY_HOLD')
        self.assertEqual(list(self.root.iterdir()), [])

    def test_no_ordinary_operation_initializes_absent_store(self):
        ledger = MissionLedger(self.db)
        for action in (lambda:ledger.admit(REQUEST), lambda:ledger.inspect('unknown'),
                       ledger.active_count,lambda:ledger.complete_local('unknown',termination_verified=True)):
            with self.assertRaises(RecoveryHold):action()
            self.assertEqual(list(self.root.iterdir()), [])

    def test_local_bootstrap_requires_exact_explicit_acknowledgement(self):
        from ops.openhands_qualification.local_bootstrap import bootstrap_local_s0
        with self.assertRaises(LedgerDenied):bootstrap_local_s0(self.db,acknowledged_local_only=False)
        self.assertEqual(list(self.root.iterdir()), [])
        evidence=bootstrap_local_s0(self.db,acknowledged_local_only=True)
        self.assertEqual(evidence['schema'],'musitu.axiom.ecc.local-bootstrap.s0.v1')
        self.assertFalse(evidence['production_authority'])
        self.assertFalse(evidence['provider_dispatch_allowed'])
        self.assertEqual(MissionLedger(self.db).status(),'LOCAL_ONLY_UNQUALIFIED')
        self.assertEqual(len(list(self.root.iterdir())),3)
        with self.assertRaises((RecoveryHold,LedgerDenied)):
            bootstrap_local_s0(self.db,acknowledged_local_only=True)

    def test_orphaned_lock_or_missing_component_never_reinitializes(self):
        from ops.openhands_qualification.local_bootstrap import bootstrap_local_s0
        for i,suffix in enumerate(('.lock','.local-anchor','')):
            with self.subTest(suffix=suffix):
                p=self.root/('extra'+str(i))
                p.mkdir(mode=0o700)
                db=str(p/'db')
                bootstrap_local_s0(db,acknowledged_local_only=True)
                Path(db+suffix).unlink()
                self.assertEqual(MissionLedger(db).status(),'RECOVERY_HOLD')
                with self.assertRaises(RecoveryHold):MissionLedger(db).admit(REQUEST)
                self.assertFalse(Path(db+suffix).exists())

    def test_bootstrap_cannot_repurpose_existing_directory(self):
        from ops.openhands_qualification.local_bootstrap import bootstrap_local_s0
        (self.root/'unrelated.txt').write_text('not empty')
        with self.assertRaises(LedgerDenied):bootstrap_local_s0(self.db,acknowledged_local_only=True)
        self.assertFalse(Path(self.db).exists())

if __name__=='__main__':unittest.main()
