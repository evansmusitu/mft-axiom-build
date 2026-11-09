"""Deterministic, no-broker P&L statistics for LIFELINE private research.

Exact Decimal arithmetic; no predictive trading signal, market order or source account.
"""
from __future__ import annotations

from decimal import Decimal
import re

AMOUNT = re.compile(r"^-?(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$")
MAX_TRADES = 250


def summarize(pnl: list[str]) -> dict:
    if not isinstance(pnl, list) or not 1 <= len(pnl) <= MAX_TRADES:
        raise ValueError("pnl must be a nonempty list with at most 250 amounts")
    amounts = []
    for raw in pnl:
        if not isinstance(raw,str) or not AMOUNT.fullmatch(raw):
            raise ValueError("each amount must be a decimal string with up to two places")
        amounts.append(Decimal(raw))
    wins = sum(x>0 for x in amounts)
    losses = sum(x<0 for x in amounts)
    gross_profit = sum((x for x in amounts if x>0),Decimal("0"))
    gross_loss = -sum((x for x in amounts if x<0),Decimal("0"))
    running = Decimal("0")
    peak = Decimal("0")
    drawdown = Decimal("0")
    for amount in amounts:
        running += amount
        peak = max(peak,running)
        drawdown = max(drawdown,peak-running)
    def cents(x):
        return f"{x.quantize(Decimal('0.01')):.2f}"
    ratio = None if gross_loss == 0 else str((gross_profit/gross_loss).quantize(Decimal("0.0001")))
    return {
        "schema":"lifeline.research.pnl_summary.v1",
        "trade_count":len(amounts),
        "wins":wins, "losses":losses,
        "break_even":len(amounts)-wins-losses,
        "gross_profit":cents(gross_profit),
        "gross_loss":cents(gross_loss),
        "net_pnl":cents(sum(amounts)),
        "win_rate_percent":str((Decimal(wins)*100/Decimal(len(amounts))).quantize(Decimal("0.01"))),
        "profit_factor":ratio,
        "max_drawdown":cents(drawdown),
        "currency":"UNSPECIFIED",
        "source":"USER_SUPPLIED_PNL_NOT_VERIFIED_HISTORY",
        "trading_enabled":False,
        "broker_connected":False,
    }
