import { DeliveryStore } from '../core/src/store.mjs';
import { sha256, verifyChain } from '../core/src/evidence.mjs';
import { workloadFingerprint } from './standard-workload.mjs';
import { buildDeterministicMatrixVroomInput } from './vroom-standard.mjs';

export const STANDARD_V2_SHA256 = 'fb80db552b55efb60c5372629c606cdd6879f796950ec44e1d854f46e8dfabdc';

const round3 = (value) => Number(Number(value).toFixed(3));
const clampRate = (value) => Math.max(0, Math.min(1, value));

function requireStandardV2({ scenario, workload, optimizer, productHead, capturedAt }) {
  if (scenario?.id !== 'musitu-last-mile-standard-v2' || scenario?.version !== 2) {
    throw Object.assign(new Error('standard-v2 scenario required'), { code: 'STANDARD_V2_REQUIRED' });
  }
  const fingerprint = workloadFingerprint(workload);
  if (fingerprint !== STANDARD_V2_SHA256) {
    throw Object.assign(new Error(`standard-v2 workload fingerprint mismatch: ${fingerprint}`), {
      code: 'STANDARD_V2_WORKLOAD_MISMATCH',
      expected: STANDARD_V2_SHA256,
      actual: fingerprint,
    });
  }
  if (!optimizer || typeof optimizer.optimize !== 'function') {
    throw Object.assign(new Error('optimizer required'), { code: 'BENCHMARK_OPTIMIZER_REQUIRED' });
  }
  if (!productHead || typeof productHead !== 'string') throw new Error('productHead required');
  if (!capturedAt || !Number.isFinite(Date.parse(capturedAt))) throw new Error('capturedAt required');
}

function plannedJobs(plan) {
  const rows = [];
  for (const route of [...(plan.result.routes || [])].sort((a, b) => Number(a.vehicle) - Number(b.vehicle))) {
    const driver = plan.drivers[Number(route.vehicle) - 1];
    if (!driver) throw new Error(`VROOM route references unknown vehicle ${route.vehicle}`);
    let previousDistance = 0;
    let lastJobDistance = 0;
    for (const step of route.steps || []) {
      const distance = Number.isFinite(Number(step.distance)) ? Number(step.distance) : previousDistance;
      if (step.type === 'job') {
        const jobId = step.id ?? step.job;
        const order = plan.orders[Number(jobId) - 1];
        if (!order) throw new Error(`VROOM route references unknown job ${jobId}`);
        rows.push({
          order,
          driver,
          arrival: Number(step.arrival),
          legDistanceM: Math.max(0, distance - previousDistance),
        });
        lastJobDistance = distance;
      }
      previousDistance = distance;
    }
    route.__returnDistanceM = Math.max(0, Number(route.distance || previousDistance) - lastJobDistance);
  }
  return rows;
}

function isoSeconds(seconds) {
  return new Date(seconds * 1000).toISOString();
}

function eventTimes(order, arrivalSeconds, trafficDelaySeconds) {
  const fallbackArrival = Math.floor(Date.parse(order.window.start) / 1000) + 60;
  const arrival = Number.isFinite(arrivalSeconds) ? arrivalSeconds : fallbackArrival;
  const delivered = arrival + Number(order.service_minutes || 0) * 60 + trafficDelaySeconds;
  return {
    assigned: isoSeconds(delivered - 4),
    collected: isoSeconds(delivered - 3),
    enRoute: isoSeconds(delivered - 2),
    arrived: isoSeconds(delivered - 1),
    delivered: isoSeconds(delivered),
    deliveredSeconds: delivered,
  };
}

