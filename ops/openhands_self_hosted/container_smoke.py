"""Run two real local-only OpenHands containers and verify isolation controls.

CI-only: NO agent tasks, NO LLM keys, NO external writes, NO production.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time

from container_policy import build_docker_command, verify_container_inspect

BRANCH = 'frontier/axiom-trackb-openhands-selfhost-20261008'
CHECK = r'''
import os, socket
from pathlib import Path
if os.getuid()!=65532 or os.getgid()!=65532:
    raise SystemExit('unexpected container identity')
if Path('/etc/axiom-trackb-write-should-fail').exists():
    raise SystemExit('dirty root filesystem')
try:
    Path('/etc/axiom-trackb-write-should-fail').write_text('forbidden')
except OSError:
    pass
else:
    raise SystemExit('root filesystem unexpectedly writable')
s=socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(1)
if s.connect_ex(('192.0.2.1',443))==0:
    raise SystemExit('public egress is reachable')
s.close()
print('MUSITU_AXIOM_OPENHANDS_RUNTIME_NETWORK_AND_FS_DENIED')
'''


def docker(*arguments, timeout=20):
    return subprocess.run(['docker', *arguments], check=True, capture_output=True, text=True, timeout=timeout)


def write_env(path, token, encryption):
    # CI-generated ephemeral credentials; never write them to logs or git.
    content = ('AXIOM_ISOLATED_QUALIFICATION=TRUE\n'
               'AXIOM_OPENHANDS_LOOPBACK_URL=http://127.0.0.1:18765\n'
               f'OH_SESSION_API_KEYS_0={token}\n'
               f'OH_SECRET_KEY={encryption}\n')
    fd=os.open(path, os.O_CREAT | os.O_WRONLY | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out:
        out.write(content)


def require_running_and_isolated(name):
    inspected = json.loads(docker('inspect',name).stdout)[0]
    if not inspected['State']['Running']:
        raise RuntimeError('isolated agent server exited unexpectedly')
    verify_container_inspect(inspected)


def require_readiness(name, until_seconds=150):
    deadline=time.monotonic()+until_seconds
    while time.monotonic()<deadline:
        require_running_and_isolated(name)
        status=subprocess.run(['docker','exec',name,'python','/opt/axiom/probe.py'],
                              capture_output=True,text=True,timeout=10)
        if status.returncode==0 and 'MUSITU_AXIOM_OPENHANDS_SELFHOST_AUTH_PREFLIGHT_PASS' in status.stdout:
            return
        time.sleep(2)
    raise RuntimeError('container authenticated-readiness check timed out')


def main():
    if (os.environ.get('AXIOM_ISOLATED_QUALIFICATION')!='TRUE'
        or os.environ.get('GITHUB_ACTIONS')!='true'
        or os.environ.get('GITHUB_REF_NAME')!=BRANCH):
        print('MUSITU_AXIOM_TRACK_B_CONTAINER_SCOPE_BLOCKED',file=sys.stderr)
        return 42
    sha = os.environ.get('AXIOM_TRACK_B_IMAGE_SHA','')
    if not sha.startswith('sha256:'):
        print('MUSITU_AXIOM_TRACK_B_IMAGE_ID_REQUIRED',file=sys.stderr)
        return 43
    names=[]
    with tempfile.TemporaryDirectory(prefix='axiom-openhands-isolation-') as scratch:
        try:
            for idx in range(2):
                name='axiom-openhands-'+secrets.token_hex(4)
                credential=Path(scratch)/('ephemeral-%d.env'%idx)
                write_env(str(credential), secrets.token_hex(32), secrets.token_hex(32))
                command=build_docker_command(image=sha,name=name,credential_file=credential)
                subprocess.run(command,check=True,capture_output=True,text=True,timeout=30)
                names.append(name)
                require_readiness(name)
                docker('exec',name,'python','-c',CHECK)
                if idx==0:
                    docker('exec',name,'python','-c',"from pathlib import Path; Path('/tmp/axiom-private-tenant-a').write_text('sentinel')")
                else:
                    docker('exec',name,'python','-c',"from pathlib import Path; assert not Path('/tmp/axiom-private-tenant-a').exists(), 'cross-tenant filesystem leak'")
            print('MUSITU_AXIOM_OPENHANDS_SELFHOST_CONTAINER_ISOLATION_PASS')
            print('CONTAINERS_TESTED=2')
            print('PUBLIC_EGRESS_ALLOWED=FALSE')
            print('EXTERNAL_ACTION_EXECUTED=FALSE')
            print('LIVE_RUNTIME_QUALIFICATION=NOT_PROVEN')
            print('PRODUCTION_AUTHORITY=FALSE')
            print('CERTIFICATION_AUTHORITY=FALSE')
            return 0
        except Exception as error:
            # Don't echo container logs, environment or credentials into public CI.
            print('MUSITU_AXIOM_OPENHANDS_CONTAINER_ISOLATION_FAIL:'+type(error).__name__,file=sys.stderr)
            return 44
        finally:
            for name in reversed(names):
                subprocess.run(['docker','rm','-f',name],capture_output=True,text=True,timeout=20,check=False)


if __name__=='__main__':
    raise SystemExit(main())
