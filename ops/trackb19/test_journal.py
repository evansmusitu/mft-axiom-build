import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from journal import EventJournal, EvidenceDenied, ingest_native_file


def ev(kind='ActionEvent',tool='file_editor',oid='a1'):
    return dict(kind=kind,id=oid,tool_call_id='tool1',tool_name=tool,action_id=oid)


class DurableNativeChain(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'journal.sqlite'
        self.j=EventJournal(self.path)
        self.private=Ed25519PrivateKey.generate()
        self.work='axiom-work-1'

    def tearDown(self):
        self.j.close()
        self.tmp.cleanup()

    def add(self,who='agent-a',ordinal=0,**kw):
        self.j.append(self.work,who,ordinal,ev(**kw))

    def test_chain_created_and_independently_verifiable(self):
        self.add();self.add(ordinal=1,kind='ObservationEvent',oid='o1');self.add(ordinal=2,tool='finish',oid='f1')
        result=self.j.verify(self.work)
        self.assertEqual(result['events'],3)
        self.assertEqual(result['workers']['agent-a']['finish'],1)
        self.assertEqual(len(result['chain_sha256']),64)

    def test_same_native_event_idempotent(self):
        self.add();r=self.j.append(self.work,'agent-a',0,ev())
        self.assertTrue(r['replayed'])
        self.assertEqual(self.j.verify(self.work)['events'],1)

    def test_mismatched_replay_denied(self):
        self.add()
        with self.assertRaisesRegex(EvidenceDenied,'REPLAY_TAMPERING_DENIED'):
            self.j.append(self.work,'agent-a',0,ev(oid='tampered'))

    def test_gap_denied_and_no_commit(self):
        with self.assertRaisesRegex(EvidenceDenied,'ORDINAL_GAP_DENIED'):
            self.add(ordinal=8)
        self.assertEqual(self.j.db.execute('SELECT COUNT(*) FROM events').fetchone()[0],0)

    def test_event_changed_after_commit_detected(self):
        self.add()
        self.j.db.execute('UPDATE events SET event_data=?', (b'{}',))
        with self.assertRaises(EvidenceDenied):self.j.verify(self.work)

    def test_previous_hash_tampered_detected(self):
        self.add();self.add(ordinal=1,kind='ObservationEvent',oid='o1')
        self.j.db.execute('UPDATE events SET previous_hash=? WHERE seq=1',('0'*64,))
        with self.assertRaisesRegex(EvidenceDenied,'PREVIOUS_HASH_INVALID'):
            self.j.verify(self.work)

    def test_record_deleted_detected(self):
        self.add();self.add(ordinal=1,kind='ObservationEvent',oid='o1')
        self.j.db.execute('DELETE FROM events WHERE seq=0')
        with self.assertRaises(EvidenceDenied):self.j.verify(self.work)

    def test_cross_workload_replay_is_separately_scoped(self):
        self.add()
        self.j.append('another-work','agent-a',0,ev())
        self.assertNotEqual(self.j.verify(self.work)['chain_sha256'],self.j.verify('another-work')['chain_sha256'])

    def test_restart_preserves_committed_evidence(self):
        self.add();digest=self.j.verify(self.work)['chain_sha256']
        self.j.close();self.j=EventJournal(self.path)
        self.assertEqual(self.j.verify(self.work)['chain_sha256'],digest)

    def test_rollback_discards_incomplete_transaction(self):
        self.add()
        other=sqlite3.connect(str(self.path),isolation_level=None)
        other.execute('BEGIN IMMEDIATE')
        other.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?)',('axiom-work-1',1,'agent-a',1,b'{}','x','y'))
        other.execute('ROLLBACK');other.close()
        self.assertEqual(self.j.verify(self.work)['events'],1)

    def test_seal_verified_by_independent_public_key(self):
        self.add()
        s=self.j.seal(self.work,self.private.sign)
        self.assertEqual(len(s['signature_hex']),128)
        proof=self.j.verify_seal(self.work,self.private.public_key().verify)
        self.assertEqual(proof['events'],1)

    def test_seal_denies_new_events(self):
        self.add();self.j.seal(self.work,self.private.sign)
        with self.assertRaisesRegex(EvidenceDenied,'WORK_SEALED'):
            self.add(ordinal=1)

    def test_signed_seal_detects_hash_change(self):
        self.add();self.j.seal(self.work,self.private.sign)
        self.j.db.execute('UPDATE work SET final_hash=?',(str('0'*64),))
        with self.assertRaises(EvidenceDenied):
            self.j.verify_seal(self.work,self.private.public_key().verify)

    def test_altered_signature_denied(self):
        self.add();self.j.seal(self.work,self.private.sign)
        self.j.db.execute('UPDATE work SET signed_seal=?',('f'*128,))
        with self.assertRaisesRegex(EvidenceDenied,'SEAL_SIGNATURE_INVALID'):
            self.j.verify_seal(self.work,self.private.public_key().verify)

    def test_invalid_native_schema_denied(self):
        with self.assertRaisesRegex(EvidenceDenied,'EVENT_SCHEMA_DENIED'):
            self.j.append(self.work,'agent-a',0,{'kind':'ActionEvent','extra':'danger'})

    def test_native_file_ingest_ignores_other_sdk_events(self):
        source=Path(self.tmp.name)/'native.jsonl'
        source.write_text('\n'.join([json.dumps({'kind':'MessageEvent'}),json.dumps(ev()),json.dumps(ev('ObservationEvent',oid='o1'))])+'\n')
        self.assertEqual(ingest_native_file(self.j,self.work,'agent-a',source),2)
        self.assertEqual(self.j.verify(self.work)['events'],2)

    def test_native_file_invalid_json_fail_closed(self):
        source=Path(self.tmp.name)/'native.jsonl';source.write_text('not-json\n')
        with self.assertRaisesRegex(EvidenceDenied,'NATIVE_EVENT_JSON_INVALID'):
            ingest_native_file(self.j,self.work,'agent-a',source)

if __name__=='__main__':unittest.main()
