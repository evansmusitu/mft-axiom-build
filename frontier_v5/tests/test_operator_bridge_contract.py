from __future__ import annotations

import tempfile
from pathlib import Path

from frontier_v5.runtime.operator_bridge import OperatorBridge, OperatorBridgeError
from frontier_v5.runtime.operator_mcp import build_operator_mcp
from frontier_v5.runtime.operator_http import OperatorHTTPApplication
from frontier_v5.runtime.operator_state import export_operator_state, restore_operator_state
from frontier_v5.runtime.mcp_2026 import PROTOCOL_META, PROTOCOL_VERSION


def expect_error(fn, contains=""):
    try:
        fn()
    except Exception as exc:
        if contains and contains not in str(exc):
            raise AssertionError(f"expected {contains!r}, got {exc!r}") from exc
        return
    raise AssertionError("expected failure")


def json_bytes(value):
    import json
    return json.dumps(value,separators=(",",":")).encode("utf-8")


def call(server, name, arguments):
    headers={
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        "Mcp-Method": "tools/call",
        "Mcp-Name": name,
    }
    message={
        "jsonrpc":"2.0",
        "id":"t1",
        "method":"tools/call",
        "params":{
            "name":name,
            "arguments":arguments,
            "_meta":{PROTOCOL_META:PROTOCOL_VERSION},
        },
    }
    status, _, body=server.handle(headers,message)
    assert status==200
    return body["result"]


