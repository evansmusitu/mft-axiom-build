"""Fail-closed Docker runtime admission for isolated OpenHands smoke tasks.

This is a disposable, non-networked CI test, not a production security boundary.
"""
from pathlib import Path
import re
import stat

IMAGE_ID = re.compile(r'^sha256:[0-9a-f]{64}$')
WORKER_NAME = re.compile(r'^axiom-openhands-[a-z0-9]{8}$')
MEMORY_BYTES = 2 * 1024**3
CPU_NANO = 1_000_000_000
MAX_PIDS = 128
TMPFS_SPEC = 'rw,nosuid,nodev,size=536870912'


def build_docker_command(*, image, name, credential_file):
    if not isinstance(image, str) or not IMAGE_ID.fullmatch(image):
        raise ValueError('must reference an exact locally built image ID')
    if not isinstance(name, str) or not WORKER_NAME.fullmatch(name):
        raise ValueError('worker name outside approved isolated namespace')
    path = Path(credential_file)
    if not path.is_absolute() or not path.is_file() or path.is_symlink():
        raise ValueError('credential file must be an existing nonsymlink absolute file')
    if stat.S_IMODE(path.stat().st_mode) != 0o600:
        raise PermissionError('ephemeral credential file must be chmod 0600')
    return [
        'docker', 'run', '-d', '--rm',
        '--name', name,
        '--network=none',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--pids-limit=128',
        '--memory=2g',
        '--cpus=1',
        '--user=65532:65532',
        '--tmpfs=/tmp:' + TMPFS_SPEC,
        '--env-file', str(path),
        '--label=musitu.axiom.track=trackb-selfhost-isolated',
        image,
    ]


def verify_container_inspect(inspected):
    """Reject a running container if Docker's actual isolation state drifts."""
    if not isinstance(inspected, dict):
        raise ValueError('Docker inspect object required')
    config = inspected.get('Config') or {}
    host = inspected.get('HostConfig') or {}
    checked = (
        config.get('User') == '65532:65532',
        host.get('NetworkMode') == 'none',
        host.get('ReadonlyRootfs') is True,
        'ALL' in (host.get('CapDrop') or []),
        any(s in ('no-new-privileges', 'no-new-privileges:true') for s in (host.get('SecurityOpt') or [])),
        host.get('Privileged') is False,
        not host.get('Binds'),
        host.get('PidMode') != 'host',
        host.get('IpcMode') != 'host',
        host.get('Memory') == MEMORY_BYTES,
        host.get('NanoCpus') == CPU_NANO,
        host.get('PidsLimit') == MAX_PIDS,
        '/tmp' in (host.get('Tmpfs') or {}),
        not inspected.get('Mounts'),
    )
    if not all(checked):
        raise ValueError('Docker runtime isolation inspect mismatch')
    return True
