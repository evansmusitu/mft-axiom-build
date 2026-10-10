"""Lossless candidate partner mine adapter; no automatic mine-safety claims."""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from connect.mining_telemetry import MINING_TELEMETRY_SENSORS
from connect.partner_mine_mapping import (
    assess_partner_mapping, transcode_partner_mine_telemetry,
)

START=datetime(2025, 5, 1, tzinfo=timezone.utc)


class PartnerMineMappingTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name)
        self.source=root/'authorized_partner_private.ndjson'
        self.mapping=root/'partner_mapping_private.json'
        self.canonical=root/'canonical.ndjson'
        self.manifest=root/'canonical_manifest_private.json'
        self.bindings=[{
            'source_field':'raw_'+sensor,'canonical_sensor':sensor,
            'transform':'identity','unit_equivalence_reference':'source-owner-unit-record',
            'location_equivalence_reference':'source-owner-installation-record',
        } for sensor in MINING_TELEMETRY_SENSORS]
        self.profile={
            'schema':'musitu.connect.mining.partner_sensor_mapping.v1',
            'source_site_id':'CONFIDENTIAL_PARTNER_SITE',
            'source_collection_id':'CONFIDENTIAL_COLLECTION',
            'source_time_field':'recorded_at',
            'source_sampling_interval_seconds':1,
            'interpolation_applied':False,'missing_values_filled':False,
            'downsampling_applied':False,
            'rights_basis':'DECLARED_OWNER_PERMISSION_PENDING_EXTERNAL_REVIEW',
            'authorization_reference':'PRIVATE_PERMISSION_RECORD',
            'provenance_reference':'PRIVATE_COLLECTION_RECORD',
            'state_semantics_reference':'PRIVATE_LEFT_RIGHT_DIRECTION_RECORD',
            'bindings':self.bindings,
        }
        self.rows=[]
        for i in range(1400):
            r={b['source_field']:("left" if b['canonical_sensor']=='F_SIDE' else .2)
               for b in self.bindings}
            r['recorded_at']=(START+timedelta(seconds=i)).isoformat()
            if 1150<=i<1170:r['raw_MM263']=1.2
            self.rows.append(r)
        self.save()

    def save(self):
        self.mapping.write_text(json.dumps(self.profile),encoding='utf-8')
        with self.source.open('w',encoding='utf-8') as f:
            for row in self.rows:f.write(json.dumps(row,sort_keys=True)+'\n')

    def run_adapter(self):
        return transcode_partner_mine_telemetry(source=self.source,mapping_path=self.mapping,
                        output_source=self.canonical,output_manifest=self.manifest)

    def test_reports_complete_mapping_but_never_verifies_real_world_equivalence(self):
        summary=assess_partner_mapping(self.profile)
        self.assertEqual(summary['mapped_sensors'],28)
        self.assertFalse(summary['unit_semantics_independently_verified'])
        self.assertFalse(summary['real_mine_site_independently_verified'])
        self.assertFalse(summary['independent_validation'])
        self.assertFalse(summary['production_admission'])
        self.assertNotIn('source_site_id',summary)
        self.assertNotIn('rights_basis',summary)

    def test_connect_adapter_must_not_depend_on_downstream_axiom_benchmarks(self):
        import ast
        path = Path(__file__).parents[2] / 'connect' / 'partner_mine_mapping.py'
        imports = [n.module for n in ast.walk(ast.parse(path.read_text()))
                   if isinstance(n, ast.ImportFrom)]
        self.assertFalse([m for m in imports if m and m.startswith('benchmarks.')])

    def test_native_numeric_direction_states_are_preserved(self):
        for j, value in enumerate((0.0,0.5,1.0,'right','L')):
            self.rows[1300+j]['raw_F_SIDE']=value
        self.save()
        result=self.run_adapter()
        records=list(map(json.loads,self.canonical.read_text().splitlines()))
        self.assertEqual([records[1300+j]['F_SIDE'] for j in range(5)],
                         [0.0,0.5,1.0,'right','L'])
        self.assertFalse(result['independent_validation'])

    def test_real_canonical_telemetry_preflight_after_no_value_transform(self):
        report=self.run_adapter()
        self.assertEqual(report['source_rows'],1400)
        self.assertFalse(report['independent_validation'])
        self.assertFalse(report['production_admission'])
        self.assertTrue(report['identity_transforms_only'])
        self.assertEqual(report['original_sha256'],hashlib.sha256(self.source.read_bytes()).hexdigest())
        emitted=list(map(json.loads,self.canonical.read_text().splitlines()))
        self.assertEqual(len(emitted),1400)
        self.assertEqual(set(emitted[0]),{'event_time',*MINING_TELEMETRY_SENSORS})
        for i in (0,1150,1180,1399):
            self.assertEqual(emitted[i]['MM263'],self.rows[i]['raw_MM263'])
            self.assertEqual(emitted[i]['F_SIDE'],self.rows[i]['raw_F_SIDE'])
            self.assertEqual(emitted[i]['event_time'],self.rows[i]['recorded_at'])
        metadata=json.loads(self.manifest.read_text())
        self.assertEqual(metadata['source_sha256'],hashlib.sha256(self.canonical.read_bytes()).hexdigest())
        try:
            from benchmarks.mining_adapter.external_source_preflight import inspect_external_source
        except ImportError:
            self.skipTest("External preflight module not mounted in local baseline snapshot")
        preflight=inspect_external_source(source=self.canonical,manifest_path=self.manifest)
        self.assertGreater(preflight['eligible_examples'],0)
        self.assertFalse(preflight['independent_validation'])
        self.assertNotIn('CONFIDENTIAL',json.dumps(report))
        self.assertTrue(report['source_values_not_rescaled'])

    def test_incomplete_sensor_coverage_rejected_no_output(self):
        self.profile['bindings'].pop()
        self.save()
        with self.assertRaisesRegex(ValueError,'mapping_incomplete'):
            self.run_adapter()
        self.assertFalse(self.canonical.exists())
        self.assertFalse(self.manifest.exists())

    def test_duplicate_raw_field_or_canonical_sensor_rejected(self):
        self.profile['bindings'][1]['source_field']=self.profile['bindings'][0]['source_field']
        self.save()
        with self.assertRaisesRegex(ValueError,'mapping_duplicate'):
            self.run_adapter()
        self.assertFalse(self.canonical.exists())

    def test_rejects_resampling_imputation_and_transforms(self):
        for field,value in [('source_sampling_interval_seconds',15),
                            ('interpolation_applied',True),('missing_values_filled',True),
                            ('downsampling_applied',True)]:
            with self.subTest(field=field):
                self.profile[field]=value
                with self.assertRaisesRegex(ValueError,'mapping_source_cadence_or_imputation'):
                    assess_partner_mapping(self.profile)
                self.profile[field]=False if field.endswith('applied') or field=='missing_values_filled' else 1
        self.profile['bindings'][0]['transform']='multiply_by_60'
        self.save()
        with self.assertRaisesRegex(ValueError,'mapping_identity_only'):
            self.run_adapter()

    def test_missing_calibration_or_equivalence_reference_is_not_silent(self):
        self.profile['bindings'][4]['location_equivalence_reference']=''
        self.save()
        with self.assertRaisesRegex(ValueError,'mapping_equivalence_declaration_missing'):
            self.run_adapter()

    def test_fails_if_raw_field_missing_or_out_of_order_and_no_partial_output(self):
        self.rows[1000].pop('raw_MM263');self.save()
        with self.assertRaisesRegex(ValueError,'raw_schema_mismatch'):
            self.run_adapter()
        self.assertFalse(self.canonical.exists());self.assertFalse(self.manifest.exists())
        self.rows[1000]['raw_MM263']=.2
        self.rows[1000]['recorded_at']=self.rows[999]['recorded_at'];self.save()
        with self.assertRaisesRegex(ValueError,'timestamp_noncontiguous'):
            self.run_adapter()
        self.assertFalse(self.canonical.exists());self.assertFalse(self.manifest.exists())

    def test_declared_one_second_source_cannot_hide_15s_measurements(self):
        for i,row in enumerate(self.rows):
            row['recorded_at']=(START+timedelta(seconds=i*15)).isoformat()
        self.save()
        with self.assertRaisesRegex(ValueError,'timestamp_noncontiguous'):
            self.run_adapter()

    def test_nonfinite_numeric_bool_sensor_and_invalid_direction_rejected(self):
        self.rows[999]['raw_MM263']=float('nan');self.save()
        with self.assertRaisesRegex(ValueError,'raw_sensor_invalid'):
            self.run_adapter()
        self.rows[999]['raw_MM263']=True;self.save()
        with self.assertRaisesRegex(ValueError,'raw_sensor_invalid'):
            self.run_adapter()
        self.rows[999]['raw_MM263']=.2
        self.rows[999]['raw_F_SIDE']='undocumented';self.save()
        with self.assertRaisesRegex(ValueError,'raw_sensor_invalid'):
            self.run_adapter()

    def test_existing_file_refused_without_modification(self):
        self.canonical.write_text('do not overwrite',encoding='utf-8')
        with self.assertRaises(FileExistsError):
            self.run_adapter()
        self.assertEqual(self.canonical.read_text(),'do not overwrite')
        self.assertFalse(self.manifest.exists())

    def test_invalid_rights_metadata_rejected(self):
        self.profile['authorization_reference']='  '
        self.save()
        with self.assertRaisesRegex(ValueError,'mapping_declarations_incomplete'):
            self.run_adapter()
        self.assertFalse(self.manifest.exists())

if __name__=='__main__':unittest.main()
