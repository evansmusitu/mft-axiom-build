"""B1-only in-memory worker lease admission. NOT a production scheduler.

Does not grant S3 permissions, model access, restart recovery or release
authority. An independent runtime terminator must be supplied by the caller.
"""
import math
import re
import secrets
import threading
import time

_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}$')
_TENANT = re.compile(r'^[a-z0-9][a-z0-9_-]{0,63}$')
_WORKER = re.compile(r'^axiom-openhands-[a-z0-9]{8}$')
_HASH = re.compile(r'^[a-f0-9]{64}$')
_KEYS = frozenset({'tenant_id', 'project_id', 'work_id',
                   'workload_identity_id', 'request_sha256',
                   'risk_class', 'operation'})
_OPERATION = 'B1_ISOLATED_CONTAINER_SMOKE'


class AdmissionDenied(ValueError):
    """Fail-closed denial of a container-only admission request."""


class RevocationFailed(RuntimeError):
    """Terminator failure; capacity must remain occupied."""


def _validate_request(request, worker):
    if type(request) is not dict or set(request) != _KEYS:
        raise AdmissionDenied('worker admission request must have exact fields')
    if not isinstance(worker, str) or not _WORKER.fullmatch(worker):
        raise AdmissionDenied('worker must have isolated namespace')
    if not isinstance(request['tenant_id'], str) or not _TENANT.fullmatch(request['tenant_id']):
        raise AdmissionDenied('tenant scope invalid')
    for field in ('project_id', 'work_id', 'workload_identity_id'):
        value = request[field]
        if not isinstance(value, str) or not _ID.fullmatch(value) or '..' in value:
            raise AdmissionDenied(field + ' scope invalid')
    if not isinstance(request['request_sha256'], str) or not _HASH.fullmatch(request['request_sha256']):
        raise AdmissionDenied('request digest invalid')
    if request['risk_class'] != 'S0' or request['operation'] != _OPERATION:
        raise AdmissionDenied('B1 scheduler admits S0 container smoke only')
    return tuple(request[field] for field in sorted(_KEYS)) + (worker,)


class LeaseScheduler:
    """Two-slot CI admission with fail-closed termination and no durability."""

    def __init__(self, *, max_active=2, max_per_tenant=1, ttl_seconds=30,
                 clock=time.monotonic, terminate=None):
        if (type(max_active) is not int or not 1 <= max_active <= 2 or
                type(max_per_tenant) is not int or not 1 <= max_per_tenant <= max_active or
                type(ttl_seconds) not in (int, float) or not 1 <= ttl_seconds <= 300 or
                not callable(clock) or not callable(terminate)):
            raise ValueError('invalid bounded B1 lease scheduler configuration')
        self._max_active = max_active
        self._max_per_tenant = max_per_tenant
        self._ttl = float(ttl_seconds)
        self._clock = clock
        self._terminate = terminate
        self._leases = {}
        self._by_request = {}
        self._lock = threading.RLock()

    def _now(self):
        now = self._clock()
        if not isinstance(now, (int, float)) or not math.isfinite(now):
            raise AdmissionDenied('invalid monotonic clock')
        return float(now)

    @property
    def active_count(self):
        with self._lock:
            return sum(item['state'] != 'TERMINATED' for item in self._leases.values())

    def _receipt(self, lease):
        return {
            'schema': 'musitu.axiom.trackb.b1-container-lease.v1',
            'lease_id': lease['id'],
            'tenant_id': lease['request']['tenant_id'],
            'state': lease['state'],
            'risk_class': 'S0',
            'runtime_qualification': 'NOT_PROVEN',
            'external_action_executed': False,
            'release_authority': False,
            'production_authority': False,
            'certification_authority': False,
        }

    def acquire(self, request, worker_name):
        binding = _validate_request(request, worker_name)
        with self._lock:
            now = self._now()
            key = request['request_sha256']
            if key in self._by_request:
                lease = self._leases[self._by_request[key]]
                if lease['binding'] != binding or lease['state'] != 'ACTIVE' or now >= lease['expiry']:
                    raise AdmissionDenied('idempotency conflict or expired/revoked lease')
                return self._receipt(lease)
            active = [item for item in self._leases.values() if item['state'] != 'TERMINATED']
            if len(active) >= self._max_active:
                raise AdmissionDenied('global worker cap reached')
            if sum(item['request']['tenant_id'] == request['tenant_id'] for item in active) >= self._max_per_tenant:
                raise AdmissionDenied('tenant worker cap reached')
            if any(item['worker_name'] == worker_name for item in active):
                raise AdmissionDenied('worker already reserved')
            lease_id = secrets.token_hex(16)
            self._leases[lease_id] = {
                'id': lease_id, 'binding': binding, 'request': dict(request),
                'worker_name': worker_name, 'expiry': now + self._ttl,
                'state': 'ACTIVE',
            }
            self._by_request[key] = lease_id
            return self._receipt(self._leases[lease_id])

    def state(self, lease_id):
        with self._lock:
            item = self._leases.get(lease_id)
            if item is None:
                raise AdmissionDenied('unknown worker lease')
            return self._receipt(item)

    def _revoke(self, item):
        if item['state'] == 'TERMINATED':
            return
        try:
            self._terminate(item['worker_name'])
        except Exception as error:
            item['state'] = 'TERMINATION_FAILED'
            raise RevocationFailed('worker termination not proven; slot retained') from error
        item['state'] = 'TERMINATED'

    def release(self, lease_id, tenant_id):
        with self._lock:
            item = self._leases.get(lease_id)
            if not item or type(tenant_id) is not str or item['request']['tenant_id'] != tenant_id:
                raise AdmissionDenied('cross-tenant or unknown lease revocation')
            self._revoke(item)
            return self._receipt(item)

    def reap_expired(self):
        with self._lock:
            now = self._now()
            for item in list(self._leases.values()):
                if item['state'] != 'TERMINATED' and now >= item['expiry']:
                    self._revoke(item)
