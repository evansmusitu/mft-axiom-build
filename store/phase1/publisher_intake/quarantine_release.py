#!/usr/bin/env python3
"""MUSITU Store V2 disposable upstream APK evidence gate.

Checks public publisher-owned GitHub release bytes, not publisher consent,
legal rights, malware clearance, signer ownership, or Store admission.
No private API key or publisher identity record is used.
"""
import argparse
import hashlib
import json
import re
import stat
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

RELEASES = (
    {"app": "Fossify Gallery", "release": "1.14.0", "package": "org.fossify.gallery",
     "url": "https://github.com/FossifyOrg/Gallery/releases/download/1.14.0/gallery-29-foss-release.apk",
     "size": 38538363, "sha256": "cfa321d7467b116741689f8f118b46011c882a4c2359b9320111f87c998af373"},
    {"app": "Material Files", "release": "v1.7.5", "package": "me.zhanghai.android.files",
     "url": "https://github.com/zhanghai/MaterialFiles/releases/download/v1.7.5/app-release-universal.apk",
     "size": 13747821, "sha256": "f2e7f028fbddf51d7ee90ace27a1ae4b247511e12514d1def6c9e52435feac40"},
)
ALLOWED_HOSTS = frozenset({'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'})
RISK_PERMISSIONS = ('MANAGE_EXTERNAL_STORAGE', 'QUERY_ALL_PACKAGES', 'REQUEST_INSTALL_PACKAGES',
                    'REQUEST_DELETE_PACKAGES', 'SYSTEM_ALERT_WINDOW', 'READ_SMS', 'SEND_SMS')

def allowed_release_url(raw):
    try:
        p = urllib.parse.urlsplit(raw)
        if p.scheme != 'https' or p.hostname not in ALLOWED_HOSTS or p.username or p.password or p.port or p.fragment:
            return False
        path = urllib.parse.unquote(p.path)
        if not path.startswith('/') or '..' in path.split('/') or '\\' in path or '//' in path:
            return False
        if p.hostname == 'github.com':
            return bool(re.fullmatch(r'/(?:FossifyOrg/Gallery|zhanghai/MaterialFiles)/releases/download/[^/]+/[^/]+\.apk', path)) and not p.query
        return path != '/'
    except (ValueError, TypeError):
        return False

def verify_artifact(path, expected_size, expected_sha256):
    path = Path(path)
    size = path.stat().st_size
    if size != expected_size: raise ValueError('size mismatch')
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1048576), b''): h.update(chunk)
    if h.hexdigest() != expected_sha256: raise ValueError('digest mismatch')
    return size

def inspect_apk_zip(path):
    try:
        with zipfile.ZipFile(path) as f:
            entries = f.infolist()
            if not entries or len(entries) > 50000: raise ValueError('unbounded archive entries')
            names = [e.filename for e in entries]
            if len(set(names)) != len(names): raise ValueError('duplicate archive paths')
            if 'AndroidManifest.xml' not in names: raise ValueError('missing AndroidManifest.xml')
            total_unpacked = 0
            for e in entries:
                n = e.filename
                if not n or n.startswith('/') or '\\' in n or '..' in n.split('/') or '\x00' in n:
                    raise ValueError('unsafe archive path')
                if e.flag_bits & 1: raise ValueError('encrypted archive member')
                if stat.S_IFMT(e.external_attr >> 16) == stat.S_IFLNK: raise ValueError('archive symlink')
                total_unpacked += e.file_size
                if total_unpacked > 1024 ** 3 or (e.file_size > 1000000 and e.file_size > 1000 * max(1, e.compress_size)):
                    raise ValueError('decompression bomb budget exceeded')
            bad = f.testzip()
            if bad is not None: raise ValueError('bad archive checksum')
            return {'archive_integrity': 'ZIP_ENTRIES_VALIDATED_ONLY', 'file_count': len(entries),
                    'unpacked_bytes': total_unpacked}
    except (zipfile.BadZipFile, OSError, EOFError) as e:
        raise ValueError('corrupt APK ZIP') from e

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def retrieve_release(url, size, expected_sha256, target):
    if not allowed_release_url(url) or urllib.parse.urlsplit(url).hostname != 'github.com':
        raise ValueError('untrusted initial release URL')
    opener = urllib.request.build_opener(NoRedirect())
    location = url
    for _ in range(5):
        if not allowed_release_url(location): raise ValueError('unsafe redirect destination')
        request = urllib.request.Request(location, headers={'User-Agent': 'MUSITU-Store-V2-private-release-integrity/1', 'Accept': 'application/octet-stream'})
        try:
            response = opener.open(request, timeout=30)
        except urllib.error.HTTPError as err:
            if err.code not in (301, 302, 303, 307, 308) or not err.headers.get('Location'):
                raise
            location = urllib.parse.urljoin(location, err.headers['Location'])
            err.close()
            continue
        with response:
            if response.status != 200: raise ValueError('unexpected download response')
            header = response.headers.get('Content-Length')
            if header and int(header) != size: raise ValueError('unexpected upstream artifact length')
            count = 0
            with Path(target).open('xb') as sink:
                while chunk := response.read(1048576):
                    count += len(chunk)
                    if count > size: raise ValueError('download exceeded exact length')
                    sink.write(chunk)
            return verify_artifact(target, size, expected_sha256)
    raise ValueError('release redirected too many times')

