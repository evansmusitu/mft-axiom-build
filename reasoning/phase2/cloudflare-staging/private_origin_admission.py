"""MUSITU AXIOM Phase 2: non-promoting private-network metadata assessment.

This pure function accepts UNTRUSTED, potentially synthetic provider snapshots.
It can identify missing security prerequisites but NEVER certifies a live
connection, PostgreSQL privileges, accounting correctness, or deployment.
No networking, database queries, billing or credential manipulation is done.

Cloudflare VPC origin TLS verification is handled at the VPC service, not
Hyperdrive's public-origin mtls setting. Omitted service TLS settings mean
verify_full under Cloudflare's documented default as of 2026-11-09.
"""

PROJECT = 'royal-grass-27046609'
REGION = 'aws-us-east-2'
DATABASE = 'axiom_phase2_stage'
RUNTIME = 'axiom_phase2_stage_runtime'
STAGE_WORKER = 'axiom-phase2-staging-db-preflight'
BINDING = 'HYPERDRIVE'


def _mapping(value):
    return value if isinstance(value, dict) else {}


def _string(value):
    return isinstance(value, str) and bool(value) and '\r' not in value and '\n' not in value


def _has_approved_neon_identity(neon):
    return (neon.get('id') == PROJECT and neon.get('region_id') == REGION
            and neon.get('branch_protected') is True
            and isinstance(neon.get('databases'), list)
            and DATABASE in neon['databases'])


def _has_approved_role(neon):
    roles = neon.get('roles')
    return (isinstance(roles, list) and RUNTIME in roles and
            all(_string(role) for role in roles))


def _has_valid_tunnel(tunnel):
    return (tunnel.get('status') == 'healthy' and
            tunnel.get('tun_type') == 'cfd_tunnel' and _string(tunnel.get('id')))


def _has_valid_service(service):
    host = _mapping(service.get('host'))
    return (service.get('type') == 'tcp'
            and service.get('app_protocol') == 'postgresql'
            and type(service.get('tcp_port')) is int and service['tcp_port'] == 5432
            and _string(service.get('service_id'))
            and _string(host.get('hostname'))
            and isinstance(host.get('resolver_network'), dict))


def _has_strict_tls(service):
    if not service:
        return False
    if 'tls_settings' not in service:
        return True  # Cloudflare Workers VPC documented default, not a live TLS proof.
    cfg = service['tls_settings']
    return isinstance(cfg, dict) and cfg.get('cert_verification_mode') == 'verify_full'


def _has_tunnel_link(tunnel, service):
    resolver = _mapping(_mapping(service.get('host')).get('resolver_network'))
    return (_string(tunnel.get('id'))
            and resolver.get('tunnel_id') == tunnel.get('id'))


def _has_private_fresh_hyperdrive(hyperdrive, service):
    origin = _mapping(hyperdrive.get('origin'))
    caching = _mapping(hyperdrive.get('caching'))
    limit = hyperdrive.get('origin_connection_limit')
    # All origin connectivity must go through VPC service. No public fallback.
    forbidden = ('host', 'port', 'connection_string', 'connectionString', 'access_client_id',
                 'access_client_secret')
    return (_string(hyperdrive.get('id'))
            and caching.get('disabled') is True
            and isinstance(hyperdrive.get('origin'), dict)
            and origin.get('service_id') == service.get('service_id')
            and _string(origin.get('service_id'))
            and origin.get('database') == DATABASE
            and origin.get('user') == RUNTIME
            and origin.get('scheme') in ('postgres', 'postgresql')
            and not any(field in origin for field in forbidden)
            and 'mtls' not in hyperdrive  # TLS is on VPC Service for private origins.
            and type(limit) is int and 5 <= limit <= 20)


def _has_exact_worker_binding(worker, hyperdrive):
    bindings = worker.get('bindings')
    if worker.get('name') != STAGE_WORKER or not isinstance(bindings, list):
        return False
    matching = [x for x in bindings if isinstance(x, dict) and
                x.get('name') == BINDING]
    return (len(matching) == 1 and matching[0].get('type') == 'hyperdrive'
            and _string(hyperdrive.get('id')) and matching[0].get('id') == hyperdrive['id'])


def evaluate(snapshot):
    """Return only schema-defined blocker enums; never copy raw provider data.

    A future trusted runner must independently authenticate these snapshots.
    Even an all-green metadata candidate requires a live TLS/PG privileges and
    spending-ledger assessment. There is deliberately NO deploy-approval state.
    """
    source = _mapping(snapshot)
    neon = _mapping(source.get('neon'))
    tunnel = _mapping(source.get('tunnel'))
    service = _mapping(source.get('service'))
    hyperdrive = _mapping(source.get('hyperdrive'))
    worker = _mapping(source.get('worker'))
    gates = []
    if not _has_approved_neon_identity(neon):
        gates.append('NEON_IDENTITY_OR_BRANCH_MISMATCH')
    settings = _mapping(neon.get('settings'))
    if (settings.get('block_public_connections') is not True or
            settings.get('block_vpc_connections') is not False):
        gates.append('NEON_NETWORK_SECURITY_INVALID')
    if not _has_approved_role(neon):
        gates.append('RUNTIME_ROLE_NOT_PROVISIONED')
    if not _has_valid_tunnel(tunnel):
        gates.append('TUNNEL_NOT_HEALTHY_OR_MISSING')
    if not _has_valid_service(service):
        gates.append('VPC_SERVICE_NOT_APPROVED')
    if not _has_strict_tls(service):
        gates.append('VPC_SERVICE_TLS_NOT_STRICT')
    if not _has_tunnel_link(tunnel, service):
        gates.append('VPC_TUNNEL_LINK_MISMATCH')
    if not _has_private_fresh_hyperdrive(hyperdrive, service):
        gates.append('HYPERDRIVE_NOT_PRIVATE_OR_CACHE_ENABLED')
    if not _has_exact_worker_binding(worker, hyperdrive):
        gates.append('WORKER_BINDING_MISMATCH')
    if gates:
        status = 'METADATA_SECURITY_GATE_BLOCKED'
    else:
        status = 'METADATA_CANDIDATE_INDEPENDENT_EVIDENCE_REQUIRED'
    # Critical live attestations are intentionally impossible to fabricate as
    # local booleans. They can only be furnished by independently approved live
    # probes and signed security/finance authority in a separate system.
    gates += [
        'LIVE_PRIVATE_TLS_HANDSHAKE_UNVERIFIED',
        'RUNTIME_SQL_PRIVILEGES_UNVERIFIED',
        'LEDGER_SPEND_SECURITY_UNVERIFIED',
    ]
    return {
        'schema': 'AXIOM_PHASE2_PRIVATE_ORIGIN_METADATA_GATE_V1',
        'status': status,
        'blocking_reasons': gates,
        'network_verified': False,
        'authorized_to_deploy': False,
        'production_release_qualified': False,
        'cloudflare_writes': 0,
        'neon_sql_queries': 0,
    }
