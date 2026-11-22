"""Offline-only object privacy and real-runner preflight tests. No Blender invocation."""
import hashlib
from pathlib import Path
import tempfile
import unittest

from musitu_studio.gates56.blender_bridge import LocalPrivateArtifacts, IsolatedBlenderBridge
from musitu_studio.gates56.ledger import GateClosed, Conflict


class LocalPrivateArtifactsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.store=LocalPrivateArtifacts(self.root/"private")
        self.source=self.root/"source.blend"
        self.source.write_bytes(b"X"*2048)

    def test_private_storage_checksum_and_no_public_url(self):
        manifest=self.store.put("tenantA","G56_abc","scene.blend",self.source)
        self.assertEqual(manifest[0],"scene.blend")
        self.assertEqual(manifest[1],hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertEqual(manifest[2],2048)
        self.assertTrue(manifest[3].startswith("private/tenantA/G56_abc/"))
        self.assertEqual(self.store.get_verified(
           principal_tenant="tenantA",tenant="tenantA",
           jid="G56_abc",filename="scene.blend",sha256=manifest[1]),
           self.source.read_bytes())

    def test_cross_tenant_read_is_denied(self):
        manifest=self.store.put("tenantA","G56_abc","scene.blend",self.source)
        with self.assertRaisesRegex(GateClosed,"FOREIGN_TENANT"):
            self.store.get_verified(principal_tenant="tenantB",tenant="tenantA",
                 jid="G56_abc",filename="scene.blend",sha256=manifest[1])

    def test_replay_is_idempotent_and_mutation_never_overwrites(self):
        first=self.store.put("tenantA","G56_abc","scene.blend",self.source)
        second=self.store.put("tenantA","G56_abc","scene.blend",self.source)
        self.assertEqual(first,second)
        original=(self.root/"private/tenantA/G56_abc/scene.blend").read_bytes()
        self.source.write_bytes(b"Y"*2048)
        with self.assertRaisesRegex(Conflict,"NO_OVERWRITE"):
            self.store.put("tenantA","G56_abc","scene.blend",self.source)
        self.assertEqual((self.root/"private/tenantA/G56_abc/scene.blend").read_bytes(),
                         original)

    def test_symlink_and_path_traversal_fail_closed(self):
        with self.assertRaisesRegex(GateClosed,"PATH_DENIED"):
            self.store.put("../tenant","G56_abc","scene.blend",self.source)
        with self.assertRaisesRegex(GateClosed,"PATH_DENIED"):
            self.store.put("tenantA","G56_abc","../../secret",self.source)
        link=self.root/"alias"
        link.symlink_to(self.source)
        with self.assertRaisesRegex(GateClosed,"UNVERIFIED_ASSET_SOURCE"):
            self.store.put("tenantA","G56_abc","scene.blend",link)

    def test_digest_mutation_detected_on_download(self):
        manifest=self.store.put("tenantA","G56_abc","scene.blend",self.source)
        target=self.root/"private/tenantA/G56_abc/scene.blend"
        target.write_bytes(b"modified" * 300)
        with self.assertRaisesRegex(GateClosed,"ASSET_DIGEST_MISMATCH"):
            self.store.get_verified(principal_tenant="tenantA",tenant="tenantA",
              jid="G56_abc",filename="scene.blend",sha256=manifest[1])


class IsolatedBlenderBridgeTests(unittest.TestCase):
    def test_external_sandbox_required_before_any_ledger_claim(self):
        class NoClaim:
            def claim(self,**kw):
                raise AssertionError("MUST_NOT_DISPATCH_WITHOUT_SANDBOX")
        with tempfile.TemporaryDirectory() as p:
            bridge=IsolatedBlenderBridge(
                ledger=NoClaim(),blender=Path(p)/"nonexistent",
                input_resolver=lambda job:None,isolation_guard=lambda:False,
                artifact_store=None,work_root=Path(p),repo_root=Path(p))
            with self.assertRaisesRegex(GateClosed,"ROOTLESS_SANDBOX"):
                bridge.run_one()


if __name__=="__main__":unittest.main()