def main():
    with tempfile.TemporaryDirectory() as td:
        root=Path(td)
        bridge=OperatorBridge(root=root, tenant="tenant-a", actor_id="owner-a")

        names={row["name"] for row in bridge.list_tools()}
        required={
            "axiom.project.create","axiom.project.status",
            "axiom.work.create","axiom.work.status","axiom.work.ready",
            "axiom.work.start","axiom.work.complete","axiom.work.fail","axiom.work.replan",
            "axiom.agent.register","axiom.agent.delegate","axiom.agent.integrity",
            "axiom.artifact.create","axiom.artifact.edit","axiom.artifact.rollback","axiom.artifact.export",
            "axiom.evidence.register","axiom.evidence.verify",
            "axiom.computer.session.create","axiom.computer.load_document",
            "axiom.computer.propose","axiom.computer.approve","axiom.computer.execute",
            "axiom.computer.rollback","axiom.computer.integrity",
            "axiom.provider.status","axiom.provider.execute",
        }
        assert required.issubset(names)
        for row in bridge.list_tools():
            assert row["inputSchema"]["type"]=="object"
            assert row["inputSchema"].get("additionalProperties") is False

        project=bridge.call_tool("axiom.project.create",{"project_id":"p1","name":"Operator bridge test"})
        assert project["project_id"]=="p1"
        assert project["production_authority"] is False
        assert project["public_submission_mutation_authority"] is False

        work=bridge.call_tool("axiom.work.create",{
            "project_id":"p1","work_id":"w1","goal":"prove durable work",
            "premises":{"sealed":True},
            "nodes":[
                {"node_id":"n1","action":"inspect","dependencies":[],"preconditions":[],"side_effecting":False},
                {"node_id":"n2","action":"verify","dependencies":["n1"],"preconditions":[],"side_effecting":False},
            ],
        })
        plan_id=work["plan_id"]
        assert bridge.call_tool("axiom.work.ready",{"project_id":"p1","plan_id":plan_id})["nodes"][0]["node_id"]=="n1"
        bridge.call_tool("axiom.work.start",{"project_id":"p1","plan_id":plan_id,"node_id":"n1"})
        bridge.call_tool("axiom.work.complete",{"project_id":"p1","plan_id":plan_id,"node_id":"n1","result":{"ok":True}})
        assert bridge.call_tool("axiom.work.ready",{"project_id":"p1","plan_id":plan_id})["nodes"][0]["node_id"]=="n2"

        # Work durability must survive a bridge process restart.
        bridge.close()
        bridge=OperatorBridge(root=root, tenant="tenant-a", actor_id="owner-a")
        status=bridge.call_tool("axiom.work.status",{"project_id":"p1","plan_id":plan_id})
        assert status["plan"]["plan_id"]==plan_id
        assert any(n["node_id"]=="n1" and n["status"]=="COMPLETED" for n in status["plan"]["nodes"])

        session=bridge.call_tool("axiom.computer.session.create",{
            "project_id":"p1","session_id":"c1","allowed_domains":["example.com"]
        })
        assert session["network_policy"]=="DENY_BY_DEFAULT_NO_RUNTIME_FETCH"
        bridge.call_tool("axiom.computer.load_document",{
            "session_id":"c1","url":"https://example.com/","title":"Example","retrieved_text":"safe page"
        })
        action=bridge.call_tool("axiom.computer.propose",{
            "session_id":"c1","action_id":"a1","action_type":"navigate","target":"https://example.com/next"
        })
        expect_error(lambda: bridge.call_tool("axiom.computer.execute",{"session_id":"c1","action_id":"a1"}),"approval")
        bridge.call_tool("axiom.computer.approve",{
            "session_id":"c1","action_id":"a1","expected_action_sha256":action["action_sha256"]
        })
        receipt=bridge.call_tool("axiom.computer.execute",{"session_id":"c1","action_id":"a1"})
        assert receipt["network_request_performed"] is False

        agent=bridge.call_tool("axiom.agent.register",{
            "project_id":"p1","agent_id":"agent1","name":"Verifier","purpose":"verify project evidence",
            "tool_scopes":["project.read","artifact.read"],"data_scopes":["project.metadata"],
            "autonomy":"PROPOSE_ONLY","max_runs":2,"max_compute_units":2
        })
        assert agent["status"]=="ACTIVE"
        assert bridge.call_tool("axiom.agent.integrity",{"project_id":"p1"})["status"]=="PASS"

        artifact=bridge.call_tool("axiom.artifact.create",{
            "project_id":"p1","artifact_id":"artifact1","artifact_type":"document","title":"Operator evidence",
            "content":{"status":"draft"},"provenance_source":"operator-test"
        })
        assert artifact["current_version_number"]==0
        export=bridge.call_tool("axiom.artifact.export",{"project_id":"p1","artifact_id":"artifact1"})
        assert export["integrity"]["status"]=="PASS"

        definition=bridge.call_tool("axiom.evidence.register",{
            "project_id":"p1","definition_id":"eval1","name":"Operator bridge qualification",
            "methodology":"sealed deterministic operator bridge contract",
            "metrics":["correctness"],"source_sha256":"a"*64
        })
        assert definition["definition_id"]=="eval1"
        assert bridge.call_tool("axiom.evidence.verify",{"project_id":"p1"})["status"]=="PASS"

        provider=bridge.call_tool("axiom.provider.status",{})
        assert provider["status"]=="UNAVAILABLE"
        assert provider["external_provider_execution_authority"] is False
        expect_error(lambda: bridge.call_tool("axiom.provider.execute",{
            "preferred":"openai","request_id":"r1","domain":"coding","modality":"text",
            "available_scopes":[],"jurisdiction":"ZW","min_quality":0.0,
            "max_latency_ms":1000,"max_cost_units":0.0,"required_policy_tags":[]
        }),"provider router unavailable")

        server=build_operator_mcp(bridge)
        list_headers={"MCP-Protocol-Version":PROTOCOL_VERSION,"Mcp-Method":"tools/list"}
        list_msg={"jsonrpc":"2.0","id":"l1","method":"tools/list","params":{"_meta":{PROTOCOL_META:PROTOCOL_VERSION}}}
        status_code, _, body=server.handle(list_headers,list_msg)
        assert status_code==200
        assert any(t["name"]=="axiom.work.status" for t in body["result"]["tools"])
        result=call(server,"axiom.project.status",{"project_id":"p1"})
        assert result["project_id"]=="p1"
        assert result["resultType"]=="complete"

        state_pack=export_operator_state(bridge)
        bridge.close()
        restored=restore_operator_state(
            root=root/"restored",
            state_pack=state_pack,
            tenant="tenant-a",
            actor_id="owner-a",
        )
        restored_status=restored.call_tool("axiom.work.status",{"project_id":"p1","plan_id":plan_id})
        assert any(n["node_id"]=="n1" and n["status"]=="COMPLETED" for n in restored_status["plan"]["nodes"])
        assert restored.call_tool("axiom.agent.integrity",{"project_id":"p1"})["status"]=="PASS"
        assert restored.call_tool("axiom.artifact.export",{"project_id":"p1","artifact_id":"artifact1"})["integrity"]["status"]=="PASS"
        assert restored.call_tool("axiom.evidence.verify",{"project_id":"p1"})["status"]=="PASS"
        assert restored.call_tool("axiom.computer.integrity",{"session_id":"c1"})["status"]=="PASS"
        bridge=restored

        app=OperatorHTTPApplication(bridge=bridge,bearer_token="test-operator-token")
        code, headers, body=app.handle("GET","/health",{},b"")
        assert code==200 and body["status"]=="READY"
        code, _, body=app.handle("POST","/mcp",{
            "MCP-Protocol-Version":PROTOCOL_VERSION,
            "Mcp-Method":"tools/list",
            "Content-Type":"application/json",
        },json_bytes(list_msg))
        assert code==401 and body["error"]=="UNAUTHORIZED"
        code, _, body=app.handle("POST","/mcp",{
            "Authorization":"Bearer test-operator-token",
            "MCP-Protocol-Version":PROTOCOL_VERSION,
            "Mcp-Method":"tools/list",
            "Content-Type":"application/json",
        },json_bytes(list_msg))
        assert code==200
        assert any(t["name"]=="axiom.work.status" for t in body["result"]["tools"])

        expect_error(lambda: bridge.call_tool("axiom.unknown",{}),"unknown operator tool")
        bridge.close()

    print("MUSITU_AXIOM_OPERATOR_BRIDGE_CONTRACT_PASS")


if __name__=="__main__":
    main()
