import copy
import hashlib
import json
import unittest
from pathlib import Path
from security_state import create_record,validate_record,AnchorDenied,EXPECTED_B27_SHA

TRANSCRIPT=b'''AXIOM_B27_B25_B26_EXACT_PARENT_SHA256_PASS\nAXIOM_B27_MANIFEST_SHA256_PASS 10\nAXIOM_B27_BOUNDARY_TESTS_PASS 15 NOT_EXTERNAL\nAXIOM_B27_GLOBAL_ROLLBACK_COUNTEREXAMPLE_REPRODUCED_NOT_FIXED\nAXIOM_B27_GLOBAL_ROLLBACK_COUNTEREXAMPLE_REPRODUCED_NOT_FIXED\n'''

class EvidenceAnchoringTests(unittest.TestCase):
    def make(self,raw=TRANSCRIPT,**updates):
        kw={'repo':'evansmusitu/mft-axiom-build','branch':'security/axiom-b27-provenance-preflight-s0-20261014',
        'commit':'a'*40,'b27_parent':EXPECTED_B27_SHA,'workflow_run_id':'12345','transcript':raw}
        kw.update(updates)
        return create_record(**kw)
    def test_positive_record_is_explicitly_not_production_authority(self):
        result=self.make()
        self.assertTrue(validate_record(result,TRANSCRIPT))
        self.assertFalse(result['production_authority'])
        self.assertFalse(result['provider_dispatch_allowed'])
        self.assertEqual(result['global_antirollback'],'FAILED_IN_SYNTHETIC_ATTACK')
        self.assertEqual(result['independent_witness'],'NOT_CERTIFIED')
        self.assertEqual(result['provider_zero_cost'],'NOT_VERIFIED')
        self.assertEqual(result['sigstore_provenance_status'],'NOT_PUBLISHED_APPROVAL_REQUIRED')
    def test_denies_missing_destructive_counterexample_marker(self):
        with self.assertRaises(AnchorDenied):self.make(TRANSCRIPT.replace(b'AXIOM_B27_GLOBAL_ROLLBACK_COUNTEREXAMPLE_REPRODUCED_NOT_FIXED',b'PASS'))
    def test_denies_missing_b27_test_success_marker(self):
        with self.assertRaises(AnchorDenied):self.make(TRANSCRIPT.replace(b'AXIOM_B27_BOUNDARY_TESTS_PASS 15 NOT_EXTERNAL',b'PASS'))
    def test_denies_unrelated_parent_source_sha(self):
        with self.assertRaises(AnchorDenied):self.make(b27_parent='b'*40)
    def test_denies_wrong_branch_repository_or_commit(self):
        for k,v in [('repo','evil/clone'),('branch','main'),('commit','deadbeef'),('workflow_run_id','')]:
            with self.subTest(k=k), self.assertRaises(AnchorDenied):self.make(**{k:v})
    def test_denies_claim_mutation_to_production(self):
        result=self.make();result['production_authority']=True
        with self.assertRaises(AnchorDenied):validate_record(result,TRANSCRIPT)
    def test_denies_claim_mutation_to_rollback_pass(self):
        result=self.make();result['global_antirollback']='CERTIFIED'
        with self.assertRaises(AnchorDenied):validate_record(result,TRANSCRIPT)
    def test_denies_forged_provider_cost_claim(self):
        result=self.make();result['provider_zero_cost']='VERIFIED'
        with self.assertRaises(AnchorDenied):validate_record(result,TRANSCRIPT)
    def test_transcript_digest_binding_and_reordering(self):
        result=self.make();self.assertEqual(result['transcript_sha256'],hashlib.sha256(TRANSCRIPT).hexdigest())
        with self.assertRaises(AnchorDenied):validate_record(result,TRANSCRIPT+b'\n')
    def test_denies_attestation_self_certification(self):
        result=self.make();result['sigstore_provenance_status']='VERIFIED'
        with self.assertRaises(AnchorDenied):validate_record(result,TRANSCRIPT)
    def test_strict_known_schema_and_type(self):
        result=self.make();result['unexpected']='something'
        with self.assertRaises(AnchorDenied):validate_record(result,TRANSCRIPT)
        result=self.make();result['production_authority']=0
        with self.assertRaises(AnchorDenied):validate_record(result,TRANSCRIPT)
    def test_excessive_or_empty_transcripts_denied(self):
        for raw in (b'',b'X'*1_000_001):
            with self.assertRaises(AnchorDenied):self.make(raw)

if __name__=='__main__':unittest.main()
