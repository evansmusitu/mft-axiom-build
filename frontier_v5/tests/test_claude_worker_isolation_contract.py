from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTIER = ROOT / "frontier_v5"
CLAUDE = FRONTIER / "distribution" / "claude"

OPENAI_AUTH_BLOB_SHA1 = "8ba0dbc1b6dd1533c6c26bff23991429e03a71a5"
OPENAI_MCP_BLOB_SHA1 = "4a1ad37a5e7df0e4d3966e8b5f9f0e8f2db69167"


def git_blob_sha1(path: Path) -> str:
    data = path.read_bytes()
    header = f"blob {len(data)}\0".encode()
    return hashlib.sha1(header + data).hexdigest()


def test_frozen_openai_sources_are_byte_exact():
    assert git_blob_sha1(ROOT / "auth" / "musitu_axiom_oauth_worker.mjs") == OPENAI_AUTH_BLOB_SHA1
    assert git_blob_sha1(ROOT / "mcp" / "musitu_axiom_plugin_gate_v4.mjs") == OPENAI_MCP_BLOB_SHA1


def test_claude_auth_candidate_is_isolated_and_uses_exact_callback_contract():
    src = (CLAUDE / "musitu_axiom_oauth_worker_claude_candidate.mjs").read_text()
    assert "https://claude-auth.mftintelligence.com" in src
    assert "https://claude-mcp.mftintelligence.com/mcp" in src
    assert 'u.hostname !== "claude.ai"' in src
    assert '"claude.com"' not in src
    assert 'u.pathname !== "/api/mcp/auth_callback"' in src
    assert "return html(200, callbackPage(url), extra)" in src
    assert "chatgpt.com" not in src
    assert "connector_platform_oauth_redirect" not in src


def test_claude_callback_completes_post_before_cross_origin_navigation():
    import subprocess
    script = r'''
import fs from 'node:fs';
import assert from 'node:assert/strict';
const src = fs.readFileSync(process.argv[1], 'utf8');
const module = await import('data:text/javascript;base64,' + Buffer.from(src + '\nexport { callbackResponse };').toString('base64'));
// Placeholders only: no account credential, OAuth transaction or database.
const url = 'https://claude.ai/api/mcp/auth_callback?code=test-only-placeholder&state=test-only-placeholder';
const response = module.callbackResponse(url);
assert.equal(response.status, 200);
assert.equal(response.headers.has('location'), false);
assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
assert.equal(response.headers.get('cache-control'), 'no-store');
const csp = response.headers.get('content-security-policy');
assert.ok(csp.includes("form-action 'self'"));
assert.ok(csp.includes("default-src 'none'"));
assert.ok(!csp.includes('script-src'));
const body = await response.text();
const escaped = url.replaceAll('&', '&amp;');
assert.ok(body.includes('http-equiv="refresh" content="0;url=' + escaped + '"'));
assert.ok(body.includes('href="' + escaped + '"'));
assert.ok(!body.includes('<script'));
assert.ok(!body.includes('<form'));
'''
    subprocess.run([
        "node", "--input-type=module", "-e", script,
        str(CLAUDE / "musitu_axiom_oauth_worker_claude_candidate.mjs"),
    ], check=True, capture_output=True, text=True)


def test_claude_mcp_candidate_has_no_openai_only_surface():
    src = (CLAUDE / "musitu_axiom_mcp_gate_claude_candidate.mjs").read_text()
    assert "https://claude-auth.mftintelligence.com" in src
    assert "https://claude-mcp.mftintelligence.com" in src
    assert "openai-apps-challenge" not in src
    assert "openai/toolInvocation" not in src
    assert "OPENAI_APPS_CHALLENGE" not in src


def test_claude_mcp_candidate_uses_exact_mcp_resource_and_http_401_auth_challenge():
    src = (CLAUDE / "musitu_axiom_mcp_gate_claude_candidate.mjs").read_text()
    assert 'oauthResource:env.MCP_OAUTH_RESOURCE||"https://claude-mcp.mftintelligence.com/mcp"' in src
    assert 'publicBase:env.MCP_PUBLIC_BASE||"https://claude-mcp.mftintelligence.com"' in src
    assert 'row.resource!==c.oauthResource' in src
    assert 'new Request(c.publicBase+path' in src
    assert 'resource:c.oauthResource' in src
    assert 'return response(401' in src
    assert '"www-authenticate":challenge(c)' in src


def test_claude_mcp_candidate_has_isolated_algebra_solve_compatibility_without_openai_mutation():
    src = (CLAUDE / "musitu_axiom_mcp_gate_claude_candidate.mjs").read_text()
    assert "function algebraSolveCompatibilityRequest" in src
    assert 'operation==="algebra.solve"' in src
    assert '"algebra.polynomial_roots"' in src
    assert "single polynomial equation and one symbol" in src
    assert "compatibility_rewrite" in src


def test_claude_mcp_projects_safe_scalar_result_into_text_content():
    import subprocess
    script = r'''
import fs from 'node:fs';
import assert from 'node:assert/strict';
const src = fs.readFileSync(process.argv[1], 'utf8');
const module = await import('data:text/javascript;base64,' + Buffer.from(src + '\nexport { projectClaudeTextResult };').toString('base64'));
const input = {
  jsonrpc: '2.0',
  id: 1,
  result: {
    content: [{type: 'text', text: 'MUSITU Axiom completed arithmetic.evaluate.'}],
    structuredContent: {
      operation: 'arithmetic.evaluate',
      result: {
        ok: true,
        operation: 'arithmetic.evaluate',
        result: '42.000000000000000000000000000000000000000000000000'
      }
    }
  }
};
const out = module.projectClaudeTextResult(structuredClone(input));
assert.equal(out.result.structuredContent.result.result, '42.000000000000000000000000000000000000000000000000');
assert.match(out.result.content[0].text, /42\.000000000000000000000000000000000000000000000000/);
assert.match(out.result.content[0].text, /arithmetic\.evaluate/);

const noScalar = {
  jsonrpc: '2.0',
  id: 2,
  result: {
    content: [{type: 'text', text: 'No scalar result.'}],
    structuredContent: {operation: 'example', result: {ok: true}}
  }
};
const unchanged = module.projectClaudeTextResult(structuredClone(noScalar));
assert.equal(unchanged.result.content[0].text, 'No scalar result.');
'''
    subprocess.run([
        "node", "--input-type=module", "-e", script,
        str(CLAUDE / "musitu_axiom_mcp_gate_claude_candidate.mjs"),
    ], check=True, capture_output=True, text=True)
