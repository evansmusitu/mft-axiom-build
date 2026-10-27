from __future__ import annotations

from datetime import datetime
from math import isfinite
from typing import Any, Iterable

from .core import CanonicalEnvelope


MINING_TELEMETRY_SENSORS=(
    "AN311","AN422","AN423",
    "TP1721","RH1722","BA1723","TP1711","RH1712","BA1713",
    "MM252","MM261","MM262","MM263","MM264","MM256","MM211","CM861",
    "CR863","P_864","TC862","WM868",
    "AMP1_IR","AMP2_IR","DMP3_IR","DMP4_IR","AMP5_IR","F_SIDE","V",
)
_STATE_SENSORS=("F_SIDE",)
_NUMERIC_SENSORS=tuple(
    sensor for sensor in MINING_TELEMETRY_SENSORS if sensor not in _STATE_SENSORS
)
_REQUIRED=("event_time",)+MINING_TELEMETRY_SENSORS
_ALLOWED=set(_REQUIRED)


def normalize_mining_telemetry_rows(rows: Iterable[dict[str,Any]]) -> CanonicalEnvelope:
    normalized=[]
    for raw in rows:
        missing=[name for name in _REQUIRED if name not in raw]
        if missing:
            raise ValueError("telemetry_missing_fields:"+",".join(missing))
        unknown=sorted(str(key) for key in raw if key not in _ALLOWED)
        if unknown:
            raise ValueError("telemetry_unknown_fields:"+",".join(unknown))

        event_time=str(raw["event_time"]).strip()
        if not event_time:
            raise ValueError("telemetry_event_time_required")
        try:
            parsed=datetime.fromisoformat(event_time.replace("Z","+00:00"))
        except ValueError:
            raise ValueError("telemetry_event_time_invalid") from None
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError("telemetry_event_time_timezone_required")

        record={"event_time":event_time}
        for sensor in _NUMERIC_SENSORS:
            try:
                value=float(raw[sensor])
            except (TypeError,ValueError):
                raise ValueError(f"telemetry_value_invalid:{sensor}") from None
            if not isfinite(value):
                raise ValueError(f"telemetry_value_not_finite:{sensor}")
            # Real mine telemetry contains documented outliers and values outside
            # nominal sensor ranges. Preserve them rather than silently clipping
            # source evidence at the interoperability boundary.
            record[sensor]=value

        for sensor in _STATE_SENSORS:
            value=str(raw[sensor]).strip()
            if not value:
                raise ValueError(f"telemetry_state_required:{sensor}")
            record[sensor]=value
        normalized.append(record)

    if not normalized:
        raise ValueError("telemetry_rows_required")
    return CanonicalEnvelope(
        contract="musitu.connect.mining.telemetry.v1",
        domain="mining_telemetry",
        records=tuple(normalized),
        source="mining-telemetry-adapter",
        provenance="normalized",
    )
