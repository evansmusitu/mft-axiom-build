"""Track B non-production zero-cash-spend policy.

This is a policy guard for local work ONLY. It is not a provider billing
integration and cannot certify actual cloud consumption or free quota.
"""
from decimal import Decimal, InvalidOperation

SCHEMA = 'musitu.axiom.trackb.zero-cost-operation.v1'
ALLOWED = frozenset({
    ('S0', 'LOCAL_OFFLINE_TEST'),
    ('S0', 'LOCAL_READ_ONLY_COMPUTE'),
    ('S1', 'LOCAL_EPHEMERAL_SANDBOX_TASK'),
})
REQUIRED_FIELDS = frozenset({
    'schema', 'risk_class', 'operation', 'provider', 'project_scope',
    'estimated_cash_cost_usd', 'may_incur_usage_charges',
    'uses_external_model', 'external_mutation', 'production_authority',
})

class ZeroCostDenied(ValueError):
    """Fail-closed policy denial; no fee-incurring operation may proceed."""


def require_zero_cash_operation(request):
    if type(request) is not dict or set(request) != REQUIRED_FIELDS:
        raise ZeroCostDenied('zero-cost request schema invalid')
    if request['schema'] != SCHEMA:
        raise ZeroCostDenied('zero-cost request version invalid')
    if (request['risk_class'], request['operation']) not in ALLOWED:
        raise ZeroCostDenied('operation not admitted under zero-cost development policy')
    if request['provider'] != 'LOCAL':
        raise ZeroCostDenied('external provider not authorized under zero-cost policy')
    if request['project_scope'] != 'TRACK_B_ISOLATED_NONPRODUCTION':
        raise ZeroCostDenied('non-production isolated scope required')
    if any(request[field] is not False for field in (
        'may_incur_usage_charges', 'uses_external_model',
        'external_mutation', 'production_authority',
    )):
        raise ZeroCostDenied('billed, external or production operation denied')
    amount = request['estimated_cash_cost_usd']
    if type(amount) is not str:
        raise ZeroCostDenied('cash amount must be a decimal string')
    try:
        cost = Decimal(amount)
    except (InvalidOperation, ValueError):
        raise ZeroCostDenied('cash amount invalid') from None
    if not cost.is_finite() or cost != Decimal('0'):
        raise ZeroCostDenied('maximum permitted cash spending is USD 0')
    return {
        'schema':'musitu.axiom.trackb.zero-cost-admission.v1',
        'state':'LOCAL_ONLY_ALLOWED',
        'cash_spend_limit_usd':'0.00',
        'external_spending_authorized':False,
        'cloud_provisioning_authorized':False,
        'external_model_inference_authorized':False,
        'public_production_authorized':False,
        'live_runtime_qualification':'NOT_PROVEN',
    }
