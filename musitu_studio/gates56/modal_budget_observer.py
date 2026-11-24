"""Read-only Modal Workspace usage observation; NEVER an admission certificate.

Modal's documented Workspace.billing.summary() returns authenticated billing
usage, NOT the provider-enforced Workspace/Environment budget configuration.
No public renderer may use this observation to construct VerifiedProviderCap.
Source-only, no deployment, no provider request unless explicitly invoked.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING
import importlib
import os
import time

from .ledger import GateClosed


@dataclass(frozen=True)
class ModalUsageReadback:
    """Authenticated, read-only billing observation; insufficient for dispatch."""
    workspace: str
    billing_cycle: str
    metered_cents: int
    billed_cents: int
    local_observation_unix: int
    hard_cap_verified: bool = False
    provider_remaining_cents: None = None
    rendering_authorized: bool = False


class ModalBudgetObserver:
    """Uses genuine Modal SDK context, but deliberately cannot open Gate 5.

    A separate independently authenticated PROVIDER ENFORCED BUDGET control
    reader must be reviewed before any cap guard can return a VerifiedProviderCap.
    Billing usage, owner-entered limits and screenshot text cannot replace it.
    """

    def __init__(self, *, expected_workspace, sdk=None, credentials=None, now=None):
        if (not isinstance(expected_workspace, str) or
                not 1 <= len(expected_workspace) <= 128 or
                expected_workspace.strip() != expected_workspace):
            raise ValueError("INVALID_EXPECTED_MODAL_WORKSPACE")
        self.expected_workspace = expected_workspace
        self.sdk = sdk
        self.credentials = credentials if credentials is not None else os.environ
        self.now = now or (lambda: int(time.time()))

    def _require_explicit_auth(self):
        creds = self.credentials
        try:
            token_id = creds.get("MODAL_TOKEN_ID", "")
            token_secret = creds.get("MODAL_TOKEN_SECRET", "")
        except Exception:
            raise GateClosed("MODAL_EXPLICIT_AUTH_REQUIRED") from None
        if (not isinstance(token_id, str) or not isinstance(token_secret, str)
                or not token_id.startswith("ak-") or not token_secret.startswith("as-")
                or len(token_id) < 11 or len(token_secret) < 11):
            raise GateClosed("MODAL_EXPLICIT_AUTH_REQUIRED")

    @staticmethod
    def _ceil_cents(amount):
        # SDK contract: billing summary monetary fields are decimal.Decimal.
        if (type(amount) is not Decimal or not amount.is_finite() or amount < 0):
            raise GateClosed("MODAL_USAGE_UNVERIFIABLE")
        cents = (amount * 100).to_integral_value(rounding=ROUND_CEILING)
        if cents > 10**14:
            raise GateClosed("MODAL_USAGE_UNVERIFIABLE")
        return int(cents)

    def read_usage(self):
        """Issue authenticated read-only SDK request; no budget or dispatch claim.

        No provider writes or Modal function calls are made. The reported cost
        can lag usage and is NOT an independently verified remaining balance.
        """
        self._require_explicit_auth()
        try:
            sdk = self.sdk if self.sdk is not None else importlib.import_module("modal")
            workspace = sdk.Workspace.from_context()
            name = workspace.name
            workspace_name = name() if callable(name) else name
        except Exception:
            # Never leak SDK exception text: credentials may be embedded in it.
            raise GateClosed("MODAL_AUTHENTICATED_READBACK_UNAVAILABLE") from None
        if workspace_name != self.expected_workspace:
            raise GateClosed("MODAL_WORKSPACE_IDENTITY_MISMATCH")
        try:
            usage = workspace.billing.summary(cycle="this month")
        except Exception:
            raise GateClosed("MODAL_AUTHENTICATED_READBACK_UNAVAILABLE") from None
        try:
            metered = self._ceil_cents(usage.metered_cost)
            billed = self._ceil_cents(usage.billed_cost)
        except (AttributeError, TypeError, ValueError):
            raise GateClosed("MODAL_USAGE_UNVERIFIABLE") from None
        try:
            observed = int(self.now())
        except Exception:
            raise GateClosed("MODAL_LOCAL_CLOCK_UNAVAILABLE") from None
        if observed <= 0:
            raise GateClosed("MODAL_LOCAL_CLOCK_UNAVAILABLE")
        return ModalUsageReadback(
            workspace=workspace_name, billing_cycle="this month",
            metered_cents=metered, billed_cents=billed,
            local_observation_unix=observed
        )

    def __call__(self):
        """A billing observer cannot become Studio's chargeable provider_guard."""
        raise GateClosed("MODAL_HARD_CAP_NOT_ATTESTED")
