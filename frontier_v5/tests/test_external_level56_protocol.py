import json
from pathlib import Path
from frontier_v5.scripts.run_external_level56_readiness import build

CASE_SET_SHA="6eea99e9e943498bbbb0e16e0be8447bff5cd206252d6d3fce79020e1e94bbf6"
CONSTRAINTS_SHA="2161fef373d371dcc0fefa9fc81df906a2eeddff2cc1429b33439c080e0a6c22"
PRIVATE_PACK_SHA="ab550cd24ca18cf3a09ab14ce3bca76c8298dbae108f250a11a9a1d235087955"
PROVIDER_BUNDLE_SHA="19223b303b2f5c368a0edb54def2fdc2b06eaa8a513455d91a5571dc0b036ba8"

def main():
    root=Path(__file__).resolve().parents[1]
    p=json.loads((root/"evals"/"EXTERNAL_LEVEL56_PROTOCOL_V2.json").read_text())
    commitment=json.loads((root/"evals"/"EXTERNAL_LEVEL56_CASESET_COMMITMENT_20261006.json").read_text())
    assert p["schema"]=="musitu.axiom.frontier.external-level56-protocol.v2"
    assert p["execution_policy"]["api_key_required"] is False
    assert p["level_5_rule"]["all_required_external_systems_required"] is True
    assert p["level_5_rule"]["partial_matrix_may_earn_level_5"] is False
    assert p["level_6_rule"]["independent_replay_required"] is True
    ids=[x["system_id"] for x in p["required_external_systems"]]
    assert ids==["openai-codex","anthropic-claude-code","google-antigravity","cognition-devin-desktop"]
    assert p["legacy_identity_rules"]["windsurf-cascade"]=="cognition-devin-desktop"

    sealed=p["sealed_evidence_commitment"]
    assert sealed["commitment_file"]=="frontier_v5/evals/EXTERNAL_LEVEL56_CASESET_COMMITMENT_20261006.json"
    assert sealed["case_set_sha256"]==commitment["case_set_sha256"]==CASE_SET_SHA
    assert sealed["constraints_sha256"]==commitment["constraints_sha256"]==CONSTRAINTS_SHA
    assert sealed["private_evaluator_pack_sha256"]==commitment["private_evaluator_pack_sha256"]==PRIVATE_PACK_SHA
    assert sealed["provider_inputs_bundle_sha256"]==commitment["provider_inputs_bundle_sha256"]==PROVIDER_BUNDLE_SHA
    assert sealed["hidden_content_published"] is False
    assert commitment["hidden_content_published"] is False

    out=build(root,Path("/tmp/does-not-exist-level56-receipts"),Path("/tmp/does-not-exist-level56-replays"))
    assert out["protocol_requires_paid_api_key"] is False
    assert out["case_set_sha256"]==CASE_SET_SHA
    assert out["constraints_sha256"]==CONSTRAINTS_SHA
    assert out["private_evaluator_pack_sha256"]==PRIVATE_PACK_SHA
    assert out["provider_inputs_bundle_sha256"]==PROVIDER_BUNDLE_SHA
    assert out["completed_external_reference_count"]==0
    assert out["evidence_level_5_verified"] is False
    assert out["evidence_level_6_verified"] is False
    assert out["gate"]=="MUSITU_AXIOM_LEVEL56_IN_PROGRESS"
    print("MUSITU_AXIOM_EXTERNAL_LEVEL56_PROTOCOL_V2_PASS")

if __name__=="__main__":
    main()
