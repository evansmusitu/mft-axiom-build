from __future__ import annotations

from frontier_v5.runtime.mcp_2026 import PROTOCOL_META, PROTOCOL_VERSION
from frontier_v5.runtime.operator_remote_core import execute_remote_mcp


def mcp_call(name, arguments, request_id="r1"):
    headers={
        "MCP-Protocol-Version":PROTOCOL_VERSION,
        "Mcp-Method":"tools/call",
        "Mcp-Name":name,
    }
    message={
        "jsonrpc":"2.0",
        "id":request_id,
        "method":"tools/call",
        "params":{
            "name":name,
            "arguments":arguments,
            "_meta":{PROTOCOL_META:PROTOCOL_VERSION},
        },
    }
    return headers,message


def main():
    tenant="tenant-remote"
    actor="owner-remote"

    h,m=mcp_call("axiom.project.create",{"project_id":"p1","name":"Remote operator"})
    first=execute_remote_mcp(
        state_pack=None,tenant=tenant,actor_id=actor,headers=h,message=m
    )
    assert first["status"]==200
    assert first["mutated"] is True
    assert first["state_pack"]["state_sha256"]
    state=first["state_pack"]

    h,m=mcp_call("axiom.project.status",{"project_id":"p1"},"r2")
    read=execute_remote_mcp(
        state_pack=state,tenant=tenant,actor_id=actor,headers=h,message=m
    )
    assert read["status"]==200
    assert read["mutated"] is False
    assert read["state_pack"] is None
    assert read["body"]["project_id"]=="p1"

    h,m=mcp_call("axiom.work.create",{
        "project_id":"p1",
        "work_id":"w1",
        "goal":"prove remote continuity",
        "premises":{"sealed":True},
        "nodes":[{"node_id":"n1","action":"inspect","dependencies":[],"preconditions":[],"side_effecting":False}],
    },"r3")
    work=execute_remote_mcp(
        state_pack=state,tenant=tenant,actor_id=actor,headers=h,message=m
    )
    assert work["status"]==200
    assert work["mutated"] is True
    state2=work["state_pack"]
    assert state2["state_sha256"]!=state["state_sha256"]
    plan_id=work["body"]["plan_id"]

    h,m=mcp_call("axiom.work.status",{"project_id":"p1","plan_id":plan_id},"r4")
    continuity=execute_remote_mcp(
        state_pack=state2,tenant=tenant,actor_id=actor,headers=h,message=m
    )
    assert continuity["status"]==200
    assert continuity["body"]["plan"]["plan_id"]==plan_id
    assert continuity["mutated"] is False

    h,m=mcp_call("axiom.unknown",{},"r5")
    bad=execute_remote_mcp(
        state_pack=state2,tenant=tenant,actor_id=actor,headers=h,message=m
    )
    assert bad["status"]==200
    assert bad["mutated"] is False
    assert bad["state_pack"] is None
    assert bad["body"]["isError"] is True

    print("MUSITU_AXIOM_OPERATOR_REMOTE_CORE_PASS")


if __name__=="__main__":
    main()
