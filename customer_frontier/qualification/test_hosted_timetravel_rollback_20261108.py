import unittest
import hosted_timetravel_rollback_20261108 as m

BOOKMARK='00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683'
class CloudflareTimeTravelContract(unittest.TestCase):
    def test_accepts_only_bound_fixed_bookmark(self):
        self.assertEqual(m.check_bookmark(BOOKMARK),BOOKMARK)
        for value in ('',None,'?bookmark=xxx','a'*250,'0'*16):
            with self.assertRaises(m.Rejected):m.check_bookmark(value)

    def test_deny_unknown_query_and_restoration_uri(self):
        self.assertEqual(m.ACCOUNT,'c954f0c842a486d0388c05b19cd21e47')
        self.assertEqual(m.TARGET,'e36972b3-850d-4273-b934-2fa67587d9f1')
        self.assertNotEqual(m.TARGET,m.observer.SOURCE)
        self.assertNotIn('DROP TABLE',m.CREATE)
        self.assertNotIn('DELETE FROM',m.INSERT)

    def test_deny_mutation_without_write_attestation(self):
        with self.assertRaisesRegex(m.Rejected,'PROBE_MUTATION_NOT_CONFIRMED'):
            m.verify_mutation_response({'meta':{'changed_db':False}},'create')
        with self.assertRaisesRegex(m.Rejected,'PROBE_SINGLE_WRITE_NOT_CONFIRMED'):
            m.verify_mutation_response({'meta':{'changed_db':True,'changes':0,'rows_written':0}},'insert')

    def test_one_restore_then_exact_private_parity(self):
        saved=(m.ctrl,m.observed_probe_count,m.verify_before_and_after)
        events=[]
        probe=[0,1,0]
        def count():return probe.pop(0)
        def compare():
            return {'status':'INDEPENDENT_HOSTED_SCHEMA_AND_DATA_PARITY_PASS',
                    'user_rows_equal':25,'data_sha256':'ab'*32}
        def ctrl(kind,body=None,bookmark=None):
            events.append((kind,body,bookmark))
            if kind=='bookmark':return {'bookmark':BOOKMARK}
            if kind=='query':return {'meta':{'changed_db':True,'changes':1,'rows_written':1}}
            if kind=='restore':return {'bookmark':BOOKMARK,'previous_bookmark':BOOKMARK}
            raise AssertionError('invalid kind')
        m.ctrl,m.observed_probe_count,m.verify_before_and_after=ctrl,count,compare
        try:
            self.assertEqual(m.run(),0)
            self.assertEqual([e[0] for e in events],['bookmark','query','query','restore'])
            self.assertEqual(events[-1][2],BOOKMARK)
        finally:m.ctrl,m.observed_probe_count,m.verify_before_and_after=saved

    def test_failed_postrestore_probe_never_retries_restore(self):
        saved=(m.ctrl,m.observed_probe_count,m.verify_before_and_after)
        events=[]
        probe=[0,1,1]
        def count():return probe.pop(0)
        def compare():
            return {'status':'INDEPENDENT_HOSTED_SCHEMA_AND_DATA_PARITY_PASS',
                    'user_rows_equal':25,'data_sha256':'ab'*32}
        def ctrl(kind,body=None,bookmark=None):
            events.append(kind)
            if kind=='bookmark':return {'bookmark':BOOKMARK}
            if kind=='query':return {'meta':{'changed_db':True,'changes':1,'rows_written':1}}
            if kind=='restore':return {'bookmark':BOOKMARK,'previous_bookmark':BOOKMARK}
            raise AssertionError('invalid kind')
        m.ctrl,m.observed_probe_count,m.verify_before_and_after=ctrl,count,compare
        try:
            self.assertEqual(m.run(),1)
            self.assertEqual(events.count('restore'),1)
        finally:m.ctrl,m.observed_probe_count,m.verify_before_and_after=saved

if __name__=='__main__':unittest.main()
