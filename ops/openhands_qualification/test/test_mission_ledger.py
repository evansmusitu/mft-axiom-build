import multiprocessing as mp
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from ops.openhands_qualification.mission_ledger import MissionLedger, LedgerDenied, RecoveryHold

H='a'*64

def req(suffix='one',tenant='t1',worker='agent-1'):
    return {'schema':'musitu.axiom.openhands.mission.s0.v1','tenant_id':tenant,'work_id':'w-'+suffix,
            'workload_identity_id':worker,'request_sha256':H if suffix=='one' else 'b'*64,
            'risk_class':'S0','production_authority':False}

def compete_distinct(db,q,i):
    r=req(suffix=str(i),tenant='t'+str(i),worker='agent-'+str(i))
    r['request_sha256']=hashlib.sha256(str(i).encode()).hexdigest()
    try:q.put(MissionLedger(db,max_active=2,max_per_tenant=1).admit(r)['mission_id'])
    except Exception as exc:q.put(type(exc).__name__)

def killed_transaction(db):
    ledger=MissionLedger(db)
    with ledger._transaction() as con:
        con.execute("UPDATE missions SET state='TERMINATED_VERIFIED_LOCAL_ONLY'")
        os._exit(43)

def compete(db,q):
    try:q.put(MissionLedger(db,max_active=2).admit(req())['mission_id'])
    except Exception as exc:q.put(type(exc).__name__)

class MissionLedgerTests(unittest.TestCase):
    def setUp(self):
        self.root=tempfile.TemporaryDirectory();self.addCleanup(self.root.cleanup)
        self.db=str(Path(self.root.name)/'journal.sqlite3')
        Path(self.root.name).chmod(0o700)
    def test_distinct_cross_process_admissions_respect_global_capacity(self):
        ctx=mp.get_context('fork');q=ctx.Queue();ps=[ctx.Process(target=compete_distinct,args=(self.db,q,i)) for i in range(8)]
        for p in ps:p.start()
        for p in ps:p.join(timeout=15);self.assertEqual(p.exitcode,0)
        results=[q.get(timeout=3) for _ in ps]
        self.assertEqual(sum(len(x)==32 for x in results),2)
        self.assertEqual(MissionLedger(self.db).active_count(),2)
    def test_process_crash_mid_transaction_rolls_back_locally(self):
        ledger=MissionLedger(self.db)
        id=ledger.admit(req())['mission_id']
        ctx=mp.get_context('fork');proc=ctx.Process(target=killed_transaction,args=(self.db,))
        proc.start();proc.join(timeout=12)
        self.assertEqual(proc.exitcode,43)
        self.assertEqual(MissionLedger(self.db).inspect(id)['state'],'ACTIVE')
        self.assertEqual(MissionLedger(self.db).active_count(),1)
    def test_anchor_deletion_halts_admissions(self):
        ledger=MissionLedger(self.db);ledger.admit(req())
        Path(self.db+'.local-anchor').unlink()
        with self.assertRaises(RecoveryHold):MissionLedger(self.db).admit(req('two',worker='agent-2'))
    def test_restart_retains_exact_mission_id_without_new_authority(self):
        first=MissionLedger(self.db).admit(req())
        second=MissionLedger(self.db).admit(req())
        self.assertEqual(first['mission_id'],second['mission_id'])
        self.assertFalse(first['production_authority']);self.assertFalse(second['provider_dispatch_allowed'])
    def test_concurrent_processes_admit_at_most_once(self):
        ctx=mp.get_context('fork');q=ctx.Queue();ps=[ctx.Process(target=compete,args=(self.db,q)) for _ in range(8)]
        for p in ps:p.start()
        for p in ps:p.join(timeout=15);self.assertEqual(p.exitcode,0)
        results=[q.get(timeout=3) for _ in ps]
        self.assertEqual(len(set(results)),1)
        self.assertEqual(MissionLedger(self.db).active_count(),1)
    def test_expired_or_ambiguous_mission_stays_in_hold_across_restart(self):
        ledger=MissionLedger(self.db,clock=lambda:100.,ttl_seconds=10)
        first=ledger.admit(req())
        with self.assertRaises(RecoveryHold):MissionLedger(self.db,clock=lambda:111.).admit(req())
        state=MissionLedger(self.db,clock=lambda:111.).inspect(first['mission_id'])
        self.assertEqual(state['state'],'RECOVERY_HOLD')
        self.assertEqual(MissionLedger(self.db,clock=lambda:111.).active_count(),1)
    def test_conflicting_identity_denied_and_capacity_is_not_oversubscribed(self):
        ledger=MissionLedger(self.db,max_active=1)
        ledger.admit(req())
        with self.assertRaises(LedgerDenied):ledger.admit(req('one',worker='other'))
        with self.assertRaises(LedgerDenied):ledger.admit(req('two',worker='agent-2'))
    def test_no_unverified_termination_frees_capacity(self):
        ledger=MissionLedger(self.db,max_active=1)
        id=ledger.admit(req())['mission_id']
        with self.assertRaises(RecoveryHold):ledger.complete_local(id,termination_verified=False)
        with self.assertRaises(LedgerDenied):ledger.admit(req('two',worker='agent-2'))
    def test_local_verified_termination_never_becomes_external_certification(self):
        ledger=MissionLedger(self.db,max_active=1)
        id=ledger.admit(req())['mission_id']
        result=ledger.complete_local(id,termination_verified=True)
        self.assertEqual(result['state'],'TERMINATED_VERIFIED_LOCAL_ONLY')
        self.assertFalse(result['production_authority']);self.assertEqual(result['independent_verifier'],'NOT_PROVEN')
        ledger.admit(req('two',worker='agent-2'))
    def test_symlink_world_writable_parent_and_fake_production_are_denied(self):
        with self.assertRaises(LedgerDenied):MissionLedger(self.db).admit({**req(),'production_authority':True})
        other=Path(self.root.name)/'alias';other.symlink_to(self.db)
        with self.assertRaises(LedgerDenied):MissionLedger(str(other)).admit(req())
        Path(self.root.name).chmod(0o777)
        with self.assertRaises(LedgerDenied):MissionLedger(self.db).admit(req())
    def test_destroyed_ledger_fails_closed_on_restart_with_state_anchor(self):
        ledger=MissionLedger(self.db);ledger.admit(req());Path(self.db).unlink()
        with self.assertRaises(RecoveryHold):MissionLedger(self.db).admit(req())
        self.assertEqual(MissionLedger(self.db).status(),'RECOVERY_HOLD')
if __name__=='__main__':unittest.main()
