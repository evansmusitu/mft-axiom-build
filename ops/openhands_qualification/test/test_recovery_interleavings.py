"""Deterministic local crash tests; do not promote to cross-host security claims."""
import multiprocessing as mp
import os
from pathlib import Path
import tempfile
import unittest
from ops.openhands_qualification.local_bootstrap import bootstrap_local_s0
from ops.openhands_qualification.mission_ledger import MissionLedger, RecoveryHold

REQUEST={'schema':'musitu.axiom.openhands.mission.s0.v1','tenant_id':'t1',
         'work_id':'recover-test','workload_identity_id':'agent-1','request_sha256':'5'*64,
         'risk_class':'S0','production_authority':False}


def crash_after_sqlite_commit(db):
    def die(self,raw):
        os._exit(77)
    MissionLedger._publish_anchor=die
    MissionLedger(db).admit(REQUEST)


def crash_mid_uncommitted_sqlite_write(db):
    ledger=MissionLedger(db)
    with ledger._transaction() as con:
        con.execute("INSERT INTO missions VALUES ('uncommitted','t2','w2','agent-2',?,?,'ACTIVE',500,NULL)",('2'*64,'3'*64))
        os._exit(79)


class RecoveryInterleavingsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.root.chmod(0o700)
        self.db=str(self.root/'db.sqlite')
        bootstrap_local_s0(self.db,acknowledged_local_only=True)

    def test_postcommit_preanchor_crash_enters_hold(self):
        proc=mp.get_context('fork').Process(target=crash_after_sqlite_commit,args=(self.db,))
        proc.start();proc.join(15)
        self.assertEqual(proc.exitcode,77)
        self.assertEqual(MissionLedger(self.db).status(),'RECOVERY_HOLD')
        with self.assertRaises(RecoveryHold):MissionLedger(self.db).admit(REQUEST)

    def test_precommit_crash_rolls_back_and_leaves_intact_anchor(self):
        proc=mp.get_context('fork').Process(target=crash_mid_uncommitted_sqlite_write,args=(self.db,))
        proc.start();proc.join(15)
        self.assertEqual(proc.exitcode,79)
        ledger=MissionLedger(self.db)
        self.assertEqual(ledger.status(),'LOCAL_ONLY_UNQUALIFIED')
        self.assertEqual(ledger.active_count(),0)
        self.assertEqual(ledger.admit(REQUEST)['state'],'ACTIVE')

    def test_post_anchor_publication_failure_stays_in_hold(self):
        # The SQLite record and anchor can agree even when directory durability
        # confirmation failed: ambiguous success must never become admission.
        ledger=MissionLedger(self.db)
        original=ledger._publish_anchor
        def published_but_unsure(raw):
            original(raw)
            raise OSError('simulated postpublication durability failure')
        ledger._publish_anchor=published_but_unsure
        with self.assertRaises(RecoveryHold):ledger.admit(REQUEST)
        self.assertEqual(MissionLedger(self.db).status(),'RECOVERY_HOLD')
        with self.assertRaises(RecoveryHold):MissionLedger(self.db).admit(REQUEST)

    def test_no_external_authority_after_local_transitions(self):
        ledger=MissionLedger(self.db)
        first=ledger.admit(REQUEST)
        self.assertEqual(first['independent_verifier'],'NOT_PROVEN')
        self.assertFalse(first['provider_dispatch_allowed'])
        self.assertFalse(first['production_authority'])
        self.assertEqual(MissionLedger(self.db).admit(REQUEST)['mission_id'],first['mission_id'])
        self.assertFalse(Path(self.db+'.transition').exists())

if __name__=='__main__':unittest.main()
