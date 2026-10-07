import { workloadFingerprint } from './standard-workload.mjs';

const EARTH_RADIUS_M = 6371e3;
const rad = (value) => value * Math.PI / 180;

function matrixDistanceMeters(a, b) {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dp = rad(b.lat - a.lat);
  const dl = rad(b.lon - a.lon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}


function unixSeconds(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`invalid benchmark timestamp: ${value}`);
  return Math.floor(ms / 1000);
}

function skillMapping(workload) {
  const names = new Set();
  for (const driver of workload.drivers || []) for (const skill of driver.skills || []) names.add(skill);
  for (const order of workload.orders || []) for (const skill of order.required_skills || []) names.add(skill);
  return Object.fromEntries([...names].sort().map((name, index) => [name, index + 1]));
}

function requireWorkload(workload) {
  if (!workload || workload.schema !== 'musitu-delivery-benchmark-workload.v1') {
    throw Object.assign(new Error('standard benchmark workload required'), { code: 'BENCHMARK_WORKLOAD_REQUIRED' });
  }
  if (!Array.isArray(workload.drivers) || !workload.drivers.length || !Array.isArray(workload.orders) || !workload.orders.length) {
    throw Object.assign(new Error('benchmark drivers and orders required'), { code: 'BENCHMARK_WORKLOAD_INVALID' });
  }
}

export function buildStandardVroomInput(workload) {
  requireWorkload(workload);
  const demand = workload.orders.reduce((sum, order) => sum + Number(order.demand || 0), 0);
  const capacity = workload.drivers.reduce((sum, driver) => sum + Number(driver.capacity || 0), 0);
  if (capacity < demand) {
    throw Object.assign(new Error(`aggregate fleet capacity ${capacity} is below delivery demand ${demand}`), {
      code: 'BENCHMARK_FLEET_CAPACITY_INFEASIBLE',
      demand,
      capacity,
    });
  }
  const skillIds = skillMapping(workload);
  const windowStarts = workload.orders.map((order) => unixSeconds(order.window.start));
  const windowEnds = workload.orders.map((order) => unixSeconds(order.window.end));
  const vehicleWindow = [Math.min(...windowStarts), Math.max(...windowEnds)];

  const vehicles = workload.drivers.map((driver, index) => ({
    id: index + 1,
    description: driver.id,
    start: [driver.lon, driver.lat],
    end: [driver.lon, driver.lat],
    capacity: [driver.capacity],
    skills: (driver.skills || []).map((skill) => skillIds[skill]).sort((a, b) => a - b),
    time_window: vehicleWindow,
  }));

  const jobs = workload.orders.map((order, index) => ({
    id: index + 1,
    description: order.id,
    location: [order.lon, order.lat],
    delivery: [order.demand],
    service: order.service_minutes * 60,
    skills: (order.required_skills || []).map((skill) => skillIds[skill]).sort((a, b) => a - b),
    time_windows: [[unixSeconds(order.window.start), unixSeconds(order.window.end)]],
    priority: order.priority,
  }));

  return {
    vehicles,
    jobs,
    metadata: {
      schema: 'musitu-delivery-vroom-input.v1',
      scenario_id: workload.scenario_id,
      scenario_version: workload.scenario_version,
      workload_sha256: workloadFingerprint(workload),
      skill_ids: skillIds,
    },
  };
}

export function buildDeterministicMatrixVroomInput(workload) {
  const input = buildStandardVroomInput(workload);
  const positions = [
    ...workload.drivers.map((driver) => ({ lat: driver.lat, lon: driver.lon })),
    ...workload.orders.map((order) => ({ lat: order.lat, lon: order.lon })),
  ];
  const distances = positions.map((from, row) => positions.map((to, col) => (row === col ? 0 : matrixDistanceMeters(from, to))));
  const durations = distances.map((line) => line.map((distance) => (distance === 0 ? 0 : Math.max(1, Math.round(distance / (30_000 / 3600))))));
  const vehicles = input.vehicles.map((vehicle, index) => ({
    ...vehicle,
    profile: 'car',
    start_index: index,
    end_index: index,
  }));
  const jobs = input.jobs.map((job, index) => ({
    ...job,
    location_index: workload.drivers.length + index,
  }));
  return {
    ...input,
    vehicles,
    jobs,
    matrices: { car: { durations, distances } },
    metadata: { ...input.metadata, matrix_model: 'haversine-30kmh-v1' },
  };
}

export async function runStandardVroomPlanning({ workload, optimizer } = {}) {
  if (!optimizer || typeof optimizer.optimize !== 'function') {
    throw Object.assign(new Error('optimizer required'), { code: 'BENCHMARK_OPTIMIZER_REQUIRED' });
  }
  const input = buildStandardVroomInput(workload);
  const result = await optimizer.optimize({ vehicles: input.vehicles, jobs: input.jobs });
  if (result?.provider !== 'vroom') {
    throw Object.assign(new Error('real VROOM is required for constrained benchmark planning'), {
      code: 'BENCHMARK_VROOM_REQUIRED',
      provider: result?.provider || null,
    });
  }
  const unassigned = Array.isArray(result.unassigned) ? result.unassigned : [];
  const unassignedCount = Number.isFinite(result?.summary?.unassigned) ? result.summary.unassigned : unassigned.length;
  if (unassigned.length > 0 || unassignedCount > 0) {
    throw Object.assign(new Error('benchmark workload contains unassigned jobs'), {
      code: 'BENCHMARK_WORKLOAD_UNASSIGNED',
      unassignedCount: Math.max(unassigned.length, unassignedCount),
    });
  }
  return {
    schema: 'musitu-delivery-vroom-planning.v1',
    evidence_kind: 'internal_controlled',
    claim_status: 'NOT_CERTIFIED',
    provider: 'vroom',
    scenario_id: workload.scenario_id,
    scenario_version: workload.scenario_version,
    workload_sha256: input.metadata.workload_sha256,
    constraints: ['time_windows', 'driver_capacity', 'service_duration', 'skills', 'route_continuity'],
    vehicle_count: input.vehicles.length,
    job_count: input.jobs.length,
    route_count: Array.isArray(result.routes) ? result.routes.length : null,
    summary: result.summary || null,
    skill_ids: input.metadata.skill_ids,
  };
}
