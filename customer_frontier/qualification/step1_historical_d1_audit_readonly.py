"""Cloudflare-origin D1 creation provenance: strict GET-only, sanitized, NO ADOPTION.

Never record API tokens, Cloudflare actor emails/IPs, raw log payloads,
customer rows, resource requests/responses, or sensitive URL query data.

Audit-log presence is historical *provenance evidence*, not proof that the
actor was authorized for AXIOM, not current durable backup, not independent
custody, and not permission to reuse the database. Fail closed on missing,
truncated, malformed, contradictory or insufficiently privileged responses.
"""

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

ACCOUNT = "93f395f5121954671f92fffa453d6b61"
DATABASE = "ccc473f1-fbb5-4b8d-8a24-45f3696ac10f"
NAME_SHA = "7e98510fc457a669c29dd85ab1d87cc758fe0ba74d0833c20863b53d599b5b36"
ROOT = "https://api.cloudflare.com/client/v4/accounts/" + ACCOUNT
SINCE = "2025-05-11"  # Verified earliest accepted date after 18-month retention edge
BEFORE = "2026-11-11"
# Bound every request to ~one month. Overlap one day to prevent missing
# events exactly on a slice boundary; deduplicate by provider event ID hash.
BOUNDS = tuple(dt.date(year, month, 11) for year in (2025, 2026)
               for month in range(5 if year == 2025 else 1,
                                  13 if year == 2025 else 12))
WINDOWS = tuple(((BOUNDS[i] - dt.timedelta(days=1 if i else 0)).isoformat(),
                 (BOUNDS[i + 1] + dt.timedelta(days=1 if i < len(BOUNDS)-2 else 0)).isoformat())
                for i in range(len(BOUNDS)-1))
MAX_PAGES = 12
PAGE_LIMIT = 100
HEX_SHA = re.compile(r"[0-9a-f]{64}\Z")
CURSOR = re.compile(r"[A-Za-z0-9_+=/.-]{1,2048}\Z")
UTC = dt.timezone.utc


class NoGo(Exception):
    pass


class NeverRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def sha(text):
    if not isinstance(text, (str, bytes)):
        raise NoGo("HASH_INPUT_INVALID")
    return hashlib.sha256(text.encode() if isinstance(text, str) else text).hexdigest()


def check_metadata(payload):
    if not isinstance(payload, dict) or payload.get("success") is not True:
        raise NoGo("DATABASE_PROVIDER_RESPONSE_UNQUALIFIED")
    result = payload.get("result")
    if not isinstance(result, dict) or result.get("uuid") != DATABASE:
        raise NoGo("HISTORICAL_DATABASE_UUID_MISMATCH")
    name = result.get("name")
    if not isinstance(name, str) or sha(name) != NAME_SHA:
        raise NoGo("HISTORICAL_DATABASE_NAME_MISMATCH")
    return True


