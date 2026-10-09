"""Streaming, non-promotable proxy analysis of methane forecasting windows.

A union of overlapping *label windows* is not an independently identified mine
incident. Prediction streaks are not confirmed operational alarm episodes.
No raw sensor values, sites, or timestamp series are emitted. The digest is a
reproducibility commitment, NOT proof of data provenance or authenticity.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any


class EventProxyAudit:
    """Summarize chronological forecast windows with constant-size state."""

    def __init__(self) -> None:
        self._digest = sha256(b'musitu.axiom.proxy_window_audit.v1\n')
        self._last_time: datetime | None = None
        self._group_end: datetime | None = None
        self._group_detected = False
        self._group_hard_detected = False
        self._false_streak_open = False
        self._sealed = False
        self.window_count = 0
        self.positive_windows = 0
        self.false_alert_windows = 0
        self.false_alert_streaks = 0
        self.group_count = 0
        self.group_detected = 0
        self.group_hard_detected = 0
        self.hard_warnings = 0

    def observe(self, *, feature_time: datetime, label_window_end: datetime,
                label: bool, hard_observed: bool, predicted_alert: bool) -> None:
        if self._sealed:
            raise ValueError('proxy_audit_already_finalized')
        if any(type(x) is not bool for x in (label, hard_observed, predicted_alert)):
            raise ValueError('proxy_audit_boolean_contract_invalid')
        if (not isinstance(feature_time, datetime) or not isinstance(label_window_end, datetime)
                or feature_time.utcoffset() is None or label_window_end.utcoffset() is None):
            raise ValueError('proxy_audit_timezone_required')
        feature_time = feature_time.astimezone(timezone.utc)
        label_window_end = label_window_end.astimezone(timezone.utc)
        if self._last_time is not None and feature_time <= self._last_time:
            raise ValueError('proxy_audit_time_order_invalid')
        if label_window_end - feature_time != timedelta(seconds=360):
            raise ValueError('proxy_audit_horizon_contract_invalid')
        if hard_observed and not predicted_alert:
            raise ValueError('proxy_audit_hard_warning_suppressed')

        # Overlapping projected future-label windows form *proxies* only.
        if label:
            projected_start = feature_time + timedelta(seconds=180)
            if self._group_end is None or projected_start > self._group_end:
                self._close_group()
                self.group_count += 1
                self._group_end = label_window_end
            else:
                self._group_end = max(self._group_end, label_window_end)
            self._group_detected |= predicted_alert
            self._group_hard_detected |= hard_observed
            self.positive_windows += 1

        false_alert = not label and predicted_alert
        consecutive = self._last_time is not None and feature_time - self._last_time == timedelta(seconds=30)
        if false_alert:
            self.false_alert_windows += 1
            if not self._false_streak_open or not consecutive:
                self.false_alert_streaks += 1
        self._false_streak_open = bool(false_alert)
        self.hard_warnings += int(hard_observed)
        self.window_count += 1
        # Digest binds the chronological decisions, not private sensor values.
        line = f'{feature_time.isoformat()}|{int(label)}|{int(hard_observed)}|{int(predicted_alert)}\n'
        self._digest.update(line.encode('ascii'))
        self._last_time = feature_time

    def _close_group(self) -> None:
        if self._group_end is not None:
            self.group_detected += int(self._group_detected)
            self.group_hard_detected += int(self._group_hard_detected)
            self._group_detected = False
            self._group_hard_detected = False
            self._group_end = None

    def finalize(self) -> dict[str, Any]:
        if self._sealed:
            raise ValueError('proxy_audit_already_finalized')
        if not self.window_count:
            raise ValueError('proxy_audit_no_windows')
        self._close_group()
        self._sealed = True
        return {
            'schema': 'musitu.axiom.external_window_proxy_audit.v1',
            'window_count': self.window_count,
            'positive_label_windows': self.positive_windows,
            'hard_observed_warning_windows': self.hard_warnings,
            'false_alert_windows': self.false_alert_windows,
            'false_alert_prediction_streaks': self.false_alert_streaks,
            'positive_window_overlap_groups': self.group_count,
            'proxy_groups_detected': self.group_detected,
            'proxy_groups_missed': self.group_count - self.group_detected,
            'hard_warning_proxy_groups_detected': self.group_hard_detected,
            'overlap_groups_are_unique_incidents': False,
            'false_alert_streaks_are_operational_alarm_events': False,
            'audit_trace_sha256': self._digest.hexdigest(),
            'trace_digest_proves_source_authenticity': False,
            'independent_validation': False,
            'production_admission': False,
        }
