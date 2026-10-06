from __future__ import annotations

import json

from reviewer_clone.operator_reviewer_transport import trusted_operator_headers


def main():
    message={
        "jsonrpc":"2.0",
        "id":"x",
        "method":"tools/call",
        "params":{
            "name":"axiom.provider.status",
            "arguments":{},
            "_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"},
        },
    }
    raw=json.dumps(message,separators=(",",":")).encode()
    headers=trusted_operator_headers(
        {
            "content-type":"application/json",
            "mcp-protocol-version":"2026-07-28",
        },
        raw,
    )
    assert headers["mcp-protocol-version"]=="2026-07-28"
    assert headers["mcp-method"]=="tools/call"
    assert headers["mcp-name"]=="axiom.provider.status"

    # Trusted adapter derives method/name from the body instead of preserving
    # mismatched values supplied across an intermediary.
    repaired=trusted_operator_headers(
        {
            "mcp-protocol-version":"2026-07-28",
            "mcp-method":"tools/list",
            "mcp-name":"wrong",
        },
        raw,
    )
    assert repaired["mcp-method"]=="tools/call"
    assert repaired["mcp-name"]=="axiom.provider.status"

    listed={
        "jsonrpc":"2.0",
        "id":"l",
        "method":"tools/list",
        "params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}},
    }
    list_headers=trusted_operator_headers({},json.dumps(listed).encode())
    assert list_headers["mcp-method"]=="tools/list"
    assert "mcp-name" not in list_headers
    assert list_headers["mcp-protocol-version"]=="2026-07-28"

    print("MUSITU_AXIOM_OPERATOR_REVIEWER_TRANSPORT_PASS")


if __name__=="__main__":
    main()
