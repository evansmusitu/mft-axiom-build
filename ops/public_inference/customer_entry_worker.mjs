/** Opt-in isolated entrypoint. Not deployed or qualified for public customers. */
import gateway from './gateway.mjs';
import { createCustomerEntry } from './customer_entry.mjs';
export default createCustomerEntry({delegate:gateway});
