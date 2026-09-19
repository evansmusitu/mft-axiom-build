from __future__ import annotations

import ast
import hashlib
import hmac
import json
import math
import re
import secrets
import time
from urllib.parse import urlsplit


RISK_CLASSES = ("S0", "S1", "S2", "S3", "S4", "S5")


class CandidateError(RuntimeError):
    """Base error for the provider-independent recovery candidate."""


class AuthenticationError(CandidateError):
    pass


class AuthorizationError(CandidateError):
    pass


class TenantIsolationError(AuthorizationError):
    pass


class ConflictError(CandidateError):
    pass


class IntegrityError(CandidateError):
    pass


class TransientAdapterError(CandidateError):
    pass


class PermanentAdapterError(CandidateError):
    pass


def canonical_json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_json(value) -> str:
    return sha256_text(canonical_json(value))


def hmac_sha256(key: bytes, value: str) -> str:
    return hmac.new(key, value.encode("utf-8"), hashlib.sha256).hexdigest()


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(16)}"


def now_ms() -> int:
    return int(time.time() * 1000)


def clean_text(value, *, maximum: int = 1000) -> str:
    text = re.sub(r"[\x00-\x1f\x7f]", " ", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()[:maximum]


def require_text(value, label: str, *, maximum: int = 1000) -> str:
    text = clean_text(value, maximum=maximum)
    if not text:
        raise ValueError(f"{label} is required")
    return text


def normalize_email(value) -> str:
    email = clean_text(value, maximum=320).lower()
    if email.count("@") != 1 or email.startswith("@") or email.endswith("@"):
        raise ValueError("valid email is required")
    return email


def normalize_risk(value) -> str:
    risk = clean_text(value, maximum=8).upper()
    if risk not in RISK_CLASSES:
        raise AuthorizationError("invalid risk class")
    return risk


def risk_index(value) -> int:
    return RISK_CLASSES.index(normalize_risk(value))


def ensure_not_downgraded(computed: str, supplied=None) -> str:
    computed = normalize_risk(computed)
    if supplied is None:
        return computed
    supplied = normalize_risk(supplied)
    if risk_index(supplied) < risk_index(computed):
        raise AuthorizationError("caller cannot understate computed risk")
    return supplied


def destination_allowed(destination: str, allowlist: tuple[str, ...]) -> bool:
    try:
        parsed = urlsplit(require_text(destination, "destination", maximum=2048))
    except ValueError:
        return False
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.fragment:
        return False
    host = (parsed.hostname or "").lower().rstrip(".")
    allowed = {clean_text(item, maximum=253).lower().lstrip(".").rstrip(".") for item in allowlist}
    return bool(host) and any(host == item or host.endswith(f".{item}") for item in allowed if item)


class _SafeArithmetic(ast.NodeVisitor):
    _binary = {
        ast.Add: lambda a, b: a + b,
        ast.Sub: lambda a, b: a - b,
        ast.Mult: lambda a, b: a * b,
        ast.Div: lambda a, b: a / b,
        ast.Mod: lambda a, b: a % b,
        ast.Pow: lambda a, b: a**b,
    }
    _unary = {ast.UAdd: lambda value: +value, ast.USub: lambda value: -value}

    def __init__(self):
        self.nodes = 0

    def visit(self, node):
        self.nodes += 1
        if self.nodes > 64:
            raise AuthorizationError("arithmetic expression is too complex")
        value = super().visit(node)
        if isinstance(value, (int, float)):
            if not math.isfinite(float(value)) or abs(float(value)) > 1e100:
                raise AuthorizationError("arithmetic result exceeds bounded range")
        return value

    def visit_Expression(self, node):
        return self.visit(node.body)

    def visit_Constant(self, node):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise AuthorizationError("unsupported arithmetic literal")
        return node.value

    def visit_BinOp(self, node):
        operation = self._binary.get(type(node.op))
        if operation is None:
            raise AuthorizationError("unsupported arithmetic operator")
        left, right = self.visit(node.left), self.visit(node.right)
        if isinstance(node.op, ast.Pow) and abs(float(right)) > 12:
            raise AuthorizationError("arithmetic exponent exceeds bounded range")
        return operation(left, right)

    def visit_UnaryOp(self, node):
        operation = self._unary.get(type(node.op))
        if operation is None:
            raise AuthorizationError("unsupported arithmetic unary operator")
        return operation(self.visit(node.operand))

    def generic_visit(self, node):
        raise AuthorizationError("unsupported arithmetic expression")


def safe_arithmetic(expression: str):
    expression = require_text(expression, "expression", maximum=200)
    try:
        parsed = ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        raise AuthorizationError("invalid arithmetic expression") from exc
    try:
        return _SafeArithmetic().visit(parsed)
    except (ArithmeticError, OverflowError) as exc:
        raise AuthorizationError("arithmetic evaluation failed safely") from exc
