"""Read-only authenticated OpenHands Workspace challenge in disposable isolation.

This exercises the REAL server workspace/terminal mechanism, not a model-driven
agent, S3 external write, production authority, or release qualification.
"""
import hashlib
import http.client
import json
import os
import sys

from probe import _port, ProbeError


class WorkspaceSmokeError(RuntimeError):
    pass


def _unauthenticated_command_attempt(port):
    connection=http.client.HTTPConnection('127.0.0.1',port,timeout=3)
    payload=json.dumps({'command':'pwd','cwd':'/tmp','timeout':10}).encode('utf-8')
    try:
        connection.request('POST','/api/bash/start_bash_command',body=payload,
                           headers={'Accept':'application/json','Content-Type':'application/json'})
        response=connection.getresponse()
        response.read(4096)
        return response.status
    except Exception:
        raise WorkspaceSmokeError('anonymous command security challenge unavailable') from None
    finally:
        connection.close()


def run_workspace_s0_probe(endpoint,session_key,*,workspace_factory=None,
                           unauthenticated_post=None):
    try:
        port=_port(endpoint)
    except ProbeError:
        raise WorkspaceSmokeError('workspace must use explicit IPv4 loopback') from None
    if (type(session_key) is not str or len(session_key.encode('utf-8'))<32 or
            any(ord(c)<33 or ord(c)>126 for c in session_key)):
        raise WorkspaceSmokeError('ephemeral workspace session credential unavailable')
    probe=unauthenticated_post or _unauthenticated_command_attempt
    status=probe(port)
    if status not in (401,403):
        raise WorkspaceSmokeError('anonymous workspace terminal API did not fail closed')
    if workspace_factory is None:
        from openhands.sdk import Workspace
        workspace_factory=Workspace
    try:
        workspace=workspace_factory(host=endpoint,api_key=session_key,working_dir='/tmp')
        result=workspace.execute_command('pwd',cwd='/tmp',timeout=10)
        if (type(result.exit_code) is not int or result.exit_code!=0 or
                type(result.stdout) is not str or result.stdout.strip()!='/tmp' or
                getattr(result,'stderr',None) not in ('',None) or
                getattr(result,'timeout_occurred',True)):
            raise WorkspaceSmokeError('authenticated S0 workspace result did not match expected output')
        digest=hashlib.sha256(result.stdout.encode('utf-8')).hexdigest()
    except WorkspaceSmokeError:
        raise
    except Exception:
        raise WorkspaceSmokeError('authenticated S0 workspace invocation failed') from None
    return {
        'schema':'musitu.axiom.trackb.remote-s0-workspace-probe.v1',
        'operation':'workspace.read_only_pwd',
        'server_scope':'IPV4_LOOPBACK',
        'anonymous_terminal_denied':True,
        'remote_workspace_s0_executed':True,
        'stdout_digest_algorithm':'sha256',
        'stdout_sha256':digest,
        'external_action_executed':False,
        'agent_model_execution':'NOT_PROVEN',
        'live_runtime_qualification':'NOT_PROVEN',
        'release_authority':False,
        'production_authority':False,
        'certification_authority':False,
    }


def main():
    if os.getenv('AXIOM_ISOLATED_QUALIFICATION')!='TRUE':
        print('MUSITU_AXIOM_OPENHANDS_WORKSPACE_S0_ISOLATION_REQUIRED',file=sys.stderr)
        return 42
    try:
        result=run_workspace_s0_probe(
            os.getenv('AXIOM_OPENHANDS_LOOPBACK_URL',''),
            os.getenv('OH_SESSION_API_KEYS_0',''),
        )
    except WorkspaceSmokeError:
        print('MUSITU_AXIOM_OPENHANDS_WORKSPACE_S0_EXECUTION_NOT_PROVEN',file=sys.stderr)
        return 43
    print(json.dumps(result,sort_keys=True))
    print('MUSITU_AXIOM_OPENHANDS_WORKSPACE_S0_REMOTE_EXECUTION_PASS')
    return 0


if __name__=='__main__':
    raise SystemExit(main())