def parse_event(event):
    """Strip raw actor values before returning; do not trust action label as owner."""
    if not isinstance(event, dict):
        raise NoGo("AUDIT_EVENT_INVALID")
    resource = event.get("resource")
    account = event.get("account")
    action = event.get("action")
    actor = event.get("actor")
    raw = event.get("raw")
    if not all(isinstance(x, dict) for x in (resource, account, action, actor, raw)):
        raise NoGo("AUDIT_EVENT_FIELDS_MISSING")
    if account.get("id") != ACCOUNT or resource.get("id") != DATABASE:
        raise NoGo("AUDIT_EVENT_WRONG_ACCOUNT_OR_DATABASE")
    if str(resource.get("product", "")).lower() not in ("d1", "d1 database", "d1 databases"):
        raise NoGo("AUDIT_EVENT_RESOURCE_PRODUCT_UNCONFIRMED")
    kind = action.get("type")
    if kind not in ("create", "update", "delete", "view"):
        raise NoGo("AUDIT_EVENT_ACTION_UNSUPPORTED")
    if action.get("result") not in ("success", "failure"):
        raise NoGo("AUDIT_EVENT_RESULT_UNSUPPORTED")
    stamp = action.get("time")
    if not isinstance(stamp, str):
        raise NoGo("AUDIT_EVENT_TIME_INVALID")
    try:
        time = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        start = dt.datetime.fromisoformat(SINCE).replace(tzinfo=UTC)
        end = dt.datetime.fromisoformat(BEFORE).replace(tzinfo=UTC)
    except ValueError as exc:
        raise NoGo("AUDIT_EVENT_TIME_INVALID") from exc
    if time.tzinfo is None or not start <= time.astimezone(UTC) < end:
        raise NoGo("AUDIT_EVENT_TIME_OUTSIDE_REVIEW_WINDOW")
    event_id = event.get("id")
    if not isinstance(event_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{12,128}", event_id):
        raise NoGo("AUDIT_EVENT_ID_INVALID")
    actor_id = actor.get("id")
    if not isinstance(actor_id, str) or not actor_id.strip() or len(actor_id) > 256:
        raise NoGo("AUDIT_ACTOR_NOT_IDENTIFIED")
    if actor.get("type") not in ("account", "user", "cloudflare_admin", "system"):
        raise NoGo("AUDIT_ACTOR_TYPE_INVALID")
    if raw.get("method") not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
        raise NoGo("AUDIT_METHOD_UNKNOWN")
    if kind == "create" and action["result"] == "success":
        # A random D1-related create must not impersonate the named database
        # creation. Cloudflare's published raw.uri uses the account-scoped path.
        uri = raw.get("uri")
        if not isinstance(uri, str):
            raise NoGo("CREATION_RAW_URI_MISSING")
        parsed = urllib.parse.urlsplit(uri)
        allowed = {"/accounts/" + ACCOUNT + "/d1/database",
                   "/client/v4/accounts/" + ACCOUNT + "/d1/database"}
        if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or parsed.path not in allowed:
            raise NoGo("CREATION_RAW_URI_WRONG_RESOURCE")
        if actor.get("context") not in ("api_token", "api_key", "dash", "oauth"):
            raise NoGo("CREATION_ACTOR_CONTEXT_UNQUALIFIED")
        status = raw.get("status_code")
        if type(status) is not int or not 200 <= status <= 299:
            raise NoGo("CREATION_PROVIDER_STATUS_UNQUALIFIED")
    return {
        "event_id_sha256": sha(event_id),
        "actor_id_sha256": sha(actor_id),
        "actor_type": actor["type"],
        "action": kind,
        "result": action["result"],
        "method": raw["method"],
        "date": time.date().isoformat(),
    }


def inspect_logs(responses, *, _events=False):
    """Fail closed unless server-side resource pagination is completed exactly."""
    if not isinstance(responses, list) or not responses or len(responses) > MAX_PAGES:
        raise NoGo("AUDIT_HISTORY_PAGE_COUNT_UNQUALIFIED")
    observed = []
    seen_events = set()
    seen_cursors = set()
    for i, p in enumerate(responses):
        if not isinstance(p, dict) or p.get("success") is not True:
            raise NoGo("AUDIT_PROVIDER_RESPONSE_UNQUALIFIED")
        entries = p.get("result")
        page_info = p.get("result_info")
        if not isinstance(entries, list) or len(entries) > PAGE_LIMIT or not isinstance(page_info, dict):
            raise NoGo("AUDIT_PAGE_SHAPE_INVALID")
        count = page_info.get("count")
        if not isinstance(count, (int, str)) or str(count) != str(len(entries)):
            raise NoGo("AUDIT_PAGE_COUNT_MISMATCH")
        next_cursor = page_info.get("cursor")
        if not next_cursor and len(entries) >= PAGE_LIMIT:
            raise NoGo("AUDIT_LAST_PAGE_AT_LIMIT_UNQUALIFIED")
        if next_cursor not in (None, ""):
            if not isinstance(next_cursor, str) or not CURSOR.fullmatch(next_cursor):
                raise NoGo("AUDIT_CURSOR_UNSAFE")
            if next_cursor in seen_cursors:
                raise NoGo("AUDIT_CURSOR_REPEATED")
            seen_cursors.add(next_cursor)
        if bool(next_cursor) != (i < len(responses)-1):
            raise NoGo("AUDIT_HISTORY_TRUNCATED_OR_OVERSCANNED")
        for record in entries:
            event = parse_event(record)
            if event["event_id_sha256"] in seen_events:
                raise NoGo("AUDIT_EVENT_DUPLICATED")
            seen_events.add(event["event_id_sha256"])
            observed.append(event)
    if _events:
        return observed
    return summarize_events(observed)


def summarize_events(observed):
    creates = [e for e in observed if e["action"] == "create" and e["result"] == "success" and e["method"] == "POST"]
    destructive = [e for e in observed if e["action"] == "delete" and e["result"] == "success"]
    # Presence of a create event is *not* ownership admission. An independent
    # human must identify the Cloudflare actor by provider control-plane proof.
    historical_create_observed = len(creates) == 1 and not destructive
    return {
        "schema": "AXIOM_STEP1_D1_HISTORICAL_PROVIDER_PROVENANCE_READONLY_V1",
        "status": "HISTORICAL_PROVIDER_EVENT_OBSERVED_NOT_OWNER_ADMITTED" if historical_create_observed else "HISTORICAL_PROVENANCE_INCOMPLETE_NO_GO",
        "database_uuid": DATABASE,
        "pages_complete": True,
        "event_count": len(observed),
        "successful_create_events": len(creates),
        "successful_delete_events": len(destructive),
        "creation_actor_sha256": creates[0]["actor_id_sha256"] if historical_create_observed else None,
        "creation_event_sha256": creates[0]["event_id_sha256"] if historical_create_observed else None,
        "creation_event_date": creates[0]["date"] if historical_create_observed else None,
        "provider_methods_used": ["GET"],
        "raw_actors_persisted": False,
        "raw_audit_events_persisted": False,
        "customer_rows_read": 0,
        "database_mutations": 0,
        "source_reuse_authorized": False,
        "historical_ownership_qualified": False,
        "current_backup_qualified": False,
        "independent_restore_qualified": False,
        "least_privilege_qualified": False,
        "data_separation_qualified": False,
        "step_2_authorized": False,
        "release_authority": False,
    }


def inspect_windows(window_pages):
    """Review complete bounded time windows, rejecting contradictory overlaps."""
    if not isinstance(window_pages, list) or len(window_pages) != len(WINDOWS):
        raise NoGo("HISTORICAL_WINDOW_COVERAGE_INCOMPLETE")
    merged = {}
    for (start, end), pages in zip(WINDOWS, window_pages):
        for event in inspect_logs(pages, _events=True):
            if not start <= event["date"] < end:
                raise NoGo("AUDIT_EVENT_OUTSIDE_BOUNDED_PROVIDER_WINDOW")
            event_id = event["event_id_sha256"]
            if event_id in merged and merged[event_id] != event:
                raise NoGo("HISTORICAL_OVERLAP_EVENT_CONFLICT")
            merged[event_id] = event
    receipt = summarize_events(list(merged.values()))
    receipt.update({
        "audited_window_count": len(window_pages),
        "provider_retention_start": SINCE,
        "audited_end_exclusive": BEFORE,
        "audit_window_strategy": "BOUNDED_MONTHLY_ONE_DAY_OVERLAP",
        "raw_overlap_events_retained": 0,
        "historical_ownership_qualified": False,
        "source_reuse_authorized": False,
        "step_2_authorized": False,
        "release_authority": False,
    })
    return receipt


def get(path, token, opener):
    # Caller only ever constructs pinned metadata or audit URL with bounded
    # pagination. Never follow redirects (token must not leave Cloudflare).
    if path != "/d1/database/" + DATABASE:
        parsed = urllib.parse.urlsplit(path)
        if parsed.path != "/logs/audit" or parsed.fragment or not parsed.query:
            raise NoGo("PATH_NOT_ALLOWLISTED")
        pairs = urllib.parse.parse_qs(parsed.query, strict_parsing=True)
        allowed = [{"since": [a], "before": [b], "resource_id": [DATABASE],
                    "direction": ["asc"], "limit": [str(PAGE_LIMIT)]}
                   for a, b in WINDOWS]
        cursor = pairs.pop("cursor", None)
        if pairs not in allowed or (cursor is not None and (len(cursor) != 1 or not CURSOR.fullmatch(cursor[0]))):
            raise NoGo("AUDIT_QUERY_NOT_ALLOWLISTED")
    req = urllib.request.Request(ROOT+path, method="GET", headers={
        "Authorization": "Bearer " + token, "Accept": "application/json"})
    try:
        with opener.open(req, timeout=18) as response:
            if response.status != 200:
                raise NoGo("PROVIDER_NON_200")
            content = response.read(500001)
    except urllib.error.HTTPError as exc:
        raise NoGo("PROVIDER_HTTP_"+str(exc.code)) from None
    except (OSError, TimeoutError):
        raise NoGo("PROVIDER_NETWORK_UNAVAILABLE") from None
    if len(content) > 500000:
        raise NoGo("PROVIDER_OVERSIZE")
    try:
        return json.loads(content.decode("utf-8"))
    except (UnicodeError, ValueError):
        raise NoGo("PROVIDER_JSON_INVALID") from None


def run():
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not token or any(x in token for x in "\r\n"):
        raise NoGo("CLOUDFLARE_READ_SCOPED_TOKEN_MISSING")
    opener = urllib.request.build_opener(NeverRedirect())
    window_pages = []
    try:
        check_metadata(get("/d1/database/" + DATABASE, token, opener))
        for window_index, (since, before) in enumerate(WINDOWS):
            pages = []
            cursor = None
            seen = set()
            for _ in range(MAX_PAGES):
                args = {"since": since, "before": before, "resource_id": DATABASE,
                        "direction": "asc", "limit": str(PAGE_LIMIT)}
                if cursor:
                    args["cursor"] = cursor
                try:
                    response = get("/logs/audit?" + urllib.parse.urlencode(args), token, opener)
                except NoGo as exc:
                    raise NoGo("AUDIT_WINDOW_" + str(window_index+1) + "__" + str(exc)) from None
                pages.append(response)
                info = response.get("result_info") if isinstance(response, dict) else None
                cursor = info.get("cursor") if isinstance(info, dict) else None
                if not cursor:
                    break
                if not isinstance(cursor, str) or not CURSOR.fullmatch(cursor) or cursor in seen:
                    raise NoGo("AUDIT_CURSOR_REUSED_OR_INVALID")
                seen.add(cursor)
            # Each window MUST prove all pages before the next window starts.
            inspect_logs(pages, _events=True)
            window_pages.append(pages)
        result = inspect_windows(window_pages)
        code = 0 if result["status"] == "HISTORICAL_PROVIDER_EVENT_OBSERVED_NOT_OWNER_ADMITTED" else 2
    except NoGo as exc:
        result = {"schema": "AXIOM_STEP1_D1_HISTORICAL_PROVIDER_PROVENANCE_READONLY_V1",
                  "status": "INCOMPLETE_NO_GO", "reason_code": str(exc)[:96],
                  "database_uuid": DATABASE, "provider_methods_used": ["GET"],
                  "database_mutations": 0, "historical_ownership_qualified": False,
                  "source_reuse_authorized": False, "step_2_authorized": False,
                  "release_authority": False}
        code = 2
    # Never store raw logs, actor names, IPs, token IDs or customer records.
    raw = (json.dumps(result, indent=2, sort_keys=True) + "\n").encode()
    path = Path("axiom-step1-historical-provider-audit-readonly.json")
    path.write_bytes(raw)
    path.with_name(path.name + ".sha256").write_text(sha(raw) + "  " + path.name + "\n")
    print("AXIOM_STEP1_AUDIT=" + result["status"] + " WRITES=0")
    return code


if __name__ == "__main__":
    raise SystemExit(run())
