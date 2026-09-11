from __future__ import annotations

import copy

from frontier_review_safe.workflow_safety import (
    RISK_MUTABLE_ACTION,
    RISK_PRIVILEGED_MUTATION,
    authoritative_workflow_audit,
    deny_review_snapshot_workflow_execution,
    validate_authoritative_workflow_audit,
)


def main():
    audit = authoritative_workflow_audit()
    result = validate_authoritative_workflow_audit(audit)
    assert result["status"] == "PASS", result
    assert result["workflow_count"] == 32
    assert result["execution_authorized"] is False
    assert result["risk_summary"] == {
        "LOCAL_READ_ONLY_CONTRACT": 29,
        "READ_ONLY_REPO_WITH_NETWORK_AND_ARTIFACT_UPLOAD": 1,
        "PRIVILEGED_EXTERNAL_MUTATION": 1,
        "LOCAL_READ_ONLY_MUTABLE_ACTION_REF": 1,
    }

    fullstack = next(
        x for x in audit["records"]
        if x["name"] == "MUSITU Axiom Frontier v5 Full-Stack Verification"
    )
    assert fullstack["risk_class"] == RISK_PRIVILEGED_MUTATION
    assert fullstack["secrets"] is True
    assert fullstack["external_mutation"] is True
    assert deny_review_snapshot_workflow_execution(fullstack["run_id"])["status"] == "DENY"

    brand = next(x for x in audit["records"] if x["name"] == "MUSITU Brand Guard")
    assert brand["risk_class"] == RISK_MUTABLE_ACTION

    tampered = copy.deepcopy(audit)
    tampered["records"][0]["job_count"] = 1
    assert validate_authoritative_workflow_audit(tampered)["status"] == "FAIL"

    laundering = copy.deepcopy(audit)
    f = next(
        x for x in laundering["records"]
        if x["name"] == "MUSITU Axiom Frontier v5 Full-Stack Verification"
    )
    f["risk_class"] = "LOCAL_READ_ONLY_CONTRACT"
    assert validate_authoritative_workflow_audit(laundering)["status"] == "FAIL"

    print("MUSITU_AXIOM_REVIEW_SAFE_WORKFLOW_AUDIT_PASS")


if __name__ == "__main__":
    main()
