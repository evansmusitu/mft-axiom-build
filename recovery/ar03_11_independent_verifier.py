#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, subprocess, sys

ROOT=pathlib.Path(__file__).resolve().parents[2]
SEALED_MAIN="d6a846f6bbe0bccac1758713eb4de167caf07113"
RUNTIME="216ee7d15f01a3fb558452cc4b906a055001ccdd"

def need(c,m):
    if not c: raise RuntimeError(m)

def git(*a):
    p=subprocess.run(["git",*a],cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False)
    if p.returncode: raise RuntimeError(f"git {' '.join(a)} failed: {p.stderr}")
    return p.stdout.strip()

def load(path): return json.loads((ROOT/path).read_text(encoding="utf-8"))

def main():
    try:
        need(subprocess.run(["git","cat-file","-e",f"{SEALED_MAIN}^{{commit}}"],cwd=ROOT).returncode==0,"sealed main missing")
        need(subprocess.run(["git","cat-file","-e",f"{RUNTIME}^{{commit}}"],cwd=ROOT).returncode==0,"runtime authority missing")

        program=load(pathlib.Path("docs/axiom_recovery/AR03_AR11_PROGRAM_CONTRACT.json"))
        need([x["stage"] for x in program["stage_sequence"]]==[f"AR-{i:02d}" for i in range(3,12)],"stage sequence drift")
        need(program["authorization"]["inherited_gate_bypass_allowed"] is False,"inherited gate bypass allowed")
        need(program["authorization"]["production_promotion_authority_granted"] is False,"production authority granted")

        status=load(pathlib.Path("docs/axiom_recovery/AR03_AR05_IMPLEMENTATION_STATUS.json"))
        need(status["claim_boundary"]["ar03_earned"] is False,"AR-03 overstated")
        need(status["claim_boundary"]["ar04_earned"] is False,"AR-04 overstated")
        need(status["claim_boundary"]["ar05_earned"] is False,"AR-05 overstated")
        need(status["claim_boundary"]["production_mutated"] is False,"production mutation overstated")

        ar06=load(pathlib.Path("docs/axiom_recovery/AR06_TOOL_FABRIC_SOURCE_AUDIT.json"))
        need(ar06["atomic_registry"]["count"]==74,"74-operation registry drift")
        need(len(ar06["ordered_lanes"])==10,"AR-06 lane cardinality drift")
        need(all(x["live_unified_orchestrator_execution"]=="NOT_PROVEN" for x in ar06["ordered_lanes"]),"AR-06 live claim overstated")
        need(ar06["state"]["gate"]=="NOT_EARNED","AR-06 gate overstated")

        ar07=load(pathlib.Path("docs/axiom_recovery/AR07_UNIFIED_APPLICATION_AUDIT.json"))
        need(ar07["state"]["five_user_gate"]=="NOT_PERFORMED","AR-07 user gate overstated")
        need(ar07["state"]["gate"]=="NOT_EARNED","AR-07 gate overstated")

        ar10=load(pathlib.Path("docs/axiom_recovery/AR10_SEALED_BENCHMARK_CONTRACT.json"))
        need(ar10["task_sealing"]["external_unseen_task_package_created"] is False,"unseen benchmark fabricated")
        need(ar10["superiority_claim_gate"]["external_superiority_authorized_now"] is False,"superiority prematurely authorized")
        need(ar10["claim_boundary"]["superiority"]=="NOT_CERTIFIED","superiority claim drift")

        from recovery.ar06.unified_fabric import UnifiedToolFabric,CapabilityPolicyError
        f=UnifiedToolFabric()
        try:
            f.bind("quantitative","fake-prod",lambda c,a,x:{"ok":True},production_proven=True)
            raise RuntimeError("fabric accepted builder self-certification")
        except CapabilityPolicyError:
            pass
        need(f.gate_state["ar06_gate_earned"] is False,"AR-06 local gate can self-promote")

        from recovery.ar08.adversarial_suite import run_suite
        adv=run_suite()
        need(adv["open_critical_high_in_scope"]==0,"AR-08 local critical/high remains open")
        need(adv["full_application_ar08_gate_earned"] is False,"AR-08 full gate overstated")

        from recovery.ar09.local_reliability import run_local_matrix
        rel=run_local_matrix(20)
        need(rel["local_measured_targets_pass"] is True,"AR-09 local measured targets failed")
        need(rel["ar09_gate_earned"] is False,"AR-09 full gate overstated")

        from recovery.ar11.rollout_controller import RolloutController,RolloutError
        try:
            RolloutController("a"*40,inherited_gates_pass=False).admit_staging({"candidate_head":"a"*40,"status":"PASS"})
            raise RuntimeError("AR-11 bypassed inherited gates")
        except RolloutError:
            pass

        forbidden=("CLOUDFLARE_GLOBAL_API_KEY","api.cloudflare.com","wrangler deploy")
        for base in ("recovery/ar03","recovery/ar04","recovery/ar05","recovery/ar06","recovery/ar08","recovery/ar09","recovery/ar11"):
            for p in (ROOT/base).rglob("*.py"):
                text=p.read_text(encoding="utf-8")
                for marker in forbidden:
                    need(marker not in text,f"forbidden provider surface {marker} in {p.relative_to(ROOT)}")

        print(json.dumps({
            "status":"PASS_INTERNAL_INDEPENDENT_RECOVERY_VERIFIER",
            "scope":"AR03_AR11_FOUNDATIONS_ONLY",
            "sealed_main":SEALED_MAIN,
            "runtime_source":RUNTIME,
            "ar02_inherited_gate":"OPEN",
            "production_mutated":False,
            "full_product_connection":"NOT_PROVEN",
            "superiority":"NOT_CERTIFIED"
        },sort_keys=True))
        return 0
    except Exception as exc:
        print(f"AR-03..AR-11 INDEPENDENT VERIFIER: FAIL: {exc}",file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())
