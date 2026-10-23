"""Local integrity boundaries: these remain explicitly NOT global antirollback."""
import json
import sqlite3
from pathlib import Path
import shutil
import tempfile
import unittest
from ops.openhands_qualification.local_bootstrap import bootstrap_local_s0
from ops.openhands_qualification.mission_ledger import MissionLedger, RecoveryHold

REQUEST={'schema':'musitu.axiom.openhands.mission.s0.v1','tenant_id':'t1',
         'work_id':'w1','workload_identity_id':'agent-a', 'request_sha256':'1'*64,
         'risk_class':'S0','production_authority':False}

class LocalIntegrityBindingTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.root.chmod(0o700)
        self.db=self.root/'missions.sqlite3'
        self.anchor=Path(str(self.db)+'.local-anchor')
        bootstrap_local_s0(str(self.db),acknowledged_local_only=True)
        self.ledger=MissionLedger(str(self.db))

    def assert_hold(self):
        self.assertEqual(MissionLedger(str(self.db)).status(),'RECOVERY_HOLD')
        with self.assertRaises(RecoveryHold):MissionLedger(str(self.db)).admit(REQUEST)
        with self.assertRaises(RecoveryHold):MissionLedger(str(self.db)).active_count()

    def test_restoring_old_database_while_preserving_new_anchor_denies(self):
        original=self.db.read_bytes()
        self.ledger.admit(REQUEST)
        self.db.write_bytes(original)
        self.assert_hold()

    def test_tampered_anchor_content_denies_without_repair(self):
        self.ledger.admit(REQUEST)
        self.anchor.write_bytes(self.anchor.read_bytes()+b'INJECTED')
        self.assert_hold()

    def test_malformed_and_extra_field_anchors_deny(self):
        self.ledger.admit(REQUEST)
        self.anchor.write_text('{not json')
        self.assert_hold()
        # A different store for the unexpected-field scenario.
        other=self.root/'second';other.mkdir(mode=0o700)
        db=other/'db';bootstrap_local_s0(str(db),acknowledged_local_only=True)
        anchor=Path(str(db)+'.local-anchor')
        try:
            data=json.loads(anchor.read_text())
            data['extra']='untrusted'
            anchor.write_text(json.dumps(data))
        except ValueError:
            self.fail('bootstrap must create a structured JSON local anchor')
        self.assertEqual(MissionLedger(str(db)).status(),'RECOVERY_HOLD')

    def test_generation_sequence_and_digest_mismatch_denied(self):
        for key,bad in [('generation_id','0'*32),('sequence',999),('mission_state_sha256','0'*64)]:
            with self.subTest(key=key):
                p=self.root/('check_'+key);p.mkdir(mode=0o700)
                db=p/'db';bootstrap_local_s0(str(db),acknowledged_local_only=True)
                ledger=MissionLedger(str(db));ledger.admit(REQUEST)
                anchor=Path(str(db)+'.local-anchor');data=json.loads(anchor.read_text())
                data[key]=bad
                anchor.write_text(json.dumps(data,sort_keys=True,separators=(',',':'))+'\n')
                self.assertEqual(MissionLedger(str(db)).status(),'RECOVERY_HOLD')

    def test_unauthorized_schema_trigger_with_identical_rows_enters_recovery_hold(self):
        # A malicious local SQLite trigger is not represented in the mission rows.
        # The old anchor hashing only rows must not silently accept the altered schema.
        con=sqlite3.connect(self.db)
        try:
            con.execute("CREATE TRIGGER unexpected_mission_mutation AFTER INSERT ON missions BEGIN DELETE FROM missions WHERE id!=NEW.id; END")
            con.commit()
        finally:con.close()
        self.assert_hold()

    def test_unauthorized_added_table_without_row_changes_enters_recovery_hold(self):
        con=sqlite3.connect(self.db)
        try:
            con.execute('CREATE TABLE attacker_controlled(payload TEXT)')
            con.commit()
        finally:con.close()
        self.assert_hold()

    def test_previous_v2_anchor_protocol_is_not_silently_migrated(self):
        # The v3 digest includes sqlite schema. Old format must be rejected
        # rather than read as if a v2 journal had been transparently certified.
        data=json.loads(self.anchor.read_text())
        data['schema']='musitu.axiom.ecc.local-anchor.s0.v2'
        self.anchor.write_text(json.dumps(data,sort_keys=True,separators=(',',':'))+'\n')
        self.assert_hold()

    def test_corrupted_sqlite_file_denied(self):
        self.db.write_bytes(b'not a database')
        self.assert_hold()

    def test_normal_idempotence_and_local_termination_remain_nonproduction(self):
        first=self.ledger.admit(REQUEST)
        second=MissionLedger(str(self.db)).admit(REQUEST)
        self.assertEqual(first['mission_id'],second['mission_id'])
        self.assertEqual(self.ledger.active_count(),1)
        self.assertEqual(self.ledger.status(),'LOCAL_ONLY_UNQUALIFIED')
        result=MissionLedger(str(self.db)).complete_local(first['mission_id'],termination_verified=True)
        self.assertEqual(result['state'],'TERMINATED_VERIFIED_LOCAL_ONLY')
        self.assertEqual(self.ledger.active_count(),0)
        self.assertFalse(result['provider_dispatch_allowed']);self.assertFalse(result['production_authority'])

if __name__=='__main__':unittest.main()
