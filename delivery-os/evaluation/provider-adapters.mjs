import { workloadFingerprint } from './standard-workload.mjs';

function requireWorkload(workload) {
  if (!workload || workload.schema !== 'musitu-delivery-benchmark-workload.v1') {
    throw new Error('standard benchmark workload is required');
  }
  if (!Array.isArray(workload.orders) || workload.orders.length === 0) {
    throw new Error('workload orders are required');
  }
}

function onfleetCapabilityMetadata(order) {
  const requirements = [];
  if ((order.required_skills || []).includes('refrigerated')) requirements.push('refrigeration');
  return requirements.length === 0 ? [] : [{
    name: 'opt_compat_attributes',
    type: 'array',
    subtype: 'string',
    value: requirements,
    visibility: ['api'],
  }];
}

export function buildOnfleetTaskPlan({ workload, city, country } = {}) {
  requireWorkload(workload);
  if (!city || typeof city !== 'string') throw new Error('Onfleet destination city is required');
  if (!country || typeof country !== 'string') throw new Error('Onfleet destination country is required');

  const requests = workload.orders.map((order) => {
    const metadata = [{
      name: 'benchmark_order_id',
      type: 'string',
      value: order.id,
      visibility: ['api'],
    }, ...onfleetCapabilityMetadata(order)];

    return {
      benchmark_order_id: order.id,
      method: 'POST',
      path: '/api/v2/tasks',
      body: {
        destination: {
          location: [order.lon, order.lat],
          address: { city, country },
        },
        recipients: [],
        completeAfter: Date.parse(order.window.start),
        completeBefore: Date.parse(order.window.end),
        pickupTask: false,
        notes: `MUSITU benchmark ${order.id}`,
        quantity: order.demand,
        serviceTime: order.service_minutes,
        requirements: {
          signature: (order.proof_required || []).includes('signature'),
          photo: (order.proof_required || []).includes('photo'),
        },
        priority: order.priority,
        metadata,
      },
    };
  });

  return {
    schema: 'musitu-delivery-provider-plan.v1',
    provider: 'onfleet',
    workload_sha256: workloadFingerprint(workload),
    requests,
    live_execution_blockers: [
      'ONFLEET_TEST_API_KEY_REQUIRED',
      'ONFLEET_TEST_TEAM_AND_WORKER_BINDINGS_REQUIRED',
      'ONFLEET_ROUTE_OPTIMIZATION_ENTITLEMENT_AND_DEFAULT_SCHEDULE_REQUIRED',
    ],
  };
}

export function buildBringgOrderPlan({ workload, createOrderUrl } = {}) {
  requireWorkload(workload);
  if (!createOrderUrl) {
    return {
      schema: 'musitu-delivery-provider-plan.v1',
      provider: 'bringg',
      workload_sha256: workloadFingerprint(workload),
      ready: false,
      blocked_by: ['BRINGG_SANDBOX_CREATE_ORDER_URL_REQUIRED'],
      requests: [],
    };
  }

  return {
    schema: 'musitu-delivery-provider-plan.v1',
    provider: 'bringg',
    workload_sha256: workloadFingerprint(workload),
    ready: false,
    blocked_by: ['BRINGG_SANDBOX_ORDER_SCHEMA_CONFIRMATION_REQUIRED'],
    endpoint: createOrderUrl,
    requests: [],
  };
}
