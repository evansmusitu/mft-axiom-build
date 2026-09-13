#!/usr/bin/env python3
"""V9.5 atomic provider promotion wrapper.

Runs the existing V9.4 exact-snapshot promotion and refuses to call the
promotion successful until the public edge returns a rights-consistent,
server-attested Market Context through the newly bound provider path.
Any post-promotion probe failure invokes the V9.4 exact rollback using the
same Promotion object and its in-memory pre-mutation snapshot.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HEX64 = re.compile(r"^[0-9a-f]{64}$")
MAX_RESPONSE_BYTES = 524288
DEFAULT_ATTEMPTS = 3
DEFAULT_RETRY_SECONDS = 1.0


def stable(value):
    if isinstance(value, list):
        return [stable(x) for x in value]
    if isinstance(value, dict):
        return {k: stable(value[k]) for k in sorted(value)}
    return value


def stable_hash(value):
    if isinstance(value, str):
        raw = value.encode("utf-8")
    else:
        raw = json.dumps(stable(value), separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def need(name):
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError("required atomic-promotion config missing: " + name)
    return value


def bool_value(name):
    value = need(name).lower()
    if value == "true":
        return True
    if value == "false":
        return False
    raise RuntimeError("invalid boolean config: " + name)


def js_iso(name):
    raw = need(name)
    try:
        text = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone(timezone.utc)
    except Exception as exc:
        raise RuntimeError("invalid timestamp config: " + name) from exc
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def expected_rights():
    for gate in ("TWELVE_DATA_LICENSE_AUTHORIZED", "TWELVE_DATA_REDISTRIBUTION_AUTHORIZED", "TWELVE_DATA_EXTERNAL_API_AUTHORIZED"):
        if bool_value(gate) is not True:
            raise RuntimeError("provider rights authorization drift: " + gate)
    market_class = need("FMI_MARKET_PROBE_MARKET_CLASS").upper()
    allowed = {x.strip().upper() for x in need("TWELVE_DATA_ALLOWED_MARKET_CLASSES").split(",") if x.strip()}
    if market_class not in allowed:
        raise RuntimeError("deployment probe market class is outside provider rights")
    try:
        retention = int(need("TWELVE_DATA_MAX_RETENTION_SECONDS"))
    except ValueError as exc:
        raise RuntimeError("invalid retention config") from exc
    attr_required = bool_value("TWELVE_DATA_ATTRIBUTION_REQUIRED")
    attr_text = need("TWELVE_DATA_ATTRIBUTION_TEXT") if attr_required else None
    attr_url = need("TWELVE_DATA_ATTRIBUTION_URL") if attr_required else None
    rights = {
        "schema": "musitu.fmi.provider-rights.v1",
        "provider": "Twelve Data",
        "rights_reference_hash": stable_hash(need("TWELVE_DATA_RIGHTS_REFERENCE")),
        "license_authorized": True,
        "redistribution_authorized": True,
        "external_api_authorized": True,
        "market_class": market_class,
        "max_retention_seconds": retention,
        "effective_at": js_iso("TWELVE_DATA_RIGHTS_EFFECTIVE_AT"),
        "expires_at": js_iso("TWELVE_DATA_RIGHTS_EXPIRES_AT"),
        "attribution": {"required": attr_required, "text": attr_text, "url": attr_url},
        "raw_provider_data_persisted": False,
    }
    return rights, stable_hash(rights)


def _header(headers, name):
    if hasattr(headers, "get"):
        return headers.get(name) or headers.get(name.lower())
    return None


def validate_market_context(status, headers, raw, expected_symbol, expected_horizon):
    if status != 200:
        raise RuntimeError(f"functional Market Context HTTP {status}")
    if len(raw) > MAX_RESPONSE_BYTES:
        raise RuntimeError("functional Market Context response too large")
    try:
        body = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise RuntimeError("functional Market Context invalid JSON") from exc
    if not isinstance(body, dict) or body.get("ok") is not True:
        raise RuntimeError("functional Market Context did not return ok=true")
    if _header(headers, "cache-control") != "no-store":
        raise RuntimeError("functional Market Context cache-control is not no-store")
    if body.get("provider") != "Twelve Data":
        raise RuntimeError("functional Market Context provider mismatch")
    if str(body.get("symbol", "")).upper() != expected_symbol.upper():
        raise RuntimeError("functional Market Context symbol mismatch")
    if body.get("horizon") != expected_horizon:
        raise RuntimeError("functional Market Context horizon mismatch")
    returns = body.get("returns")
    if not isinstance(returns, list) or not 5 <= len(returns) <= 256:
        raise RuntimeError("functional Market Context returns count invalid")
    if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(float(x)) for x in returns):
        raise RuntimeError("functional Market Context returns invalid")
    for key in ("context_hash", "provider_source_hash", "rights_hash"):
        if not HEX64.fullmatch(str(body.get(key, ""))):
            raise RuntimeError("functional Market Context invalid " + key)
    if body.get("provider_health") != "HEALTHY":
        raise RuntimeError("functional Market Context provider not healthy")
    if body.get("provider_state") != "BOUND" or body.get("manual_fallback") is not False:
        raise RuntimeError("functional Market Context binding state mismatch")
    routing = body.get("routing") or {}
    if routing.get("selected_provider") != "Twelve Data" or routing.get("selected_role") != "PRIMARY":
        raise RuntimeError("functional Market Context routing mismatch")
    if routing.get("fallback_used") is not False:
        raise RuntimeError("functional Market Context unexpectedly used fallback")
    if routing.get("bearer_forwarded_to_provider") is not False or routing.get("customer_identity_forwarded_to_provider") is not False:
        raise RuntimeError("functional Market Context identity isolation failed")
    router = body.get("router") or {}
    if router.get("schema") != "musitu.fmi.market-data-router.v1":
        raise RuntimeError("functional Market Context router schema mismatch")
    att = body.get("attestation") or {}
    if att.get("integrity") != "SERVER_ATTESTED":
        raise RuntimeError("functional Market Context is not server-attested")
    if not str(att.get("id", "")).startswith("mca_"):
        raise RuntimeError("functional Market Context attestation id invalid")
    if not HEX64.fullmatch(str(att.get("analysis_input_hash", ""))):
        raise RuntimeError("functional Market Context attestation input hash invalid")
    try:
        exp_text = str(att.get("expires_at", ""))
        exp = datetime.fromisoformat(exp_text[:-1] + "+00:00" if exp_text.endswith("Z") else exp_text)
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp.astimezone(timezone.utc) <= datetime.now(timezone.utc):
            raise RuntimeError("functional Market Context attestation expired")
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError("functional Market Context attestation expiry invalid") from exc
    expected, expected_hash = expected_rights()
    if body.get("rights") != expected:
        raise RuntimeError("functional Market Context rights object mismatch")
    if body.get("rights_hash") != expected_hash:
        raise RuntimeError("functional Market Context rights hash mismatch")
    raw_text = raw.decode("utf-8", "replace")
    forbidden = [need("TWELVE_DATA_RIGHTS_REFERENCE"), need("TWELVE_DATA_API_KEY"), need("FMI_DEPLOYMENT_PROBE_API_KEY")]
    if any(secret and secret in raw_text for secret in forbidden):
        raise RuntimeError("functional Market Context leaked a private value")
    authority = body.get("authority") or {}
    if authority.get("paper_shadow_only") is not True or authority.get("live_trading") is not False or authority.get("trade_execution") is not False:
        raise RuntimeError("functional Market Context authority drift")
    return body


def functional_probe(opener=urllib.request.urlopen, sleep=time.sleep):
    base = need("FMI_PUBLIC_EDGE_URL").rstrip("/")
    symbol = need("FMI_MARKET_PROBE_SYMBOL").upper()
    horizon = need("FMI_MARKET_PROBE_HORIZON").upper()
    api_key = need("FMI_DEPLOYMENT_PROBE_API_KEY")
    provider_key = need("TWELVE_DATA_API_KEY")
    if not re.fullmatch(r"fmi_[0-9A-Za-z_-]{32,128}", api_key):
        raise RuntimeError("deployment probe API key format invalid")
    if api_key == provider_key:
        raise RuntimeError("deployment probe API key must be distinct from provider key")
    if not base.lower().startswith("https://"):
        raise RuntimeError("public edge probe URL must use HTTPS")
    query = urllib.parse.urlencode({"symbol": symbol, "horizon": horizon})
    request = urllib.request.Request(
        base + "/v1/market/context?" + query,
        headers={
            "Authorization": "Bearer " + api_key,
            "Accept": "application/json",
            "User-Agent": "MUSITU-FMI-V9.5-AtomicPromotionProbe/1.0",
        },
        method="GET",
    )
    attempts = int(os.getenv("FMI_MARKET_PROBE_ATTEMPTS", str(DEFAULT_ATTEMPTS)))
    retry = float(os.getenv("FMI_MARKET_PROBE_RETRY_SECONDS", str(DEFAULT_RETRY_SECONDS)))
    if not 1 <= attempts <= 5:
        raise RuntimeError("invalid functional probe attempt count")
    errors = []
    for index in range(attempts):
        try:
            with opener(request, timeout=45) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                return validate_market_context(response.status, response.headers, raw, symbol, horizon)
        except urllib.error.HTTPError as exc:
            errors.append(f"HTTP {exc.code}")
        except Exception as exc:
            errors.append(type(exc).__name__ + ":" + str(exc))
        if index + 1 < attempts:
            sleep(retry)
    raise RuntimeError("functional Market Context probe failed: " + " | ".join(errors[-3:]))


def load_v94_module():
    path = pathlib.Path(__file__).with_name("fmi_v9_4_provider_promote.py")
    spec = importlib.util.spec_from_file_location("fmi_v9_4_provider_promote", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load V9.4 promotion authority")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AtomicPromotion:
    def __init__(self, promotion, output, probe=functional_probe):
        self.promotion = promotion
        self.output = pathlib.Path(output)
        self.probe = probe

    def run(self):
        stage_output = self.promotion.output
        source_evidence = self.promotion.promote()
        try:
            context = self.probe()
        except Exception:
            self.promotion.rollback()
            raise
        evidence = {
            "schema": "musitu.fmi.v9-5-atomic-provider-promotion.v1",
            "status": "PROMOTED_AND_FUNCTIONALLY_VERIFIED",
            "mutation_performed": True,
            "source_binding_stage_status": source_evidence.get("status"),
            "operations": list(source_evidence.get("operations") or []),
            "functional_market_context_probe": "PASS",
            "provider": context.get("provider"),
            "symbol": context.get("symbol"),
            "horizon": context.get("horizon"),
            "context_hash": context.get("context_hash"),
            "provider_source_hash": context.get("provider_source_hash"),
            "rights_hash": context.get("rights_hash"),
            "rights_reference_hash": (context.get("rights") or {}).get("rights_reference_hash"),
            "attestation_integrity": (context.get("attestation") or {}).get("integrity"),
            "attestation_id": (context.get("attestation") or {}).get("id"),
            "secret_values_logged": False,
            "live_trading": False,
            "trade_execution": False,
            "production_model_authority": False,
        }
        self.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        try:
            if pathlib.Path(stage_output) != self.output and pathlib.Path(stage_output).exists():
                pathlib.Path(stage_output).unlink()
        except Exception:
            pass
        return evidence


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload-root", required=True)
    parser.add_argument("--output", default="fmi-v9-5-atomic-provider-promotion-evidence.json")
    args = parser.parse_args()
    v94 = load_v94_module()
    stage = pathlib.Path(args.output).with_suffix(".source-binding-stage.json")
    promotion = v94.Promotion(v94.CF(), args.payload_root, stage)
    try:
        evidence = AtomicPromotion(promotion, args.output).run()
        print(json.dumps(evidence, sort_keys=True))
    except Exception as exc:
        print("FAIL " + type(exc).__name__ + " " + str(exc), file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
