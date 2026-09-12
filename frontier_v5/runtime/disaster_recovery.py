#!/usr/bin/env python3
"""Frontier-only enterprise disaster-recovery governance.

Isolated from sealed-v4/public OAuth, production D1, billing, and customer
secrets. Recovery uses tenant-scoped SQLite snapshots plus synthetic key files
inside disposable storage and fails closed on RPO/RTO or integrity violations.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any
import hashlib
import json
import re
import shutil
import sqlite3

_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,191}$")

class DisasterRecoveryError(RuntimeError): pass
class DRInputError(DisasterRecoveryError): pass
class DRAuthorizationError(DisasterRecoveryError): pass
class DRIntegrityError(DisasterRecoveryError): pass
class DRNotFoundError(DisasterRecoveryError): pass
class DRObjectiveError(DisasterRecoveryError): pass

def _canon(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)

def _hash_json(value: Any) -> str:
    return hashlib.sha256(_canon(value).encode()).hexdigest()

def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()

def _ident(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip(): raise DRInputError(f"{name} is required")
    value = value.strip()
    if not _ID.fullmatch(value): raise DRInputError(f"{name} has invalid format")
    return value

def _epoch(value: Any, name: str) -> int:
    if type(value) is not int or value < 0: raise DRInputError(f"{name} must be an integer >= 0")
    return value

def _positive(value: Any, label: str) -> int:
    if type(value) is not int or value <= 0: raise DRInputError(f"{label} must be an integer > 0")
    return value

def _authorized(value: bool) -> None:
    if value is not True: raise DRAuthorizationError("explicitly authorized disaster-recovery action required")

def _file(value: str | Path, name: str) -> Path:
    try: path = Path(value)
    except TypeError as exc: raise DRInputError(f"{name} is invalid") from exc
    if not path.is_file(): raise DRInputError(f"{name} must reference an existing file")
    return path

def _verify_db(path: Path, tenant: str) -> tuple[bool, bool]:
    try:
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True); db.row_factory = sqlite3.Row
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"tenant_records", "audit_log"}.issubset(tables):
            raise DRIntegrityError("database snapshot is missing required recovery tables")
        tenants = {str(r[0]) for r in db.execute("SELECT DISTINCT tenant_id FROM tenant_records")}
        rows = db.execute("SELECT sequence,tenant_id,payload_json,previous_sha256,event_sha256 FROM audit_log ORDER BY sequence").fetchall()
        db.close()
    except DRIntegrityError: raise
    except sqlite3.Error as exc: raise DRIntegrityError("database snapshot is not readable SQLite") from exc
    if not tenants or tenants != {tenant}: raise DRIntegrityError("tenant isolation validation failed")
    if not rows: raise DRIntegrityError("audit history is missing")
    previous = None
    for row in rows:
        if str(row["tenant_id"]) != tenant: raise DRIntegrityError("tenant isolation validation failed in audit history")
        if row["previous_sha256"] != previous: raise DRIntegrityError("audit chain previous hash mismatch")
        expected = _hash_json({"tenant_id": tenant, "sequence": int(row["sequence"]), "payload_json": str(row["payload_json"]), "previous_sha256": previous})
        if str(row["event_sha256"]) != expected: raise DRIntegrityError("audit chain integrity validation failed")
        previous = expected
    return True, True

def _snapshot(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        src = sqlite3.connect(f"file:{source}?mode=ro", uri=True); dst = sqlite3.connect(destination)
        src.backup(dst); dst.commit(); dst.close(); src.close()
    except sqlite3.Error as exc:
        destination.unlink(missing_ok=True); raise DRIntegrityError("failed to create SQLite recovery snapshot") from exc

class EnterpriseDisasterRecoveryManager:
    def __init__(self, control_db_path: str | Path, recovery_root: str | Path) -> None:
        self.path = Path(control_db_path); self.path.parent.mkdir(parents=True, exist_ok=True)
        self.recovery_root = Path(recovery_root); self.recovery_root.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path); self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA foreign_keys=ON"); self._db.execute("PRAGMA journal_mode=WAL"); self._db.execute("PRAGMA busy_timeout=5000")
        self._db.executescript("""
        CREATE TABLE IF NOT EXISTS dr_objectives(tenant_id TEXT PRIMARY KEY,max_rpo_seconds INTEGER NOT NULL,max_rto_seconds INTEGER NOT NULL,actor TEXT NOT NULL,updated_epoch INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS dr_backups(tenant_id TEXT NOT NULL,backup_id TEXT NOT NULL,source_region TEXT NOT NULL,recovery_point_epoch INTEGER NOT NULL,database_path TEXT NOT NULL,key_path TEXT NOT NULL,database_sha256 TEXT NOT NULL,key_sha256 TEXT NOT NULL,tenant_isolated INTEGER NOT NULL,audit_valid INTEGER NOT NULL,actor TEXT NOT NULL,created_epoch INTEGER NOT NULL,PRIMARY KEY(tenant_id,backup_id));
        CREATE TABLE IF NOT EXISTS dr_recoveries(tenant_id TEXT NOT NULL,recovery_id TEXT NOT NULL,backup_id TEXT NOT NULL,target_region TEXT NOT NULL,disaster_epoch INTEGER NOT NULL,restore_started_epoch INTEGER NOT NULL,restore_completed_epoch INTEGER NOT NULL,measured_rpo_seconds INTEGER NOT NULL,measured_rto_seconds INTEGER NOT NULL,database_path TEXT NOT NULL,key_path TEXT NOT NULL,tenant_isolated INTEGER NOT NULL,audit_preserved INTEGER NOT NULL,key_recovered INTEGER NOT NULL,objectives_met INTEGER NOT NULL,status TEXT NOT NULL,actor TEXT NOT NULL,PRIMARY KEY(tenant_id,recovery_id),FOREIGN KEY(tenant_id,backup_id) REFERENCES dr_backups(tenant_id,backup_id));
        CREATE TABLE IF NOT EXISTS dr_failovers(tenant_id TEXT NOT NULL,recovery_id TEXT NOT NULL,from_region TEXT NOT NULL,to_region TEXT NOT NULL,actor TEXT NOT NULL,recorded_epoch INTEGER NOT NULL,PRIMARY KEY(tenant_id,recovery_id),FOREIGN KEY(tenant_id,recovery_id) REFERENCES dr_recoveries(tenant_id,recovery_id));
        CREATE TABLE IF NOT EXISTS dr_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,actor TEXT NOT NULL,event_type TEXT NOT NULL,target_id TEXT NOT NULL,payload_json TEXT NOT NULL,previous_sha256 TEXT,event_sha256 TEXT NOT NULL,created_epoch INTEGER NOT NULL);
        """); self._db.commit()

    def close(self) -> None: self._db.close()

    def _audit(self, tenant: str, actor: str, event: str, target: str, payload: dict[str, Any], epoch: int) -> None:
        row = self._db.execute("SELECT event_sha256 FROM dr_audit WHERE tenant_id=? ORDER BY sequence DESC LIMIT 1", (tenant,)).fetchone()
        previous = str(row[0]) if row else None; payload_json = _canon(payload)
        body = {"tenant_id":tenant,"actor":actor,"event_type":event,"target_id":target,"payload_json":payload_json,"previous_sha256":previous,"created_epoch":epoch}
        event_hash = _hash_json(body)
        self._db.execute("INSERT INTO dr_audit(tenant_id,actor,event_type,target_id,payload_json,previous_sha256,event_sha256,created_epoch) VALUES(?,?,?,?,?,?,?,?)", (tenant,actor,event,target,payload_json,previous,event_hash,epoch))

    def verify_audit_chain(self, tenant_id: str) -> bool:
        try: tenant = _ident(tenant_id, "tenant_id")
        except DRInputError: return False
        rows = self._db.execute("SELECT * FROM dr_audit WHERE tenant_id=? ORDER BY sequence", (tenant,)).fetchall()
        if not rows: return False
        previous = None
        for row in rows:
            if row["previous_sha256"] != previous: return False
            body = {"tenant_id":row["tenant_id"],"actor":row["actor"],"event_type":row["event_type"],"target_id":row["target_id"],"payload_json":row["payload_json"],"previous_sha256":row["previous_sha256"],"created_epoch":row["created_epoch"]}
            if _hash_json(body) != str(row["event_sha256"]): return False
            previous = str(row["event_sha256"])
        return True

    def _objectives(self, tenant: str) -> sqlite3.Row:
        row = self._db.execute("SELECT * FROM dr_objectives WHERE tenant_id=?", (tenant,)).fetchone()
        if row is None: raise DRObjectiveError("RPO/RTO objectives are not configured")
        return row

    def _backup(self, tenant: str, backup_id: str) -> sqlite3.Row:
        row = self._db.execute("SELECT * FROM dr_backups WHERE tenant_id=? AND backup_id=?", (tenant, backup_id)).fetchone()
        if row is None: raise DRNotFoundError("backup not found for tenant")
        return row

    def _recovery(self, tenant: str, recovery_id: str) -> sqlite3.Row:
        row = self._db.execute("SELECT * FROM dr_recoveries WHERE tenant_id=? AND recovery_id=?", (tenant, recovery_id)).fetchone()
        if row is None: raise DRNotFoundError("recovery not found for tenant")
        return row

    def declare_objectives(self, tenant_id: str, *, max_rpo_seconds: int, max_rto_seconds: int, actor: str, authorized: bool, now_epoch: int) -> dict[str, Any]:
        _authorized(authorized); tenant=_ident(tenant_id,"tenant_id"); actor=_ident(actor,"actor")
        rpo=_positive(max_rpo_seconds,"RPO max_rpo_seconds"); rto=_positive(max_rto_seconds,"RTO max_rto_seconds"); now=_epoch(now_epoch,"now_epoch")
        with self._db:
            self._db.execute("INSERT INTO dr_objectives VALUES(?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET max_rpo_seconds=excluded.max_rpo_seconds,max_rto_seconds=excluded.max_rto_seconds,actor=excluded.actor,updated_epoch=excluded.updated_epoch", (tenant,rpo,rto,actor,now))
            self._audit(tenant,actor,"objectives.declared","objectives",{"max_rpo_seconds":rpo,"max_rto_seconds":rto},now)
        return {"tenant_id":tenant,"max_rpo_seconds":rpo,"max_rto_seconds":rto,"status":"declared"}

    def create_backup(self, tenant_id: str, backup_id: str, *, source_db_path: str | Path, key_path: str | Path, source_region: str, recovery_point_epoch: int, actor: str, authorized: bool, now_epoch: int) -> dict[str, Any]:
        _authorized(authorized); tenant=_ident(tenant_id,"tenant_id"); backup_id=_ident(backup_id,"backup_id"); region=_ident(source_region,"source_region"); actor=_ident(actor,"actor")
        point=_epoch(recovery_point_epoch,"recovery_point_epoch"); now=_epoch(now_epoch,"now_epoch")
        if point > now: raise DRInputError("recovery_point_epoch cannot be after now_epoch")
        source=_file(source_db_path,"source_db_path"); key=_file(key_path,"key_path")
        if key.stat().st_size == 0: raise DRIntegrityError("recovery key material is empty")
        self._objectives(tenant); _verify_db(source,tenant)
        if self._db.execute("SELECT 1 FROM dr_backups WHERE tenant_id=? AND backup_id=?",(tenant,backup_id)).fetchone(): raise DRInputError("backup_id already exists")
        bucket=self.recovery_root/hashlib.sha256(tenant.encode()).hexdigest()/"backups"/hashlib.sha256(backup_id.encode()).hexdigest()
        if bucket.exists(): raise DRIntegrityError("recovery storage collision detected")
        bucket.mkdir(parents=True); snap=bucket/"database.sqlite3"; saved_key=bucket/"recovery.key"
        try:
            _snapshot(source,snap); shutil.copyfile(key,saved_key); isolated,audit=_verify_db(snap,tenant); db_hash=_hash_file(snap); key_hash=_hash_file(saved_key)
            with self._db:
                self._db.execute("INSERT INTO dr_backups VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",(tenant,backup_id,region,point,str(snap),str(saved_key),db_hash,key_hash,int(isolated),int(audit),actor,now))
                self._audit(tenant,actor,"backup.verified",backup_id,{"source_region":region,"recovery_point_epoch":point,"database_sha256":db_hash,"key_sha256":key_hash,"tenant_isolated":isolated,"audit_valid":audit},now)
        except Exception:
            if not self._db.execute("SELECT 1 FROM dr_backups WHERE tenant_id=? AND backup_id=?",(tenant,backup_id)).fetchone(): shutil.rmtree(bucket,ignore_errors=True)
            raise
        return {"tenant_id":tenant,"backup_id":backup_id,"status":"verified","source_region":region,"recovery_point_epoch":point,"database_sha256":db_hash,"key_sha256":key_hash,"tenant_isolated":isolated,"audit_valid":audit}

    def restore_backup(self, tenant_id: str, backup_id: str, *, recovery_id: str, restore_dir: str | Path, target_region: str, disaster_epoch: int, restore_started_epoch: int, restore_completed_epoch: int, actor: str, authorized: bool) -> dict[str, Any]:
        _authorized(authorized); tenant=_ident(tenant_id,"tenant_id"); backup_id=_ident(backup_id,"backup_id"); recovery_id=_ident(recovery_id,"recovery_id"); region=_ident(target_region,"target_region"); actor=_ident(actor,"actor")
        disaster=_epoch(disaster_epoch,"disaster_epoch"); started=_epoch(restore_started_epoch,"restore_started_epoch"); completed=_epoch(restore_completed_epoch,"restore_completed_epoch")
        if not disaster <= started <= completed: raise DRInputError("restore timeline must satisfy disaster <= started <= completed")
        backup=self._backup(tenant,backup_id); objectives=self._objectives(tenant)
        if disaster < int(backup["recovery_point_epoch"]): raise DRInputError("disaster_epoch cannot precede the recovery point")
        measured_rpo=disaster-int(backup["recovery_point_epoch"]); measured_rto=completed-started
        if measured_rpo > int(objectives["max_rpo_seconds"]): raise DRObjectiveError(f"RPO objective exceeded: {measured_rpo}s > {int(objectives['max_rpo_seconds'])}s")
        if measured_rto > int(objectives["max_rto_seconds"]): raise DRObjectiveError(f"RTO objective exceeded: {measured_rto}s > {int(objectives['max_rto_seconds'])}s")
        source=Path(str(backup["database_path"])); key=Path(str(backup["key_path"]))
        if not source.is_file() or _hash_file(source)!=str(backup["database_sha256"]): raise DRIntegrityError("backup database integrity validation failed")
        if not key.is_file() or _hash_file(key)!=str(backup["key_sha256"]): raise DRIntegrityError("backup key integrity validation failed")
        _verify_db(source,tenant)
        if self._db.execute("SELECT 1 FROM dr_recoveries WHERE tenant_id=? AND recovery_id=?",(tenant,recovery_id)).fetchone(): raise DRInputError("recovery_id already exists")
        destination=Path(restore_dir)
        if destination.exists() and not destination.is_dir(): raise DRInputError("restore_dir must be a directory")
        if destination.exists() and any(destination.iterdir()): raise DRInputError("restore_dir must be disposable and empty")
        destination.mkdir(parents=True,exist_ok=True); restored_db=destination/"database.sqlite3"; restored_key=destination/"recovery.key"
        try:
            _snapshot(source,restored_db); shutil.copyfile(key,restored_key); isolated,audit=_verify_db(restored_db,tenant); key_ok=_hash_file(restored_key)==str(backup["key_sha256"])
            if not key_ok: raise DRIntegrityError("recovery key integrity validation failed")
            with self._db:
                self._db.execute("INSERT INTO dr_recoveries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(tenant,recovery_id,backup_id,region,disaster,started,completed,measured_rpo,measured_rto,str(restored_db),str(restored_key),int(isolated),int(audit),int(key_ok),1,"verified",actor))
                self._audit(tenant,actor,"restore.verified",recovery_id,{"backup_id":backup_id,"target_region":region,"measured_rpo_seconds":measured_rpo,"measured_rto_seconds":measured_rto,"objectives_met":True,"tenant_isolated":isolated,"audit_preserved":audit,"key_recovered":key_ok},completed)
        except Exception:
            if not self._db.execute("SELECT 1 FROM dr_recoveries WHERE tenant_id=? AND recovery_id=?",(tenant,recovery_id)).fetchone(): shutil.rmtree(destination,ignore_errors=True)
            raise
        return {"tenant_id":tenant,"backup_id":backup_id,"recovery_id":recovery_id,"status":"verified","target_region":region,"measured_rpo_seconds":measured_rpo,"measured_rto_seconds":measured_rto,"objectives_met":True,"tenant_isolated":isolated,"audit_preserved":audit,"key_recovered":key_ok,"database_path":str(restored_db),"key_path":str(restored_key)}

    def record_failover(self, tenant_id: str, recovery_id: str, *, from_region: str, to_region: str, actor: str, authorized: bool, now_epoch: int) -> dict[str, Any]:
        _authorized(authorized); tenant=_ident(tenant_id,"tenant_id"); recovery_id=_ident(recovery_id,"recovery_id"); source_region=_ident(from_region,"from_region"); target_region=_ident(to_region,"to_region"); actor=_ident(actor,"actor"); now=_epoch(now_epoch,"now_epoch")
        if source_region==target_region: raise DRInputError("failover requires a different region")
        recovery=self._recovery(tenant,recovery_id); backup=self._backup(tenant,str(recovery["backup_id"]))
        if source_region!=str(backup["source_region"]): raise DRInputError("from_region does not match the backup source region")
        if target_region!=str(recovery["target_region"]): raise DRInputError("to_region does not match the verified recovery target region")
        if now<int(recovery["restore_completed_epoch"]): raise DRInputError("failover cannot precede restore completion")
        with self._db:
            self._db.execute("INSERT INTO dr_failovers VALUES(?,?,?,?,?,?)",(tenant,recovery_id,source_region,target_region,actor,now)); self._audit(tenant,actor,"failover.recorded",recovery_id,{"from_region":source_region,"to_region":target_region},now)
        return {"tenant_id":tenant,"recovery_id":recovery_id,"status":"recorded","from_region":source_region,"to_region":target_region}

    def promotion_readiness(self, tenant_id: str, recovery_id: str) -> dict[str, Any]:
        tenant=_ident(tenant_id,"tenant_id"); recovery_id=_ident(recovery_id,"recovery_id"); recovery=self._recovery(tenant,recovery_id); backup=self._backup(tenant,str(recovery["backup_id"]))
        restored_db=Path(str(recovery["database_path"])); restored_key=Path(str(recovery["key_path"]))
        if not restored_db.is_file(): raise DRIntegrityError("restored database is missing")
        try: isolated,audit=_verify_db(restored_db,tenant)
        except DRIntegrityError as exc:
            if "audit" in str(exc).lower(): raise
            raise DRIntegrityError(f"recovery audit/tenant integrity check failed: {exc}") from exc
        key_ok=restored_key.is_file() and _hash_file(restored_key)==str(backup["key_sha256"])
        if not key_ok: raise DRIntegrityError("recovered key integrity validation failed")
        failover=self._db.execute("SELECT 1 FROM dr_failovers WHERE tenant_id=? AND recovery_id=?",(tenant,recovery_id)).fetchone() is not None
        control_audit=self.verify_audit_chain(tenant)
        if not control_audit: raise DRIntegrityError("control audit chain integrity validation failed")
        objectives=bool(recovery["objectives_met"]); promotable=bool(objectives and isolated and audit and key_ok and failover and control_audit)
        return {"tenant_id":tenant,"recovery_id":recovery_id,"promotable":promotable,"objectives_met":objectives,"tenant_isolated":isolated,"audit_preserved":audit,"key_recovered":key_ok,"failover_recorded":failover,"control_audit_valid":control_audit}
