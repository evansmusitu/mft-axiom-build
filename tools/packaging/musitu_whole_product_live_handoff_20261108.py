#!/usr/bin/env python3
"""MUSITU AXIOM PUBLIC GitHub whole-product, portable, SHA-verified chat-shift handoff.

Runs only in a read-only GitHub Actions job. Archives public Git refs and
selected immutable source trees, current public PR/issue/CI evidence, and
a safe new-chat command. NEVER fetches private GitLab, Neon credentials,
Cloudflare account secrets, GitHub workflow secrets, or production data.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import tarfile
import io
import urllib.request
from pathlib import Path

REPO = "evansmusitu/mft-axiom-build"
DAY = "20261108"
EXPECTED_MAIN = "b10a74b435feb25654d4cf67ba67d09602698a3e"
KEY_PRS = (9, 76, 77, 81, 87, 99, 104, 149)
REQUIRED_PRS = (76, 81, 87, 99, 104)
SOURCE_SNAPSHOTS = (
    ("main", None),
    ("draft-9-connect-frontier", 9),
    ("draft-76-phase210a", 76),
    ("draft-77-connect-d1", 77),
    ("draft-81-phase210b", 81),
    ("draft-87-evidence", 87),
    ("draft-99-hyperdrive", 99),
    ("draft-104-protected-budget", 104),
    ("draft-149-d1-pr77", 149),
)
SAFE_SHA = re.compile(r"^[a-f0-9]{40}$")
FORBIDDEN_BASENAME = {".env", ".dev.vars", "credentials.json", "id_rsa", "id_ed25519"}
FORBIDDEN_SUFFIX = {".pem", ".p12", ".pfx", ".key"}
MAX_PUBLIC_PRS = 1000


def cmd(*args: str, capture: bool = True) -> str:
    proc = subprocess.run(args, check=True, capture_output=capture, text=True)
    return proc.stdout.strip() if capture else ""


def gh(path: str):
    token = os.environ.get("GH_TOKEN", "")
    if not token:
        raise RuntimeError("MISSING_READONLY_GITHUB_TOKEN")
    url = "https://api.github.com/" + path.lstrip("/")
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "musitu-public-handoff-checkpoint",
        },
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write(path: Path, data: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data.rstrip() + "\n", encoding="utf-8")


def jsonwrite(path: Path, data):
    write(path, json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True))


def get_all_prs():
    result = []
    for page in range(1, 12):
        items = gh(f"repos/{REPO}/pulls?state=open&sort=updated&direction=desc&per_page=100&page={page}")
        if not isinstance(items, list):
            raise RuntimeError("UNEXPECTED_PULL_REQUEST_PAYLOAD")
        result.extend(items)
        if len(result) > MAX_PUBLIC_PRS:
            raise RuntimeError("PR_INVENTORY_TOO_LARGE")
        if len(items) < 100:
            break
    result.sort(key=lambda x: x["number"])
    if not result:
        raise RuntimeError("EMPTY_PUBLIC_PR_INVENTORY")
    return result


def capture_pr(pr):
    return {
        "number": pr["number"],
        "url": pr["html_url"],
        "title": pr["title"],
        "draft": pr["draft"],
        "state": pr["state"],
        "updated_at": pr["updated_at"],
        "head_sha": pr["head"]["sha"],
        "head_branch": pr["head"]["ref"],
        "head_repository": (pr["head"].get("repo") or {}).get("full_name"),
        "base_branch": pr["base"]["ref"],
        "base_sha": pr["base"]["sha"],
        "labels": [x["name"] for x in pr.get("labels", [])],
    }


def tracked_files_at(revision: str):
    raw = subprocess.check_output(("git", "ls-tree", "-rz", "--full-tree", revision))
    files = {}
    for entry in raw.split(b"\0"):
        if not entry:
            continue
        left, path = entry.split(b"\t", 1)
        mode, kind, oid = left.split(b" ", 2)
        if kind != b"blob" or mode not in (b"100644", b"100755"):
            raise RuntimeError("NONREGULAR_PUBLIC_GIT_ENTRY:" + path.decode("utf-8", "replace"))
        name = path.decode("utf-8")
        if (
            Path(name).name in FORBIDDEN_BASENAME
            or Path(name).suffix.lower() in FORBIDDEN_SUFFIX
            or ".." in Path(name).parts
            or name.startswith("/")
        ):
            raise RuntimeError("POTENTIAL_PUBLIC_SOURCE_SECRET_PATH:" + name)
        files[name] = oid.decode("ascii")
    return files


def snap(revision: str, dest: Path) -> dict:
    if not SAFE_SHA.fullmatch(revision):
        raise RuntimeError("INVALID_SOURCE_SHA")
    dest.mkdir(parents=True, exist_ok=False)
    archive = subprocess.check_output(("git", "archive", "--format=tar", revision))
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as src:
        for member in src.getmembers():
            pp = Path(member.name)
            if pp.is_absolute() or ".." in pp.parts or member.issym() or member.islnk():
                raise RuntimeError("UNSAFE_GIT_ARCHIVE_ENTRY")
        src.extractall(dest, filter="data")
    expected = tracked_files_at(revision)
    observed = {}
    for file in dest.rglob("*"):
        if file.is_file():
            key = file.relative_to(dest).as_posix()
            data = file.read_bytes()
            observed[key] = hashlib.sha1(
                b"blob " + str(len(data)).encode("ascii") + b"\0" + data
            ).hexdigest()
    if expected != observed:
        raise RuntimeError(
            "SOURCE_GIT_BLOB_MISMATCH:"
            + json.dumps(
                {
                    "missing": sorted(set(expected) - set(observed))[:10],
                    "extra": sorted(set(observed) - set(expected))[:10],
                    "mismatched": [
                        x for x in expected.keys() & observed.keys()
                        if expected[x] != observed[x]
                    ][:10],
                }
            )
        )
    return {"commit_sha": revision, "files": len(observed), "git_blob_parity": True}


def main():
    if os.environ.get("GITHUB_REPOSITORY") != REPO:
        raise RuntimeError("WRONG_GITHUB_REPOSITORY")
    if (os.environ.get("GITHUB_HEAD_REF") or os.environ.get("GITHUB_REF_NAME")) != "handoff/whole-product-20261108-1223":
        raise RuntimeError("WRONG_ARCHIVE_BUILD_BRANCH")
    if cmd("git", "status", "--porcelain"):
        raise RuntimeError("UNEXPECTED_UNCOMMITTED_SOURCE")
    build_head = cmd("git", "rev-parse", "HEAD")
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    live_main = gh(f"repos/{REPO}/branches/main")["commit"]["sha"]
    if live_main != EXPECTED_MAIN:
        raise RuntimeError("CANONICAL_MAIN_ADVANCED_REVERIFY_BEFORE_PACKAGE")
    prs_raw = get_all_prs()
    prs = [capture_pr(x) for x in prs_raw]
    pmap = {p["number"]: p for p in prs}
    for number in REQUIRED_PRS:
        if number not in pmap or not pmap[number]["draft"]:
            raise RuntimeError("EXPECTED_ENGINEERING_DRAFT_NOT_OPEN:" + str(number))

    # This is a PUBLIC repo. Fetch its complete public branch and tag graph,
    # not just the PRs visible in the current chat.
    cmd(
        "git", "fetch", "--force", "--prune", "origin",
        "+refs/heads/*:refs/remotes/origin/*",
        "+refs/tags/*:refs/tags/*",
        capture=False,
    )
    if cmd("git", "rev-parse", "refs/remotes/origin/main") != live_main:
        raise RuntimeError("FETCHED_MAIN_MISMATCH")
    for p in prs:
        head = p["head_sha"]
        if not SAFE_SHA.fullmatch(head):
            raise RuntimeError("INVALID_PR_HEAD")
        test = subprocess.run(("git", "cat-file", "-e", head + "^{commit}"))
        if test.returncode != 0:
            cmd(
                "git", "fetch", "origin",
                f"+refs/pull/{p['number']}/head:refs/remotes/pull/{p['number']}",
                capture=False,
            )
            if subprocess.run(("git", "cat-file", "-e", head + "^{commit}")).returncode:
                raise RuntimeError("UNFETCHABLE_OPEN_PR_HEAD:" + str(p["number"]))

    root = Path(os.environ["RUNNER_TEMP"]) / "musitu-whole-product-20261108"
    root.mkdir(parents=True, exist_ok=False)
    hand = root / "HANDOFF"
    hist = root / "SOURCE_HISTORY"
    product = root / "PRODUCT"
    for directory in (hand, hist, product):
        directory.mkdir()
    refs = cmd(
        "git", "for-each-ref",
        "--format=%(refname:short)\t%(objectname)\t%(objecttype)",
        "refs/remotes", "refs/heads", "refs/tags",
    )
    write(hist / "PUBLIC_REFS.tsv", refs)
    bundle = hist / "public-github-all-refs.bundle"
    cmd("git", "bundle", "create", str(bundle), "--all", capture=False)
    verify = cmd("git", "bundle", "verify", str(bundle))
    heads = cmd("git", "bundle", "list-heads", str(bundle))
    if len(heads.splitlines()) < 50:
        raise RuntimeError("INCOMPLETE_GIT_REF_BUNDLE")
    write(
        hist / "VERIFY.txt",
        "PUBLIC-ONLY full-ref Git bundle. The source is canonical live GitHub.\n"
        + "bundle_file_sha256=" + sha(bundle) + "\n"
        + "bundled_ref_count=" + str(len(heads.splitlines())) + "\n"
        + "verification=" + verify + "\n",
    )
    write(hist / "LATEST_COMMITS.txt",
          cmd("git", "log", "--all", "--date=iso", "-n", "160",
              "--format=%H %aI %s"))
    jsonwrite(hand / "PUBLIC_OPEN_PULL_REQUESTS.json", prs)
    snapshots = {}
    for label, number in SOURCE_SNAPSHOTS:
        if number is not None and number not in pmap:
            continue
        commit = live_main if number is None else pmap[number]["head_sha"]
        snapshots[label] = snap(commit, product / label)
    if any("draft-" + str(n) not in key for n in () for key in snapshots):
        raise RuntimeError("IMPOSSIBLE_SNAPSHOT_STATE")
    if len(snapshots) < 6:
        raise RuntimeError("INSUFFICIENT_SOURCE_SNAPSHOTS")

    ci = {}
    for n in KEY_PRS:
        if n not in pmap:
            continue
        p = pmap[n]
        data = gh(
            f"repos/{REPO}/actions/runs?head_sha={p['head_sha']}&per_page=100"
        )
        entries = []
        for run in data.get("workflow_runs", []):
            if run.get("head_sha") != p["head_sha"]:
                continue
            entries.append({
                "id": run["id"], "name": run["name"],
                "status": run["status"], "conclusion": run.get("conclusion"),
                "url": run["html_url"], "event": run.get("event"),
                "created_at": run.get("created_at"),
            })
        ci[str(n)] = {
            "head_sha": p["head_sha"],
            "all_workflows_claimed_success": bool(entries) and all(
                x["status"] == "completed" and x["conclusion"] == "success"
                for x in entries
            ),
            "observed_head_workflows": entries,
        }
    jsonwrite(hand / "EXACT_HEAD_CI.json", ci)
    issues = {}
    for n in (74, 75):
        q = gh(f"repos/{REPO}/issues/{n}")
        issues[str(n)] = {
            "number": n, "title": q["title"], "state": q["state"],
            "updated_at": q["updated_at"], "url": q["html_url"],
            "labels": [x["name"] for x in q.get("labels", [])],
            "body": q.get("body"),
        }
    jsonwrite(hand / "PUBLIC_RELEASE_ISSUES.json", issues)
    final_main = gh(f"repos/{REPO}/branches/main")["commit"]["sha"]
    if final_main != live_main:
        raise RuntimeError("CANONICAL_MAIN_MOVED_DURING_ARCHIVE")
    for n in REQUIRED_PRS:
        final_pr = gh(f"repos/{REPO}/pulls/{n}")
        if final_pr["head"]["sha"] != pmap[n]["head_sha"] or final_pr["state"] != "open":
            raise RuntimeError("ENGINEERING_PR_MOVED_DURING_ARCHIVE:" + str(n))
    if 149 in pmap:
        final_last = gh(f"repos/{REPO}/pulls/149")
        if final_last["head"]["sha"] != pmap[149]["head_sha"]:
            raise RuntimeError("LATEST_PR_MOVED_DURING_ARCHIVE")

    state = {
        "schema": "musitu_axiom.whole_product_handoff.2026_11_08",
        "created_utc": started,
        "completed_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "public_canonical_repository": REPO,
        "main_sha": live_main,
        "archive_build_branch": os.environ["GITHUB_REF_NAME"],
        "archive_build_head": build_head,
        "public_open_pr_count": len(prs),
        "snapshots": snapshots,
        "key_pull_requests": {str(n): pmap[n] for n in KEY_PRS if n in pmap},
        "key_workflow_checks": ci,
        "public_git_bundle_sha256": sha(bundle),
        "public_git_ref_count": len(heads.splitlines()),
        "public_release_issues": {
            n: {"state": v["state"], "title": v["title"], "url": v["url"]}
            for n, v in issues.items()
        },
        "neon_staging": {
            "last_user_connector_readback": "2026-11-08",
            "database": "PostgreSQL 17",
            "public_connections_blocked_last_verified": True,
            "only_listed_role_last_verified": "neondb_owner",
            "requires_fresh_live_verification": True,
        },
        "private_gitlab_history": "NOT_IN_THIS_PUBLIC_ARCHIVE; check private archive independently",
        "production_release": "NO-GO",
        "profit_guarantee": "NONE",
        "real_paid_vendor_approval": False,
        "private_network_exception_approved": False,
    }
    jsonwrite(hand / "CONTINUATION_STATE.json", state)

    critical = "\n".join(
        f"- PR #{n}: {pmap[n]['title']}, HEAD {pmap[n]['head_sha']}, "
        f"base {pmap[n]['base_branch']}, draft {pmap[n]['draft']}, "
        f"CI {ci.get(str(n), {}).get('all_workflows_claimed_success', 'not captured')}"
        for n in KEY_PRS if n in pmap
    )
    names = ", ".join(sorted(snapshots))
    write(
        hand / "README_FIRST.md",
        "# MUSITU AXIOM — COMPLETE PUBLIC SOURCE / CURRENT LIVE CHAT SHIFT\n\n"
        + "Captured 2026-11-08. Read this BEFORE touching any source or service.\n\n"
        + "1. Read HANDOFF/CONTINUATION_STATE.md and HANDOFF/CONTINUATION_STATE.json.\n"
        + "2. Read HANDOFF/VERIFICATION_MATRIX.md, HANDOFF/SOURCE_MANIFEST.md, "
          "HANDOFF/CONTINUATION_TIMELINE.md and HANDOFF/NEW_CHAT_COMMAND.txt.\n"
        + "3. Run python HANDOFF/VERIFY_PACKAGE.py from extracted ZIP; "
          "review HANDOFF/SHA256SUMS.txt and SOURCE_HISTORY/VERIFY.txt.\n"
        + "4. Restore SOURCE_HISTORY/public-github-all-refs.bundle (PUBLIC history only) "
          "and check all PRODUCT snapshots against GitHub live refs.\n"
        + "5. Review HANDOFF/PUBLIC_OPEN_PULL_REQUESTS.json, "
          "HANDOFF/EXACT_HEAD_CI.json and HANDOFF/PUBLIC_RELEASE_ISSUES.json.\n\n"
        + "All public tracked Git branch/tag history is included in the bundle. "
          "Full immutable selected source snapshots: " + names + ". "
        + "The live GitHub repository remains authoritative after packaging.\n\n"
        + "**PRIVACY:** Private GitLab Git objects, private archive, provider credentials, "
          "billing receipts and customer data are deliberately NOT included. "
        + "Never republish private history in public GitHub or this package.\n\n"
        + "**PRODUCTION NO-GO:** No release, Neon access alteration, paid vendor call, "
          "production merge, credential grant or destructive DB operation was authorized by this export.\n"
    )
    write(
        hand / "CONTINUATION_STATE.md",
        "# MUSITU AXIOM — precise live engineering handoff (2026-11-08)\n\n"
        + "## Authority and scope\n"
        + f"- Canonical PUBLIC GitHub: https://github.com/{REPO}, verified main {live_main}.\n"
        + f"- This read-only archive job: {build_head} on handoff branch; not merged.\n"
        + f"- {len(prs)} open PUBLIC PRs at inventory; read all heads/bases in "
          "PUBLIC_OPEN_PULL_REQUESTS.json. Existing stacked drafts remain unmerged.\n"
        + "- Private original GitLab and a separately private GitHub mirror preserve "
          "the restricted Git history; do NOT publish either here. Private GitLab "
          "issue/MR metadata and external records require separate private custody review.\n"
        + "- Do not assume historical chat answers or source checkout replace a fresh live read.\n\n"
        + "## Current priority drafts and evidence\n"
        + critical + "\n\n"
        + "## Engineering status\n"
        + "- Phase 2.10A: tenant PostgreSQL budget and provider metering draft #76.\n"
        + "- Phase 2.10B: shared vendor-organization caps and concurrency, stacked draft #81.\n"
        + "- Phase 2.10C: draft #104 protected reserve/settle SECURITY DEFINER SQL, "
          "explicit non-login definer migration, SQL-RPC-only trusted ledger and "
          "productionBillingRequired service admission. Offline PostgreSQL CI "
          "does NOT prove cross-worker deployment or bills.\n"
        + "- Cloudflare Hyperdrive staging draft #99: offline-only, closed HTTP "
          "probe with role/owner/public ACL checks, privileged DML and SELECT "
          "denial. Live origin TLS, caching, runtime grants and networking not proven.\n"
        + "- Draft #87: independent six-gate release and privacy archival evidence contract.\n"
        + "- PR #77 and descendants through the latest open PRs: Cloudflare "
          "D1/OAuth/DR isolated and staging evidence; distinguish actual "
          "operator actions from synthetic-only tests, and read all PR metadata first.\n"
        + "- Multiple branches are stacked: never squash, force-push or blanket-merge.\n\n"
        + "## External approval and production hold\n"
        + "- Neon PostgreSQL 17 last user-connector read: public connections blocked; "
          "only neondb_owner listed. No approved restricted runtime SQL role or "
          "network exception has been proved. Recheck live before any action.\n"
        + "- Cloudflare infrastructure is Workers-only. Do NOT open Neon to "
          "shared egress networks, grant roles, install production schema, "
          "deploy billable AI, or create customer credentials without "
          "separate genuine operator authorization and verification.\n"
        + "- Release issue #74 and private-record issue #75 must be read live. "
          "Production remains NO-GO until six independent evidence gates and "
          "appropriate operator/security/finance approvals are real.\n"
        + "- No quant model or trading signal can promise guaranteed profit.\n"
        + "- Proceed autonomously on safe tests, docs, threat models, PR branches, "
          "static reviews and non-destructive CI; do not claim unsupported evidence.\n"
    )
    write(
        hand / "VERIFICATION_MATRIX.md",
        "# Independent verification matrix — snapshot vs live external proof\n\n"
        + "| Claim | Packaged evidence | External/live status |\n"
        + "|---|---|---|\n"
        + f"| Public Git refs/tree source | {len(heads.splitlines())} bundle heads; "
          f"{len(snapshots)} Git blob-validated source trees | "
          "PASS for captured public source; live GitHub can advance |\n"
        + "| Exact head CI | HANDOFF/EXACT_HEAD_CI.json with observed run IDs | "
          "Historical checks only; recheck new head |\n"
        + "| Production-wide budget enforcement | draft #104 SQL, role handoff, "
          "service mode and disposable PostgreSQL tests | **BLOCKED** real deploy and topology |\n"
        + "| Live staging network/TLS/Hyperdrive | draft #99 offline query/ACL checks | "
          "**BLOCKED** Neon network, role, origin and cache proofs |\n"
        + "| Vendor invoices vs internal spending | no private receipts in archive | "
          "**BLOCKED** finance/provider consent |\n"
        + "| Approved live evidence access | public research-only source and drafts | "
          "**BLOCKED** scope/rights/credentialed evidence |\n"
        + "| Independent penetration tests | public source security gates | "
          "**BLOCKED** assessor report and retest |\n"
        + "| IdP/KMS/DR/incident readiness | code and public PR evidence, no secret data | "
          "**BLOCKED** external operational sign-offs |\n"
        + "| Private GitLab history | private mirror claimed separately, not copied | "
          "**BLOCKED** private metadata/privacy approval |\n"
        + "| Trading signal guaranteed profit | no valid guarantee exists | "
          "**NOT CLAIMED** |\n"
    )
    write(
        hand / "SOURCE_MANIFEST.md",
        "# Source manifest and restoration\n\n"
        + f"- PUBLIC GitHub repository: https://github.com/{REPO}.\n"
        + f"- Canonical main SHA at package freeze: {live_main}.\n"
        + "- Git bundle: SOURCE_HISTORY/public-github-all-refs.bundle; SHA-256 and "
          "ref count in SOURCE_HISTORY/VERIFY.txt. Includes all fetched public branch/tag "
          "refs (and fetched open PR heads). This is actual Git history, not synthetic commits.\n"
        + "- Ref inventory: SOURCE_HISTORY/PUBLIC_REFS.tsv.\n"
        + "- Latest public commits: SOURCE_HISTORY/LATEST_COMMITS.txt.\n"
        + "- Full source trees, byte-for-byte cross-checked against Git blob IDs:\n"
        + "\n".join(
            f"  - PRODUCT/{label}/ : {v['commit_sha']} ({v['files']} tracked files)"
            for label, v in snapshots.items()
        )
        + "\n\n"
        + "On an isolated computer, extract the ZIP and run: "
          "python HANDOFF/VERIFY_PACKAGE.py. Restore Git history with "
          "git clone SOURCE_HISTORY/public-github-all-refs.bundle public-restored. "
          "Use the recorded branch or SHA with git checkout; don't infer names from old chats.\n"
        + "Important: private GitLab-only history is NOT part of this public bundle. "
          "Current private archive must be accessed via its separately authorized account.\n"
    )
    write(
        hand / "CONTINUATION_TIMELINE.md",
        "# Continuation timeline and safe provenance\n\n"
        + "- 2026-11-06 to 2026-11-07: prior public whole-product source "
          "bundle captured; private GitLab historical objects independently mirrored "
          "to separate private archive, excluded from this public ZIP.\n"
        + "- 2026-11-07: release freeze at canonical public main "
          + EXPECTED_MAIN + " and draft #76/#81/#87/#99, no production release.\n"
        + "- 2026-11-08: draft #104 protected PostgreSQL SQL functions, "
          "nonlogin owner handoff, synthetic paid-provider protected-only admission; "
          "draft #99 offline privilege and function-ownership admission gates.\n"
        + "- 2026-11-08: numerous public drafts for D1/OAuth/Cloudflare DR and "
          "synthetic staging evidence through latest captured PRs. "
          "Full inventory and actual Git history included; do not conflate "
          "synthetic tests with genuine deployment evidence.\n"
        + f"- {started}: read-only archival checkout and exact snapshot/PR/CI audit. "
          "Live refs can advance immediately after export.\n"
    )
    next_command = (
        "Continue MUSITU AXIOM from my connected Google Drive file "
        "MUSITU_AXIOM_WHOLE_PRODUCT_CONTINUATION_20261108.zip. "
        "Before making any change, open the ZIP and read in order: "
        "HANDOFF/README_FIRST.md, HANDOFF/CONTINUATION_STATE.md, "
        "HANDOFF/CONTINUATION_STATE.json, HANDOFF/VERIFICATION_MATRIX.md, "
        "HANDOFF/SOURCE_MANIFEST.md, HANDOFF/CONTINUATION_TIMELINE.md, "
        "HANDOFF/NEW_CHAT_COMMAND.txt, HANDOFF/PUBLIC_OPEN_PULL_REQUESTS.json, "
        "HANDOFF/EXACT_HEAD_CI.json and HANDOFF/PUBLIC_RELEASE_ISSUES.json. "
        "Run HANDOFF/VERIFY_PACKAGE.py, verify SHA256SUMS.txt, validate "
        "SOURCE_HISTORY/public-github-all-refs.bundle, and inspect ALL "
        "captured PRODUCT source snapshots; the full PUBLIC Git history of "
        "all refs is in the bundle. Treat public GitHub "
        + REPO + " as canonical and the recorded main commit "
        + live_main + " only as a frozen reference; check LIVE main and "
        "ALL currently open PRs/heads/bases/CI before acting, including "
        "stacked #76 #81 #87 #99 #104 and the D1/OAuth/DR draft chain "
        "through #149 and any newer successors. Keep private GitLab history "
        "and its separate private GitHub archive private and out of the public "
        "repository/package. You have my standing approval to continue safe "
        "source review, design, test-first implementation, CI, documentation "
        "and draft PRs autonomously, preserving branch ancestry and never "
        "squashing or force-pushing. Do not merge or deploy before unmet "
        "external authorizations. Neon staging PostgreSQL 17 has last-confirmed "
        "block_public_connections=true with only owner role; Cloudflare is "
        "Workers-only. Re-verify those live; do NOT weaken networking, "
        "create privileged credentials or roles, run real provider charges, "
        "expose customer data, or change production without the required "
        "independent security/operator/cost approval. Keep issue #74 "
        "production release NO-GO and issue #75 private-record custody OPEN "
        "until genuine independent gates and evidence justify closure. "
        "Continue current protected PostgreSQL function-owner/ACL and "
        "productionBillingRequired security work, Hyperdrive staging "
        "preflight, and D1/OAuth DR controls; do not claim guaranteed "
        "trading profit or fabricate verification. Report source and "
        "CI evidence with exact SHAs, and avoid routine confirmation pauses."
    )
    write(hand / "NEW_CHAT_COMMAND.txt", next_command)
    write(
        hand / "ARCHIVE_BUILD_LOG.txt",
        f"captured_utc={started}\n"
        f"public_main={live_main}\n"
        f"archive_build_branch={os.environ['GITHUB_REF_NAME']}\n"
        f"archive_build_head={build_head}\n"
        f"public_open_prs={len(prs)}\n"
        f"full_git_bundle_bytes={bundle.stat().st_size}\n"
        f"git_ref_count={len(heads.splitlines())}\n"
        f"selected_snapshot_count={len(snapshots)}\n"
        "provenance=GitHub API public PR and CI + Git tree/Git bundle\n"
        "private_history_included=false\n"
        "real_network_access=false\n"
        "production_release=NO_GO\n"
    )
    verifier = """#!/usr/bin/env python3
