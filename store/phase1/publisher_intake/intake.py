"""Private offline Android publisher review intake; never grants publish authority."""
from __future__ import annotations
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
from urllib.parse import urlsplit

MAX_REQUEST=65536
MAX_APK=512*1024*1024
HEX=re.compile(r'[0-9a-f]{64}\Z')
SLUG=re.compile(r'[a-z][a-z0-9-]{2,63}\Z')
ANDROID_PACKAGE=re.compile(r'[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+\Z')
EMAIL=re.compile(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,63}\Z')
FIELDS={'schema','publisherId','publisherName','appId','packageId','versionCode',
        'signingCertificateSha256','apkSha256','apkBytes','contactEmail',
        'privacyPolicyUrl','reviewTermsAccepted'}

class IntakeRejected(ValueError):
    pass

def _require(ok,problem):
    if not ok: raise IntakeRejected(problem)

def _pairs(items):
    result={}
    for k,v in items:
        _require(k not in result,'duplicate JSON key')
        result[k]=v
    return result

def _reject_constant(value):
    raise IntakeRejected('nonfinite JSON value')

def _string(obj,key,max_len=128):
    val=obj[key]
    _require(isinstance(val,str) and 1<=len(val)<=max_len
             and val==val.strip() and all(32<=ord(c)<=126 for c in val),
             'invalid '+key)
    return val

def _verified_https(raw):
    try:
        url=urlsplit(raw)
        host=url.hostname
        _require(url.scheme=='https' and host is not None and
                 url.username is None and url.password is None and url.port is None
                 and not url.query and not url.fragment and url.path.startswith('/')
                 and '\\' not in raw and '%' not in host and host.isascii()
                 and re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)+',host)
                 and not host.endswith('.local'),
                 'invalid HTTPS privacy policy URL')
        try: ipaddress.ip_address(host)
        except ValueError: pass
        else: raise IntakeRejected('IP-hosted privacy policy not allowed')
    except (ValueError,AttributeError) as err:
        raise IntakeRejected('invalid HTTPS privacy policy URL') from err

def _validate(raw):
    _require(isinstance(raw,bytes) and 2<=len(raw)<=MAX_REQUEST,
             'submission size unsupported')
    try:
        request=json.loads(raw.decode('utf-8',errors='strict'),
                           object_pairs_hook=_pairs,parse_constant=_reject_constant)
    except (ValueError,UnicodeDecodeError) as err:
        raise IntakeRejected('malformed publisher submission') from err
    _require(type(request) is dict and set(request)==FIELDS,
             'submission fields must match the private intake schema')
    _require(_string(request,'schema',64)=='musitu.store.publisher-submission.v1',
             'unknown intake schema')
    for key in ('publisherId','appId'):
        _require(bool(SLUG.fullmatch(_string(request,key,64))),'invalid '+key)
    _string(request,'publisherName',128)
    _require(bool(ANDROID_PACKAGE.fullmatch(_string(request,'packageId',255))),
             'invalid Android package identity')
    _require(type(request['versionCode']) is int and 1<=request['versionCode']<=2**63-1,
             'invalid versionCode')
    _require(type(request['apkBytes']) is int and 1<=request['apkBytes']<=MAX_APK,
             'invalid APK size')
    for key in ('apkSha256','signingCertificateSha256'):
        _require(bool(HEX.fullmatch(_string(request,key,64))),'invalid '+key)
    _require(bool(EMAIL.fullmatch(_string(request,'contactEmail',254))),
             'invalid publisher contact')
    _verified_https(_string(request,'privacyPolicyUrl',2048))
    _require(request['reviewTermsAccepted'] is True,'explicit manual-review terms required')
    return request

def _sha256_regular_file(path):
    flags=os.O_RDONLY|getattr(os,'O_NOFOLLOW',0)|getattr(os,'O_CLOEXEC',0)
    try: fd=os.open(Path(path),flags)
    except OSError as exc:
        raise IntakeRejected('cannot open APK as a regular non-symlink file') from exc
    with os.fdopen(fd,'rb') as stream:
        record=os.fstat(stream.fileno())
        _require(stat.S_ISREG(record.st_mode) and 1<=record.st_size<=MAX_APK,
                 'APK is not a supported regular file')
        digest=hashlib.sha256()
        size=0
        for data in iter(lambda:stream.read(65536),b''):
            size+=len(data)
            _require(size<=MAX_APK,'APK exceeds maximum size')
            digest.update(data)
        return digest.hexdigest(),size

