"""Reproducible, privacy-conscious, entire-product chat-shift handoff.

Run in GitHub Actions on the protected feature branch. Never deploy, promote,
merge, or mutate main. All three snapshots come directly from Git objects.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path

REPO = "evansmusitu/mft-axiom-build"
FEATURE = "feat/musitu-connect-frontier"
HISTORIC_SEAL = "d6a846f6bbe0bccac1758713eb4de167caf07113"
MODEL_SHA = "3b51f3318fb59d2555b66cbbd41e371f9f0241d2137e5166c77e685f9ab030eb"
MANIFEST_SHA = "f57fab879104a8307f0b472fc106d61c1aa7cf440811229b2221b2266ee779bf"
EVIDENCE = (
    ("PUBLIC_NATIVE_FROZEN_LIGHTGBM", "37882474024", "musitu-axiom-native-frozen-lightgbm-research"),
    ("PUBLIC_SYNTHETIC_REPLAY", "37906916355", "musitu-axiom-pinned-native-model-synthetic-smoke"),
    ("PUBLIC_SYNTHETIC_PROXY_AUDIT", "37938799538", "musitu-axiom-research-window-proxy-synthetic-audit"),
    ("INDEPENDENT_DATA_GAP_AUDIT", "37978735182", "musitu-axiom-independent-mine-source-gap-report"),
)


def shell(*args: str) -> str:
    return subprocess.check_output(args, text=True).strip()


def gh_json(endpoint: str) -> dict:
    return json.loads(subprocess.check_output(("gh", "api", endpoint), text=True))


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def snapshot(rev: str, dest: Path) -> int:
    dest.mkdir()
    raw = subprocess.check_output(("git", "archive", "--format=tar", rev))
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as tf:
        for member in tf.getmembers():
            p = Path(member.name)
            if p.is_absolute() or ".." in p.parts or member.issym() or member.islnk():
                raise RuntimeError("UNSAFE_GIT_ARCHIVE_PATH")
        tf.extractall(dest, filter="data")
    files = [p for p in dest.rglob("*") if p.is_file()]
    if not files:
        raise RuntimeError("EMPTY_PRODUCT_SNAPSHOT")
    # Never intentionally package tracked credentials or private keys.
    forbidden = [p for p in files if p.name in (".env", "id_rsa", "credentials.json")
                 or p.suffix in (".pem", ".p12", ".key")]
    if forbidden:
        raise RuntimeError("POTENTIAL_SECRET_FILE_IN_SOURCE_ARCHIVE")
    return len(files)


def verify(stage: Path) -> int:
    manifest = stage / "HANDOFF" / "CHECKSUMS.json"
    expected = json.loads(manifest.read_text(encoding="utf-8"))
    actual = {p.relative_to(stage).as_posix(): sha(p) for p in stage.rglob("*")
              if p.is_file() and p != manifest}
    if actual != expected:
        print("HANDOFF_INTEGRITY_FAILED", json.dumps({
            "missing": sorted(expected.keys() - actual.keys()),
            "extra": sorted(actual.keys() - expected.keys()),
            "changed": sorted(k for k in actual.keys() & expected.keys()
                              if actual[k] != expected[k])
        }, sort_keys=True))
        return 1
    print("HANDOFF_FULL_SHA256_CHECK_PASSED", len(expected))
    return 0


def main() -> None:
    if os.environ.get("GITHUB_REPOSITORY") != REPO or os.environ.get("GITHUB_REF_NAME") != FEATURE:
        raise RuntimeError("HANDOFF_WRONG_REPOSITORY_OR_BRANCH")
    if shell("git", "status", "--porcelain"):
        raise RuntimeError("HANDOFF_WORKTREE_NOT_CLEAN")

    shell("git", "fetch", "--no-tags", "origin", "main")
    head = shell("git", "rev-parse", "HEAD")
    main_sha = shell("git", "rev-parse", "origin/main")
    shell("git", "cat-file", "-e", HISTORIC_SEAL + "^{commit}")
    pr = gh_json(f"repos/{REPO}/pulls/9")
    live_main = gh_json(f"repos/{REPO}/branches/main")["commit"]["sha"]
    if (pr["state"] != "open" or pr.get("merged_at") is not None
            or pr["head"]["sha"] != head or pr["base"]["ref"] != "main"
            or live_main != main_sha):
        raise RuntimeError("HANDOFF_UNSAFE_LIVE_GITHUB_STATE")

    stage = Path(os.environ["RUNNER_TEMP"]) / "musitu-clean-whole-product-20261024"
    stage.mkdir(parents=True, exist_ok=False)
    hand = stage / "HANDOFF"
    hand.mkdir()
    evidence = stage / "EVIDENCE_PUBLIC_RESEARCH_ONLY"
    evidence.mkdir()
    counts = {
        "PRODUCT_ACTIVE_FEATURE_BRANCH": snapshot(head, stage / "PRODUCT_ACTIVE_FEATURE_BRANCH"),
        "PRODUCT_CURRENT_MAIN": snapshot(main_sha, stage / "PRODUCT_CURRENT_MAIN"),
        "REFERENCE_PREVIOUSLY_SEALED_MAIN": snapshot(HISTORIC_SEAL, stage / "REFERENCE_PREVIOUSLY_SEALED_MAIN"),
    }
    (hand / "ACTIVE_FEATURE_RECENT_COMMITS.txt").write_text(
        shell("git", "log", "-n", "25", "--format=%h %cs %s", "HEAD") + "\n")
    (hand / "MAIN_RECENT_COMMITS.txt").write_text(
        shell("git", "log", "-n", "25", "--format=%h %cs %s", "origin/main") + "\n")
    (hand / "BRANCH_DIVERGENCE.txt").write_text(
        subprocess.check_output(("git", "diff", "--stat", "origin/main...HEAD"), text=True)
        + "\nmain-only / feature-only commits: "
        + shell("git", "rev-list", "--left-right", "--count", "origin/main...HEAD")
        + "\n"
    )

    evidence_log = []
    for destname, run, artifact in EVIDENCE:
        target = evidence / destname
        target.mkdir()
        subprocess.run(("gh", "run", "download", run, "--repo", REPO,
                        "--name", artifact, "--dir", str(target)), check=True)
        files = [p for p in target.rglob("*") if p.is_file()]
        if not files:
            raise RuntimeError("EXPECTED_GITHUB_RESEARCH_EVIDENCE_MISSING")
        evidence_log.append({"name": artifact, "run_id": int(run), "files": len(files),
                             "research_only": True})
    native = evidence / "PUBLIC_NATIVE_FROZEN_LIGHTGBM"
    if sha(native / "model.txt") != MODEL_SHA or sha(native / "manifest.json") != MANIFEST_SHA:
        raise RuntimeError("PUBLIC_FROZEN_MODEL_ARTIFACT_DIGEST_MISMATCH")
    if (native / "manifest.sha256").read_text().strip() != MANIFEST_SHA:
        raise RuntimeError("PUBLIC_FROZEN_MODEL_SIDECAR_MISMATCH")

    all_runs = gh_json(f"repos/{REPO}/actions/runs?branch={FEATURE}&per_page=80")["workflow_runs"]
    head_runs = [{"name": r["name"], "run_id": r["id"],
                  "status": r["status"], "conclusion": r["conclusion"],
                  "html_url": r["html_url"]} for r in all_runs if r["head_sha"] == head]
    release_gate_path = stage / "PRODUCT_ACTIVE_FEATURE_BRANCH" / "qualification" / "musitu_connect_beta_release_gate.json"
    if not release_gate_path.is_file():
        raise RuntimeError("MISSING_CUSTOMER_BETA_RELEASE_GATE")
    beta_gate = json.loads(release_gate_path.read_text())
    if (beta_gate.get("state") != "BLOCKED_PENDING_CUSTOMER_AND_OPERATIONS_EVIDENCE"
            or beta_gate.get("new_beta_customer_admission_authorized") is not False
            or beta_gate.get("public_customer_publication_authorized") is not False
            or beta_gate.get("predictive_methane_production_authorized") is not False):
        raise RuntimeError("CUSTOMER_BETA_GATE_UNEXPECTEDLY_OPEN")

    state = {
        "schema": "musitu.whole_product.chat_handoff.v2026_10_18",
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "repository": REPO,
        "active_feature_branch": FEATURE,
        "feature_head": head,
        "current_main_head": main_sha,
        "previously_sealed_main_commit": HISTORIC_SEAL,
        "main_advanced_after_previous_seal": main_sha != HISTORIC_SEAL,
        "pull_request": 9,
        "pull_request_open_unmerged": True,
        "source_files_per_snapshot": counts,
        "beta_customer_admission_authorized": False,
        "public_customer_publication_authorized": False,
        "beta_customer_release_state": beta_gate["state"],
        "customer_beta_checks": beta_gate["checks"],
        "hosted_cloudflare_d1_qualified": False,
        "launch_gate_source": "PRODUCT_ACTIVE_FEATURE_BRANCH/qualification/musitu_connect_beta_release_gate.json",
        "chat_shift_procedure": "verify_checksums_read_handoff_compare_live_refs_then_engineer_on_feature",
        "model_sha256": MODEL_SHA, "model_manifest_sha256": MANIFEST_SHA,
        "evidence": evidence_log,
        "github_checks_observed_at_export": head_runs,
        "production_connect_axiom_compute": "PREVIOUSLY_AUTHORIZED_AND_RECORDED_ENABLED_RECHECK_LIVE",
        "methane_predictive_production_admission": False,
        "independent_mine_validation": False,
        "mine_safety_certification": False,
        "merge_pr_9_authorized": False,
        "mutate_main_authorized": False,
        "deploy_or_promote_without_user_approval": False,
    }
    (hand / "STATE.json").write_text(json.dumps(state, sort_keys=True, indent=2) + "\n")

    read_first = f"""# MUSITU Connect + MUSITU Axiom — FULL PRODUCT HANDOFF

