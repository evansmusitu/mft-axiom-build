"""Owner-host-only official MetaQuotes MCP observation probe.

No credentials are logged; no trade, compile, tester mutation, filesystem scan,
order, shell, or remote network calls are issued by this script.
Run this only on a privately owned Windows machine with loopback listeners and
MCP tokens set directly in its environment (NOT in GitHub Actions).
"""
import json
import os
import sys
from native_mcp import NativeConfig,NativeMCP,NativeMCPError

def verify() -> dict:
    report={
        "schema":"lifeline.native_mcp.host_observer.v1",
        "terminal_local_mcp_responding":False,
        "metaeditor_local_mcp_responding":False,
        "readonly_discovery_filtered":False,
        "unauthenticated_access_denied":False,
        "trade_or_shell_called":False,
        "tokens_printed":False,
        "persistent_windows_host_proven":False,
    }
    if sys.platform!="win32":
        raise NativeMCPError("LIFELINE observer requires owner-controlled Windows host")
    configured={
        "terminal":os.environ.get("LIFELINE_TERMINAL_MCP_TOKEN",""),
        "metaeditor":os.environ.get("LIFELINE_METAEDITOR_MCP_TOKEN",""),
    }
    if any(len(t)<24 for t in configured.values()):
        raise NativeMCPError("local MCP tokens not installed")
    for server,token in configured.items():
        client=NativeMCP(NativeConfig(server,token))
        client.initialize()
        safe=client.list_safe_tools()
        # The official server may not implement every tool on every version.
        # Fail if discovery somehow exposes an unaudited operation.
        allowed={"terminal":{"get_time_information","get_marketwatch_symbols","tester_get_status"},
                 "metaeditor":{"get_workspace_info","list_open_documents"}}[server]
        if any(row.get("name") not in allowed for row in safe):
            raise NativeMCPError("unexpected native MCP capability")
        report[server+"_local_mcp_responding"]=True
    report["readonly_discovery_filtered"]=True
    # Negative authentication test with a non-secret, invalid bearer.
    try:
        unauthorized=NativeMCP(NativeConfig("terminal","LIFELINE-INVALID-BEARER-CANNOT-AUTHENTICATE"))
        unauthorized.initialize()
    except NativeMCPError:
        report["unauthenticated_access_denied"]=True
    if not report["unauthenticated_access_denied"]:
        raise NativeMCPError("local MCP accepted an invalid bearer")
    # A one-shot observer is not proof the Windows machine stays online.
    return report

def main() -> int:
    try:
        result=verify()
        print(json.dumps(result,sort_keys=True))
        return 0
    except Exception:
        # Never echo native MCP exception messages; some native servers can
        # include account paths or credentials in error details.
        print(json.dumps({"schema":"lifeline.native_mcp.host_observer.v1",
              "qualified":False,"reason":"LOCAL_MCP_QUALIFICATION_INCOMPLETE",
              "trade_or_shell_called":False},sort_keys=True))
        return 2

if __name__=="__main__":
    raise SystemExit(main())
