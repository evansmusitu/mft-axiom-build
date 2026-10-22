/**
 * MUSITU Connect future customer payload boundary.
 * Isolated research-only; not imported by the production Worker.
 */
export const MAX_CUSTOMER_JSON_BYTES = 65536;
export async function readBoundedCustomerJson(_request) {
  return {ok:false,status:503,error:'CUSTOMER_PAYLOAD_DISABLED'};
}
