/** D1 prepared statement semantics implemented atop one SQLite-backed Durable Object. */
export function makeDurableSqlAdapter(storage){
  if(!storage?.sql?.exec||typeof storage.transactionSync!=='function')
    throw Error('SQLITE_DURABLE_OBJECT_REQUIRED');
  const sql=storage.sql;
  const execute=(query,params,mode)=>{
    const cursor=sql.exec(query,...params);
    if(mode==='all')return {results:Array.from(cursor,row=>({...row}))};
    if(mode==='first')return Array.from(cursor,row=>({...row}))[0]??null;
    return {meta:{changes:Number(sql.exec('SELECT changes() AS n').one()?.n??0)}};
  };
  function bound(query,params){return {
    all:async()=>execute(query,params,'all'),
    first:async()=>execute(query,params,'first'),
    run:async()=>execute(query,params,'run'),
    execute:()=>execute(query,params,'run'),
  }}
  return {
    prepare(query){if(typeof query!=='string'||query.length>100_000)throw Error('SQL_STATEMENT_INVALID');
      return {bind(...params){return bound(query,params)}}},
    async batch(statements){if(!Array.isArray(statements)||!statements.length||statements.length>16)
      throw Error('SQL_TRANSACTION_INVALID');
      return storage.transactionSync(()=>statements.map(statement=>statement.execute()))}
  };
}
