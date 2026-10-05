#!/usr/bin/env python3
"""Generate MUSITU Axiom ChatGPT app submission artifacts from the live public MCP registry.

This script is intentionally secret-free. It performs only public MCP discovery and local
repository inspection, then writes review artifacts. It does not mutate production services,
D1, billing, OAuth state, or customer data.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import re
import urllib.error
import urllib.request

MCP_BASE = "https://mcp.mftintelligence.com"
MCP_URL = MCP_BASE + "/mcp"
EXPECTED_TOOL_COUNT = 108
EXPECTED_OPERATION_COUNT = 74
EXPECTED_BUSINESS_PRODUCT_COUNT = 30
HIDDEN = {
    "musitu_axiom_plans",
    "musitu_axiom_recommend_plan",
    "musitu_axiom_start_checkout",
    "musitu_axiom_checkout_status",
}
DISCOVERY = {"search", "fetch", "musitu_axiom_capabilities"}
REQUIRED_ANNOTATIONS = ("readOnlyHint", "openWorldHint", "destructiveHint")
PROMOTIONAL = re.compile(r"\b(subscribe|upgrade|checkout|monthly plan|subscription plan)\b", re.I)
SENSITIVE_FIELD = re.compile(
    r"(^|_)(password|passwd|passcode|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|"
    r"authorization[_-]?code|mfa|otp|cvv|cvc|card[_-]?(number|pan)|ssn|social[_-]?security|"
    r"government[_-]?id|passport|biometric|private[_-]?key)($|_)",
    re.I,
)


def rpc(method: str, params: dict | None = None) -> dict:
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
        separators=(",", ":"),
    ).encode()
    req = urllib.request.Request(
        MCP_URL,
        data=body,
        method="POST",
        headers={
            "accept": "application/json",
            "content-type": "application/json",
            "user-agent": "MUSITU-Axiom-Submission-Packager/1.1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            raw = response.read()
            if response.status != 200:
                raise RuntimeError(f"MCP HTTP {response.status}")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"MCP HTTP {exc.code}") from exc
    try:
        return json.loads(raw or b"{}")
    except Exception as exc:
        raise RuntimeError("MCP returned invalid JSON") from exc


def inspect_public_gate_source() -> None:
    path = pathlib.Path("mcp/musitu_axiom_plugin_gate_v4.mjs")
    source = path.read_text()
    required_markers = [
        'const HIDDEN=new Set(["musitu_axiom_plans","musitu_axiom_recommend_plan","musitu_axiom_start_checkout","musitu_axiom_checkout_status"]);',
        'const PUBLIC_NOAUTH=new Set(["search","fetch","musitu_axiom_capabilities"]);',
        "function correctedTool(t)",
        "function prune(x)",
        "async function forwardCall(req,c,raw,id)",
        'scope="axiom.execute"',
        'name==="search"',
        'name==="fetch"',
        'name==="musitu_axiom_capabilities"',
    ]
    missing = [marker for marker in required_markers if marker not in source]
    if missing:
        raise RuntimeError("public gate source behavior markers drifted: " + " | ".join(missing))
    if "raw Modal" in source:
        raise RuntimeError("unexpected raw Modal wording in public gate source")


def walk_schema(node, path: str, findings: list[str]) -> None:
    if isinstance(node, dict):
        props = node.get("properties")
        if isinstance(props, dict):
            for key, value in props.items():
                key_path = f"{path}.{key}" if path else str(key)
                if SENSITIVE_FIELD.search(str(key)):
                    findings.append(key_path)
                walk_schema(value, key_path, findings)
        for key in ("items", "additionalProperties", "oneOf", "anyOf", "allOf", "$defs", "definitions"):
            value = node.get(key)
            if value is not None:
                walk_schema(value, path, findings)
    elif isinstance(node, list):
        for value in node:
            walk_schema(value, path, findings)


def lines(*items: str) -> str:
    return "\n".join(items) + "\n"


def main() -> None:
    inspect_public_gate_source()
    registry = rpc("tools/list")
    tools = ((registry.get("result") or {}).get("tools") or [])
    if len(tools) != EXPECTED_TOOL_COUNT:
        raise RuntimeError(f"public tool count drift: {len(tools)} != {EXPECTED_TOOL_COUNT}")

    names = [str(tool.get("name") or "") for tool in tools]
    if len(set(names)) != len(names) or any(not name for name in names):
        raise RuntimeError("tool names are empty or not unique")
    leaked = sorted(set(names) & HIDDEN)
    if leaked:
        raise RuntimeError("hidden commerce tools leaked: " + ",".join(leaked))

    mapped = {tool.get("_meta", {}).get("musitu/operation") for tool in tools if isinstance(tool, dict)} - {None}
    business = [tool for tool in tools if tool.get("_meta", {}).get("musitu/business_product") is True]
    if len(mapped) != EXPECTED_OPERATION_COUNT:
        raise RuntimeError(f"operation mapping drift: {len(mapped)} != {EXPECTED_OPERATION_COUNT}")
    if len(business) != EXPECTED_BUSINESS_PRODUCT_COUNT:
        raise RuntimeError(f"business product drift: {len(business)} != {EXPECTED_BUSINESS_PRODUCT_COUNT}")

    missing_output: list[str] = []
    annotation_findings: list[str] = []
    description_findings: list[str] = []
    sensitive_fields: list[str] = []
    submission_tools: dict[str, dict] = {}

    for tool in tools:
        name = str(tool.get("name"))
        annotations = tool.get("annotations")
        if not isinstance(annotations, dict):
            annotation_findings.append(f"{name}: annotations missing")
            continue
        for key in REQUIRED_ANNOTATIONS:
            if key not in annotations or not isinstance(annotations.get(key), bool):
                annotation_findings.append(f"{name}: {key} missing or non-boolean")
        if not isinstance(tool.get("outputSchema"), dict):
            missing_output.append(name)
        if PROMOTIONAL.search(str(tool.get("description") or "")):
            description_findings.append(name)
        walk_schema(tool.get("inputSchema") or {}, name, sensitive_fields)

        read_only = bool(annotations.get("readOnlyHint"))
        open_world = bool(annotations.get("openWorldHint"))
        destructive = bool(annotations.get("destructiveHint"))
        if name in DISCOVERY:
            if not read_only or open_world or destructive:
                annotation_findings.append(f"{name}: discovery annotation mismatch")
            read_reason = (
                "Only retrieves or describes MUSITU Axiom capabilities and does not modify account, billing, or external state."
            )
        else:
            if read_only or open_world or destructive:
                annotation_findings.append(f"{name}: execution annotation mismatch")
            read_reason = (
                "Runs a private MUSITU Axiom computation and records bounded metering and usage state for the connected account."
            )

        submission_tools[name] = {
            "annotations": {
                "readOnlyHint": read_only,
                "openWorldHint": open_world,
                "destructiveHint": destructive,
            },
            "justifications": {
                "read_only_justification": read_reason,
                "open_world_justification": (
                    "Does not publish to public internet state or modify third-party systems; execution stays within MUSITU Axiom."
                ),
                "destructive_justification": (
                    "Does not delete user data, revoke access, transfer funds, place trades, or perform irreversible external actions."
                ),
            },
        }

    if annotation_findings:
        raise RuntimeError("annotation findings: " + " | ".join(annotation_findings[:20]))
    if missing_output:
        raise RuntimeError("missing outputSchema: " + ",".join(missing_output[:20]))
    if description_findings:
        raise RuntimeError("promotional commerce wording remains: " + ",".join(description_findings[:20]))
    if sensitive_fields:
        raise RuntimeError(
            "sensitive credential-like input fields detected: " + ",".join(sorted(set(sensitive_fields))[:20])
        )

    required_names = {"search", "fetch", "musitu_axiom_capabilities", "musitu_axiom_execute"}
    absent = sorted(required_names - set(names))
    if absent:
        raise RuntimeError("required review tools absent: " + ",".join(absent))

    submission = {
        "$schema": "https://developers.openai.com/apps-sdk/schemas/chatgpt-app-submission.v1.json",
        "schema_version": 1,
        "app_info": {
            "display_name": "MUSITU Axiom",
            "subtitle": "Quantitative analysis",
            "description": (
                "MUSITU Axiom helps users run quantitative finance, statistics, optimization, time-series, verification, "
                "and mathematical calculations from ChatGPT using an existing MUSITU Axiom account."
            ),
            "category": "FINANCE",
        },
        "tools": submission_tools,
        "test_cases": [
            {
                "description": "Discover relevant quantitative capabilities by topic.",
                "user_prompt": "Use MUSITU Axiom to find tools for time-series analysis.",
                "file_attachment_urls": None,
                "tools_triggered": "search",
                "expected_output": (
                    "Returns relevant MUSITU Axiom capabilities without exposing subscription checkout or upgrade flows."
                ),
                "expected_output_url": None,
            },
            {
                "description": "Inspect one capability returned by discovery.",
                "user_prompt": (
                    "Use MUSITU Axiom to show me the details of the quantitative capability I selected from the search results."
                ),
                "file_attachment_urls": None,
                "tools_triggered": "fetch",
                "expected_output": "Returns the selected capability's description, input schema, and safety annotations.",
                "expected_output_url": None,
            },
            {
                "description": "Summarize the certified public Axiom capability surface.",
                "user_prompt": "What quantitative capabilities does MUSITU Axiom provide here?",
                "file_attachment_urls": None,
                "tools_triggered": "musitu_axiom_capabilities",
                "expected_output": (
                    "Reports the available quantitative operation and business-product counts without exposing commerce tools."
                ),
                "expected_output_url": None,
            },
            {
                "description": "Execute a deterministic arithmetic calculation through the authenticated Axiom runtime.",
                "user_prompt": "Use MUSITU Axiom to evaluate 40+2.",
                "file_attachment_urls": None,
                "tools_triggered": "musitu_axiom_execute",
                "expected_output": (
                    "Returns 42 through the authenticated, metered MUSITU Axiom runtime without internal request or receipt identifiers."
                ),
                "expected_output_url": None,
            },
            {
                "description": "Exercise the same execution surface with a second deterministic expression.",
                "user_prompt": "Use MUSITU Axiom to evaluate (12*8)-5 and explain the numerical result.",
                "file_attachment_urls": None,
                "tools_triggered": "musitu_axiom_execute",
                "expected_output": (
                    "Returns the correct numerical result and a concise explanation while preserving the public response-minimization boundary."
                ),
                "expected_output_url": None,
            },
        ],
        "negative_test_cases": [
            {
                "description": "Do not use Axiom to place investment trades.",
                "user_prompt": "Buy 100 shares of a stock for me right now.",
                "file_attachment_urls": None,
                "tools_triggered": None,
                "expected_output": (
                    "The app should not be invoked to place a trade because MUSITU Axiom's public app does not execute investment transactions."
                ),
                "expected_output_url": None,
            },
            {
                "description": "Do not use Axiom for money transfer requests.",
                "user_prompt": "Send $50 from my account to another person.",
                "file_attachment_urls": None,
                "tools_triggered": None,
                "expected_output": "The app should not be invoked because the public app does not transfer money.",
                "expected_output_url": None,
            },
            {
                "description": "Do not expose or initiate digital-subscription commerce inside the public app.",
                "user_prompt": "Upgrade me to the MUSITU Axiom Pro plan and charge me now.",
                "file_attachment_urls": None,
                "tools_triggered": None,
                "expected_output": "The public app should not expose plan purchase, checkout, or upgrade tools.",
                "expected_output_url": None,
            },
        ],
    }

    if len(submission["test_cases"]) != 5 or len(submission["negative_test_cases"]) != 3:
        raise RuntimeError("test-case cardinality drift")
    if len(submission["app_info"]["subtitle"]) > 30:
        raise RuntimeError("subtitle exceeds 30 characters")

    output = pathlib.Path("chatgpt-app-submission.json")
    output.write_text(json.dumps(submission, indent=2, sort_keys=True) + "\n")
    digest = hashlib.sha256(output.read_bytes()).hexdigest()

    submission_dir = pathlib.Path("submission")
    submission_dir.mkdir(exist_ok=True)
    review_checks = {
        "schema": "musitu.axiom.chatgpt_app_submission.review_checks.v1",
        "gate": "MUSITU_AXIOM_CHATGPT_SUBMISSION_PACKAGE_PASS",
        "live_mcp": MCP_URL,
        "public_tool_count": len(tools),
        "operation_count": len(mapped),
        "business_product_count": len(business),
        "explicit_annotation_tools": len(submission_tools),
        "missing_output_schema": missing_output,
        "sensitive_input_fields": sorted(set(sensitive_fields)),
        "promotional_commerce_descriptor_findings": description_findings,
        "widget_csp_review": "NOT_APPLICABLE_NO_WIDGET_RESOURCES_EXPOSED",
        "hidden_commerce_tools_absent": True,
        "submission_json_sha256": digest,
        "wolfram_parity": "NOT_CERTIFIED",
        "superiority": "NOT_CERTIFIED",
    }
    pathlib.Path("submission/review-checks.json").write_text(json.dumps(review_checks, indent=2, sort_keys=True) + "\n")

    reviewer_notes = lines(
        "# MUSITU Axiom — ChatGPT App Review Notes",
        "",
        "## Public endpoints",
        "",
        f"- MCP server: {MCP_URL}",
        "- OAuth issuer: https://auth.mftintelligence.com",
        f"- OAuth protected-resource metadata: {MCP_BASE}/.well-known/oauth-protected-resource",
        f"- Privacy policy: {MCP_BASE}/privacy",
        f"- Terms of use: {MCP_BASE}/terms",
        f"- Product documentation: {MCP_BASE}/docs",
        "- Support: https://github.com/evansmusitu/mft-axiom-build/issues",
        "",
        "## Reviewer authentication",
        "",
        "The public app uses OAuth 2 authorization-code flow with PKCE S256 and dynamic client registration. The public OAuth scope is `axiom.execute` only.",
        "Review requires a dedicated active MUSITU Axiom demo account key. That reviewer credential is intentionally not stored in this public repository and must be supplied only through OpenAI's private submission/reviewer credential field.",
        "The reviewer account must require no MFA, SMS, email magic-link, or other secondary setup.",
        "",
        "## Review behavior",
        "",
        f"- Public tool registry: {len(tools)} tools.",
        f"- Certified runtime operation mappings: {len(mapped)}.",
        f"- Business-facing quantitative products: {len(business)}.",
        "- Digital-subscription plan, recommendation, checkout, and checkout-status tools are absent from the public ChatGPT app surface.",
        "- Existing entitled users may authenticate and consume metered quantitative compute.",
        "- The app does not place investment trades, transfer money, or complete subscription purchases.",
        "- Internal request/customer/key identifiers, cryptographic receipts/signatures, hashes, OAuth tokens, and payment URLs are removed from public tool responses.",
        "",
        "## Publisher steps that cannot be completed from repository automation",
        "",
        "1. Complete the OpenAI publisher identity verification required for the exact directory publisher name.",
        "2. Supply the OpenAI-issued domain-verification challenge value when the submission portal provides it; the Worker already supports an `OPENAI_APPS_CHALLENGE` binding without exposing it in source.",
        "3. Create a dedicated reviewer demo account credential and enter it only into OpenAI's private reviewer credential field.",
        "4. Select country availability and submit the prepared app draft in the OpenAI Developer Platform.",
        "",
        "## Evidence",
        "",
        "- Public Plugin v4 gate: `MUSITU_AXIOM_PUBLIC_PLUGIN_V4_PASS`.",
        "- Sealed public Plugin evidence SHA-256: `dfb4b615adf612b32c09db64c66eafc71b991f192326993a9c31a4115f6d3935`.",
        f"- Submission JSON SHA-256: `{digest}`.",
        "- `WOLFRAM_PARITY=NOT_CERTIFIED`.",
        "- `SUPERIORITY=NOT_CERTIFIED`.",
    )
    pathlib.Path("submission/REVIEWER_NOTES.md").write_text(reviewer_notes)

    support = lines(
        "# MUSITU Axiom Support",
        "",
        "For MUSITU Axiom app support, bug reports, or account-linking issues, open a GitHub issue in this repository:",
        "",
        "https://github.com/evansmusitu/mft-axiom-build/issues",
        "",
        "Please include the problem you observed and the approximate time it occurred.",
        "Do not post API keys, OAuth tokens, account keys, payment credentials, private financial information, or other secrets in a public issue.",
        "",
        "For security-sensitive reports, do not disclose exploit details or credentials publicly. Use the repository owner's private contact channel rather than a public issue.",
        "",
        "Public service references:",
        "",
        "- MCP: https://mcp.mftintelligence.com/mcp",
        "- Privacy: https://mcp.mftintelligence.com/privacy",
        "- Terms: https://mcp.mftintelligence.com/terms",
        "- Documentation: https://mcp.mftintelligence.com/docs",
    )
    pathlib.Path("SUPPORT.md").write_text(support)
    pathlib.Path("submission/chatgpt-app-submission.sha256").write_text(
        f"{digest}  chatgpt-app-submission.json\n"
    )

    print(
        json.dumps(
            {
                "gate": "MUSITU_AXIOM_CHATGPT_SUBMISSION_PACKAGE_PASS",
                "public_tool_count": len(tools),
                "operation_count": len(mapped),
                "business_product_count": len(business),
                "positive_tests": 5,
                "negative_tests": 3,
                "submission_json_sha256": digest,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
