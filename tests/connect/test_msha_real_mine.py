import unittest

from benchmarks.mining_adapter.msha_real_mine import (
    MshaRealMineSpec,
    evaluate_real_mine_gate,
    normalize_msha_rows,
    parse_msha_pipe_text,
)


_FIXTURE="""MINE_ID|DOCUMENT_NO|SUBUNIT_CD|SUBUNIT|ACCIDENT_DT|CAL_YR|DEGREE_INJURY_CD|DEGREE_INJURY|MINING_EQUIP_CD|MINING_EQUIP|CLASSIFICATION_CD|CLASSIFICATION|ACCIDENT_TYPE_CD|ACCIDENT_TYPE|NO_INJURIES|DAYS_RESTRICT|DAYS_LOST|IMMED_NOTIFY_CD|IMMED_NOTIFY|COAL_METAL_IND
1234567|220260010001|03|Strip, quarry, open pit|01/01/2026|2026|03|Days away from work only|123|Haul truck|12|Powered haulage|08|Struck by|1|0|14|13|Not marked|M
7654321|220251230002|01|Underground|05/03/2025|2025|01|Fatality|456|Continuous miner|05|Fall of roof|04|Caught in|1|0|0|01|Death|C
"""


class MshaRealMineTests(unittest.TestCase):
    def test_parser_requires_official_header_and_preserves_rows(self):
        rows=parse_msha_pipe_text(_FIXTURE)
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0]["DOCUMENT_NO"],"220260010001")
        self.assertEqual(rows[1]["MINE_ID"],"7654321")

    def test_normalizer_preserves_real_incident_semantics_without_fake_optimizer_fields(self):
        envelope=normalize_msha_rows(parse_msha_pipe_text(_FIXTURE))
        self.assertEqual(envelope.contract,"musitu.connect.mining.public_incident.v1")
        self.assertEqual(envelope.domain,"mining_incident")
        self.assertEqual(len(envelope.records),2)
        first=envelope.records[0]
        self.assertEqual(first["mine_id"],"1234567")
        self.assertEqual(first["accident_date"],"2026-01-01")
        self.assertEqual(first["days_lost"],14)
        self.assertEqual(first["classification"],"Powered haulage")
        self.assertNotIn("likelihood",first)
        self.assertNotIn("benefit",first)
        self.assertNotIn("cost",first)

    def test_normalizer_rejects_duplicate_document_numbers(self):
        rows=parse_msha_pipe_text(_FIXTURE)
        rows.append(dict(rows[0]))
        with self.assertRaisesRegex(ValueError,"duplicate_document_no"):
            normalize_msha_rows(rows)

    def test_gate_requires_official_source_scale_freshness_and_durable_replay(self):
        spec=MshaRealMineSpec(min_source_records=1000,min_latest_year=2025)
        report={
            "source_url":spec.source_url,
            "source_zip_sha256":"a"*64,
            "source_text_sha256":"b"*64,
            "source_records":1200,
            "selected_records":1000,
            "unique_document_numbers":1200,
            "earliest_accident_date":"2000-01-01",
            "latest_accident_date":"2026-06-30",
            "canonical_sha256":"c"*64,
            "signature_verified":True,
            "replay_verified":True,
            "audit_chain_verified":True,
            "credentials_used":False,
            "errors":[],
        }
        qualified=evaluate_real_mine_gate(spec,report)
        self.assertTrue(qualified["real_mine_data_qualified"])
        self.assertEqual(qualified["gate"],"REAL_MINE_PUBLIC_DATA_QUALIFIED")

        broken=dict(report)
        broken["source_url"]="https://example.com/Accidents.zip"
        failed=evaluate_real_mine_gate(spec,broken)
        self.assertFalse(failed["real_mine_data_qualified"])


if __name__=="__main__":
    unittest.main()
