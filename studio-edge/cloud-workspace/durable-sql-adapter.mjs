/**
 * SQLite-backed Durable Object storage bridge, isolated replacement for D1.
 * One Durable Object is keyed by a server-derived tenant ID. The service's
 * existing member predicate and version CAS SQL are preserved unchanged.
 * No tenant/user provisioning or public routes are exposed by this module.
 */
export const DURABLE_SCHEMA=`
CREATE TABLE IF NOT EXISTS workspace_tenants (
 tenant_id TEXT PRIMARY KEY NOT NULL CHECK(length(tenant_id) BETWEEN 3 AND 40),
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_memberships (
 tenant_id TEXT NOT NULL,
 subject TEXT NOT NULL CHECK(length(subject) BETWEEN 8 AND 256),
 role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
 created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,subject),
 FOREIGN KEY(tenant_id) REFERENCES workspace_tenants(tenant_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workspace_blobs (
 tenant_id TEXT NOT NULL,
 slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 5),
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 2147483647),
 encrypted TEXT NOT NULL CHECK(length(encrypted) BETWEEN 100 AND 250000),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,slot),
 FOREIGN KEY(tenant_id) REFERENCES workspace_tenants(tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS workspace_memberships_subject_idx ON workspace_memberships(subject,tenant_id);
`;

export class DurableAdapterError extends Error {
  constructor(code){super(code);this.name='DurableAdapterError';this.code=code;}
}
export function createDurableDB(sql){
  if(!sql||typeof sql.exec!=='function')throw new DurableAdapterError('SQLITE_UNAVAILABLE');
  // A minimal D1-shaped adapter over synchronous SQLite-backed DO storage.
  // Parameters are always bound using sql.exec(query,...params), never interpolated.
  return Object.freeze({
    prepare(query){
      if(typeof query!=='string'||query.length>10000||
        !/^\s*(SELECT|INSERT|UPDATE|DELETE)\s/i.test(query)){
        throw new DurableAdapterError('UNSUPPORTED_QUERY');
      }
      return Object.freeze({
        bind(...params){
          if(params.length>14||params.some(v=>typeof v!=='string'&&typeof v!=='number')){
            throw new DurableAdapterError('INVALID_BINDINGS');
          }
          return Object.freeze({
            async first(){
              if(!/^\s*SELECT\s/i.test(query))throw new DurableAdapterError('READ_QUERY_REQUIRED');
              const cursor=sql.exec(query,...params);
              const rows=cursor.toArray();
              if(rows.length>1)throw new DurableAdapterError('NON_UNIQUE_READ');
              return rows[0]||null;
            },
            async run(){
              if(!/^\s*(INSERT|UPDATE|DELETE)\s/i.test(query))throw new DurableAdapterError('WRITE_QUERY_REQUIRED');
              const cursor=sql.exec(query,...params);
              if(!Number.isInteger(cursor.rowsWritten)||cursor.rowsWritten<0){
                throw new DurableAdapterError('WRITE_RESULT_UNAVAILABLE');
              }
              return {success:true,meta:{changes:cursor.rowsWritten}};
            }
          });
        }
      });
    }
  });
}
export function initializeDurableTenant(storage){
  if(!storage?.sql?.exec)throw new DurableAdapterError('SQLITE_UNAVAILABLE');
  storage.sql.exec(DURABLE_SCHEMA);
  return createDurableDB(storage.sql);
}