export async function runStandardV2Harness({ scenario, workload, optimizer, productHead, capturedAt, vroomRelease = null }) {
  requireStandardV2({ scenario, workload, optimizer, productHead, capturedAt });
  const store = new DeliveryStore(false);
  const baseSeconds = Math.floor(Date.parse(workload.orders[0].window.start) / 1000);

  workload.drivers.forEach((driver, index) => {
    store.registerDriver({
      id: driver.id,
      name: `Benchmark Driver ${String(index + 1).padStart(2, '0')}`,
      online: true,
      lat: driver.lat,
      lon: driver.lon,
      capacity: driver.capacity,
      skills: [...driver.skills],
    }, {
      eventId: `benchmark:driver-register:${driver.id}`,
      at: isoSeconds(baseSeconds + index),
      actor: 'benchmark-harness',
    });
  });

  workload.orders.forEach((order, index) => {
    store.createOrder({
      id: order.id,
      trackingToken: `benchmark:${order.id}`,
      customer: 'Benchmark Recipient',
      address: `${order.lat},${order.lon}`,
      lat: order.lat,
      lon: order.lon,
      priority: order.priority,
      demand: order.demand,
      service_minutes: order.service_minutes,
      required_skills: [...order.required_skills],
      window: { ...order.window },
      proof_required: [...order.proof_required],
    }, {
      eventId: `benchmark:create:${order.id}`,
      at: isoSeconds(baseSeconds + 100 + index),
      actor: 'benchmark-harness',
    });
  });

  let planCount = 0;
  let solverMsTotal = 0;
  let solverJobCount = 0;
  const solve = async (drivers, orders) => {
    const subWorkload = { ...workload, drivers: drivers.map((x) => ({ ...x })), orders: orders.map((x) => ({ ...x })), disruptions: [] };
    const input = buildDeterministicMatrixVroomInput(subWorkload);
    const result = await optimizer.optimize({ vehicles: input.vehicles, jobs: input.jobs, matrices: input.matrices });
    if (result?.provider !== 'vroom') {
      throw Object.assign(new Error('real VROOM is required for standard-v2 execution evidence'), {
        code: 'BENCHMARK_VROOM_REQUIRED',
        provider: result?.provider || null,
      });
    }
    const unassigned = Array.isArray(result.unassigned) ? result.unassigned.length : 0;
    const summaryUnassigned = Number.isFinite(result?.summary?.unassigned) ? Number(result.summary.unassigned) : unassigned;
    if (unassigned > 0 || summaryUnassigned > 0) {
      throw Object.assign(new Error('standard-v2 execution contains unassigned jobs'), {
        code: 'BENCHMARK_WORKLOAD_UNASSIGNED',
        unassignedCount: Math.max(unassigned, summaryUnassigned),
      });
    }
    planCount += 1;
    solverJobCount += orders.length;
    solverMsTotal += Number(result?.summary?.computing_times?.solving || 0);
    return { input, result, drivers, orders };
  };

  let remaining = workload.orders.map((order) => ({ ...order }));
  let activeDrivers = workload.drivers.map((driver) => ({ ...driver }));
  let currentPlan = await solve(activeDrivers, remaining);
  let completed = 0;
  let routeDistanceM = 0;
  let onTime = 0;
  let proofComplete = 0;
  let trafficDelaySeconds = 0;
  let disruptionIndex = 0;
  let driverOfflineEvents = 0;
  let trafficDelayEvents = 0;
  let pendingRestore = null;
  let operatorInterventions = 0;

  while (remaining.length > 0) {
    const disruption = workload.disruptions[disruptionIndex] || null;
    const segmentEnd = disruption ? disruption.after_order : workload.orders.length;
    const need = Math.max(0, segmentEnd - completed);
    const sequence = plannedJobs(currentPlan);
    if (sequence.length < need) throw new Error(`VROOM plan has ${sequence.length} jobs but ${need} are required before next disruption`);

    for (const row of sequence.slice(0, need)) {
      const times = eventTimes(row.order, row.arrival, trafficDelaySeconds);
      store.assign(row.order.id, row.driver.id, {
        eventId: `benchmark:assign:${row.order.id}`,
        at: times.assigned,
        actor: 'benchmark-harness',
      });
      const transitions = [
        ['COLLECTED', times.collected],
        ['EN_ROUTE', times.enRoute],
        ['ARRIVED', times.arrived],
      ];
      for (const [type, at] of transitions) {
        const order = store.orders.get(row.order.id);
        store.applyClientEvent({
          eventId: `benchmark:${type.toLowerCase()}:${row.order.id}`,
          orderId: row.order.id,
          expectedVersion: order.version,
          type,
          actor: 'benchmark-harness',
          at,
        });
      }
      const beforeDelivery = store.orders.get(row.order.id);
      store.applyClientEvent({
        eventId: `benchmark:delivered:${row.order.id}`,
        orderId: row.order.id,
        expectedVersion: beforeDelivery.version,
        type: 'DELIVERED',
        actor: 'benchmark-harness',
        at: times.delivered,
        proof: {
          recipientName: 'Benchmark Recipient',
          photoHash: sha256(`photo:${row.order.id}`),
          signatureHash: sha256(`signature:${row.order.id}`),
          lat: row.order.lat,
          lon: row.order.lon,
          capturedAt: times.delivered,
        },
      });
      routeDistanceM += row.legDistanceM;
      completed += 1;
      store.setDriverLocation(row.driver.id, { lat: row.order.lat, lon: row.order.lon }, {
        eventId: `benchmark:driver-location:${row.order.id}`,
        actor: 'benchmark-harness',
        at: times.delivered,
      });
      const deliveredOrder = store.orders.get(row.order.id);
      if (deliveredOrder.proof?.photoHash && deliveredOrder.proof?.signatureHash) proofComplete += 1;
      if (times.deliveredSeconds <= Math.floor(Date.parse(row.order.window.end) / 1000)) onTime += 1;
    }

    const completedIds = new Set([...store.orders.values()].filter((order) => order.status === 'DELIVERED').map((order) => order.id));
    remaining = workload.orders.filter((order) => !completedIds.has(order.id)).map((order) => ({ ...order }));

    if (!disruption) {
      for (const route of currentPlan.result.routes || []) routeDistanceM += Number(route.__returnDistanceM || 0);
      break;
    }

    const eventAt = isoSeconds(baseSeconds + 1000 + disruptionIndex * 120);
    if (pendingRestore) {
      store.setDriverOnline(pendingRestore.driver_id, true, {
        eventId: `benchmark:${pendingRestore.id}:online`,
        reason: `standard-v2 ${pendingRestore.duration_minutes}-minute availability window elapsed`,
        actor: 'benchmark-harness',
        at: eventAt,
      });
      pendingRestore = null;
    }

    if (disruption.type === 'DRIVER_OFFLINE') {
      store.setDriverOnline(disruption.driver_id, false, {
        eventId: `benchmark:${disruption.id}:offline`,
        reason: 'standard-v2 deterministic disruption',
        actor: 'benchmark-harness',
        at: eventAt,
      });
      driverOfflineEvents += 1;
      pendingRestore = disruption;
    } else if (disruption.type === 'TRAFFIC_DELAY') {
      store.recordTrafficDelay({
        eventId: `benchmark:${disruption.id}:traffic`,
        zone: disruption.zone,
        delayMinutes: disruption.delay_minutes,
        reason: 'standard-v2 remaining-ETA offset policy',
        actor: 'benchmark-harness',
        at: eventAt,
      });
      trafficDelaySeconds += disruption.delay_minutes * 60;
      trafficDelayEvents += 1;
    } else {
      operatorInterventions += 1;
      throw new Error(`unsupported disruption type: ${disruption.type}`);
    }

    disruptionIndex += 1;
    activeDrivers = workload.drivers
      .filter((driver) => store.drivers.get(driver.id)?.online !== false)
      .map((driver) => {
        const canonical = store.drivers.get(driver.id);
        return { ...driver, lat: canonical.lat, lon: canonical.lon };
      });
    currentPlan = await solve(activeDrivers, remaining);
  }

  if (pendingRestore) {
    store.setDriverOnline(pendingRestore.driver_id, true, {
      eventId: `benchmark:${pendingRestore.id}:online`,
      reason: `standard-v2 ${pendingRestore.duration_minutes}-minute availability window elapsed`,
      actor: 'benchmark-harness',
      at: isoSeconds(baseSeconds + 3000),
    });
  }

  const snapshot = store.snapshot();
  const chainValid = verifyChain(store.events);
  const delivered = snapshot.orders.filter((order) => order.status === 'DELIVERED');
  const artifact = {
    schema: 'musitu-delivery-standard-v2-internal-evidence.v1',
    scenario: { id: scenario.id, version: scenario.version },
    workload_sha256: STANDARD_V2_SHA256,
    product_head: productHead,
    planner: {
      provider: 'vroom',
      engine_release: vroomRelease,
      matrix_model: 'haversine-30kmh-v1',
      plan_count: planCount,
      replan_count: Math.max(0, planCount - 1),
      metric_method: 'assignment_decision_ms = aggregate VROOM solving milliseconds / aggregate jobs considered across initial plan and replans',
    },
    evidence: {
      kind: 'internal_controlled',
      source: 'standard-v2-canonical-delivery-store-harness',
      captured_at: capturedAt,
    },
    claim_status: 'NOT_CERTIFIED',
    comparison_ready: false,
    execution: {
      orders_total: workload.orders.length,
      orders_delivered: delivered.length,
      disruptions_applied: disruptionIndex,
      driver_offline_events: driverOfflineEvents,
      traffic_delay_events: trafficDelayEvents,
      traffic_delay_policy: 'remaining_eta_offset',
      proof_required: [...scenario.workload.proof_required],
    },
    metrics: {
      assignment_decision_ms: round3(solverJobCount ? solverMsTotal / solverJobCount : 0),
      route_total_distance_m: Math.round(routeDistanceM),
      on_time_completion_rate: round3(clampRate(onTime / workload.orders.length)),
      operator_interventions: operatorInterventions,
      proof_completeness_rate: round3(clampRate(proofComplete / workload.orders.length)),
    },
    chain: {
      valid: chainValid,
      event_count: store.events.length,
      head_sha256: store.events.at(-1)?.hash || sha256('GENESIS'),
    },
  };
  if (!chainValid) throw Object.assign(new Error('DeliveryStore evidence chain verification failed'), { code: 'EVIDENCE_CHAIN_INVALID' });
  if (delivered.length !== workload.orders.length || proofComplete !== workload.orders.length) {
    throw Object.assign(new Error('standard-v2 completion/proof gate failed'), { code: 'STANDARD_V2_COMPLETION_INCOMPLETE' });
  }
  return artifact;
}