Date: 2026-10-24
Repository: {REPO}
Active feature branch: {FEATURE}
Active source commit: {head}
Current main commit: {main_sha}
Historically sealed main baseline: {HISTORIC_SEAL}
PR #9: OPEN / UNMERGED when frozen.

ALL THREE SOURCE SNAPSHOTS ARE INCLUDED:
1. PRODUCT_ACTIVE_FEATURE_BRANCH is the current working feature source.
2. PRODUCT_CURRENT_MAIN is the independently fetched actual main at freeze.
3. REFERENCE_PREVIOUSLY_SEALED_MAIN retains the older sealed baseline.
main ADVANCED beyond the formerly sealed SHA. Never assume the old SHA is
still current or silently reset, merge, rewrite or force-push either branch.

EVIDENCE_PUBLIC_RESEARCH_ONLY contains the SHA-verified public native
LightGBM bundle, synthetic-only replay evidence, proxy analysis, and the
external-data-source gap audit. The package deliberately contains no private
mine telemetry, production credentials, mine permission grants, or secrets.

Handoff rules:
- First run: python HANDOFF/VERIFY_PACKAGE.py
- Read HANDOFF/STATE.json, HANDOFF/CONTINUATION.md and
  HANDOFF/EXACT_NEW_CHAT_COMMAND.txt.
