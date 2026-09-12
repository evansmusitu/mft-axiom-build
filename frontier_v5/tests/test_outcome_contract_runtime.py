#!/usr/bin/env python3
"""Phase-3 contract for Work + Outcome Contracts and durable recovery."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile

from frontier_v5.runtime.outcome_contracts import OutcomeContractConflict, OutcomeContractNotFound, OutcomeContractRuntime


class Clock:
    def __init__(self): self.value=datetime(2026,9,12,18,0,0,tzinfo=timezone.utc)
    def __call__(self): return self.value
    def advance(self, **kwargs): self.value += timedelta(**kwargs)


def expect_error(fn, exc=Exception):
    try: fn()
    except exc: return
    raise AssertionError(f"expected {exc.__name__}")


def main():
    clock=Clock()
    with tempfile.TemporaryDirectory() as td:
        db=Path(td)/"outcomes.db"
        r=OutcomeContractRuntime(db, now=clock)
        made=r.create_contract("tenant-a","contract-001","Publish evidence pack","Produce a review-safe evidence pack",["All required files exist","All hashes verify"],{"privacy":"Project"})
        cid=made["contract_id"]
        assert made["created"] is True
        duplicate=r.create_contract("tenant-a","contract-001","Publish evidence pack","Produce a review-safe evidence pack",["All required files exist","All hashes verify"],{"privacy":"Project"})
        assert duplicate=={"contract_id":cid,"created":False}
        expect_error(lambda:r.create_contract("tenant-a","contract-001","Changed","Different",["x"],{}),OutcomeContractConflict)
        expect_error(lambda:r.get("tenant-b",cid),OutcomeContractNotFound)
        assert r.get("tenant-a",cid)["status"]=="AWAITING_APPROVAL"
        assert [x["contract_id"] for x in r.approval_queue("tenant-a")]==[cid]
        expect_error(lambda:r.approve("tenant-a",cid,"operator",99),OutcomeContractConflict)

        approval=r.approve("tenant-a",cid,"operator",0,"explicit user approval")
        task_id=approval["task_id"]
        claim=r.claim_background("tenant-a","worker-1",lease_seconds=30)
        assert claim and claim.task_id==task_id and claim.attempt==1
        first=r.advance_claim(claim,"worker-1")
        assert first["step"]=="PREPARED"
        snap=r.snapshot("tenant-a",cid)
        assert {n["node_id"]:n["status"] for n in snap["plan"]["nodes"]}["prepare"]=="COMPLETED"
        assert len(snap["checkpoints"])==1
        assert r.verify_history("tenant-a",cid) is True
        r.close()

        # Accelerated five-hour elapsed-time restart proof. This proves durable
        # restart/reclaim semantics; it is NOT a literal five-hour wall-clock soak.
        clock.advance(hours=5)
        r=OutcomeContractRuntime(db, now=clock)
        recovered=r.claim_background("tenant-a","worker-2",lease_seconds=30)
        assert recovered and recovered.task_id==task_id and recovered.attempt==2
        assert len(r.snapshot("tenant-a",cid)["checkpoints"])==1
        second=r.advance_claim(recovered,"worker-2")
        assert second["status"]=="AWAITING_ACCEPTANCE" and second["step"]=="EXECUTION_COMPLETE"
        snap=r.snapshot("tenant-a",cid)
        assert snap["task"]["status"]=="SUCCEEDED"
        assert [x["step"] for x in snap["checkpoints"]]==["PREPARED","EXECUTION_COMPLETE"]
        assert r.verify_history("tenant-a",cid) is True

        failed=r.record_acceptance("tenant-a",cid,"reviewer",[True,False],{"evidence":"first-pass"})
        assert failed["status"]=="ACCEPTANCE_FAILED"
        assert r.snapshot("tenant-a",cid)["plan"]["status"]=="ACTIVE"
        passed=r.record_acceptance("tenant-a",cid,"reviewer",[True,True],{"evidence":"verified"})
        assert passed["status"]=="SUCCEEDED"
        final=r.snapshot("tenant-a",cid)
        assert final["plan"]["status"]=="SUCCEEDED"
        assert len(final["acceptance_attempts"])==2
        assert r.verify_history("tenant-a",cid) is True

        # Retry recovery does not replay the completed prepare checkpoint.
        c2=r.create_contract("tenant-a","contract-002","Recover task","Prove retry recovery",["Recovered"],{})["contract_id"]
        r.approve("tenant-a",c2,"operator",0)
        c2claim=r.claim_background("tenant-a","worker-a",lease_seconds=30)
        assert c2claim
        r.advance_claim(c2claim,"worker-a")
        clock.advance(seconds=31)
        c2claim2=r.claim_background("tenant-a","worker-b",lease_seconds=30)
        assert c2claim2 and c2claim2.attempt==2
        assert r.fail_claim(c2claim2,"worker-b",{"code":"TEMP"},backoff_seconds=5)=="RETRY"
        clock.advance(seconds=5)
        c2claim3=r.claim_background("tenant-a","worker-c",lease_seconds=30)
        assert c2claim3 and c2claim3.attempt==3
        r.advance_claim(c2claim3,"worker-c")
        assert [x["step"] for x in r.snapshot("tenant-a",c2)["checkpoints"]]==["PREPARED","EXECUTION_COMPLETE"]

        c3=r.create_contract("tenant-a","contract-003","Reject me","Do not execute",["Never started"],{})["contract_id"]
        assert r.reject("tenant-a",c3,"operator",0,"not authorized")=="REJECTED"
        assert r.get("tenant-a",c3)["task_id"] is None

        assert r.verify_history("tenant-a",cid) is True
        r.db.execute("UPDATE outcome_events SET payload_json='{}' WHERE contract_id=? AND sequence=0",(cid,));r.db.commit()
        assert r.verify_history("tenant-a",cid) is False
        r.close()
    print("MUSITU_AXIOM_INTERFACE_PHASE3_OUTCOME_RUNTIME_PASS")

if __name__=="__main__": main()
