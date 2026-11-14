import importlib.util
import os
import pathlib
import shutil
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1]/'qualification'/'step1_owner_restored_keys_rehearsal.py'
spec = importlib.util.spec_from_file_location('step1_owner_restored_keys_rehearsal',MODULE_PATH)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

@unittest.skipUnless(shutil.which('openssl'), 'OpenSSL not available')
class OwnerKeyRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='axiom-owner-restore-test-')
        self.addCleanup(self.temp.cleanup)
        td = pathlib.Path(self.temp.name)
        self.original = td/'original'
        self.original.mkdir()
        (self.original/'public').mkdir()
        (self.original/'private').mkdir()
        self.restored = td/'restored'
        self.restored.mkdir()
        (self.restored/'private').mkdir(mode=0o700)
        self.output = td/'out'
        self.passphrase = 'SYNTHETIC-ONLY-TEST-NEVER-OWNER'
        for kind,alg in [('ed25519','ED25519'),('x25519','X25519')]:
            private=self.original/'private'/f'owner_{kind}_pkcs8_encrypted.pem'
            subprocess.run(['openssl','genpkey','-algorithm',alg,'-aes-256-cbc',
                '-pass','pass:'+self.passphrase,'-out',str(private)],check=True,capture_output=True)
            public=(self.original/'public'/f'owner_{kind}_spki.pem')
            subprocess.run(['openssl','pkey','-in',str(private),'-passin','pass:'+self.passphrase,
                '-pubout','-out',str(public)],check=True,capture_output=True)
            subprocess.run(['openssl','pkey','-pubin','-in',str(public),'-outform','DER',
                '-out',str(self.original/'public'/f'owner_{kind}_spki.der')],check=True,capture_output=True)
            target=self.restored/'private'/private.name
            shutil.copy2(private,target)
            target.chmod(0o600)
        self.signpin=m.digest((self.original/'public'/m.PUBLIC_SIGN).read_bytes())
        self.encpin=m.digest((self.original/'public'/m.PUBLIC_ENC).read_bytes())

    def valid(self,**kwargs):
        args=dict(original=self.original,restored=self.restored,target=self.output,
                  trusted_sign=self.signpin,trusted_enc=self.encpin)
        args.update(kwargs)
        return m.preflight(**args)

    def assert_denied(self,code,**kwargs):
        with self.assertRaises(m.NoGo) as err:
            self.valid(**kwargs)
        self.assertEqual(str(err.exception),code)
        self.assertFalse(self.output.exists())

    def test_synthetic_separate_encrypted_key_copy_matches_external_pins(self):
        v=self.valid()
        self.assertEqual(v['trusted_sign'],self.signpin)
        self.assertEqual(v['trusted_enc'],self.encpin)
        self.assertFalse(self.output.exists())

    def test_missing_or_self_substituted_trust_pins_denied(self):
        self.assert_denied('REVIEWED_PUBLIC_TRUST_PINS_REQUIRED',trusted_sign=None)
        self.assert_denied('PUBLIC_KEYS_DO_NOT_MATCH_EXTERNAL_TRUST',trusted_enc='0'*64)

    def test_same_directory_copy_denied(self):
        self.assert_denied('RESTORED_COPY_MUST_BE_SEPARATE',restored=self.original)

    def test_output_nested_inside_key_directory_denied(self):
        nested=self.restored/'proof'
        self.assert_denied('OUTPUT_MUST_BE_OUTSIDE_KEY_DIRECTORIES',target=nested)

    def test_output_parent_alias_into_keys_denied(self):
        alias = self.output.parent / 'output-alias'
        alias.symlink_to(self.restored, target_is_directory=True)
        self.assert_denied('NONCANONICAL_DIRECTORY_REFUSED', target=alias/'receipt')
        self.assertFalse((self.restored/'receipt').exists())

    def test_output_parent_dotdot_into_keys_denied(self):
        alias = self.original / '..' / self.restored.name
        self.assert_denied('NONCANONICAL_DIRECTORY_REFUSED', target=alias/'receipt')
        self.assertFalse((self.restored/'receipt').exists())

    def test_restored_private_directory_requires_private_permissions(self):
        private = self.restored / 'private'
        for mode in (0o755, 0o770, 0o777):
            with self.subTest(mode=oct(mode)):
                private.chmod(mode)
                self.assert_denied('RESTORED_PRIVATE_DIRECTORY_PERMISSIONS_TOO_OPEN')

    def test_other_user_writable_ancestry_denied(self):
        for directory in (self.original, self.restored, self.output.parent):
            with self.subTest(directory=directory.name):
                original_mode = stat.S_IMODE(directory.stat().st_mode)
                try:
                    directory.chmod(0o777)
                    self.assert_denied('DIRECTORY_WRITABLE_BY_OTHERS')
                finally:
                    directory.chmod(original_mode)

    def test_restored_private_hardlink_to_original_denied(self):
        recovered=self.restored/'private'/m.SIGN_KEY
        recovered.unlink()
        os.link(self.original/'private'/m.SIGN_KEY,recovered)
        self.assert_denied('RESTORED_COPY_HARDLINKS_ORIGINAL')

    def test_public_key_substitution_denied(self):
        a=self.original/'public'/m.PUBLIC_SIGN
        a.write_bytes((self.original/'public'/m.PUBLIC_ENC).read_bytes())
        self.assert_denied('PUBLIC_KEYS_DO_NOT_MATCH_EXTERNAL_TRUST')

    def test_unencrypted_private_key_denied(self):
        p=self.restored/'private'/m.SIGN_KEY
        p.write_bytes(b'-----BEGIN PRIVATE KEY-----\n'+b'x'*80)
        self.assert_denied('RECOVERED_KEY_NOT_PKCS8_ENCRYPTED')

    def test_symlinked_restored_private_denied(self):
        p=self.restored/'private'/m.SIGN_KEY
        p.unlink()
        p.symlink_to(self.original/'private'/m.SIGN_KEY)
        self.assert_denied('MISSING_OR_INVALID_ENCRYPTED_KEY')

    def test_symlinked_public_key_denied(self):
        p=self.original/'public'/m.PUBLIC_SIGN
        real=p.with_suffix('.real')
        p.rename(real)
        p.symlink_to(real)
        self.assert_denied('INVALID_PUBLIC_SPKI')

    def test_permissive_restored_private_mode_denied(self):
        (self.restored/'private'/m.SIGN_KEY).chmod(0o644)
        self.assert_denied('RECOVERED_PRIVATE_KEY_PERMISSIONS_TOO_OPEN')

    def test_existing_output_never_overwritten(self):
        self.output.mkdir()
        with self.assertRaises(m.NoGo) as e: self.valid()
        self.assertEqual(str(e.exception),'OUTPUT_MUST_BE_NEW')
        self.assertTrue(self.output.exists())

    def test_noninteractive_cloud_ci_denied_before_decrypt(self):
        with self.assertRaises(m.NoGo) as e:
            m.do_rehearsal(self.original,self.restored,self.output,self.signpin,self.encpin,
                'I RESTORED ENCRYPTED COPIES ON MY OWN DEVICE')
        self.assertEqual(str(e.exception),'INTERACTIVE_OWNER_DEVICE_ONLY')
        self.assertFalse(self.output.exists())

    def test_wrong_confirmation_denied_with_mocked_terminal(self):
        with patch.object(m.sys.stdin,'isatty',return_value=True),patch.object(m.sys.stdout,'isatty',return_value=True),\
             patch.dict(os.environ,{'CI':'','GITHUB_ACTIONS':''}):
            with self.assertRaises(m.NoGo) as e:
                m.do_rehearsal(self.original,self.restored,self.output,self.signpin,self.encpin,'INVALID')
        self.assertEqual(str(e.exception),'EXPLICIT_OWNER_OFFLINE_CONFIRMATION_REQUIRED')
        self.assertFalse(self.output.exists())

    def test_synthetic_crypto_interoperability_with_encrypted_keys(self):
        # Proof of offline primitives under synthetic passwords only; not an owner rehearsal.
        with tempfile.TemporaryDirectory() as td:
            td=pathlib.Path(td)
            challenge=td/'challenge';challenge.write_bytes(os.urandom(64))
            signature=td/'signature'
            signpriv=self.restored/'private'/m.SIGN_KEY
            signpub=self.original/'public'/'owner_ed25519_spki.pem'
            subprocess.run(['openssl','pkeyutl','-sign','-rawin','-inkey',str(signpriv),
                '-passin','pass:'+self.passphrase,'-in',str(challenge),'-out',str(signature)],
                capture_output=True,check=True)
            subprocess.run(['openssl','pkeyutl','-verify','-rawin','-pubin','-inkey',str(signpub),
                '-in',str(challenge),'-sigfile',str(signature)],capture_output=True,check=True)
            ephem=td/'ephem.pem'; ephem_pub=td/'ephem.pub'
            subprocess.run(['openssl','genpkey','-algorithm','X25519','-out',str(ephem)],capture_output=True,check=True)
            subprocess.run(['openssl','pkey','-in',str(ephem),'-pubout','-out',str(ephem_pub)],capture_output=True,check=True)
            a=td/'secret.a'; b=td/'secret.b'
            subprocess.run(['openssl','pkeyutl','-derive','-inkey',str(self.restored/'private'/m.ENC_KEY),
                '-passin','pass:'+self.passphrase,'-peerkey',str(ephem_pub),'-out',str(a)],capture_output=True,check=True)
            subprocess.run(['openssl','pkeyutl','-derive','-inkey',str(ephem),
                '-peerkey',str(self.original/'public'/'owner_x25519_spki.pem'),'-out',str(b)],capture_output=True,check=True)
            self.assertEqual(a.read_bytes(),b.read_bytes())
            self.assertEqual(len(a.read_bytes()),32)

    def test_rehearsal_uses_only_verified_public_der_bytes(self):
        # Run the actual rehearsal with synthetic fixture keys and local passphrases.
        for public_pem in (self.original/'public').glob('*.pem'):
            public_pem.unlink()
        original_runner = m.run_openssl

        def synthetic_openssl(args, **kwargs):
            if ('-in' in args and str(self.restored) in args[args.index('-in')+1]) or (
                    '-inkey' in args and str(self.restored) in args[args.index('-inkey')+1]):
                args = [*args, '-passin', 'pass:'+self.passphrase]
            return original_runner(args, **kwargs)

        with patch.object(m, 'run_openssl', side_effect=synthetic_openssl), \
             patch.object(m.sys.stdin, 'isatty', return_value=True), \
             patch.object(m.sys.stdout, 'isatty', return_value=True), \
             patch.dict(os.environ, {'CI':'', 'GITHUB_ACTIONS':''}):
            receipt = m.do_rehearsal(self.original, self.restored, self.output,
                self.signpin, self.encpin, 'I RESTORED ENCRYPTED COPIES ON MY OWN DEVICE')
        self.assertTrue(receipt['ed25519_challenge_signature_verified_locally'])
        self.assertTrue(receipt['x25519_synthetic_key_agreement_verified_locally'])
        self.assertFalse(receipt['step1_closed'])
        self.assertFalse(receipt['owner_identity_and_mfa_verified'])

    def test_no_cloud_network_or_authorization_code(self):
        source=MODULE_PATH.read_text()
        for fragment in ['CLOUDFLARE_API_TOKEN','GITHUB_TOKEN','urllib.request','requests.',
                         'fetch(','wrangler ','git push','release_authorized\':True']:
            self.assertNotIn(fragment,source)
        for field in ["'step1_closed':False","'step2_authorized':False",
                      "'release_authorized':False","'release_status':'NOT_RELEASE'",
                      "'on_device_execution_independently_attested':False"]:
            self.assertIn(field,source)

if __name__=='__main__': unittest.main()