def _tool(command):
    try:
        proc=subprocess.run(command,capture_output=True,text=True,
                            timeout=60,check=False)
    except (OSError,subprocess.TimeoutExpired) as err:
        raise IntakeRejected('Android SDK independent archive inspection unavailable') from err
    _require(proc.returncode==0 and len(proc.stdout)<=1_000_000,
             'Android SDK rejected APK archive')
    return proc.stdout

def _sdk_tool(name):
    # Prefer the provisioned Android SDK over unrelated PATH tools.
    root=os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    if root:
        for candidate in sorted((Path(root)/'build-tools').glob(f'*/{name}'),
                                reverse=True):
            if candidate.is_file() and os.access(candidate,os.X_OK):
                return str(candidate)
    found=shutil.which(name)
    if found: return found
    raise IntakeRejected('required Android SDK inspection tool unavailable: '+name)

def inspect_apk(path):
    """Inspect an actual signed APK through Android SDK, never applicant claims."""
    path=str(Path(path).absolute())
    cert_output=_tool([_sdk_tool('apksigner'),'verify','--print-certs',path])
    certs=[]
    for line in cert_output.splitlines():
        match=re.fullmatch(
            r'Signer #([1-9][0-9]*) certificate SHA-256 digest:[ \t]*([0-9a-fA-F]{64})',
            line.strip())
        if match:
            certs.append((int(match.group(1)),match.group(2)))
    if len(certs)!=1 or certs[0][0]!=1:
        # Safe parser diagnostics: disclose lengths/shape only, never publisher
        # certificate digests, DN identity, or APK bytes.
        shapes=[]
        for line in cert_output.splitlines():
            if 'certificate SHA-256 digest:' in line:
                digest_text=line.split('digest:',1)[-1].strip()
                shapes.append({'chars':len(digest_text),
                               'hex':bool(re.fullmatch(r'[0-9a-fA-F]+',digest_text)),
                               'line_prefix_space':len(line)-len(line.lstrip())})
        raise IntakeRejected('single APK signer not parsed; stdout_chars='+
                             str(len(cert_output))+' sha256_shapes='+str(shapes))
    badging=_tool([_sdk_tool('aapt'),'dump','badging',path])
    packages=re.findall(r"(?m)^package: name='([^']+)' versionCode='([0-9]+)'",badging)
    _require(len(packages)==1,'APK package identity unavailable')
    return {'package_id':packages[0][0],
            'version_code':int(packages[0][1]),
            'certificate_sha256':certs[0][1].lower()}

def verify_local_submission(raw,apk_path):
    """Verify independent local APK evidence; return only REVIEW_REQUIRED."""
    request=_validate(raw)
    pre_hash,pre_bytes=_sha256_regular_file(apk_path)
    _require(pre_hash==request['apkSha256'] and pre_bytes==request['apkBytes'],
             'APK does not match submitted digest and length')
    archive=inspect_apk(Path(apk_path))
    _require(type(archive) is dict and archive.get('package_id')==request['packageId'],
             'APK package differs from requested identity')
    _require(type(archive.get('version_code')) is int
             and archive['version_code']==request['versionCode'],
             'APK version differs from submission')
    _require(archive.get('certificate_sha256')==request['signingCertificateSha256'],
             'APK signer differs from requested signer')
    post_hash,post_bytes=_sha256_regular_file(apk_path)
    _require((post_hash,post_bytes)==(pre_hash,pre_bytes),
             'APK changed during independent inspection')
    return {'schema':'musitu.store.publisher-review.v1',
            'state':'REVIEW_REQUIRED','publisherId':request['publisherId'],
            'appId':request['appId'],'packageId':request['packageId'],
            'versionCode':request['versionCode'],'apkSha256':pre_hash,
            'signingCertificateSha256':request['signingCertificateSha256'],
            'conditions':['independent_publisher_identity','legal_ownership',
                          'signed_store_root_delegation','human_approval']}

def main():
    parser=argparse.ArgumentParser(description='Private Android publisher review preparation only')
    parser.add_argument('submission_json',type=Path)
    parser.add_argument('signed_apk',type=Path)
    args=parser.parse_args()
    try:
        result=verify_local_submission(args.submission_json.read_bytes(),args.signed_apk)
    except (IntakeRejected,OSError) as err:
        print('MUSITU_STORE_PUBLISHER_INTAKE_REJECTED: '+str(err),file=sys.stderr)
        return 1
    print(json.dumps(result,sort_keys=True,separators=(',',':')))
    return 0

if __name__=='__main__':
    sys.exit(main())
