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
from concurrent.futures import ThreadPoolExecutor

from container_policy import build_docker_command, verify_container_inspect
from worker_leases import AdmissionDenied, LeaseScheduler

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
    leases=[]
    def terminate_container(name):
        docker('rm','-f',name)
        # A kill request is not evidence: require destination-native absence.
        inspected = subprocess.run(['docker','inspect',name], capture_output=True, text=True, timeout=15)
        if inspected.returncode == 0:
            raise RuntimeError('terminated container still visible in Docker')
    scheduler = LeaseScheduler(max_active=2, max_per_tenant=1,
                               ttl_seconds=300, clock=time.monotonic,
                               terminate=terminate_container)
    with tempfile.TemporaryDirectory(prefix='axiom-openhands-isolation-') as scratch:
        try:
            for idx in range(2):
                name='axiom-openhands-'+secrets.token_hex(4)
                tenant=f'ci-tenant-{idx}'
                request={
                    'tenant_id':tenant, 'project_id':'axiom-b1',
                    'work_id':f'isolated-container-{idx}',
                    'workload_identity_id':f'ci-workload-{idx}',
                    'request_sha256':f'{idx+1:064x}',
                    'risk_class':'S0',
                    'operation':'B1_ISOLATED_CONTAINER_SMOKE',
                }
                lease=scheduler.acquire(request,name)
                leases.append((lease['lease_id'],tenant))
                credential=Path(scratch)/('ephemeral-%d.env'%idx)
                write_env(str(credential), secrets.token_hex(32), secrets.token_hex(32))
                command=build_docker_command(image=sha,name=name,credential_file=credential)
                subprocess.run(command,check=True,capture_output=True,text=True,timeout=30)
                names.append(name)
                require_readiness(name)
                docker('exec',name,'python','-c',CHECK)
                s0 = docker('exec',name,'python','/opt/axiom/workspace_s0_probe.py',timeout=40)
                if 'MUSITU_AXIOM_OPENHANDS_WORKSPACE_S0_REMOTE_EXECUTION_PASS' not in s0.stdout:
                    raise RuntimeError('OpenHands authenticated S0 command not proven')
                if idx==0:
                    docker('exec',name,'python','-c',"from pathlib import Path; Path('/tmp/axiom-private-tenant-a').write_text('sentinel')")
                else:
                    docker('exec',name,'python','-c',"from pathlib import Path; assert not Path('/tmp/axiom-private-tenant-a').exists(), 'cross-tenant filesystem leak'")
            try:
                scheduler.acquire({
                    'tenant_id':'ci-tenant-third','project_id':'axiom-b1',
                    'work_id':'overflow-attempt','workload_identity_id':'ci-workload-third',
                    'request_sha256':'f'*64,'risk_class':'S0',
                    'operation':'B1_ISOLATED_CONTAINER_SMOKE',
                }, 'axiom-openhands-cccccccc')
            except AdmissionDenied:
                pass
            else:
                raise RuntimeError('third worker bypassed maximum capacity')
            try:
                scheduler.release(leases[0][0], 'ci-tenant-foreign')
            except AdmissionDenied:
                pass
            else:
                raise RuntimeError('cross-tenant revocation succeeded')
            if scheduler.active_count != 2:
                raise RuntimeError('lease admission count mismatch')
            # Two isolated OpenHands servers handle five concurrent authenticated
            # read-only API commands EACH. These are not ten worker sandboxes.
            def one_container_load(container_name):
                result=docker('exec',container_name,'python',
                              '/opt/axiom/workspace_s0_load.py',timeout=75)
                if 'MUSITU_AXIOM_OPENHANDS_FIVE_CONCURRENT_S0_REQUESTS_PASS' not in result.stdout:
                    raise RuntimeError('five-request real OpenHands API challenge failed')
                try:
                    record=json.loads(result.stdout.splitlines()[0])
                except Exception:
                    raise RuntimeError('OpenHands load receipt malformed') from None
                if record.get('requests_completed') != 5 or record.get('max_inflight') != 5:
                    raise RuntimeError('OpenHands load receipt contradicts expected bounds')
                return record
            with ThreadPoolExecutor(max_workers=2) as pool:
                completed=list(pool.map(one_container_load,names))
            if sum(item['requests_completed'] for item in completed)!=10:
                raise RuntimeError('ten-request S0 challenge did not complete')
            print('MUSITU_AXIOM_OPENHANDS_TWO_CONTAINERS_TEN_S0_REQUESTS_PASS')
            print('MODEL_DRIVEN_EXECUTION=NOT_PROVEN')
            print('TEN_INDEPENDENT_WORKERS=NOT_PROVEN')
            for lease_id,tenant in reversed(leases):
                receipt=scheduler.release(lease_id,tenant)
                if receipt['state'] != 'TERMINATED':
                    raise RuntimeError('lease revocation not verified')
            if scheduler.active_count != 0:
                raise RuntimeError('lease capacity not released')
            print('MUSITU_AXIOM_OPENHANDS_WORKSPACE_S0_TWO_CONTAINERS_PASS')
            print('MUSITU_AXIOM_TRACK_B_REAL_CONTAINER_LEASE_LIFECYCLE_PASS')
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
