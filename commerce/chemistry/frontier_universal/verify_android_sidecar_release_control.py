#!/usr/bin/env python3
import json, pathlib, re, sys
HERE=pathlib.Path(__file__).resolve().parent
P=HERE/'ANDROID_SIDECAR_MIGRATION.json'
A=HERE/'ANDROID_SIDECAR_SOURCE_ARTIFACT.json'
j=json.loads(P.read_text())
a=json.loads(A.read_text())
checks=[]
def c(name, ok, detail=''): checks.append((name,bool(ok),detail))
c('schema',j.get('schema')=='musitu.chemistry.android_sidecar_migration.v1')
c('artifact_schema',a.get('schema')=='musitu.chemistry.android_sidecar.source_artifact.v1')
c('strategy',j.get('strategy')=='SIDE_BY_SIDE_MIGRATION')
c('legacy_package',j.get('legacy_application_id')=='com.mft.chemistry')
c('sidecar_package',j.get('sidecar_application_id')=='com.musitu.chemistry')
c('activity_preserved',j.get('preserved_native_activity')=='com.mft.chemistry.MainActivity')
for k in ['legacy_repaired_apk_sha256','legacy_repaired_certificate_sha256','baseline_frontier_unsigned_sha256','sidecar_unsigned_sha256','sidecar_v2_test_apk_sha256','sidecar_v2_test_certificate_sha256','sidecar_v2_test_content_digest_sha256']:
    c('sha256:'+k, bool(re.fullmatch(r'[0-9a-f]{64}',str(j.get(k,'')))))
c('repair_key_not_recovered',j.get('repair_private_key_recovered') is False)
v=j.get('v2_test_signature',{})
c('v2_test_only',v.get('verified_locally') is True and v.get('production_authority') is False and v.get('private_test_key_persisted') is False)
c('v2_algorithm',v.get('algorithm_id')=='0x0103' and v.get('block_id')=='0x7109871a')
ver=j.get('verification',{})
c('red_observed',ver.get('tdd_red_observed') is True)
c('focused_40',ver.get('focused_sidecar_contract')=='40/40 PASS')
c('unsigned_14',ver.get('independent_unsigned_sidecar')=='14/14 PASS')
c('signed_14',ver.get('independent_v2_test_signed_sidecar')=='14/14 PASS')
c('deterministic',ver.get('deterministic_unsigned_rebuild') is True)
c('double_transform_fail_closed',ver.get('double_transform_fail_closed') is True)
c('v2_verified',ver.get('v2_signature_and_content_digest')=='PASS')
m=j.get('migration_contract',{})
c('learner_schema_v2',m.get('learner_export_schema_version')==2 and m.get('learner_progress_export_import_compatible') is True)
c('commerce_separate',m.get('commercial_state_copied_between_installations') is False)
c('new_device_id',m.get('new_installation_device_id_expected') is True)
c('premium_reissue',m.get('premium_restore_or_reissue_required_for_new_device_id') is True)
b=j.get('manifest_change_boundary',{})
c('manifest_only',b.get('android_manifest_only') is True and b.get('dex_payload_changed') is False and b.get('resources_arsc_changed') is False and b.get('web_learning_assets_changed') is False)
c('debuggable_false',b.get('debuggable') is False)
pub=j.get('publication',{})
c('publication_false',pub.get('authorized') is False and pub.get('production_deployed') is False and pub.get('production_download_replaced') is False and pub.get('customer_exposed') is False)
c('open_production_signing_gate','durable production Android signing authority for com.musitu.chemistry' in j.get('open_gates',[]))
c('source_artifact_hash',bool(re.fullmatch(r'[0-9a-f]{64}',str(a.get('artifact_sha256','')))) and int(a.get('artifact_bytes',0))>0 and int(a.get('artifact_file_count',0))==25)
c('artifact_unsigned_matches',a.get('unsigned_apk',{}).get('sha256')==j.get('sidecar_unsigned_sha256'))
c('artifact_v2_matches',a.get('v2_test_apk',{}).get('sha256')==j.get('sidecar_v2_test_apk_sha256'))
c('artifact_v2_cert_matches',a.get('v2_test_apk',{}).get('certificate_sha256')==j.get('sidecar_v2_test_certificate_sha256'))
for key in ['library_file_id']:
    c('artifact_library_id',bool(re.fullmatch(r'file_[0-9a-f]+',str(a.get(key,'')))))
for section in ['unsigned_apk','v2_test_apk']:
    c('artifact_'+section+'_library_id',bool(re.fullmatch(r'file_[0-9a-f]+',str(a.get(section,{}).get('library_file_id','')))))
c('artifact_no_secrets',a.get('contains_private_keys') is False and a.get('contains_keystores') is False and a.get('contains_payment_secrets') is False and a.get('contains_licence_signing_private_key') is False)
c('artifact_no_authority',a.get('production_signing_authority') is False and a.get('publication_authority') is False and a.get('v2_test_apk',{}).get('production_authority') is False)
for bad in ['private_test_signing','sidecar-test-key.pem','.jks','.keystore']:
    c('no_private_key_reference:'+bad, bad not in P.read_text() and bad not in A.read_text())
failed=[x for x in checks if not x[1]]
for name,ok,detail in checks: print(('PASS' if ok else 'FAIL'),name,detail)
print(f'ANDROID_SIDECAR_RELEASE_CONTROL_CHECKS={len(checks)} PASS={len(checks)-len(failed)} FAIL={len(failed)}')
if failed: sys.exit(1)
print('MUSITU_CHEMISTRY_ANDROID_SIDECAR_RELEASE_CONTROL_PASS')
