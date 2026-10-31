"""Host MCP verifier must fail closed before attempting networking."""
import json
import os
import pathlib
import subprocess
import sys
import unittest
from unittest.mock import patch
HERE=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import Verify_LifelineNativeMCP as observer
from native_mcp import NativeMCPError

class HostObserverTests(unittest.TestCase):
    def test_non_windows_must_fail_closed(self):
        with patch.object(sys,"platform","linux"):
            with self.assertRaisesRegex(NativeMCPError,"Windows"):
                observer.verify()
    def test_missing_tokens_denied_before_any_client(self):
        with patch.object(sys,"platform","win32"),patch.dict(os.environ,{},clear=True):
            with self.assertRaisesRegex(NativeMCPError,"tokens not installed"):
                observer.verify()
    def test_no_secrets_or_trading_are_returned(self):
        class MockClient:
            def __init__(self,config):
                self.config=config
                self.initialize_called=False
            def initialize(self):
                self.initialize_called=True
                if self.config.token.startswith("LIFELINE-INVALID"):
                    raise NativeMCPError("unauthorized")
                return {}
            def list_safe_tools(self):
                return [{"name":"get_time_information" if self.config.server=="terminal" else "get_workspace_info"}]
        with patch.object(sys,"platform","win32"):
            with patch.dict(os.environ,{
                "LIFELINE_TERMINAL_MCP_TOKEN":"sensitive-terminal-test-only-long",
                "LIFELINE_METAEDITOR_MCP_TOKEN":"sensitive-metaeditor-test-only-long",
            }):
                with patch.object(observer,"NativeMCP",MockClient):
                    result=observer.verify()
        self.assertTrue(result["terminal_local_mcp_responding"])
        self.assertTrue(result["metaeditor_local_mcp_responding"])
        self.assertTrue(result["unauthenticated_access_denied"])
        self.assertFalse(result["trade_or_shell_called"])
        self.assertNotIn("sensitive",json.dumps(result))
        self.assertFalse(result["persistent_windows_host_proven"])
    def test_unexpected_discovery_denied(self):
        class Unsafe:
            def __init__(self,config):self.config=config
            def initialize(self):return {}
            def list_safe_tools(self):return [{"name":"trade_send_market_order"}]
        with patch.object(sys,"platform","win32"):
            with patch.dict(os.environ,{
                "LIFELINE_TERMINAL_MCP_TOKEN":"safe-test-token-for-terminal-1234",
                "LIFELINE_METAEDITOR_MCP_TOKEN":"safe-test-token-for-editor-1234"}):
                with patch.object(observer,"NativeMCP",Unsafe):
                    with self.assertRaisesRegex(NativeMCPError,"unexpected"):
                        observer.verify()

if __name__=="__main__":unittest.main()