- Query LIVE GitHub refs, PR #9, all relevant CI and new commits before
  doing more engineering. A snapshot can become stale after it is exported.
- Keep PR #9 OPEN and UNMERGED. Do not mutate main without explicit user
  authorization. Never redeploy or promote a model simply because the chat
  changed.
- MUSITU Connect is the general-purpose enterprise integration platform.
  Mining is the first adapter. Axiom is the downstream predictive / quantitative
  engine, not the owner of enterprise interoperability.
- Authenticated production Connect-to-Axiom COMPUTATION was previously
  separately authorized and recorded enabled. This is distinct from a
  qualified safety-critical production METHANE PREDICTION capability, which
  remains BLOCKED and unvalidated.
- Preserve hard methane measured warnings >= 1.0; causal 600-second
  history; t+180 to t+360 future labels; 30-second stride; no lookahead.
- Preserve original forecast gates: recall >= 0.90, precision >= 0.10,
  F2 >= hard-warning-baseline F2 * 1.05, and passing >= 3/4 folds. LightGBM
  previously passed only 1/4 development folds.
- Never claim external mine data are verified based on declarations or hashes;
  physical sensor equivalence, provenance and reuse permission require
  legitimate independent evidence.
- Do not fill absent channels, relabel 15-second streams as 1-second, fit or
  recalibrate thresholds on an external holdout, invent incidents, manipulate
  admission gates, leak secrets or manufacture green evidence.
- Existing holdout preregistration and source-readiness work exists. Inspect
  before extending; avoid redundant synthetic infrastructure.
- Customer beta release gate is FAIL-CLOSED. The feature branch contains
  synthetic-only tenant credentials, D1/SQLite quota reservations, minute limits,
  bounded JSON intake, Mining semantic validation, provisioning/offboarding
  examples, staging preflight and synthetic pilot acceptance. These are not
  commercial customer admission or an approved hosted D1 deployment.
- Do NOT distribute production's internal HMAC bearer or upstream Axiom key.
  Independent customer credentials and tenant-admin pathways remain unqualified.
- Primary launch blockers: independently approved isolated hosted Cloudflare D1
  staging, real concurrent/tenant/revocation tests, secure provisioning,
  human-acknowledged operations paging, legal/privacy and pilot signatures.
- The authoritative next action is to compare LIVE GitHub state and evidence,
  rather than assuming either this ZIP or an earlier chat remains current.
