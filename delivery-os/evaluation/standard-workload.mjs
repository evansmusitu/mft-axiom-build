import crypto from 'node:crypto';
import { canonicalJson } from './benchmark.mjs';

const DEPOT = Object.freeze({ id: 'bench-depot-01', lat: -17.8292, lon: 31.0522 });
const BASE_TIME = Date.parse('2026-10-06T08:00:00.000Z');

const round6 = (value) => Number(value.toFixed(6));
const isoFromMinutes = (minutes) => new Date(BASE_TIME + minutes * 60_000).toISOString();

export function generateStandardWorkload(scenario) {
  if (!scenario || scenario.id !== 'musitu-last-mile-standard-v1' || scenario.version !== 1) {
    throw new Error('standard-v1 scenario contract required');
  }
  const counts = scenario.workload || {};
  const driverCount = Number(counts.drivers);
  const orderCount = Number(counts.orders);
  const disruptionCount = Number(counts.disruption_events);
  if (![driverCount, orderCount, disruptionCount].every(Number.isInteger)) {
    throw new Error('integer workload counts required');
  }

  const drivers = Array.from({ length: driverCount }, (_, index) => {
    const row = Math.floor(index / 5);
    const col = index % 5;
    return {
      id: `bench-driver-${String(index + 1).padStart(2, '0')}`,
      lat: round6(DEPOT.lat + (row - 0.5) * 0.006),
      lon: round6(DEPOT.lon + (col - 2) * 0.006),
      capacity: 20,
      skills: index % 2 === 0 ? ['standard', 'refrigerated'] : ['standard'],
      start_depot_id: DEPOT.id,
      end_depot_id: DEPOT.id,
    };
  });

  const orders = Array.from({ length: orderCount }, (_, index) => {
    const row = Math.floor(index / 10);
    const col = index % 10;
    const windowStartMinutes = (index % 12) * 20;
    const demand = 1 + (index % 4);
    return {
      id: `bench-order-${String(index + 1).padStart(3, '0')}`,
      lat: round6(DEPOT.lat + (row - 4.5) * 0.004),
      lon: round6(DEPOT.lon + (col - 4.5) * 0.004),
      priority: 1 + (index % 5),
      demand,
      service_minutes: 5 + (index % 4) * 5,
      required_skills: index % 10 === 0 ? ['standard', 'refrigerated'] : ['standard'],
      window: {
        start: isoFromMinutes(windowStartMinutes),
        end: isoFromMinutes(windowStartMinutes + 120),
      },
      proof_required: [...scenario.workload.proof_required],
    };
  });

  const disruptions = Array.from({ length: disruptionCount }, (_, index) => {
    const type = index % 2 === 0 ? 'DRIVER_OFFLINE' : 'TRAFFIC_DELAY';
    const event = {
      id: `disruption-${String(index + 1).padStart(2, '0')}`,
      type,
      after_order: Math.min(orderCount, (index + 1) * 9),
    };
    if (type === 'DRIVER_OFFLINE') {
      event.driver_id = drivers[index % drivers.length].id;
      event.duration_minutes = 30;
    } else {
      event.zone = `zone-${String((index % 5) + 1).padStart(2, '0')}`;
      event.delay_minutes = 15 + (index % 3) * 5;
    }
    return event;
  });

  return {
    schema: 'musitu-delivery-benchmark-workload.v1',
    scenario_id: scenario.id,
    scenario_version: scenario.version,
    seed: scenario.seed,
    depot: { ...DEPOT },
    drivers,
    orders,
    disruptions,
  };
}

export function workloadFingerprint(workload) {
  return crypto.createHash('sha256').update(canonicalJson(workload)).digest('hex');
}
