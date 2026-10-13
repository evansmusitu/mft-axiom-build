import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from verify_gate import verify

class VerificationTests(unittest.TestCase):
    def fixture(self):
        return '\n'.join('B21_WORKERD_ADMITTED=agent-'+w+':'+str(i)+':'+('a' if w=='a' else 'b')*64
            for w in 'ab' for i in range(3))+'\n'+ '\n'.join([
            'MUSITU_AXIOM_B12_TWO_NATIVE_SDK_AGENT_PROCESSES_SYNTHETIC_MODEL_PASS',
            'AXIOM_B19_GENUINE_OPENHANDS_SDK_NATIVE_EVENT_JOURNAL_S0_PASS_NOT_PRODUCTION',
            'B19_CHAIN_SHA256=abcd','B19_PORTABLE_EVIDENCE_B64=abcd'])
    def test_accept_real_set(self):self.assertEqual(verify(self.fixture())['admissions'],6)
    def test_reject_duplicate(self):
        with self.assertRaises(ValueError):verify(self.fixture()+'\n'+self.fixture().splitlines()[0])
    def test_reject_missing(self):
        with self.assertRaises(ValueError):verify('\n'.join(self.fixture().splitlines()[1:]))
    def test_reject_denial(self):
        with self.assertRaises(ValueError):verify(self.fixture()+'\nB21_DENIED_BEFORE_NATIVE_MODEL_REPLY=agent-a:0')
    def test_reject_missing_portable(self):
        with self.assertRaises(ValueError):verify(self.fixture().replace('B19_PORTABLE_EVIDENCE_B64','PORTABLE_GONE'))

if __name__=='__main__':unittest.main()