from pathlib import Path
import hashlib, sys
root=Path(__file__).resolve().parent.parent
lines=(root/'HANDOFF'/'SHA256SUMS.txt').read_text().splitlines()
bad=[]
for row in lines:
    digest, name=row.split('  ',1)
    if not name.startswith('./') or '..' in Path(name).parts:
        bad.append((name,'unsafe name')); continue
    path=root/name[2:]
    if not path.is_file():
        bad.append((name,'missing')); continue
    h=hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda:file.read(1024*1024),b''):
            h.update(chunk)
    if digest != h.hexdigest():
        bad.append((name,'SHA-256 mismatch'))
actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
listed={row.split('  ',1)[1].removeprefix('./') for row in lines}
expected=listed|{'HANDOFF/SHA256SUMS.txt'}
if actual!=expected:
    bad.append(('inventory', f'extra={sorted(actual-expected)[:10]} missing={sorted(expected-actual)[:10]}'))
print('MUSITU_HANDOFF_SHA256_CHECK', 'PASS' if not bad else 'FAIL',
      'files='+str(len(lines)), 'errors='+str(len(bad)))
for issue in bad[:15]: print(issue)
sys.exit(1 if bad else 0)
"""
    write(hand / "VERIFY_PACKAGE.py", verifier)
    checks = []
    for file in sorted(root.rglob("*")):
        if file.is_file() and file.name != "SHA256SUMS.txt":
            checks.append(f"{sha(file)}  ./{file.relative_to(root).as_posix()}")
    write(hand / "SHA256SUMS.txt", "\n".join(checks))
    cmd(sys.executable, str(hand / "VERIFY_PACKAGE.py"), capture=False)
    print(
        "PUBLIC_WHOLE_PRODUCT_HANDOFF_READY",
        json.dumps(
            {
                "public_refs": len(heads.splitlines()),
                "public_open_prs": len(prs),
                "complete_source_snapshots": len(snapshots),
                "sha256_verified_files": len(checks),
                "git_bundle_bytes": bundle.stat().st_size,
                "main_sha": live_main,
                "archive_build_head": build_head,
            },
            sort_keys=True,
        ),
    )


if __name__ == "__main__":
    main()