def run_tool(argv):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=120, check=False)
    if result.returncode: raise ValueError(f'Android SDK inspection failed: {argv[0]} status={result.returncode}')
    return result.stdout + '\n' + result.stderr

def inspect_apk(path, cfg, apksigner, aapt):
    report = inspect_apk_zip(path)
    signed = run_tool([apksigner, 'verify', '--verbose', '--print-certs', str(path)])
    signer = re.findall(r'Signer #\d+ certificate SHA-256 digest:\s*([0-9a-fA-F]{64})', signed)
    if not signer: raise ValueError('no native signing-certificate SHA-256 digest obtained')
    badging = run_tool([aapt, 'dump', 'badging', str(path)])
    match = re.search(r"^package: name='([^']+)' versionCode='(\d+)'", badging, re.MULTILINE)
    if not match or match.group(1) != cfg['package']: raise ValueError('unqualified package identity')
    permissions = run_tool([aapt, 'dump', 'permissions', str(path)])
    perms = set(re.findall(r"name='(android\.permission\.[A-Z_]+)'", permissions))
    report.update({
        'app': cfg['app'], 'upstream_release': cfg['release'], 'exact_upstream_sha256': cfg['sha256'],
        'actual_downloaded_bytes': cfg['size'], 'package_id': match.group(1), 'version_code': match.group(2),
        'certificate_sha256_digests': sorted(set(x.lower() for x in signer)),
        'declared_android_permission_count': len(perms),
        'manual_security_review_flags': sorted(p for p in perms if any(p.endswith(x) for x in RISK_PERMISSIONS)),
        'binary_integrity': 'SOURCE_BYTES_SHA256_AND_SIZE_MATCH',
        'native_apk_signatures': 'CRYPTOGRAPHICALLY_VALID_NOT_UPSTREAM_AUTHOR_IDENTITY_CERTIFIED',
        'malware_clearance': 'NOT_PERFORMED', 'publisher_consent': 'NOT_ESTABLISHED',
        'distribution_rights': 'NOT_APPROVED', 'real_physical_device_test': 'NOT_PERFORMED',
        'accepted_store_app': False, 'store_publication_authorized': False, 'store_commerce_enabled': False,
    })
    return report

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--apksigner', required=True)
    p.add_argument('--aapt', required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()
    results = []
    with tempfile.TemporaryDirectory(prefix='store-v2-private-apk-quarantine-') as tmp:
        for i, cfg in enumerate(RELEASES):
            apk = Path(tmp) / f'upstream-{i}.apk'
            retrieve_release(cfg['url'], cfg['size'], cfg['sha256'], apk)
            results.append(inspect_apk(apk, cfg, args.apksigner, args.aapt))
    Path(args.output).write_text(json.dumps({'schema':'musitu.store.quarantine-evidence.v1',
        'classification':'UPSTREAM_APK_BYTES_VERIFIED_STATIC_ONLY_NOT_PUBLISHER_APPROVED',
        'files_retained':False, 'results':results}, indent=2, sort_keys=True) + '\n')
    print(json.dumps({'status':'STATIC_QUARANTINE_VERIFIED_NOT_STORE_ACCEPTANCE',
                      'verified_artifacts':len(results),
                      'digests':[r['exact_upstream_sha256'] for r in results],
                      'publisher_approval_count':0,'malware_certified_count':0}))

if __name__ == '__main__': main()
