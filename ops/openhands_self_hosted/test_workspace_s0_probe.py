"""Regression suite for actual S0 command execution via OpenHands Workspace API."""
import unittest
from workspace_s0_probe import run_workspace_s0_probe, WorkspaceSmokeError

SESSION="a"*64

class Result:
    def __init__(self,stdout="/tmp\n",exit_code=0,stderr="",timeout_occurred=False):
        self.stdout=stdout
        self.stderr=stderr
        self.exit_code=exit_code
        self.timeout_occurred=timeout_occurred

class FakeWorkspace:
    configured=[]
    outcome=Result()
    def __init__(self,*,host,api_key,working_dir):
        self.configured.append((host,api_key,working_dir))
    def execute_command(self,command,cwd,timeout):
        self.last=(command,cwd,timeout)
        return self.outcome

class WorkspaceProbeTests(unittest.TestCase):
    def setUp(self):
        FakeWorkspace.configured=[]
        FakeWorkspace.outcome=Result()
        self.noauth=[]

    def reject_unauth(self,port):
        self.noauth.append(port)
        return 401

    def test_read_only_workspace_execution_with_actual_sdk_boundary(self):
        receipt=run_workspace_s0_probe(
            "http://127.0.0.1:18765",SESSION,
            workspace_factory=FakeWorkspace,
            unauthenticated_post=self.reject_unauth,
        )
        self.assertEqual(self.noauth,[18765])
        self.assertEqual(FakeWorkspace.configured,[("http://127.0.0.1:18765",SESSION,"/tmp")])
        self.assertEqual(receipt["operation"],"workspace.read_only_pwd")
        self.assertEqual(receipt["stdout_digest_algorithm"],"sha256")
        self.assertEqual(receipt["external_action_executed"],False)
        self.assertEqual(receipt["live_runtime_qualification"],"NOT_PROVEN")
        self.assertEqual(receipt["remote_workspace_s0_executed"],True)
        self.assertNotIn(SESSION,str(receipt))
        self.assertNotIn("stdout",receipt)

    def test_default_deny_if_unauthenticated_command_endpoint_open(self):
        with self.assertRaises(WorkspaceSmokeError):
            run_workspace_s0_probe("http://127.0.0.1:18765",SESSION,
                workspace_factory=FakeWorkspace,unauthenticated_post=lambda port:200)
        self.assertEqual(FakeWorkspace.configured,[])

    def test_invalid_endpoint_and_credentials_rejected_before_http(self):
        for endpoint in ("http://localhost:18765","http://127.0.0.1:18765/evil",
                         "https://127.0.0.1:18765","http://127.0.0.1:0",
                         "http://127.0.0.2:18765"):
            with self.subTest(endpoint=endpoint),self.assertRaises(WorkspaceSmokeError):
                run_workspace_s0_probe(endpoint,SESSION,
                    workspace_factory=FakeWorkspace,unauthenticated_post=self.reject_unauth)
        for key in ("short","a\nb","",None):
            with self.subTest(key=key),self.assertRaises(WorkspaceSmokeError):
                run_workspace_s0_probe("http://127.0.0.1:18765",key,
                    workspace_factory=FakeWorkspace,unauthenticated_post=self.reject_unauth)
        self.assertEqual(self.noauth,[])

    def test_fail_closed_on_output_mismatch_error_or_timeout(self):
        for result in (Result(stdout="/etc\n"),Result(exit_code=1),
                       Result(stderr="secret"),Result(timeout_occurred=True),
                       Result(stdout="/tmp\n",exit_code=None)):
            FakeWorkspace.outcome=result
            with self.subTest(result=result.__dict__),self.assertRaises(WorkspaceSmokeError):
                run_workspace_s0_probe("http://127.0.0.1:18765",SESSION,
                    workspace_factory=FakeWorkspace,unauthenticated_post=self.reject_unauth)

    def test_fails_closed_on_exception_without_leaking_secret(self):
        class FailedWorkspace(FakeWorkspace):
            def execute_command(self,*args,**kwargs):
                raise RuntimeError("could not execute "+SESSION)
        with self.assertRaises(WorkspaceSmokeError) as ctx:
            run_workspace_s0_probe("http://127.0.0.1:18765",SESSION,
                workspace_factory=FailedWorkspace,unauthenticated_post=self.reject_unauth)
        self.assertNotIn(SESSION,str(ctx.exception))

if __name__=="__main__":
    unittest.main()