"""
    (hand / "00_READ_FIRST.md").write_text(read_first)

    continuation = f"""# Exact next-chat execution context

Authoritative live repo: https://github.com/{REPO}
Open PR #9: https://github.com/{REPO}/pull/9
Feature branch SHA at export: {head}
Main SHA at export: {main_sha}
Earlier protected baseline SHA: {HISTORIC_SEAL}

SOURCE SNAPSHOT INVENTORY: {json.dumps(counts, sort_keys=True)}

Data and evidence already completed:
- Production Connect compute endpoint and Axiom remote executor are recorded
  as separately enabled; verify current runtime status from live source.
- Frozen real-source (public developmental) LightGBM model is supplied under
  EVIDENCE_PUBLIC_RESEARCH_ONLY/PUBLIC_NATIVE_FROZEN_LIGHTGBM.
- Other bundled artifacts are synthetic or descriptive research-only.
- Data source catalog: qualification/independent_mine_source_catalog_20261009.json
- Preregistration: benchmarks/mining_adapter/independent_holdout_protocol.py
- Candidate readiness: benchmarks/mining_adapter/independent_mine_readiness.py
- Partner mapping: connect/partner_mine_mapping.py
- Frozen inference: benchmarks/mining_adapter/frozen_mine_evaluator.py
- Retain all tests, GitHub workflows and operational qualification plans.

NEXT LEGITIMATE MILESTONE: Compare actual candidate external datasets against
rights, independent mine identity, original 28 physical channels, one-second
observations and adequate positive support. Obtain permission and verify it.
Use the preregistered, immutable prediction protocol. Do not synthesize missing
channels or alter frozen model threshold. If no eligible external dataset is
available, produce a precise gap report and remain research-only.

Run targeted and full Connect regression tests, reread CI logs, publish only
verified safe feature-branch commits with compare-and-swap. Do not blindly merge
a snapshot into main, particularly because main moved after the older seal.
The new chat must not assume prior chat conclusions are current.
"""
    continuation += """
ENTERPRISE LAUNCH CONTINUATION (24 October 2026):
- This handoff supersedes 2026-10-18 package's feature-head context.
- Feature branch contains the nonproduction Connect customer lifecycle and
  simulated enterprise acceptance package, with local GitHub CI proof only.
- The beta gate's NOT_DEMONSTRATED and NOT_DEMONSTRATED_ON_REAL_D1 entries
  remain authoritative for hosted D1, ops and customer admission.
- FIRST check live feature/main SHAs, PR #9, CI and beta gate before editing.
- Advance with useful code/tests and documented proof inside the feature
  branch; NEVER run production deployment, main merge, Cloudflare changes,
  issue customer credentials or contact real mines without separate consent.
- Scope: MUSITU Connect enterprise infrastructure first; Mining is adapter #1,
  Axiom quantitative executor. Independent methane predictor qualification
  is still blocked by absent qualified real underground mine evidence.
- No ChatGPT Connect publication or customer billing is authorized.
"""
    (hand / "CONTINUATION.md").write_text(continuation)

    fresh_command = (
        "Continue MUSITU Connect and MUSITU Axiom from the NEW complete clean "
        "whole-product handoff ZIP saved in my connected Google Drive. "
        "Use the matching 2026-10-24 handoff ZIP, extract it and FIRST read "
        "HANDOFF/00_READ_FIRST.md, HANDOFF/STATE.json, "
        "HANDOFF/CONTINUATION.md and verify HANDOFF/CHECKSUMS.json with "
        "python HANDOFF/VERIFY_PACKAGE.py. "
        f"The active source snapshot SHA is {head} and the actual main SHA "
        f"at packaging was {main_sha}; the earlier seal was {HISTORIC_SEAL}. "
        "Inspect BOTH full product source snapshots, the previous-seal reference, "
        "SHA-pinned public model, and research evidence. "
        "Then query LIVE GitHub evansmusitu/mft-axiom-build, "
        "feat/musitu-connect-frontier, PR #9, main, latest CI and any newer commits "
        "before proceeding. Keep PR #9 unmerged, do not change main or promote "
        "methane to production without my express authorization. "
        "Respect MUSITU Connect's enterprise platform boundary and Axiom's "
        "downstream predictive role. Production compute integration was recorded "
        "enabled, but independent mine validation and production methane safety "
        "qualification remain NOT achieved. Continue the complete product engineering, "
        "prioritizing enterprise Connect security, customer isolation, and a "
        "hosted D1 staging qualification ONLY with separate infrastructure approval; "
        "preserve synthetic pilot gates and actual human/legal signoffs. Preserve "
        "the independent methane holdout research and frozen models. Never "
        "fabricate data, permissions, models, CI or safety claims. "
        "Carry the work through to verified CI and accurate final gate status "
        "inside this chat without asking me to restate the project."
    )
    (hand / "EXACT_NEW_CHAT_COMMAND.txt").write_text(fresh_command + "\n")

    (hand / "PRODUCT_AND_LAUNCH_INDEX.md").write_text("""# Product and launch orientation

