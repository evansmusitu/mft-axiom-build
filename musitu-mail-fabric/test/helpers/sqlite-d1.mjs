/** Test-only minimal Cloudflare D1 facade over native SQLite. No network or secrets. */
export function createD1Compat(db){
 return {prepare(sql){return {bind(...args){let statement=db.prepare(sql);return {async run(){const r=statement.run(...args);return {success:true,meta:{changes:r.changes},results:[]};},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)}}};}};}};
}
