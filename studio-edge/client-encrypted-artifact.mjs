// Browser-only building block for a future Access-authenticated workspace UI.
// Deliberately not imported by the public site or active Worker.
// Keys must be provisioned by an independently reviewed client-side flow.
// This does not migrate, read, overwrite, or sync the existing five local slots.
export async function encryptTenantText() { throw new Error('NOT_IMPLEMENTED'); }
export async function decryptTenantText() { throw new Error('NOT_IMPLEMENTED'); }