This ZIP contains full tracked source snapshots under:
- PRODUCT_ACTIVE_FEATURE_BRANCH: feature branch at STATE.json feature_head.
- PRODUCT_CURRENT_MAIN: true main SHA at export, unchanged by packaging.
- REFERENCE_PREVIOUSLY_SEALED_MAIN: historical separately sealed baseline.
- EVIDENCE_PUBLIC_RESEARCH_ONLY: model and research evidence, with frozen SHA.

Review these component entrypoints in the feature snapshot:
- Connect production Worker: connect/production_worker.mjs
- Internal Connect/Axiom auth and mining API: contracts/connect.openapi.yaml
- Customer identity and quota: connect/customer_identity.mjs,
  connect/customer_admission.mjs and infra/connect_customer_registry.sql
- Customer request safety: connect/customer_payload.mjs,
  connect/customer_mining_semantics.mjs, connect/customer_ingress_canary.mjs
- Nonproduction customer lifecycle: connect/customer_provisioning.mjs
- Local D1 verification: tests/connect/test_customer_d1_local.mjs
- Synthetic partner acceptance: examples/connect/synthetic_beta_acceptance.json,
  tests/connect/test_synthetic_beta_acceptance.mjs
- Hosted D1 staging candidate check: qualification/connect_d1_staging_preflight.py
- Beta hard stop: qualification/musitu_connect_beta_release_gate.json
- Detailed procedures: docs/operations/musitu-connect-*.md
- Mining adapter and independent evidence: connect/partner_mine_mapping.py,
  benchmarks/mining_adapter/, qualification/, EVIDENCE_PUBLIC_RESEARCH_ONLY/

Every successful CI claim is limited to the observed SHA and date. Local
workerd/Miniflare tests do not imply a hosted D1 qualification. The customer
admission and public launch flags in the beta gate remain FALSE.

Operational boundaries:
- No production redeploy, main mutation, PR merge, Cloudflare zone/security
  changes, OAuth/customer-key issuance or safety promotion without separate
  explicit authorization.
- The existing Connect-to-Axiom production arithmetic computation was recorded
  separately authorized and enabled; verify live state before making claims.
- Independently qualified, production methane safety predictions are blocked.
- ChatGPT Axiom submission is separate from Connect plugin publication.

Read HANDOFF/STATE.json first for pinned feature/main refs, then verify GitHub
live state. If newer code exists, reconcile it and make a new verified snapshot.
""")

    verifier = '''from pathlib import Path
import hashlib,json,sys
root=Path(__file__).resolve().parents[1]
expected=json.loads((root/"HANDOFF"/"CHECKSUMS.json").read_text())
actual={p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
        for p in root.rglob("*") if p.is_file() and p != root/"HANDOFF"/"CHECKSUMS.json"}
if actual != expected:
    print("HANDOFF_SHA256_CHECK=FAIL")
    print("MISSING", sorted(expected.keys()-actual.keys()))
    print("EXTRA", sorted(actual.keys()-expected.keys()))
    print("MODIFIED", sorted(k for k in actual.keys() & expected.keys() if expected[k]!=actual[k]))
    sys.exit(1)
print("HANDOFF_SHA256_CHECK=PASS",len(expected))
'''
    (hand / "VERIFY_PACKAGE.py").write_text(verifier)
    checksums = {p.relative_to(stage).as_posix(): sha(p) for p in stage.rglob("*")
                 if p.is_file() and p != hand / "CHECKSUMS.json"}
    (hand / "CHECKSUMS.json").write_text(json.dumps(checksums, indent=2, sort_keys=True) + "\n")
    if verify(stage):
        raise RuntimeError("FULL_HANDOFF_VERIFY_FAILED")
    print("HANDOFF_COMPLETE", json.dumps({
        "head": head, "main": main_sha,
        "files_checksums": len(checksums),
        "source_snapshots": counts, "research_artifacts": len(evidence_log),
        "pr9_open_unmerged": True,
        "production_methane_blocked": True
    }, sort_keys=True))


if __name__ == "__main__":
    main()
