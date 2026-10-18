import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from intake import IntakeRejected, verify_local_submission, inspect_apk

CERT = 'a'*64
APK = b'test-only-not-an-actual-APK; metadata inspection mocked at the trusted tool boundary'

def verified_metadata(_path):
    return {'package_id':'org.fixture.vendorapp','version_code':7,'certificate_sha256':CERT}

def submission(apk,**overrides):
    fields={
      'schema':'musitu.store.publisher-submission.v1',
      'publisherId':'independent-vendor',
      'publisherName':'Independent Vendor',
      'appId':'independent-vendor-app',
      'packageId':'org.fixture.vendorapp',
      'versionCode':7,
      'signingCertificateSha256':CERT,
      'apkSha256':hashlib.sha256(apk).hexdigest(),
      'apkBytes':len(apk),
      'contactEmail':'developer@example.org',
      'privacyPolicyUrl':'https://example.org/privacy',
      'reviewTermsAccepted':True
    }
    fields.update(overrides)
    return json.dumps(fields,separators=(',',':')).encode()

class PublisherIntakeContract(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.apk=Path(self.temp.name)/'app.apk'
        self.apk.write_bytes(APK)

    def check(self,raw=None,inspector=verified_metadata):
        with patch('intake.inspect_apk',side_effect=inspector):
            return verify_local_submission(raw if raw is not None else submission(APK),self.apk)

    def rejected(self,raw=None,inspector=verified_metadata):
        with self.assertRaises(IntakeRejected):
            self.check(raw,inspector)

    def test_verified_apk_remains_pending_independent_ownership_review(self):
        result=self.check()
        self.assertEqual(result['state'],'REVIEW_REQUIRED')
        self.assertEqual(result['publisherId'],'independent-vendor')
        self.assertEqual(result['apkSha256'],hashlib.sha256(APK).hexdigest())
        self.assertNotIn('approved',result)
        self.assertNotIn('grants',result)

    def test_wrong_artifact_digest_is_blocked(self):
        self.rejected(submission(APK,apkSha256='f'*64))

    def test_wrong_native_signing_certificate_is_blocked(self):
        self.rejected(submission(APK,signingCertificateSha256='0'*64))

    def test_wrong_native_package_identity_is_blocked(self):
        self.rejected(submission(APK,packageId='org.fixture.anotherapp'))

    def test_wrong_native_version_is_blocked(self):
        self.rejected(submission(APK,versionCode=6))

    def test_unsigned_or_uninspectable_artifact_is_blocked(self):
        def bad(_): raise IntakeRejected('APK has no independently verified signature')
        self.rejected(inspector=bad)

    def test_duplicate_json_key_is_blocked(self):
        raw=submission(APK).decode().replace(
            '"publisherId":"independent-vendor",',
            '"publisherId":"other-vendor","publisherId":"independent-vendor",')
        self.rejected(raw.encode())

    def test_no_permission_to_self_approve(self):
        raw=json.loads(submission(APK))
        raw['approved']=True
        self.rejected(json.dumps(raw).encode())

    def test_explicit_terms_and_https_privacy_policy_required(self):
        self.rejected(submission(APK,reviewTermsAccepted=False))
        self.rejected(submission(APK,privacyPolicyUrl='http://example.org/privacy'))
        self.rejected(submission(APK,privacyPolicyUrl='https://127.0.0.1/p'))

    def test_symlink_apk_is_rejected(self):
        link=Path(self.temp.name)/'aliased.apk'
        link.symlink_to(self.apk)
        with self.assertRaises(IntakeRejected):
            verify_local_submission(submission(APK),link)

    def test_apk_changed_between_check_and_inspection_is_rejected(self):
        def tamper(path):
            path.write_bytes(b'modified')
            return verified_metadata(path)
        self.rejected(inspector=tamper)

    def test_apksigner_tool_metadata_is_parsed_and_multiple_signers_rejected(self):
        cert='a'*64
        one='Signer #1 certificate SHA-256 digest: '+cert+'\n'
        package="package: name='org.fixture.vendorapp' versionCode='7' versionName='1.0'\n"
        with patch('intake._sdk_tool',side_effect=lambda name:name),patch('intake._tool',side_effect=[one,package]):
            self.assertEqual(inspect_apk(self.apk),verified_metadata(self.apk))
        with patch('intake._sdk_tool',side_effect=lambda name:name),patch('intake._tool',side_effect=[one+one.replace('#1','#2'),package]):
            with self.assertRaises(IntakeRejected):
                inspect_apk(self.apk)

    def test_malformed_utf8_or_json_is_blocked(self):
        self.rejected(b'\xff\xfe')
        self.rejected(b'{hello}')

if __name__=='__main__':
    unittest.main()
