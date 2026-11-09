import base64
from dataclasses import replace
import hashlib
import importlib.util
import sys
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

target=Path(__file__).resolve().parents[1] / 'recovery' / 'verify_prod_oauth_encrypted_intake.py'
spec=importlib.util.spec_from_file_location('verify_prod_oauth_encrypted_intake',target)
subject=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=subject
spec.loader.exec_module(subject)
Pins,PRODUCTION_PINS,verify_zip=subject.Pins,subject.PRODUCTION_PINS,subject.verify_zip


def canonical(obj):
    return json.dumps(obj, separators=(',', ':'), sort_keys=True).encode()


def sha(b):
    return hashlib.sha256(b).hexdigest()


def fake_zip(path, *, change=None, filename='prod-oauth-current-20261108.json.enc', extra=None):
    # Completely synthetic opaque ciphertext: never use real user data or keys.
    cipher = b'ciphertext not SQL'
    header = {
        'schema': 'musitu.axiom.d1_logical_export.v1',
        'database_id': '00000000-1111-4111-8111-222222222222',
        'catalog_sha256': 'a'*64,
        'recipient_public_sha256': 'b'*64,
        'source_sha': 'c'*40,
        'sql_sha256': 'd'*64,
        'sql_bytes': len(cipher),
        'created_at': '2026-11-08T07:42:00Z',
    }
    envelope = {
        'schema': 'musitu.axiom.encrypted_d1_backup.v1',
        'algorithm': 'RSA-OAEP-SHA256+AES-256-GCM',
        'aad_b64': base64.b64encode(canonical(header)).decode(),
        'nonce_b64': base64.b64encode(b'1'*12).decode(),
        'tag_b64': base64.b64encode(b'2'*16).decode(),
        'wrapped_key_b64': base64.b64encode(b'3'*512).decode(),
        'ciphertext_b64': base64.b64encode(cipher).decode(),
    }
    pins = Pins(envelope_sha256=sha(canonical(envelope)), sql_sha256=header['sql_sha256'],
                sql_bytes=len(cipher), catalog_sha256=header['catalog_sha256'],
                source_sha=header['source_sha'], database_id=header['database_id'],
                recipient_sha256=header['recipient_public_sha256'])
    receipt = {
        'schema':'musitu.axiom.existing_d1_backup_export.v1',
        'database_id':header['database_id'], 'source_sha':header['source_sha'],
        'recipient_public_sha256':header['recipient_public_sha256'],
        'catalog_sha256':header['catalog_sha256'], 'envelope_sha256':pins.envelope_sha256,
        'envelope_bytes':len(canonical(envelope)), 'export_started':True,
        'export_complete':True, 'catalog_read_zero_writes':True,
        'backup_saved_to_drive':False,'restore_qualified':False,
        'hosted_migration_qualified':False,'target_admitted':False,'release_authority':False,
        'transport':[],
    }
    if change:
        change(envelope,receipt,header)
        if header:
            # Caller may override envelope.aad_b64 explicitly to exercise mismatches.
            pass
    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(filename,canonical(envelope))
        z.writestr('prod-oauth-backup-receipt.json',canonical(receipt))
        if extra:
            z.writestr(extra,b'evil')
    return pins


class EncryptedIntake(unittest.TestCase):
    def test_known_pins_match_source_contract(self):
        self.assertEqual(PRODUCTION_PINS.sql_bytes,2453521)
        self.assertEqual(PRODUCTION_PINS.database_id,'504029cc-f9a5-495e-818f-63c6144b4ea4')

    def test_synthetic_encrypted_envelope_is_admitted_for_intake_only(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'data.zip'
            pins=fake_zip(path)
            receipt=verify_zip(path,pins=pins)
            self.assertEqual(receipt['status'],'EXACT_ENCRYPTED_OAUTH_INTAKE_VERIFIED_NOT_RESTORED')
            self.assertFalse(receipt['decryption_performed'])
            self.assertFalse(receipt['hosted_restore_qualified'])
            self.assertFalse(receipt['release_authority'])
            self.assertNotIn('ciphertext not SQL',str(receipt))

    def test_rejects_unpinned_envelope(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'data.zip'
            pins=fake_zip(path,change=lambda envelope,receipt,header:envelope.__setitem__('algorithm','none'))
            with self.assertRaises(ValueError):verify_zip(path,pins=pins)

    def test_rejects_wrong_member_and_unexpected_payload(self):
        with tempfile.TemporaryDirectory() as folder:
            for extra in ('../secret.sql','data.txt'):
                path=Path(folder)/'data.zip';pins=fake_zip(path,extra=extra)
                with self.assertRaises(ValueError):verify_zip(path,pins=pins)

    def test_rejects_duplicate_json_even_when_envelope_pin_is_recomputed(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'data.zip';pins=fake_zip(path)
            with zipfile.ZipFile(path) as z:
                original=z.read('prod-oauth-current-20261108.json.enc')
                receipt=json.loads(z.read('prod-oauth-backup-receipt.json'))
            encrypted=original[:-1]+b',"algorithm":"RSA-OAEP-SHA256+AES-256-GCM"}'
            pins=replace(pins,envelope_sha256=sha(encrypted))
            receipt['envelope_sha256']=pins.envelope_sha256
            receipt['envelope_bytes']=len(encrypted)
            with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as z:
                z.writestr('prod-oauth-current-20261108.json.enc',encrypted)
                z.writestr('prod-oauth-backup-receipt.json',canonical(receipt))
            with self.assertRaisesRegex(ValueError,'DUPLICATE_JSON_MEMBER'):
                verify_zip(path,pins=pins)

    def test_rejects_wrong_authentication_header_despite_matching_outer_digest(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'data.zip';pins=fake_zip(path)
            with zipfile.ZipFile(path) as z:
                envelope=json.loads(z.read('prod-oauth-current-20261108.json.enc'))
                receipt=json.loads(z.read('prod-oauth-backup-receipt.json'))
            header=json.loads(base64.b64decode(envelope['aad_b64']))
            header['database_id']='wrong-database'
            envelope['aad_b64']=base64.b64encode(canonical(header)).decode()
            encrypted=canonical(envelope)
            pins=replace(pins,envelope_sha256=sha(encrypted))
            receipt['envelope_sha256']=pins.envelope_sha256
            receipt['envelope_bytes']=len(encrypted)
            with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as z:
                z.writestr('prod-oauth-current-20261108.json.enc',encrypted)
                z.writestr('prod-oauth-backup-receipt.json',canonical(receipt))
            with self.assertRaisesRegex(ValueError,'HEADER_SOURCE_PROVENANCE_MISMATCH'):
                verify_zip(path,pins=pins)

    def test_rejects_pretend_release_attestation(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'data.zip'
            pins=fake_zip(path,change=lambda envelope,receipt,header:receipt.__setitem__('release_authority',True))
            with self.assertRaisesRegex(ValueError,'SOURCE_RECEIPT_MISMATCH'):
                verify_zip(path,pins=pins)

    def test_rejects_wrong_backup_receipt(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'data.zip'
            pins=fake_zip(path,change=lambda envelope,receipt,header:receipt.__setitem__('database_id','wrong-db'))
            with self.assertRaises(ValueError):verify_zip(path,pins=pins)


if __name__=='__main__':unittest.main()
