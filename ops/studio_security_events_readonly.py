"""Studio-only Cloudflare Security Events Ray correlation (read-only).

Never log or persist IPs, UAs, auth values, raw response bodies or rule expressions.
"""
import json, os, pathlib, re, urllib.request, urllib.error
from datetime import datetime, timezone
CF_API = "https://api.cloudflare.com/client/v4"
ACCOUNT = "93f395f5121954671f92fffa453d6b61"
RAYS = ("a4c53d53abad646a", "a4c53d5428111400")
SINCE = "2026-10-18T05:44:30Z"
UNTIL = "2026-10-18T05:47:00Z"
OUTPUT = pathlib.Path("studio-security-events-ray-correlation-readonly.json")

def query_payload(zone_id, ray_id):
    if not re.fullmatch(r"[a-f0-9]{16,32}", ray_id):
        raise ValueError("ray ID must be a hex prefix without colo suffix")
    return {
        "query": """query StudioOneRay($zoneTag: string, $filter: FirewallEventsAdaptiveFilter_InputObject) {
          viewer { zones(filter: {zoneTag: $zoneTag}) {
            firewallEventsAdaptive(filter: $filter, limit: 6, orderBy: [datetime_DESC]) {
              rayName action source ruleId datetime
            }
          }}
        }""",
        "variables": {"zoneTag": zone_id, "filter": {
            "rayName": ray_id, "datetime_geq": SINCE, "datetime_leq": UNTIL
        }}
    }

def summarize_response(result, ray_id):
    outcome = {"ray_id": ray_id, "query_usable": False, "matching_event_count": 0,
               "matching_events": [], "outcome": "analytics_unavailable_or_denied"}
    if not isinstance(result, dict) or result.get("errors"):
        return outcome
    zones = (((result.get("data") or {}).get("viewer") or {}).get("zones") or [])
    if len(zones) != 1 or not isinstance(zones[0], dict):
        return outcome
    events = zones[0].get("firewallEventsAdaptive")
    if not isinstance(events, list):
        return outcome
    outcome["query_usable"] = True
    for event in events:
        if not isinstance(event, dict) or str(event.get("rayName", "")).lower() != ray_id:
            continue
        safe = {}
        for in_name, out_name in (("source", "source"), ("action", "action")):
            val = event.get(in_name)
            safe[out_name] = val if isinstance(val, str) and re.fullmatch(r"[a-z_-]{1,40}", val) else None
        rule_id = event.get("ruleId")
        safe["rule_id"] = rule_id if isinstance(rule_id, str) and re.fullmatch(r"[a-fA-F0-9-]{12,64}", rule_id) else None
        ts = event.get("datetime")
        safe["event_time_utc"] = ts if isinstance(ts, str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z", ts) else None
        outcome["matching_events"].append(safe)
    outcome["matching_event_count"] = len(outcome["matching_events"])
    outcome["outcome"] = ("exact_ray_events_returned" if outcome["matching_event_count"]
                          else "no_event_returned_sampling_or_coverage_unknown")
    return outcome

def request_json(url, token, post_json=None):
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    if post_json is None:
        req = urllib.request.Request(url, headers=headers, method="GET")
    else:
        headers["Content-Type"] = "application/json"
        data = json.dumps(post_json, separators=(",", ":")).encode()
        req = urllib.request.Request(url, headers=headers, method="POST", data=data)
    try:
        with urllib.request.urlopen(req, timeout=18) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except (OSError, ValueError):
        return 0, None

def verified_zone(token):
    code, payload = request_json(CF_API + "/zones?name=mftintelligence.com&status=active", token)
    if code != 200 or not isinstance(payload, dict) or not payload.get("success"):
        return code, None
    zones = payload.get("result") or []
    matched = [z for z in zones if isinstance(z, dict) and z.get("name") == "mftintelligence.com"
               and (z.get("account") or {}).get("id") == ACCOUNT]
    if len(matched) != 1 or not re.fullmatch(r"[a-f0-9]{32}", str(matched[0].get("id", ""))):
        return code, None
    return code, matched[0]["id"]

def main():
    report = {"schema": "musitu.studio.cloudflare-ray-correlation.v1",
              "checked_at_utc": datetime.now(timezone.utc).isoformat(),
              "read_only": True, "cloudflare_configuration_mutated": False,
              "window_utc": {"geq": SINCE, "leq": UNTIL},
              "scoped_host": "studio.mftintelligence.com",
              "query_http_statuses": [], "zone_verified": False,
              "events": [], "overall": "not_queried"}
    token = os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CF_API_TOKEN")
    if token:
        code, zone = verified_zone(token)
        report["zone_lookup_http_status"] = code
        if zone:
            report["zone_verified"] = True
            for ray in RAYS:
                status, response = request_json(CF_API + "/graphql", token, query_payload(zone, ray))
                report["query_http_statuses"].append(status)
                report["events"].append(summarize_response(response if status == 200 else None, ray))
            report["overall"] = ("ray_correlated" if any(e["matching_event_count"] for e in report["events"])
                                 else "no_correlated_events_or_missing_analytics_permission")
        else:
            report["overall"] = "zone_unverified_no_query"
    else:
        report["overall"] = "credentials_not_available_to_runner"
    OUTPUT.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print("STUDIO_SECURITY_EVENTS_RAY_CORRELATION=" + json.dumps(report, sort_keys=True))

if __name__ == "__main__":
    main()
