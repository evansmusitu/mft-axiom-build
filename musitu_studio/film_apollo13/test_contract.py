import unittest
from contract import ranges, validate_receipt
class ContractTests(unittest.TestCase):
    def test_complete_exact_range(self):
        self.assertEqual([f for a,b in ranges() for f in range(a,b+1)],list(range(1,5401)))
    def test_reject_missing_frame_or_cpu(self):
        record={'start':1,'end':2,'renderer':'CYCLES_CUDA','device':'Tesla T4','frames':[{'frame':1,'sha256':'a'*64,'bytes':2000},{'frame':2,'sha256':'b'*64,'bytes':2000}]}
        validate_receipt(record,1,2)
        for changed in [dict(record,frames=record['frames'][:1]),dict(record,renderer='CPU'),dict(record,frames=[record['frames'][0]]*2)]:
            with self.assertRaises(ValueError): validate_receipt(changed,1,2)
if __name__=='__main__': unittest.main()
