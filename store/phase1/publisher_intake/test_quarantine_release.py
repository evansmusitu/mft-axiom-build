import hashlib
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from quarantine_release import allowed_release_url, inspect_apk_zip, verify_artifact

def zip_bytes(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for name, value in entries.items(): z.writestr(name, value)
    return buf.getvalue()

class QuarantineTests(unittest.TestCase):
    def test_only_exact_github_release_host_or_approved_asset_redirect(self):
        good = ['https://github.com/zhanghai/MaterialFiles/releases/download/v1.7.5/app-release-universal.apk',
                'https://release-assets.githubusercontent.com/github-production-release-asset/1?X-Amz-Signature=abc']
        for url in good: self.assertTrue(allowed_release_url(url), url)
        bad = ['http://github.com/zhanghai/MaterialFiles/releases/download/x/a.apk',
               'https://github.com.evil.test/download',
               'https://127.0.0.1/attack.apk',
               'https://username:password@github.com/repo/x',
               'https://evil.com/x.apk',
               'https://github.com:444/repo/x',
               'https://github.com/../../x']
        for url in bad: self.assertFalse(allowed_release_url(url), url)

    def test_reject_modified_binary_and_byte_count(self):
        data = zip_bytes({'AndroidManifest.xml': b'manifest', 'classes.dex': b'dexcontent'})
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'candidate.apk';p.write_bytes(data)
            self.assertEqual(verify_artifact(p,len(data),hashlib.sha256(data).hexdigest()),len(data))
            with self.assertRaisesRegex(ValueError,'size'): verify_artifact(p,len(data)+1,hashlib.sha256(data).hexdigest())
            with self.assertRaisesRegex(ValueError,'digest'): verify_artifact(p,len(data),'0'*64)

    def test_reject_unsafe_archive_entries_and_missing_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            for entries in [{'../escape':b'z','AndroidManifest.xml':b'a'},
                            {'/root':b'bad','AndroidManifest.xml':b'a'},
                            {'classes.dex':b'dex'}]:
                p=Path(d)/'unsafe.apk';p.write_bytes(zip_bytes(entries))
                with self.assertRaises(ValueError):inspect_apk_zip(p)
            p.write_bytes(zip_bytes({'AndroidManifest.xml':b'a', 'classes.dex':b'dex'}))
            out=inspect_apk_zip(p)
            self.assertEqual(out['archive_integrity'],'ZIP_ENTRIES_VALIDATED_ONLY')

if __name__=='__main__': unittest.main()
