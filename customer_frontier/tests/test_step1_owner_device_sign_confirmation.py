"""Offline-only tests: mocked node/openssl, no real keys or provider calls."""
import hashlib
import os
import pathlib
import shlex
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "qualification" / "step1_owner_device_sign_proposal.sh"
PLAN = b'{"schema":"offline-test-only","action":"PROPOSE_NEW_DISPOSABLE_D1_ONLY","release_status":"NOT_RELEASE"}'
DIGEST = hashlib.sha256(PLAN).hexdigest()


class OwnerReviewConfirmationTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory(prefix="axiom-owner-review-synthetic-")
        self.addCleanup(self.work.cleanup)
        self.root = pathlib.Path(self.work.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.keys = self.root / "keys"
        self.keys.mkdir()
        self.out = self.root / "new-proposal"
        (self.bin / "node").write_text(
            "#!/usr/bin/env python3\n"
            "import os,pathlib,sys\n"
            "mode=sys.argv[2]; output=pathlib.Path(sys.argv[4])\n"
            "if mode=='prepare':\n"
            " output.mkdir()\n"
            f" (output/'OWNER_PROPOSAL_PAYLOAD.json').write_bytes({PLAN!r})\n"
            "elif mode=='finalize':\n"
            " (output/'MOCK_FINALIZED_NOT_RELEASE').touch()\n"
            "else: sys.exit(2)\n"
        )
        (self.bin / "openssl").write_text(
            "#!/usr/bin/env python3\n"
            "import pathlib,sys\n"
            "out=pathlib.Path(sys.argv[sys.argv.index('-out')+1]); out.write_bytes(bytes(64))\n"
            "(out.parent/'MOCK_SIGNER_CALLED').touch()\n"
        )
        for f in self.bin.iterdir():
            f.chmod(0o755)
        self.env = dict(os.environ)
        self.env["PATH"] = str(self.bin)+os.pathsep+os.environ['PATH']
        self.env["AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256"] = "a"*64
        self.env["AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256"] = "b"*64

    def run_interactive(self, answer):
        cmd = "bash " + " ".join(shlex.quote(str(v)) for v in (SCRIPT,self.keys,self.out))
        return subprocess.run(["script","-qec",cmd,"/dev/null"], input=answer+"\n",
                              capture_output=True, text=True, env=self.env, timeout=12)

    def test_typo_digest_blocks_sign_and_finalize(self):
        r=self.run_interactive("0"*64)
        self.assertNotEqual(r.returncode,0)
        self.assertIn('did not confirm exact proposal digest',r.stdout+r.stderr)
        self.assertFalse((self.out/'MOCK_SIGNER_CALLED').exists())
        self.assertFalse((self.out/'MOCK_FINALIZED_NOT_RELEASE').exists())

    def test_correct_digest_allows_synthetic_signature_but_no_authority(self):
        r=self.run_interactive(DIGEST)
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        self.assertIn('NO_D1_AUTHORITY_NOT_RELEASE',r.stdout)
        self.assertTrue((self.out/'MOCK_SIGNER_CALLED').exists())
        self.assertTrue((self.out/'MOCK_FINALIZED_NOT_RELEASE').exists())
        self.assertEqual((self.out/'OWNER_PROPOSAL_PAYLOAD.json').read_bytes(),PLAN)

    def test_blank_confirmation_denies(self):
        r=self.run_interactive('')
        self.assertNotEqual(r.returncode,0)
        self.assertFalse((self.out/'MOCK_SIGNER_CALLED').exists())

    def test_no_tty_denied_before_preparation(self):
        r=subprocess.run(['bash',str(SCRIPT),str(self.keys),str(self.out)],
                         input=DIGEST+'\n', capture_output=True,text=True,env=self.env,timeout=10)
        self.assertNotEqual(r.returncode,0)
        self.assertIn('interactive terminal',r.stderr)
        self.assertFalse(self.out.exists())

    def test_missing_trust_pin_denied(self):
        del self.env['AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256']
        r=self.run_interactive(DIGEST)
        self.assertNotEqual(r.returncode,0)
        self.assertIn('separately reviewed public trust pins required',r.stdout+r.stderr)
        self.assertFalse(self.out.exists())

    def test_hash_mismatch_after_confirmation_denied(self):
        original_hash = subprocess.check_output(['which','sha256sum'],text=True).strip()
        self.assertTrue(pathlib.Path(original_hash).exists())
        # Simulate source mutation by shim returning a wrong digest on second call.
        (self.bin/'sha256sum').write_text(
            '#!/usr/bin/env python3\n'
            'import sys,pathlib,subprocess,os\n'
            f'counter=pathlib.Path({str(self.root/"hash_counter")!r})\n'
            'i=int(counter.read_text())+1 if counter.exists() else 1\n'
            'counter.write_text(str(i))\n'
            f'bad=("f"*64) if i>=2 else {DIGEST!r}\n'
            'print(bad+"  "+sys.argv[-1])\n'
        )
        (self.bin/'sha256sum').chmod(0o755)
        r=self.run_interactive(DIGEST)
        self.assertNotEqual(r.returncode,0)
        self.assertIn('proposal changed since owner review',r.stdout+r.stderr)
        self.assertFalse((self.out/'MOCK_SIGNER_CALLED').exists())


if __name__ == "__main__": unittest.main()
