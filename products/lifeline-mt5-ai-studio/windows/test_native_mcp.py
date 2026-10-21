"""Fail-closed contract acceptance for MetaQuotes local MCP connectivity (offline mocks)."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from native_mcp import NativeMCP, NativeConfig, NativeMCPError, HTTPTransport, _decode_response, native_status_from_environment

TOKEN = "test-only-native-mcp-token-at-least-24"

class NativeMock:
    def __init__(self):
        self.methods = []
        self.urls = []
        self.headers = []

    def __call__(self, url, raw, headers):
        data = json.loads(raw)
        self.methods.append(data["method"])
        self.urls.append(url)
        self.headers.append(headers)
        result = {}
        if data["method"] == "initialize":
            result = {"protocolVersion":"2025-03-26","serverInfo":{"name":"metaeditor","version":"latest"}}
        if data["method"] == "tools/list":
            result = {"tools":[
                {"name":"get_workspace_info","inputSchema":{"type":"object"}},
                {"name":"compile_file","inputSchema":{"type":"object"}},
                {"name":"shell","inputSchema":{"type":"object"}},
                {"name":"trade_send_market_order","inputSchema":{"type":"object"}},
            ]}
        if data["method"] == "tools/call":
            result = {"content":[{"type":"text","text":"observation only"}]}
        return json.dumps({"jsonrpc":"2.0","id":data["id"],"result":result}).encode(), "application/json", "session-ok"


class Tests(unittest.TestCase):
    def client(self,server="metaeditor"):
        transport=NativeMock()
        client=NativeMCP(NativeConfig(server,TOKEN),transport)
        return client,transport

    def test_reject_unknown_server(self):
        with self.assertRaises(NativeMCPError):NativeConfig("cloud",TOKEN)

    def test_reject_short_or_newline_token(self):
        for t in ("x","validtoken-longenough-abc\r\nX: yes"):
            with self.assertRaises(NativeMCPError):NativeConfig("terminal",t)

    def test_exact_loopback_and_auth(self):
        cli,fake=self.client()
        cli.initialize()
        self.assertEqual(fake.urls[0],"http://127.0.0.1:22345/mcp")
        self.assertEqual(fake.headers[0]["Authorization"],"Bearer "+TOKEN)
        cli.list_safe_tools()
        self.assertEqual(fake.headers[1]["Mcp-Session-Id"],"session-ok")

    def test_mcp_tool_discovery_filtered(self):
        cli,fake=self.client()
        cli.initialize()
        tools=cli.list_safe_tools()
        self.assertEqual([t["name"] for t in tools], ["get_workspace_info"])
        self.assertEqual(tools[0]["inputSchema"],{"type":"object","properties":{},"additionalProperties":False})

    def test_cannot_call_trade_shell_compile_or_any_arbitrary_tool(self):
        cli,fake=self.client("metaeditor")
        cli.initialize()
        for name in ("trade_send_market_order", "shell", "compile_file", "write_file", "send_web_request", "build_project",
                     "list_directory","find_files_by_glob","find_files_by_name_keyword","tester_get_report",
                     "get_chart_ticks_history","get_chart_history"):
            with self.subTest(name=name),self.assertRaises(NativeMCPError):
                cli.call_readonly(name,{})
        self.assertEqual(fake.methods, ["initialize"])

    def test_allowed_readonly_tool_call(self):
        cli,fake=self.client()
        cli.initialize()
        self.assertIn("content",cli.call_readonly("get_workspace_info",{}))

    def test_reject_bad_readonly_arguments(self):
        cli,fake=self.client()
        cli.initialize()
        for args in ({"command":"dir"},{"url":"https://evil.test"}, {"headers":{"authorization":"x"}},
                     {"path":"C:/Users/private"},{"depth":999},{"symbol":"XAUUSD"},
                     {"nested":{"unsafe":True}}):
            with self.assertRaises(NativeMCPError):cli.call_readonly("get_workspace_info",args)

    def test_no_initialize_denied(self):
        cli,fake=self.client()
        with self.assertRaises(NativeMCPError):cli.list_safe_tools()
        with self.assertRaises(NativeMCPError):cli.call_readonly("get_workspace_info",{})

    def test_jsonrpc_error_denied_without_leaking(self):
        class Bad(NativeMock):
            def __call__(self,url,raw,headers):
                request=json.loads(raw)
                return json.dumps({"jsonrpc":"2.0","id":request["id"],"error":{"code":-32600,"message":"account secrets"}}).encode(),"application/json",None
        cli=NativeMCP(NativeConfig("terminal",TOKEN), Bad())
        with self.assertRaisesRegex(NativeMCPError,"JSON-RPC error") as ctx:
            cli.initialize()
        self.assertNotIn("account secrets",str(ctx.exception))

    def test_mismatched_request_id_denied(self):
        class Bad(NativeMock):
            def __call__(self,url,raw,headers):
                request=json.loads(raw)
                return json.dumps({"jsonrpc":"2.0","id":request["id"]+1,"result":{}}).encode(),"application/json",None
        with self.assertRaisesRegex(NativeMCPError,"mismatched"):
            NativeMCP(NativeConfig("metaeditor",TOKEN),Bad()).initialize()

    def test_json_sse_result_supported(self):
        reply=b'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n'
        self.assertTrue(_decode_response(reply,"text/event-stream")["result"]["ok"])
        with self.assertRaises(NativeMCPError): _decode_response(b"nonsense","text/plain")

    def test_remote_transport_blocked(self):
        t=HTTPTransport()
        with self.assertRaisesRegex(NativeMCPError,"exact loopback"):
            t("http://example.com/mcp",b"{}",{})

    def test_status_has_no_keys(self):
        result=native_status_from_environment()
        self.assertFalse(result["trading_enabled"])
        self.assertFalse(result["shell_enabled"])
        self.assertNotIn("token",json.dumps(result).replace("_token_configured",""))

if __name__=="__main__":unittest.main()
