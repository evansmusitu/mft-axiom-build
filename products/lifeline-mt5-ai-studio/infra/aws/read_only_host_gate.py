"""LIFELINE read-only AWS EC2 Windows host acceptance (never provisions).

Runs in an OWNER-authenticated AWS CLI session, not ChatGPT or GitHub Actions.
No IAM changes, launches, credentials, billing writes, or secrets in output.
"""
from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timedelta, timezone
from typing import Callable

REGION = "eu-north-1"
WIN_AMI = re.compile(r"^Windows_Server-2022-English-Full-Base-\d{4}\.\d{2}\.\d{2}$")
CLI = ["aws"]


class QualificationError(RuntimeError):
    pass


def _invoke(args: list[str]) -> dict:
    # Built-in exact, static read-only commands, no shell, no caller paths.
    try:
        done = subprocess.run(CLI + args + ["--output", "json", "--no-cli-pager"],
                              stdin=subprocess.DEVNULL, capture_output=True, text=True,
                              timeout=28, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise QualificationError("AWS_CLI_UNAVAILABLE") from None
    if done.returncode:
        # AWS CLI stderr can contain account data; never emit it.
        raise QualificationError("AWS_READ_DENIED_OR_UNAVAILABLE")
    if len(done.stdout) > 256_000:
        raise QualificationError("AWS_RESPONSE_TOO_LARGE")
    try:
        data = json.loads(done.stdout)
    except ValueError:
        raise QualificationError("AWS_INVALID_RESPONSE") from None
    if type(data) is not dict:
        raise QualificationError("AWS_INVALID_RESPONSE")
    return data


def qualify(call: Callable[[list[str]], dict] = _invoke) -> dict:
    result = {"schema": "lifeline.aws_ec2.windows_readonly_gate.v1",
              "aws_region": REGION, "account_plan_free_active": False,
              "credit_buffer_present": False, "t3_small_eligible": False,
              "official_windows_ami_eligible": False, "no_existing_ec2_instances": False,
              "live_host_connected": False, "windows_mcp_paired": False,
              "windows_price_verified": False, "ssm_access_verified": False,
              "firewall_verified": False, "public_trading_enabled": False,
              "billing_upgrade_authorized": False, "deployment_authorized": False}
    p = call(["freetier", "get-account-plan-state", "--region", "us-east-1"])
    money = p.get("accountPlanRemainingCredits")
    try:
        credit = float(money["amount"]) if type(money) is dict and money.get("unit") == "USD" else 0
    except (ValueError, TypeError, KeyError):
        credit = 0
    result["account_plan_free_active"] = p.get("accountPlanType") == "FREE" and p.get("accountPlanStatus") == "ACTIVE"
    result["credit_buffer_present"] = 40 <= credit <= 1_000
    expiry = p.get("accountPlanExpirationDate")
    expiry_valid = False
    min_runway = False
    if type(expiry) is str:
        try:
            parsed = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
            if parsed.tzinfo is not None:
                expiry_utc = parsed.astimezone(timezone.utc)
                now_utc = datetime.now(timezone.utc)
                expiry_valid = expiry_utc > now_utc
                min_runway = expiry_utc >= now_utc + timedelta(days=30)
        except ValueError:
            pass
    result["account_not_expired"] = expiry_valid
    result["minimum_30day_plan_runway"] = min_runway
    types = call(["ec2", "describe-instance-types", "--region", REGION,
                  "--instance-types", "t3.small"])
    found = types.get("InstanceTypes", [])
    result["t3_small_eligible"] = (
        type(found) is list and len(found) == 1 and type(found[0]) is dict
        and found[0].get("InstanceType") == "t3.small"
        and found[0].get("FreeTierEligible") is True
        and (found[0].get("MemoryInfo") or {}).get("SizeInMiB", 0) >= 2048)
    offerings = call(["ec2", "describe-instance-type-offerings", "--region", REGION,
                      "--location-type", "region", "--filters",
                      "Name=instance-type,Values=t3.small"])
    offered = offerings.get("InstanceTypeOfferings")
    result["t3_small_region_offered"] = (
        not offerings.get("NextToken")
        and type(offered) is list and any(
            type(o) is dict and o.get("InstanceType") == "t3.small"
            and o.get("LocationType") == "region" and o.get("Location") == REGION
            for o in offered))
    images = call(["ec2", "describe-images", "--region", REGION, "--owners", "amazon",
                   "--filters", "Name=name,Values=Windows_Server-2022-English-Full-Base-*",
                   "Name=state,Values=available"])
    rows = images.get("Images", [])
    result["official_windows_ami_eligible"] = (
        type(rows) is list and any(
            type(i) is dict and type(i.get("Name")) is str and WIN_AMI.fullmatch(i["Name"])
            and i.get("Architecture") == "x86_64" and i.get("State") == "available"
            and i.get("Platform") == "windows" and i.get("FreeTierEligible") is True
            and type(i.get("ImageId")) is str and i["ImageId"].startswith("ami-")
            for i in rows))
    live = call(["ec2", "describe-instances", "--region", REGION])
    reservations = live.get("Reservations", None)
    # Refuse incomplete pagination. Even an empty initial page is not a
    # complete regional inventory if the API supplies a continuation token.
    result["no_existing_ec2_instances"] = (
        not live.get("NextToken")
        and type(reservations) is list
        and all(type(r) is dict and type(r.get("Instances")) is list
                and not r["Instances"] for r in reservations))
    result["candidate_qualifies_for_manual_review"] = all(
        result[k] for k in ("account_plan_free_active", "credit_buffer_present",
        "account_not_expired", "minimum_30day_plan_runway", "t3_small_eligible",
        "t3_small_region_offered", "official_windows_ami_eligible",
        "no_existing_ec2_instances"))
    # No status can ever be promoted to deployment approval here. A separate
    # approved, audited host build + SSM/firewall/price gate is mandatory.
    return result


def main() -> int:
    try:
        result = qualify()
    except QualificationError as exc:
        print(json.dumps({"schema": "lifeline.aws_ec2.windows_readonly_gate.v1",
                          "candidate_qualifies_for_manual_review": False,
                          "deployment_authorized": False, "reason": str(exc)}, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0 if result["candidate_qualifies_for_manual_review"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
