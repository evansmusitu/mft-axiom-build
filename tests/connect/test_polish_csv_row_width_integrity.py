"""Fail-closed test for ambiguous and absent original mining telemetry cells.

Synthetic CSV/ARFF only. The 28 measured channels cannot be treated as
complete when a record has extra, lost, or explicitly missing fields.
"""
from __future__ import annotations

import io
import unittest

from benchmarks.mining_adapter.polish_longwall_telemetry import (
    LongwallTelemetrySpec, canonical_telemetry_row, iter_canonical_rows,
    scan_csv_stream, scan_arff_stream,
)
from tests.connect.test_polish_longwall_telemetry import fixture_text, fixture_arff


class PolishCsvRowWidthIntegrityTests(unittest.TestCase):
    def test_missing_f_side_cell_never_becomes_string_none(self):
        lines=fixture_text().splitlines()
        header=lines[0].split(',')
        values=lines[1].split(',')
        raw=dict(zip(header,values,strict=True))
        raw['F_SIDE']=None
        with self.assertRaisesRegex(ValueError, 'longwall_sensor_state_required:F_SIDE'):
            canonical_telemetry_row(raw)
        self.assertIsNone(raw['F_SIDE'])

        # DictReader supplies None for a missing *last* F_SIDE column.
        missing_csv=lines[0]+'\n'+','.join(lines[1].split(',')[:-1])+'\n'
        report,selected=scan_csv_stream(io.StringIO(missing_csv),
            LongwallTelemetrySpec(min_source_rows=1,durable_sample_rows=1))
        self.assertEqual(report['parse_failures'],1)
        self.assertEqual(report['source_rows'],0)
        self.assertEqual(selected,[])

    def test_csv_row_with_surplus_value_is_counted_as_invalid_not_silently_dropped(self):
        lines=fixture_text().splitlines()
        mutated=lines[0]+'\n'+lines[1]+',HIDDEN_EXTRA_CELL\n'+'\n'.join(lines[2:])+'\n'
        spec=LongwallTelemetrySpec(min_source_rows=2,durable_sample_rows=2)
        report,selected=scan_csv_stream(io.StringIO(mutated),spec)
        self.assertEqual(report['source_rows'],2)
        self.assertEqual(report['parse_failures'],1)
        self.assertEqual(len(selected),2)
        with self.assertRaisesRegex(ValueError,'longwall_csv_row_width_invalid'):
            list(iter_canonical_rows(io.StringIO(mutated)))

    def test_unknown_header_columns_are_not_accepted_as_original_source(self):
        lines=fixture_text().splitlines()
        mutated=lines[0]+',EXTRA_CHANNEL\n'+'\n'.join(x+',0.25' for x in lines[1:])+'\n'
        spec=LongwallTelemetrySpec(min_source_rows=3,durable_sample_rows=2)
        with self.assertRaisesRegex(ValueError,'longwall_unexpected_column'):
            scan_csv_stream(io.StringIO(mutated),spec)

    def test_unknown_arff_attribute_cannot_be_dropped_without_evidence(self):
        lines=fixture_arff().splitlines()
        at=lines.index('@DATA')
        lines.insert(at,'@ATTRIBUTE EXTRA_CHANNEL NUMERIC')
        for index in range(at+2,len(lines)):
            if lines[index].strip():
                lines[index]+=',0.5'
        with self.assertRaisesRegex(ValueError,'longwall_unexpected_column'):
            scan_arff_stream(io.StringIO('\n'.join(lines)+'\n'),
                LongwallTelemetrySpec(min_source_rows=3,durable_sample_rows=2))


if __name__=='__main__':
    unittest.main()
