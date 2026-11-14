"""Synthetic only: Free D1 source-size admission never grants operations."""
import importlib.util
import pathlib
import unittest

file=pathlib.Path(__file__).resolve().parents[1]/'qualification'/'step1_gate1_free_d1_feasibility_readonly_20261113.py'
spec=importlib.util.spec_from_file_location('free_d1',file)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def response(size,uuid=None):return {'success':True,'result':{'uuid':uuid or m.SOURCE,'file_size':size}}

class Gate1FreeFeasibility(unittest.TestCase):
    def test_small_size_only_not_approval(self):
        r=m.assess(response(1024));self.assertTrue(r['source_file_size_fits_free_single_db_conservative'])
        self.assertFalse(r['new_free_account_or_target_creation_authorized']);self.assertFalse(r['gate1_closed'])
    def test_near_free_boundary(self):
        self.assertTrue(m.assess(response(500_000_000))['source_file_size_fits_free_single_db_conservative'])
    def test_above_free_boundary(self):
        self.assertFalse(m.assess(response(500_000_001))['source_file_size_fits_free_single_db_conservative'])
    def test_missing_size(self):self.assertFalse(m.assess(response(None))['source_file_size_known'])
    def test_nan_size(self):self.assertFalse(m.assess(response(float('nan')))['source_file_size_known'])
    def test_inf_size(self):self.assertFalse(m.assess(response(float('inf')))['source_file_size_known'])
    def test_negative_size(self):self.assertFalse(m.assess(response(-2))['source_file_size_known'])
    def test_fraction_size(self):self.assertFalse(m.assess(response(1.5))['source_file_size_known'])
    def test_boolean_size(self):self.assertFalse(m.assess(response(True))['source_file_size_known'])
    def test_string_size(self):self.assertFalse(m.assess(response('200'))['source_file_size_known'])
    def test_zero_size(self):self.assertTrue(m.assess(response(0))['source_file_size_known'])
    def test_protected_source(self):
        with self.assertRaisesRegex(m.NoGo,'SOURCE_UUID_DRIFT'):m.assess(response(20,'other-db'))
    def test_missing_provider_envelope(self):
        with self.assertRaises(m.NoGo):m.assess({})
    def test_missing_result(self):
        with self.assertRaises(m.NoGo):m.assess({'success':True,'result':[]})
    def test_correct_free_plan_limits(self):
        r=m.assess(response(20));self.assertEqual(r['free_plan_daily_written_row_limit'],100000)
        self.assertEqual(r['free_plan_daily_reads_rows_limit'],5000000)
        self.assertEqual(r['free_plan_database_limit'],10)
    def test_provider_get_only(self):self.assertEqual(m.assess(response(20))['provider_operation'],'GET_ONLY_SOURCE_METADATA')
    def test_no_data_move_authority(self):
        r=m.assess(response(20));self.assertFalse(r['source_backup_authorized']);self.assertFalse(r['hosted_restore_authorized'])
    def test_zero_spend_doesnt_follow_from_size(self):
        r=m.assess(response(20));self.assertFalse(r['current_paid_account_d1_zero_spend_guaranteed'])
    def test_token_required(self):
        for t in ('','abc\n123','abc\r123',None):
            with self.subTest(t=t),self.assertRaisesRegex(m.NoGo,'TOKEN_UNAVAILABLE'):m.source_metadata_get(t)

if __name__=='__main__':unittest.main()
