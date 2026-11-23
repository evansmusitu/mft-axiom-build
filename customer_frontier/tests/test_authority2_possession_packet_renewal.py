"""Offline public packet renewal: no owner key or provider operations."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / 'scripts/build_authority2_possession_packet.py'
SOURCE = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
EVIDENCE = ROOT / 'customer_frontier/evidence/gate3_security_20261114/authority2_signer_possession_20261116'


class PublicPacketRenewalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='axiom-a2-renewal-')
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)

    def build(self, name='packet', renew=True, source=SOURCE):
        cmd = [sys.executable, str(BUILDER), '--out', str(self.base / name),
               '--source-commit', source]
        if renew:
            cmd.append('--renew-challenge')
        return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)

    def renewed(self, name='packet'):
        p = self.build(name)
        self.assertEqual(p.returncode, 0, p.stderr)
        return self.base / name, json.loads(p.stdout)

    def test_current_time_packet_fresh_and_pinned_to_original_authority(self):
        before = datetime.now(timezone.utc)
        directory, result = self.renewed()
        challenge = json.loads((directory / 'challenge.json').read_text())
        original = json.loads((EVIDENCE / 'challenge.json').read_text())
        issued = datetime.fromisoformat(challenge['issued_at_utc'])
        expires = datetime.fromisoformat(challenge['expires_at_utc'])
        self.assertGreaterEqual(issued.timestamp(), before.timestamp() - 1)
        self.assertLessEqual(issued, datetime.now(timezone.utc))
        self.assertEqual((expires - issued).total_seconds(), 86400)
        self.assertRegex(challenge['challenge_id'], r'^[0-9a-f]{64}$')
        self.assertNotEqual(challenge['challenge_id'], original['challenge_id'])
        for key in set(original) - {'challenge_id', 'issued_at_utc', 'expires_at_utc'}:
            self.assertEqual(challenge[key], original[key], key)
        self.assertFalse(result['gate3_closed'])
        self.assertFalse(result['private_key_material_included'])
        checked = subprocess.run(['node', str(directory / 'step3_authority2_signer_possession.mjs'),
                                  '--public-check'], capture_output=True, text=True)
        self.assertEqual(checked.returncode, 0, checked.stderr)

    def test_every_renewal_has_a_distinct_challenge(self):
        first, _ = self.renewed('first/packet')
        second, _ = self.renewed('second/packet')
        a = json.loads((first / 'challenge.json').read_text())
        b = json.loads((second / 'challenge.json').read_text())
        self.assertNotEqual(a['challenge_id'], b['challenge_id'])

    def test_derived_helper_changes_only_challenge_digest_and_wrapper_pin(self):
        directory, _ = self.renewed()
        original = subprocess.check_output(['git', 'show', SOURCE + ':customer_frontier/qualification/step3_authority2_signer_possession.mjs'], cwd=ROOT)
        actual = (directory / 'step3_authority2_signer_possession.mjs').read_bytes()
        digest = hashlib.sha256((directory / 'challenge.json').read_bytes()).hexdigest().encode()
        expected = re.sub(rb"(export const CHALLENGE_SHA256=')[a-f0-9]{64}(';)",
                          lambda m: m[1] + digest + m[2], original)
        self.assertEqual(actual, expected)
        wrapper = subprocess.check_output(['git', 'show', SOURCE + ':customer_frontier/qualification/step3_authority2_signer_possession.ps1'], cwd=ROOT)
        expected_wrapper = wrapper.replace(hashlib.sha256(original).hexdigest().encode(),
                                           hashlib.sha256(expected).hexdigest().encode())
        self.assertEqual((directory / 'Run_MUSITU_AXIOM_Authority2_Signer_Check.ps1').read_bytes(), expected_wrapper)

    def test_archive_and_manifest_bind_all_public_bytes(self):
        directory, result = self.renewed()
        archive = Path(result['archive'])
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), result['sha256'])
        manifest = json.loads((directory / 'PACKET_MANIFEST.json').read_text())
        self.assertEqual(manifest['tool_source_commit'], SOURCE)
        self.assertEqual(manifest['source_mode'], 'exact_git_bytes_with_public_challenge_renewal')
        self.assertEqual(manifest['network_operations'], 0)
        self.assertFalse(manifest['deployment_performed'])
        self.assertFalse(manifest['gate3_closed'])
        with zipfile.ZipFile(archive) as z:
            self.assertIsNone(z.testzip())
            self.assertEqual(set(z.namelist()), {x['name'] for x in manifest['files']} | {'PACKET_MANIFEST.json'})
            for entry in manifest['files']:
                data = z.read(entry['name'])
                self.assertEqual(len(data), entry['bytes'])
                self.assertEqual(hashlib.sha256(data).hexdigest(), entry['sha256'])
                self.assertEqual(data, (directory / entry['name']).read_bytes())

    def test_renewal_never_overwrites_an_existing_packet(self):
        directory, result = self.renewed()
        paths = list(directory.iterdir()) + [Path(result['archive'])]
        before = {p: p.read_bytes() for p in paths}
        denied = self.build()
        self.assertNotEqual(denied.returncode, 0)
        self.assertEqual({p: p.read_bytes() for p in paths}, before)

    def test_archive_collision_refuses_before_creating_a_new_directory(self):
        _, result = self.renewed()
        before = Path(result['archive']).read_bytes()
        denied = self.build('different-packet')
        self.assertNotEqual(denied.returncode, 0)
        self.assertFalse((self.base / 'different-packet').exists())
        self.assertEqual(Path(result['archive']).read_bytes(), before)

    def test_non_commit_source_is_rejected_before_output(self):
        denied = self.build(source='main')
        self.assertNotEqual(denied.returncode, 0)
        self.assertIn('exact full Git commit SHA', denied.stderr)
        self.assertFalse((self.base / 'packet').exists())

    def test_historical_packet_stays_byte_exact_without_renewal(self):
        p = self.build(renew=False)
        self.assertEqual(p.returncode, 0, p.stderr)
        directory = self.base / 'packet'
        original_challenge = subprocess.check_output(['git', 'show', SOURCE + ':customer_frontier/evidence/gate3_security_20261114/authority2_signer_possession_20261116/challenge.json'], cwd=ROOT)
        self.assertEqual((directory / 'challenge.json').read_bytes(), original_challenge)
        original = subprocess.check_output(['git', 'show', SOURCE + ':customer_frontier/qualification/step3_authority2_signer_possession.mjs'], cwd=ROOT)
        self.assertEqual((directory / 'step3_authority2_signer_possession.mjs').read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
