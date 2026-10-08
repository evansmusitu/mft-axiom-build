"""Behavioral security regression tests for a self-hosted OpenHands container."""
import copy
import tempfile
import unittest
from pathlib import Path

from container_policy import build_docker_command, verify_container_inspect

IMAGE = 'sha256:' + 'a' * 64


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.envfile = Path(self.tmp.name) / 'credentials.env'
        self.envfile.write_text('OH_SESSION_API_KEYS_0=example-ephemeral-key\n')
        self.envfile.chmod(0o600)

    def args(self, **kwargs):
        return build_docker_command(
            image=kwargs.pop('image', IMAGE),
            name=kwargs.pop('name', 'axiom-openhands-abc12345'),
            credential_file=kwargs.pop('credential_file', self.envfile),
        )

    def test_denies_network_privilege_rootfs_and_unbounded_resources(self):
        cmd = self.args()
        self.assertEqual(cmd[:3], ['docker', 'run', '-d'])
        for arg in ('--network=none', '--read-only', '--cap-drop=ALL',
                    '--security-opt=no-new-privileges', '--user=65532:65532',
                    '--pids-limit=128', '--memory=2g', '--cpus=1'):
            self.assertIn(arg, cmd)
        self.assertTrue(any(s.startswith('--tmpfs=/tmp:') for s in cmd))
        self.assertNotIn('--privileged', cmd)
        self.assertFalse(any(s.startswith('--publish') or s.startswith('-p') for s in cmd))
        self.assertFalse(any(s.startswith('--volume') or s == '-v' for s in cmd))
        self.assertEqual(cmd[-1], IMAGE)

    def test_rejects_unpinned_images_untrusted_names_or_world_readable_keys(self):
        for image in ('python:latest', 'example/image@sha256:' + 'x' * 64, ''):
            with self.subTest(image=image), self.assertRaises((TypeError, ValueError)):
                self.args(image=image)
        for name in ('../../evil', 'axiom-openhands-abc12345;sh', ''):
            with self.subTest(name=name), self.assertRaises((TypeError, ValueError)):
                self.args(name=name)
        self.envfile.chmod(0o644)
        with self.assertRaises(PermissionError):
            self.args()

    def test_readback_attests_enforced_docker_isolation(self):
        good = {
            'Config': {'User': '65532:65532'},
            'HostConfig': {
                'NetworkMode': 'none', 'ReadonlyRootfs': True,
                'CapDrop': ['ALL'], 'SecurityOpt': ['no-new-privileges'],
                'Privileged': False, 'Binds': None,
                'PidMode': '', 'IpcMode': 'private', 'UsernsMode': '',
                'Memory': 2147483648, 'NanoCpus': 1000000000, 'PidsLimit': 128,
                'Tmpfs': {'/tmp': 'rw,nosuid,nodev,size=536870912'},
            },
            'Mounts': [],
        }
        self.assertTrue(verify_container_inspect(good))
        for field, bad in [
            ('NetworkMode', 'bridge'), ('ReadonlyRootfs', False),
            ('CapDrop', []), ('Privileged', True), ('Binds', ['/host:/tmp']),
            ('PidMode', 'host'), ('Memory', 0), ('PidsLimit', 0),
        ]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                probe = copy.deepcopy(good)
                probe['HostConfig'][field] = bad
                verify_container_inspect(probe)
        probe = copy.deepcopy(good)
        probe['Mounts'] = [{'Type': 'bind', 'Source': '/var/run/docker.sock', 'Destination': '/tmp/s'}]
        with self.assertRaises(ValueError):
            verify_container_inspect(probe)


if __name__ == '__main__':
    unittest.main()
