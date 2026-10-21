"""Exercise isolated publisher intake against a disposable independently signed CI APK."""
import hashlib
import json
from pathlib import Path
import sys
from intake import IntakeRejected, inspect_apk, verify_local_submission

def check_fixture(path):
    apk=Path(path)
    metadata=inspect_apk(apk)
    raw=apk.read_bytes()
    document={
        'schema':'musitu.store.publisher-submission.v1',
        'publisherId':'fixture-publisher-alpha',
        'publisherName':'Disposable CI Publisher',
        'appId':'fixture-alpha',
        'packageId':metadata['package_id'],
        'versionCode':metadata['version_code'],
        'signingCertificateSha256':metadata['certificate_sha256'],
        'apkSha256':hashlib.sha256(raw).hexdigest(),
        'apkBytes':len(raw),
        'contactEmail':'ci-fixture@example.org',
        'privacyPolicyUrl':'https://example.org/ci-test-only',
        'reviewTermsAccepted':True,
    }
    assert metadata['package_id']=='org.musitu.fixturealpha','unexpected fixture APK identity'
    def serialize(x):return json.dumps(x,separators=(',',':')).encode()
    result=verify_local_submission(serialize(document),apk)
    assert result['state']=='REVIEW_REQUIRED' and result['packageId']==metadata['package_id']
    tampered=dict(document,signingCertificateSha256='f'*64)
    try:verify_local_submission(serialize(tampered),apk)
    except IntakeRejected:pass
    else:raise AssertionError('false signer passed local review intake')
    tampered=dict(document,approved=True)
    try:verify_local_submission(serialize(tampered),apk)
    except IntakeRejected:pass
    else:raise AssertionError('applicant self-approval accepted')
    print('MUSITU_STORE_PUBLISHER_INTAKE_SIGNED_APK_PASS positive=1 negative=2 state=REVIEW_REQUIRED')

if __name__=='__main__':
    if len(sys.argv)!=2:
        raise SystemExit('Usage: python3 signed_apk_integration.py disposable-signed.apk')
    check_fixture(sys.argv[1])
