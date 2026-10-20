"""LIFELINE Windows-native MT5 executor. Developer/research operations only, no trades.

This intentionally does NOT expose a network server. Pairing requires a separate outbound
poll client and a live Cloudflare queue with tenant authentication. A remote MQL5 file can
execute arbitrary native logic: only trusted, reviewed code in an isolated Windows VM.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
from contextlib import closing
import subprocess
import sys
import time
import uuid
from datetime import date
from typing import Any

OPS = frozenset({"probe", "compile", "backtest"})
PERIODS = frozenset({"M1","M5","M15","M30","H1","H4","D1","W1","MN1"})
SYMBOL = re.compile(r"^[A-Za-z0-9_.-]{1,30}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
MAX_CLOCK_SKEW_SECONDS = 120
MAX_COMPILE_SECONDS = 90
MAX_TEST_SECONDS = 120


class AgentError(Exception):
    pass


def canonical(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sign(payload: dict[str, Any], key: bytes) -> str:
    return hmac.new(key, canonical(payload), hashlib.sha256).hexdigest()


def verify_job(job: dict[str, Any], key: bytes, now: int | None = None) -> dict[str, Any]:
    if not isinstance(job, dict) or len(canonical(job)) > 16384:
        raise AgentError("malformed job or oversized payload")
    if len(key) < 32:
        raise AgentError("missing authenticated pairing key")
    sig = job.get("signature")
    if not isinstance(sig, str) or not SHA256.fullmatch(sig):
        raise AgentError("missing signature")
    payload = {k: v for k,v in job.items() if k != "signature"}
    if not hmac.compare_digest(sign(payload, key), sig):
        raise AgentError("job signature mismatch")
    try:
        uid = str(uuid.UUID(payload["job_id"]))
        issued = payload["issued_at"]
        nonce = payload["nonce"]
        op = payload["operation"]
    except (KeyError, ValueError, TypeError):
        raise AgentError("invalid required job fields")
    if uid != payload["job_id"] or type(issued) is not int:
        raise AgentError("invalid job id/timestamp")
    if abs((int(time.time()) if now is None else now) - issued) > MAX_CLOCK_SKEW_SECONDS:
        raise AgentError("expired job")
    if not isinstance(nonce, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", nonce):
        raise AgentError("invalid nonce")
    if not isinstance(op, str) or op not in OPS:
        raise AgentError("operation forbidden")
    if "args" not in payload or not isinstance(payload["args"], dict):
        raise AgentError("args missing")
    if set(payload)-{"job_id","issued_at","nonce","operation","args","tenant"}:
        raise AgentError("unexpected job fields")
    if not isinstance(payload.get("tenant"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}",payload["tenant"]):
        raise AgentError("tenant identity missing")
    return payload


def safe_relative(root: Path, relative: str, suffix: str) -> Path:
    if not isinstance(relative, str) or len(relative) > 160 or relative.startswith(("/", "\\\\")):
        raise AgentError("invalid source path")
    if any(part in ("..", ".", "") for part in relative.replace("\\\\", "/").split("/")):
        raise AgentError("path traversal")
    path = (root / relative).resolve(strict=True)
    try: path.relative_to(root.resolve(strict=True))
    except ValueError: raise AgentError("file outside sandbox")
    if path.suffix.lower() != suffix or not path.is_file():
        raise AgentError("wrong source type")
    return path


def run_checked(executable: str, argv: list[str], timeout: int) -> dict[str, Any]:
    path = Path(executable).resolve(strict=True)
    if path.suffix.lower() != ".exe" or not path.is_file():
        raise AgentError("native tool unavailable")
    try:
        proc = subprocess.run([str(path)] + argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=timeout, check=False, creationflags=0,
                              cwd=str(path.parent))
        return {"exit_code": proc.returncode, "elapsed": "completed"}
    except subprocess.TimeoutExpired:
        raise AgentError("native process timed out")


def sha_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def compile_mql5(root: Path, args: dict[str, Any], editor: str) -> dict[str, Any]:
    if set(args) != {"relative_source","source_sha256"}:
        raise AgentError("compile input not allowlisted")
    path = safe_relative(root, args["relative_source"], ".mq5")
    if not isinstance(args["source_sha256"], str) or sha_file(path) != args["source_sha256"]:
        raise AgentError("source hash mismatch")
    exe = Path(editor).resolve(strict=True)
    if exe.name.lower() not in {"metaeditor64.exe","metaeditor.exe"}:
        raise AgentError("only official MetaEditor process permitted")
    log=path.with_suffix(".log")
    result=path.with_suffix(".ex5")
    if log.exists(): log.unlink()
    if result.exists(): result.unlink()
    proc = run_checked(str(exe), ["/compile:"+str(path), "/log"], MAX_COMPILE_SECONDS)
    text = log.read_text(errors="replace") if log.is_file() else ""
    success = result.is_file() and result.stat().st_size > 100 and bool(re.search(r"\b0\s+errors?\b", text, re.I))
    return {"verified": bool(success), "compiler_exit": proc["exit_code"],
            "source_sha256": sha_file(path), "compile_log_sha256":sha_file(log) if log.is_file() else None,
            "ex5_sha256": sha_file(result) if success else None, "warnings":bool(re.search(r"\b[1-9]\d*\s+warnings?\b",text,re.I))}


def backtest(root: Path, args: dict[str, Any], terminal: str) -> dict[str, Any]:
    if set(args)!={"relative_expert","expert_sha256","symbol","period","from_date","to_date"}:
        raise AgentError("tester args not allowlisted")
    file=safe_relative(root,args["relative_expert"],".ex5")
    if sha_file(file)!=args["expert_sha256"]:
        raise AgentError("expert hash mismatch")
    if not isinstance(args["symbol"],str) or not SYMBOL.fullmatch(args["symbol"]) or args["period"] not in PERIODS:
        raise AgentError("invalid tester symbol or timeframe")
    try:
        start=date.fromisoformat(args["from_date"]); end=date.fromisoformat(args["to_date"])
    except (TypeError,ValueError):
        raise AgentError("invalid date")
    if end<=start or (end-start).days>365:
        raise AgentError("tester date window too broad")
    exe=Path(terminal).resolve(strict=True)
    if exe.name.lower()!="terminal64.exe": raise AgentError("only MetaTrader 5 terminal allowed")
    # Safe generated parameters; NO login, no MQL5 cloud compute, no execution of arbitrary script.
    report="lifeline-"+uuid.uuid4().hex
    cfg=root/(report+".ini")
    cfg.write_text(
        "[Tester]\nExpert="+file.stem+"\nSymbol="+args["symbol"]+"\nPeriod="+args["period"]+
        "\nFromDate="+start.strftime("%Y.%m.%d")+"\nToDate="+end.strftime("%Y.%m.%d")+
        "\nModel=1\nUseCloud=0\nOptimization=0\nVisual=0\nReport="+report+
        "\nReplaceReport=1\nShutdownTerminal=1\n",encoding="ascii")
    try: proc=run_checked(str(exe), ["/config:"+str(cfg)],MAX_TEST_SECONDS)
    finally: cfg.unlink(missing_ok=True)
    candidates=[root/(report+extension) for extension in (".html",".htm",".xml")]
    report_file=next((p for p in candidates if p.is_file() and p.stat().st_size>500),None)
    return {"verified":bool(report_file), "terminal_exit":proc["exit_code"],
            "report_sha256":sha_file(report_file) if report_file else None,
            "status":"REPORT_PRESENT_NOT_PERFORMANCE_CERTIFIED" if report_file else "NO_VERIFIED_REPORT_OR_MARKET_DATA"}


def execute(job:dict[str,Any], key:bytes, root:Path, editor:str|None, terminal:str|None, now:int|None=None)->dict[str,Any]:
    payload=verify_job(job,key,now=now)
    operation=payload["operation"]
    try:
        if operation=="probe":
            result={"windows":sys.platform=="win32","metaeditor_available":bool(editor and Path(editor).is_file()),
                    "terminal_available":bool(terminal and Path(terminal).is_file()),"live_trading":False}
        elif operation=="compile":
            if sys.platform!="win32" or not editor: raise AgentError("Windows MetaEditor not paired")
            result=compile_mql5(root,payload["args"],editor)
        else:
            if sys.platform!="win32" or not terminal: raise AgentError("Windows terminal not paired")
            result=backtest(root,payload["args"],terminal)
        outcome="completed"
    except (AgentError, OSError, KeyError) as exc:
        outcome="rejected";result={"error":str(exc)}
    receipt={"schema":"lifeline.agent.receipt.v1","job_id":payload["job_id"],"tenant":payload["tenant"],
             "operation":operation,"outcome":outcome,"result":result,"created_at":int(time.time()),"trading_enabled":False}
    receipt["signature"]=sign(receipt,key)
    return receipt

def execute_once(job: dict[str,Any], key: bytes, root: Path, editor: str | None,
                 terminal: str | None, database: Path, now: int | None = None) -> dict[str,Any]:
    """At-most-once local dispatch; unknown claims are never automatically retried."""
    payload = verify_job(job,key,now=now)
    database.parent.mkdir(parents=True,exist_ok=True)
    with closing(sqlite3.connect(database,timeout=15)) as db:
        db.execute("CREATE TABLE IF NOT EXISTS jobs (job_id TEXT PRIMARY KEY, nonce TEXT NOT NULL UNIQUE, state TEXT NOT NULL, receipt TEXT)")
        try:
            db.execute("INSERT INTO jobs (job_id,nonce,state,receipt) VALUES (?,?,'CLAIMED',NULL)",
                       (payload["job_id"],payload["nonce"]))
            db.commit()
        except sqlite3.IntegrityError:
            existing=db.execute("SELECT nonce,state,receipt FROM jobs WHERE job_id=?",(payload["job_id"],)).fetchone()
            if existing is not None and existing[0]==payload["nonce"] and existing[1]=="COMPLETED":
                return json.loads(existing[2])
            raise AgentError("job already claimed or nonce reused; manual reconciliation required")
    # Deliberate commit BEFORE execution; restart cannot repeat an uncertain native operation.
    receipt=execute(job,key,root,editor,terminal,now=now)
    with closing(sqlite3.connect(database,timeout=15)) as db:
        db.execute("UPDATE jobs SET state='COMPLETED', receipt=? WHERE job_id=? AND state='CLAIMED'",
                   (json.dumps(receipt,separators=(",",":")),payload["job_id"]))
        db.commit()
    return receipt
