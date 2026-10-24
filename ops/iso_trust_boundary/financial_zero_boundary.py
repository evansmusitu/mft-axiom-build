"""Pure S0 local-cost preflight; holds EVERY real provider or paid operation.

This function never issues grants, reads secrets, sends network requests, verifies
provider billing policy, or performs durable reservations. A local S0 positive
review is NOT authority to execute even an S0 tool. All external provider/cost
paths HOLD, regardless of alleged free tier, credit balance, $0 price, or
caller-supplied signed attestations. This is only a defense-in-depth seam before
a separately authorized independent Security/Authorization Gateway.
"""
import hashlib
import json
import re


class FinancialHold(ValueError):
    """Fail closed on financial, identity, or operation-scope uncertainty."""


_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}\Z')
_HASH = re.compile(r'[0-9a-f]{64}\Z')
_OP_FIELDS = frozenset({
    'schema','policy_sha256','operation_id','project_id','work_id',
    'agent_id','workload_identity_id','request_sha256','risk_class','tool_id',
    'provider_dispatch','network_egress','external_state_write',
    'privileged_credential_required',
})
_COST_FIELDS = frozenset({
    'schema','currency','cost_source','quoted_max_charge_micro_usd',
    'observed_charge_micro_usd','external_provider_account_id',
    'external_provider_hard_zero_cap_verified','billing_method_enabled',
    'billing_credits_available','cost_unknown',
})


def _hold(reason):
    raise FinancialHold('AXIOM_ISO_S0_FINANCIAL_HOLD:' + reason)


def _id(value):
    return type(value) is str and _ID.fullmatch(value) is not None and '..' not in value


def _digest(value):
    return type(value) is str and _HASH.fullmatch(value) is not None


def _canonical(body):
    try:
        raw = json.dumps(body,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('utf-8')
    except (TypeError,ValueError,OverflowError,UnicodeEncodeError):
        _hold('NON_CANONICAL_OPERATION')
    if len(raw)>4096:
        _hold('INPUT_TOO_LARGE')
    return raw


class FinancialZeroBoundary:
    """S0-only local classification, not a financial attestation or execution gate."""

    def __init__(self, *, pinned_policy_sha256, local_tool_allowlist):
        if not _digest(pinned_policy_sha256):
            _hold('PINNED_POLICY_INVALID')
        if (type(local_tool_allowlist) is not tuple or
                not 0 < len(local_tool_allowlist) <= 32 or
                any(not _id(t) for t in local_tool_allowlist) or
                len(set(local_tool_allowlist)) != len(local_tool_allowlist)):
            _hold('PINNED_ALLOWLIST_INVALID')
        self.pinned_policy_sha256 = pinned_policy_sha256
        self.local_tool_allowlist = frozenset(local_tool_allowlist)

    def review(self, *, operation, financial):
        if type(operation) is not dict or set(operation) != _OP_FIELDS:
            _hold('EXACT_OPERATION_FIELDS')
        if type(financial) is not dict or set(financial) != _COST_FIELDS:
            _hold('EXACT_FINANCIAL_FIELDS')
        if operation['schema'] != 'musitu.axiom.iso.s0.planned-operation.v1':
            _hold('OPERATION_SCHEMA')
        if operation['policy_sha256'] != self.pinned_policy_sha256:
            _hold('POLICY_MISMATCH')
        for key in ('operation_id','project_id','work_id','agent_id','workload_identity_id','tool_id'):
            if not _id(operation[key]):
                _hold('IDENTITY_INVALID')
        if not _digest(operation['request_sha256']):
            _hold('REQUEST_HASH_INVALID')
        if operation['tool_id'] not in self.local_tool_allowlist:
            _hold('TOOL_NOT_PINNED')
        if type(operation['risk_class']) is not str or operation['risk_class']!='S0':
            _hold('NON_S0_OPERATION')
        for key in ('provider_dispatch','network_egress','external_state_write','privileged_credential_required'):
            if type(operation[key]) is not bool:
                _hold('EXPLICIT_BOOLEAN_REQUIRED')
        if operation['provider_dispatch']:
            _hold('PROVIDER_DISPATCH_DENIED')
        if operation['network_egress']:
            _hold('NETWORK_EGRESS_DENIED')
        if operation['external_state_write']:
            _hold('EXTERNAL_WRITE_DENIED')
        if operation['privileged_credential_required']:
            _hold('PRIVILEGED_CREDENTIAL_DENIED')
        if financial['schema']!='musitu.axiom.iso.s0.financial-input.v1':
            _hold('FINANCIAL_SCHEMA')
        if financial['currency']!='USD':
            _hold('CURRENCY_INVALID')
        for key in ('external_provider_hard_zero_cap_verified','billing_method_enabled',
                    'billing_credits_available','cost_unknown'):
            if type(financial[key]) is not bool:
                _hold('EXPLICIT_FINANCIAL_BOOLEAN_REQUIRED')
        if financial['cost_unknown']:
            _hold('UNKNOWN_EXTERNAL_COST')
        # Real provider accounts, even ones *claimed* to have a USD0 hard cap,
        # cannot be proven safe by builder-attested fields or promotional credits.
        if (financial['external_provider_account_id'] is not None or
                financial['external_provider_hard_zero_cap_verified'] or
                financial['billing_method_enabled'] or
                financial['billing_credits_available']):
            _hold('BILLING_ACCOUNT_PRESENT')
        if financial['cost_source']!='NO_EXTERNAL_PROVIDER_INVOCATION':
            _hold('UNTRUSTED_COST_ORIGIN')
        for key in ('quoted_max_charge_micro_usd','observed_charge_micro_usd'):
            if type(financial[key]) is not int or financial[key]!=0:
                _hold('ANY_CHARGE_OR_NONINTEGER_AMOUNT')
        op_sha=hashlib.sha256(_canonical(operation)).hexdigest()
        finance_sha=hashlib.sha256(_canonical(financial)).hexdigest()
        return {
            'schema':'musitu.axiom.iso.s0.financial-review.v1',
            'status':'S0_LOCAL_ZERO_SPEND_RULE_CHECKED',
            'operation_sha256':op_sha,
            'financial_input_sha256':finance_sha,
            'policy_sha256':self.pinned_policy_sha256,
            'operation_id':operation['operation_id'],
            'risk_class':'S0',
            'product_objects':['Project','Work','Agent','Artifact','Evidence'],
            'account_wide_zero_hard_cap':'NOT_PROVEN',
            'external_provider_allowed':False,
            'provider_dispatch_allowed':False,
            'execution_allowed':False,
            'production_authority':False,
            'single_use_authorization':'NOT_PROVEN',
            'global_antirollback':'FAILED_IN_SYNTHETIC_ATTACK',
            'independent_security_qualification':'NOT_CERTIFIED',
        }