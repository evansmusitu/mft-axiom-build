"""Start a real self-hosted OpenHands Agent Server in isolated CI; do not run agents.

Only supports disposable CI environments. Does NOT attest container isolation,
execute an LLM request, or authorize external mutations.
"""
import os
import secrets
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from probe import ProbeError, run_probe

PORT = 18765
TIMEOUT_SECONDS = 110


def main() -> int:
    if (os.environ.get('AXIOM_ISOLATED_QUALIFICATION') != 'TRUE'
            or os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('GITHUB_REF_NAME') != 'frontier/axiom-trackb-openhands-selfhost-20261008'):
        print('MUSITU_AXIOM_OPENHANDS_SELFHOST_CI_SCOPE_BLOCKED', file=sys.stderr)
        return 42
    key = secrets.token_hex(32)
    encryption_secret = secrets.token_hex(32)
    with tempfile.TemporaryDirectory(prefix='axiom-openhands-b1-') as sandbox:
        directory = Path(sandbox)
        env = {
            'PATH': os.environ.get('PATH', '/usr/local/bin:/usr/bin:/bin'),
            'HOME': str(directory),
            'XDG_CACHE_HOME': str(directory / '.cache'),
            'TMPDIR': str(directory),
            'LANG': 'C.UTF-8',
            'OH_SESSION_API_KEYS_0': key,
            'OH_SECRET_KEY': encryption_secret,
            'PYTHONUNBUFFERED': '1',
        }
        with open(directory / 'agent-server.log', 'w', encoding='utf-8') as output:
            process = subprocess.Popen(
                [sys.executable, '-m', 'openhands.agent_server', '--host', '127.0.0.1', '--port', str(PORT)],
                cwd=directory, env=env, stdout=output, stderr=subprocess.STDOUT,
            )
            try:
                until = time.monotonic() + TIMEOUT_SECONDS
                last_failure = 'not started'
                while time.monotonic() < until:
                    if process.poll() is not None:
                        print('MUSITU_AXIOM_OPENHANDS_SELFHOST_AGENT_SERVER_EXITED', file=sys.stderr)
                        return 43
                    try:
                        result = run_probe('http://127.0.0.1:' + str(PORT), key)
                        if result['status'] != 'PASS' or result['live_runtime_qualification'] != 'NOT_PROVEN':
                            print('MUSITU_AXIOM_OPENHANDS_SELFHOST_PREFLIGHT_INVALID', file=sys.stderr)
                            return 44
                        print('MUSITU_AXIOM_OPENHANDS_SELFHOST_REAL_SERVER_AUTH_PASS')
                        print('EXTERNAL_ACTION_EXECUTED=FALSE')
                        print('LIVE_RUNTIME_QUALIFICATION=NOT_PROVEN')
                        print('RELEASE_AUTHORITY=FALSE')
                        print('PRODUCTION_AUTHORITY=FALSE')
                        return 0
                    except ProbeError as error:
                        last_failure = str(error)
                    time.sleep(1)
                print('MUSITU_AXIOM_OPENHANDS_SELFHOST_PREFLIGHT_TIMEOUT: ' + last_failure, file=sys.stderr)
                return 45
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == '__main__':
    raise SystemExit(main())
