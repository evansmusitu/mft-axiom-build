from __future__ import annotations

import json
import sqlite3

from .common import (
    AuthorizationError,
    ConflictError,
    TenantIsolationError,
    canonical_json,
    clean_text,
    new_id,
    now_ms,
    require_text,
    sha256_json,
    sha256_text,
)
from .identity import IdentityContext, IdentityService
from .store import CandidateStore


ENTITY_TYPES = ("WORK", "ARTIFACT", "AGENT", "MEMORY", "SOURCE", "APPROVAL")


class ProjectWorkGraph:
    def __init__(self, store: CandidateStore, identity: IdentityService):
        self.store = store
        self.identity = identity

    def _authorize_project(self, context: IdentityContext, project_id: str):
        self.identity.validate_context(context)
        project_id = require_text(project_id, "project id", maximum=200)
        row = self.store.connection.execute(
            """SELECT p.* FROM projects p
               JOIN memberships m ON m.organization_id=p.organization_id AND m.user_id=? AND m.status='ACTIVE'
               WHERE p.project_id=?""",
            (context.user_id, project_id),
        ).fetchone()
        if not row or row["organization_id"] != context.organization_id:
            raise TenantIsolationError("project is outside the authenticated tenant")
        return row

    def _append_event(
        self,
        db,
        *,
        context: IdentityContext,
        project_id: str,
        entity_id: str,
        entity_type: str,
        entity_version: int,
        event_type: str,
        payload,
    ):
        previous = db.execute(
            """SELECT event_sha256 FROM graph_events
               WHERE organization_id=? AND project_id=? ORDER BY sequence DESC LIMIT 1""",
            (context.organization_id, project_id),
        ).fetchone()
        body = {
            "event_id": new_id("graph_event"),
            "organization_id": context.organization_id,
            "project_id": project_id,
            "entity_id": entity_id,
            "entity_type": entity_type,
            "entity_version": int(entity_version),
            "event_type": event_type,
            "payload": payload,
            "previous_event_sha256": previous["event_sha256"] if previous else None,
            "created_at_ms": now_ms(),
        }
        payload_json = canonical_json(payload)
        digest = sha256_json(body)
        db.execute(
            """INSERT INTO graph_events(
               event_id,organization_id,project_id,entity_id,entity_type,entity_version,event_type,
               payload_json,payload_sha256,previous_event_sha256,event_sha256,created_at_ms
               ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                body["event_id"],
                context.organization_id,
                project_id,
                entity_id,
                entity_type,
                entity_version,
                event_type,
                payload_json,
                sha256_text(payload_json),
                body["previous_event_sha256"],
                digest,
                body["created_at_ms"],
            ),
        )
        return digest

    @staticmethod
    def _entity(row):
        return {
            "organization_id": row["organization_id"],
            "project_id": row["project_id"],
            "entity_id": row["entity_id"],
            "entity_type": row["entity_type"],
            "version": row["version"],
            "body": json.loads(row["body_json"]),
            "body_sha256": row["body_sha256"],
            "provenance": json.loads(row["provenance_json"]),
            "provenance_sha256": row["provenance_sha256"],
            "created_by": row["created_by"],
            "created_at_ms": row["created_at_ms"],
            "updated_at_ms": row["updated_at_ms"],
        }

    def put_entity(
        self,
        context: IdentityContext,
        project_id,
        *,
        entity_type,
        body,
        provenance,
        entity_id=None,
        expected_version=None,
    ):
        project = self._authorize_project(context, project_id)
        entity_type = clean_text(entity_type, maximum=40).upper()
        if entity_type not in ENTITY_TYPES:
            raise ValueError("unsupported Project/Work graph entity type")
        entity_id = clean_text(entity_id, maximum=200) or new_id(entity_type.lower())
        body_json = canonical_json(body or {})
        provenance_json = canonical_json(provenance or {})
        created = now_ms()
        try:
            with self.store.transaction(immediate=True) as db:
                prior = db.execute(
                    """SELECT * FROM graph_entities
                       WHERE organization_id=? AND project_id=? AND entity_id=?""",
                    (context.organization_id, project_id, entity_id),
                ).fetchone()
                prior_version = prior["version"] if prior else 0
                if expected_version is not None and int(expected_version) != prior_version:
                    raise ConflictError("optimistic graph version conflict")
                version = prior_version + 1
                if prior:
                    db.execute(
                        """UPDATE graph_entities SET version=?,entity_type=?,body_json=?,body_sha256=?,
                           provenance_json=?,provenance_sha256=?,updated_at_ms=?
                           WHERE organization_id=? AND project_id=? AND entity_id=?""",
                        (
                            version,
                            entity_type,
                            body_json,
                            sha256_text(body_json),
                            provenance_json,
                            sha256_text(provenance_json),
                            created,
                            context.organization_id,
                            project_id,
                            entity_id,
                        ),
                    )
                else:
                    db.execute(
                        """INSERT INTO graph_entities VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (
                            context.organization_id,
                            project_id,
                            entity_id,
                            entity_type,
                            version,
                            body_json,
                            sha256_text(body_json),
                            provenance_json,
                            sha256_text(provenance_json),
                            context.user_id,
                            created,
                            created,
                        ),
                    )
                payload = {
                    "body_sha256": sha256_text(body_json),
                    "provenance_sha256": sha256_text(provenance_json),
                    "actor_id": context.user_id,
                }
                self._append_event(
                    db,
                    context=context,
                    project_id=project["project_id"],
                    entity_id=entity_id,
                    entity_type=entity_type,
                    entity_version=version,
                    event_type="entity.updated" if prior else "entity.created",
                    payload=payload,
                )
        except sqlite3.IntegrityError as exc:
            raise ConflictError("graph entity violates persistence constraints") from exc
        row = self.store.connection.execute(
            "SELECT * FROM graph_entities WHERE organization_id=? AND project_id=? AND entity_id=?",
            (context.organization_id, project_id, entity_id),
        ).fetchone()
        return self._entity(row)

    def get_entity(self, context: IdentityContext, project_id, entity_id):
        self._authorize_project(context, project_id)
        row = self.store.connection.execute(
            "SELECT * FROM graph_entities WHERE organization_id=? AND project_id=? AND entity_id=?",
            (context.organization_id, project_id, entity_id),
        ).fetchone()
        return self._entity(row) if row else None

    def list_entities(self, context: IdentityContext, project_id, *, entity_types=None):
        self._authorize_project(context, project_id)
        allowed = tuple(sorted({clean_text(item, maximum=40).upper() for item in (entity_types or ENTITY_TYPES)}))
        if not allowed:
            return []
        placeholders = ",".join("?" for _ in allowed)
        rows = self.store.connection.execute(
            f"""SELECT * FROM graph_entities WHERE organization_id=? AND project_id=?
                AND entity_type IN ({placeholders}) ORDER BY entity_type,entity_id""",
            (context.organization_id, project_id, *allowed),
        ).fetchall()
        return [self._entity(row) for row in rows]

    def sync(self, context: IdentityContext, project_id, *, after_sequence=0, device_id="device"):
        project = self._authorize_project(context, project_id)
        after_sequence = max(0, int(after_sequence))
        rows = self.store.connection.execute(
            """SELECT * FROM graph_events WHERE organization_id=? AND project_id=? AND sequence>?
               ORDER BY sequence""",
            (context.organization_id, project_id, after_sequence),
        ).fetchall()
        events = []
        for row in rows:
            item = dict(row)
            item["payload"] = json.loads(item.pop("payload_json"))
            events.append(item)
        return {
            "schema": "musitu.axiom.ar04.sync.v1",
            "organization_id": context.organization_id,
            "project": dict(project),
            "device_id": clean_text(device_id, maximum=120),
            "from_sequence": after_sequence,
            "to_sequence": events[-1]["sequence"] if events else after_sequence,
            "events": events,
            "entities": self.list_entities(context, project_id),
            "provenance_preserved": self.verify_project(context, project_id)["status"] == "PASS",
        }

    def import_local(self, context: IdentityContext, project_id, source_store, rows):
        self._authorize_project(context, project_id)
        source_store = require_text(source_store, "source store", maximum=160)
        mapped = []
        for source in rows:
            source_id = require_text(source.get("id"), "source object id", maximum=200)
            entity_type = clean_text(source.get("entity_type"), maximum=40).upper()
            if entity_type not in ENTITY_TYPES:
                raise ValueError("unsupported Project/Work graph entity type")
            body = source.get("body") or {}
            provenance = {
                "source": "LOCAL_STORE_IMPORT",
                "source_store": source_store,
                "original": source.get("provenance") or {},
            }
            fingerprint = sha256_json(
                {
                    "entity_type": entity_type,
                    "body": body,
                    "provenance": source.get("provenance") or {},
                }
            )
            entity_id = "import_" + sha256_json(
                {
                    "organization_id": context.organization_id,
                    "project_id": project_id,
                    "source_store": source_store,
                    "source_object_id": source_id,
                }
            )[:32]
            with self.store.transaction(immediate=True) as db:
                existing = db.execute(
                    """SELECT * FROM import_keys WHERE organization_id=? AND project_id=?
                       AND source_store=? AND source_object_id=?""",
                    (context.organization_id, project_id, source_store, source_id),
                ).fetchone()
                if existing:
                    if existing["imported_sha256"] != fingerprint:
                        raise ConflictError(
                            "local import changed behind an existing source identity"
                        )
                    entity_id = existing["entity_id"]
                else:
                    created = now_ms()
                    body_json = canonical_json(body)
                    provenance_json = canonical_json(provenance)
                    try:
                        db.execute(
                            "INSERT INTO graph_entities VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                            (
                                context.organization_id,
                                project_id,
                                entity_id,
                                entity_type,
                                1,
                                body_json,
                                sha256_text(body_json),
                                provenance_json,
                                sha256_text(provenance_json),
                                context.user_id,
                                created,
                                created,
                            ),
                        )
                    except sqlite3.IntegrityError as exc:
                        raise ConflictError(
                            "deterministic local import identity already exists"
                        ) from exc
                    self._append_event(
                        db,
                        context=context,
                        project_id=project_id,
                        entity_id=entity_id,
                        entity_type=entity_type,
                        entity_version=1,
                        event_type="entity.imported",
                        payload={
                            "body_sha256": sha256_text(body_json),
                            "provenance_sha256": sha256_text(provenance_json),
                            "actor_id": context.user_id,
                            "imported_sha256": fingerprint,
                        },
                    )
                    db.execute(
                        "INSERT INTO import_keys VALUES(?,?,?,?,?,?,?)",
                        (
                            context.organization_id,
                            project_id,
                            source_store,
                            source_id,
                            entity_id,
                            fingerprint,
                            created,
                        ),
                    )
            mapped.append(entity_id)
        return mapped

    def verify_project(self, context: IdentityContext, project_id):
        self._authorize_project(context, project_id)
        errors = []
        entities = self.store.connection.execute(
            "SELECT * FROM graph_entities WHERE organization_id=? AND project_id=? ORDER BY entity_id",
            (context.organization_id, project_id),
        ).fetchall()
        for row in entities:
            if sha256_text(row["body_json"]) != row["body_sha256"]:
                errors.append(f"entity_hash:{row['entity_id']}")
            if sha256_text(row["provenance_json"]) != row["provenance_sha256"]:
                errors.append(f"provenance_hash:{row['entity_id']}")
        events = self.store.connection.execute(
            """SELECT * FROM graph_events WHERE organization_id=? AND project_id=? ORDER BY sequence""",
            (context.organization_id, project_id),
        ).fetchall()
        previous = None
        latest = {}
        for row in events:
            if row["previous_event_sha256"] != previous:
                errors.append(f"event_chain:{row['sequence']}")
            try:
                payload = json.loads(row["payload_json"])
            except json.JSONDecodeError:
                errors.append(f"event_json:{row['sequence']}")
                payload = None
            if sha256_text(row["payload_json"]) != row["payload_sha256"]:
                errors.append(f"event_payload:{row['sequence']}")
            body = {
                "event_id": row["event_id"],
                "organization_id": row["organization_id"],
                "project_id": row["project_id"],
                "entity_id": row["entity_id"],
                "entity_type": row["entity_type"],
                "entity_version": row["entity_version"],
                "event_type": row["event_type"],
                "payload": payload,
                "previous_event_sha256": row["previous_event_sha256"],
                "created_at_ms": row["created_at_ms"],
            }
            if sha256_json(body) != row["event_sha256"]:
                errors.append(f"event_hash:{row['sequence']}")
            latest[row["entity_id"]] = payload
            previous = row["event_sha256"]
        for row in entities:
            event = latest.get(row["entity_id"])
            if not isinstance(event, dict) or event.get("body_sha256") != row["body_sha256"]:
                errors.append(f"entity_event_binding:{row['entity_id']}")
        return {
            "status": "PASS" if not errors else "FAIL",
            "errors": sorted(set(errors)),
            "project_id": project_id,
            "entity_count": len(entities),
            "event_count": len(events),
            "tenant_isolation_enforced": True,
        }
