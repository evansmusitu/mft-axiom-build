"""Fail-closed, provider-free 2099 mock test qualification runner contract."""
import pathlib
import os
import time
import subprocess
import sys
import unittest
from types import SimpleNamespace

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'ops'))

from studio_v03_bounded_2099_qualification import discover_cases, qualify, _bounded_process_group


class BoundedQualificationTests(unittest.TestCase):
    def test_discovers_every_current_god_mode_mock_without_running_blender(self):
        ids = discover_cases(ROOT)
        self.assertGreaterEqual(len(ids), 39)
        self.assertEqual(len(set(ids)),len(ids))
        self.assertTrue(any('release_receipt' in x for x in ids))
        self.assertTrue(any('render_entry' in x for x in ids))
        self.assertTrue(any('test_timeout_kills_entire_mock_process_group_boundedly' in x for x in ids))

    def test_verifies_each_serial_chunk_result_and_never_fakes_runner_success(self):
        calls=[]
        def fake(cmd, **kwargs):
            cases = [x for x in cmd if '.test_' in x and not x.startswith('-')]
            calls.append((len(cases),kwargs['timeout'],kwargs['cwd']))
            return SimpleNamespace(returncode=0, stdout='', stderr=f'Ran {len(cases)} tests in 0.010s\n\nOK\n')
        result = qualify(ROOT, group_size=6, timeout_seconds=75, runner=fake)
        self.assertTrue(result['complete'])
        self.assertEqual(result['tests_passed'],len(discover_cases(ROOT)))
        self.assertEqual(sum(c[0] for c in calls),len(discover_cases(ROOT)))
        self.assertEqual(len(calls),(len(discover_cases(ROOT))+5)//6)
        self.assertEqual(len({str(c[2]) for c in calls}),1)
        self.assertTrue(all(c[1]==75 for c in calls))
        self.assertFalse(result['provider_verified'])

    def test_zero_exit_without_full_unittest_summary_fails_closed(self):
        def liar(cmd,**kwargs):
            return SimpleNamespace(returncode=0,stdout='',stderr='Ran 1 test in 0.01s\n\nOK\n')
        with self.assertRaisesRegex(ValueError,'STUDIO_2099_QUALIFICATION_INCOMPLETE'):
            qualify(ROOT,group_size=6,runner=liar)

    def test_timeouts_and_nonzero_exit_never_become_qualification(self):
        def late(cmd,**kwargs):
            raise subprocess.TimeoutExpired(cmd,kwargs['timeout'])
        with self.assertRaisesRegex(ValueError,'STUDIO_2099_QUALIFICATION_TIMEOUT'):
            qualify(ROOT,group_size=6,runner=late)
        def failed(cmd,**kwargs):
            return SimpleNamespace(returncode=1,stdout='',stderr='Ran 6 tests\nFAILED')
        with self.assertRaisesRegex(ValueError,'STUDIO_2099_QUALIFICATION_FAILED'):
            qualify(ROOT,group_size=6,runner=failed)

    def test_group_kill_bounds_uncooperative_nested_test_worker(self):
        if os.name!='posix':
            self.skipTest('process groups require POSIX')
        command=[sys.executable,'-c',
                 'import subprocess,sys,time;subprocess.Popen([sys.executable,"-c","import time;time.sleep(20)"]);time.sleep(20)']
        start=time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):
            _bounded_process_group(command,cwd=ROOT,env=os.environ.copy(),
                                   capture_output=True,text=True,timeout=0.3)
        self.assertLess(time.monotonic()-start,4.0,
            'a nested test subprocess must not keep stdout/stderr pipes open')

    def test_invalid_group_and_timeout_configuration_fail_closed(self):
        for size in (0,-1,100,1.5,'6'):
            with self.subTest(size=size),self.assertRaises(ValueError):
                qualify(ROOT,group_size=size,runner=lambda *a,**kw:None)
        for seconds in (0,-3,1000,'45'):
            with self.subTest(timeout=seconds),self.assertRaises(ValueError):
                qualify(ROOT,timeout_seconds=seconds,runner=lambda *a,**kw:None)


if __name__=='__main__': unittest.main()
