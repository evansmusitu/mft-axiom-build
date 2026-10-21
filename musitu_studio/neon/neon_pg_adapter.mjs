/** Studio V0.3 PostgreSQL adapter — STAGING ONLY, not wired to production.
 * Dependency injected PG Client constructor permits CI with no Neon credentials.
 * PostgreSQL SERIALIZABLE transactions retain the existing conditional-audit
 * contract: an approval audit is inserted iff the preceding UPDATE changed one row.
 * This module MUST NOT be activated until signed-authenticated end-to-end
 * qualification, private connectivity and exact customer-data reconciliation.
 */
export function compileStudioPgSql(input){
  if(typeof input!=='string'||input.length>100000||input.includes(';'))
    throw Error('NEON_SQL_STATEMENT_INVALID');
  if(!/^\s*(?:SELECT|INSERT|UPDATE)\b/i.test(input)||
     /\b(?:ATTACH|PRAGMA|VACUUM|DROP|TRUNCATE|ALTER|GRANT|REVOKE|COPY)\b/i.test(input))
    throw Error('NEON_SQL_STATEMENT_DENIED');
  if(/\bdate\s*\(\s*substr\s*\(/i.test(input))
    throw Error('NEON_SQLITE_DATE_SEMANTICS_UNSUPPORTED');
  let out='',quotes='',i=0,count=0;
  for(;i<input.length;i++){
    const ch=input[i],next=input[i+1];
    if(quotes){
      out+=ch;
      if(ch===quotes){
        if(next===quotes){out+=next;i++}else quotes='';
      }
      continue;
    }
    if(ch==="'"||ch==='"'){quotes=ch;out+=ch;continue}
    if(ch==='?'){out+='$'+(++count);continue}
    out+=ch;
  }
  if(quotes)throw Error('NEON_UNTERMINATED_SQL_QUOTE');
  return {text:out,parameters:count};
}
function affected(result){
  if(!result||typeof result.rowCount!=='number'||result.rowCount<0)
    throw Error('NEON_ROWCOUNT_MISSING_FAIL_CLOSED');
  return result.rowCount;
}
const auditGate=/\s+WHERE\s+changes\(\)\s*=\s*1\s*$/i;
const dbOpts={maxStatements:16,maxParams:64};
export function createStudioNeonPgAdapter({makeClient}={}){
  if(typeof makeClient!=='function')throw Error('NEON_CLIENT_FACTORY_REQUIRED');
  async function executeOn(client,statement,precedingChanges){
    if(!statement||typeof statement.sql!=='string'||!Array.isArray(statement.values))
      throw Error('NEON_INVALID_STATEMENT');
    const conditional=auditGate.test(statement.sql);
    if(conditional&&!/^\s*INSERT INTO audit_events\s*\(/i.test(statement.sql))
      throw Error('NEON_CONDITIONAL_AUDIT_MISUSED');
    if(conditional&&precedingChanges!==1)return {meta:{changes:0}};
    const raw=conditional?statement.sql.replace(auditGate,''):statement.sql;
    const converted=compileStudioPgSql(raw);
    if(converted.parameters!==statement.values.length||statement.values.length>dbOpts.maxParams)
      throw Error('NEON_PARAMETER_MISMATCH');
    const result=await client.query(converted.text,statement.values);
    if(statement.mode==='all')return {results:result.rows||[]};
    if(statement.mode==='first')return (result.rows||[])[0]??null;
    return {meta:{changes:affected(result)}};
  }
  async function session(callback){
    const client=makeClient();
    if(!client||typeof client.connect!=='function'||typeof client.query!=='function'||
       typeof client.end!=='function')throw Error('NEON_CLIENT_INVALID');
    let connected=false;
    try{
      await client.connect();connected=true;
      await client.query('SET search_path TO studio_v03, pg_catalog');
      return await callback(client);
    }finally{
      if(connected)await client.end();
    }
  }
  function statement(sql,values,mode){
    return {sql,values,mode};
  }
  function prepared(sql){
    if(typeof sql!=='string'||!sql.trim()||sql.length>100000)throw Error('NEON_INVALID_QUERY');
    return {bind(...values){
      const call=mode=>session(client=>executeOn(client,statement(sql,values,mode)));
      return {
        all:()=>call('all'),
        first:()=>call('first'),
        run:()=>call('run'),
        // Never exposed to user input; batch calls this purely syntactic object.
        execute:()=>statement(sql,values,'run')
      };
    }};
  }
  async function batch(statements){
    if(!Array.isArray(statements)||statements.length<1||
       statements.length>dbOpts.maxStatements)throw Error('NEON_BATCH_LIMIT');
    return session(async client=>{
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const results=[];let lastChanges=null;
      try{
        for(const q of statements){
          if(!q||typeof q.execute!=='function')throw Error('NEON_BATCH_UNBOUND');
          const s=q.execute();
          const result=await executeOn(client,s,lastChanges);
          results.push(result);
          if(s.mode==='run')lastChanges=result?.meta?.changes??null;
        }
        await client.query('COMMIT');
        return results;
      }catch(error){
        try{await client.query('ROLLBACK')}catch{}
        throw error;
      }
    });
  }
  return {prepare:prepared,batch};
}
