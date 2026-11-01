/**
 * NONPRODUCTION ONLY: combined customer ingress canary.
 * This is a callable offline module, NOT a deployed Worker entrypoint,
 * product API, mining calculator or production admission authorization.
 *
 * The canary deliberately NEVER executes planning, Axiom calculations,
 * billable work, or external HTTP fetches. It returns only a sanitized
 * record that the authenticated/quota-reserved transport was accepted.
 * Do not import into connect/production_worker.mjs.
 */
import { reserveConnectCustomerRequest } from './customer_admission.mjs';
import { readBoundedCustomerJson } from './customer_payload.mjs';
import { validateCustomerMiningBody } from './customer_mining_semantics.mjs';

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
const json = (status, body) =>
  new Response(JSON.stringify(body), {status, headers});
const failure = (status, error) => json(status, {ok:false, error});

export async function inspectIsolatedCustomerIngress(request, env, options={}) {
  if (env?.CONNECT_CUSTOMER_CANARY_ENABLED !== 'true') {
    return failure(503, 'CUSTOMER_CANARY_DISABLED');
  }
  try {
    const path = new URL(request.url).pathname;
    const scope = path === '/__offline_connect/plan' ? 'mining.plan'
      : path === '/__offline_connect/risk' ? 'mining.risk' : null;
    if (scope === null) return failure(404, 'NOT_FOUND');
    if (request.method !== 'POST') return failure(405, 'METHOD_NOT_ALLOWED');

    // This is a trusted local test seam. Caller-supplied payloads MUST NOT
    // control scope, tenant, clock or request ID generator.
    const admission = await reserveConnectCustomerRequest({
      authorization:request.headers.get('authorization'),
      scope, env,
      ...(options.nowMs === undefined ? {} : {nowMs:options.nowMs}),
      ...(options.requestIdFactory === undefined ? {} : {requestIdFactory:options.requestIdFactory}),
    });
    if (!admission.ok) return failure(admission.status, admission.error);

    // Invalid payloads consume an admitted *attempt* quota reservation.
    // They are never marked as executed or billable usage.
    const intake = await readBoundedCustomerJson(request);
    if (!intake.ok) return failure(intake.status, intake.error);
    const semantics = validateCustomerMiningBody(intake.body, scope);
    if (!semantics.ok) return failure(semantics.status, semantics.error);

    // No upstream execution is possible on this path.
    return json(200, {
      ok:true,
      mode:'NONPRODUCTION_INGRESS_CHECK_ONLY',
      executed:false,
      request_id:admission.request_id,
    });
  } catch {
    return failure(503, 'CUSTOMER_CANARY_UNAVAILABLE');
  }
}
