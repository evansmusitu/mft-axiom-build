import fs from "node:fs";
import assert from "node:assert/strict";

const oauth="reviewer_clone/musitu_axiom_operator_reviewer_oauth.mjs";
const gate="reviewer_clone/musitu_axiom_operator_reviewer_gate.mjs";
for (const p of [oauth,gate]) assert.equal(fs.existsSync(p),true,`missing ${p}`);

const o=fs.readFileSync(oauth,"utf8");
const g=fs.readFileSync(gate,"utf8");

assert.match(o,/axiom\.operator\.execute/);
assert.match(o,/openid/);
assert.match(o,/email/);
assert.doesNotMatch(o,/https:\/\/auth\.mftintelligence\.com/);
assert.doesNotMatch(o,/https:\/\/mcp\.mftintelligence\.com/);

assert.match(g,/axiom\.operator\.execute/);
assert.match(g,/MODAL_OPERATOR_URL/);
assert.match(g,/MODAL_PROXY_KEY/);
assert.match(g,/MODAL_PROXY_SECRET/);
assert.match(g,/\.well-known\/oauth-protected-resource/);
assert.match(g,/tools\/list/);
assert.match(g,/tools\/call/);
assert.doesNotMatch(g,/https:\/\/mcp\.mftintelligence\.com/);
assert.doesNotMatch(g,/musitu_axiom_plugin_gate_v4/);


const deploy="reviewer_clone/deploy_operator_reviewer_clone.py";
assert.equal(fs.existsSync(deploy),true,`missing ${deploy}`);
const d=fs.readFileSync(deploy,"utf8");
assert.match(d,/musitu_axiom_operator_reviewer_oauth_machine_transport/);
assert.match(d,/musitu_axiom_operator_reviewer_mcp_machine_transport/);
assert.match(d,/security_level/);
assert.match(d,/essentially_off/);
assert.match(d,/bic/);
assert.match(d,/under_attack/);
assert.match(d,/OAUTH_HOST/);
assert.match(d,/MCP_HOST/);

console.log("MUSITU_AXIOM_OPERATOR_REVIEWER_CLONE_CONTRACT_PASS");
