"""Real XLS parsing edge cases, based on GENERATED test data only."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from connect.mining_telemetry import MINING_TELEMETRY_SENSORS
from benchmarks.mining_adapter.public_candidate_forensics import inspect_public_workbook


class PublicCandidateForensicsTests(unittest.TestCase):
    def setUp(self):
        import xlwt
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "sample.xls"
        self.xlwt = xlwt

    def make(self, *, names=None, cadence=15, rows=40):
        names = list(names or ("TIME", "CH4_A", "CH4_B", "WIND", "TEMP"))
        book = self.xlwt.Workbook()
        tab = book.add_sheet("Synthetic_not_mine")
        for c,name in enumerate(names):tab.write(0,c,name)
        for i in range(rows):
            for c,name in enumerate(names):
                tab.write(i+1,c, "{:02}:{:02}:{:02}".format(
                    (i*cadence//3600)%24,(i*cadence//60)%60,(i*cadence)%60
                ) if name=="TIME" else (1.0 if name=="F_SIDE" else .2))
        book.save(str(self.path))

    def run_scan(self):
        with patch("benchmarks.mining_adapter.public_candidate_forensics.PUBLISHED_MD5",
                   hashlib.md5(self.path.read_bytes()).hexdigest()):
            return inspect_public_workbook(source=self.path)

    def test_real_xls_distinct_mine_channel_mismatch_never_qualifies(self):
        self.make()
        report=self.run_scan()
        self.assertTrue(report["source_md5_matches_published"])
        self.assertFalse(report["any_sheet_exact_28_canonical_named"])
        self.assertEqual(report["sheets"][0]["column_count"], 5)
        self.assertFalse(report["production_admission"])
        self.assertFalse(report["frozen_model_inference_executed"])
        self.assertFalse(report["source_rights_and_site_independence_verified"])
        modes=report["sheets"][0]["time_column_candidates"]
        self.assertTrue(modes)
        self.assertEqual(modes[0]["positive_delta_mode_seconds"],15)
        self.assertGreater(modes[0]["non_one_second_deltas"],0)

    def test_even_28_accurately_named_fields_do_not_prove_same_mine_topology(self):
        self.make(names=["TIME",*MINING_TELEMETRY_SENSORS],cadence=1)
        report=self.run_scan()
        self.assertTrue(report["any_sheet_exact_28_canonical_named"])
        self.assertFalse(report["frozen_model_sensor_and_cadence_qualified"])
        self.assertFalse(report["record_license_independently_verified"])
        self.assertFalse(report["independent_physical_methane_events_verified"])
        self.assertEqual(report["sheets"][0]["time_column_candidates"][0]["positive_delta_mode_seconds"],1)

    def test_forgeries_rejected(self):
        self.make()
        with self.assertRaisesRegex(ValueError,"published_md5_mismatch"):
            inspect_public_workbook(source=self.path)
        with patch("benchmarks.mining_adapter.public_candidate_forensics.PUBLISHED_MD5",
                   hashlib.md5(self.path.read_bytes()).hexdigest()):
            self.path.write_bytes(b"not an Excel spreadsheet")
            with self.assertRaisesRegex(ValueError,"published_md5_mismatch"):
                inspect_public_workbook(source=self.path)

    def test_different_source_bytes_have_distinct_sha256(self):
        self.make(rows=40)
        first=self.run_scan()["source_sha256"]
        self.make(rows=41)
        second=self.run_scan()["source_sha256"]
        self.assertNotEqual(first,second)

    def test_metadata_does_not_leak_rows_or_timestamps(self):
        self.make()
        r=self.run_scan()
        self.assertNotIn("CH4_A",str(r))
        self.assertNotIn("00:00:15",str(r))
        self.assertNotIn("synthetic_not_mine",str(r).lower())
        self.assertEqual(r["record_license"],"NOT_VERIFIED")


if __name__=="__main__":
    unittest.main()
