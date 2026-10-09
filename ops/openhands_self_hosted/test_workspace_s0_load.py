import threading
import time
import unittest
from workspace_s0_load import run_bounded_s0_load, LoadNotQualified

class Tests(unittest.TestCase):
    def test_exact_five_concurrent_s0_calls(self):
        active = 0
        peak = 0
        lock = threading.Lock()
        def fake(endpoint, key):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(active, peak)
            time.sleep(0.025)
            with lock:
                active -= 1
            return {'remote_workspace_s0_executed':True, 'live_runtime_qualification':'NOT_PROVEN', 'external_action_executed':False}
        result=run_bounded_s0_load('http://127.0.0.1:18765','x'*64,probe=fake)
        self.assertEqual(peak,5)
        self.assertEqual(result['requests_completed'],5)
        self.assertEqual(result['max_inflight'],5)
        self.assertFalse(result['production_authority'])
        self.assertNotIn('x'*64,repr(result))

    def test_one_failure_blocks_success_claim(self):
        def fake(endpoint,key):
            raise RuntimeError('secret:'+key)
        with self.assertRaises(LoadNotQualified) as e:
            run_bounded_s0_load('http://127.0.0.1:18765','x'*64,probe=fake)
        self.assertNotIn('x'*64,str(e.exception))

    def test_invalid_load_scope_rejected(self):
        for count in (0,1,10,100,True):
            with self.subTest(count=count), self.assertRaises(LoadNotQualified):
                run_bounded_s0_load('http://127.0.0.1:18765','x'*64,count=count,probe=lambda a,b:None)

if __name__=='__main__':
    unittest.main()
