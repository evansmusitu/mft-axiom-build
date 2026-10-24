/**
 * Strict Mining JSON *semantics* for the nonproduction customer ingress canary.
 * Different from legacy internal Worker normalization (which coerces numbers).
 * No computation, upstream fetch, customer record storage, or production import.
 * The bounds are provisional pending customer, safety and performance review.
 */
const requiredRow = ['hazard','exposure','severity','likelihood','cost','benefit'];
const allowedRow = new Set([...requiredRow,'record_id','asset_id','site','event_time','latitude','longitude']);
const controlCharacters = /[\u0000-\u001f\u007f]/;
const failure = error => ({ok:false,status:400,error});
const invalid = () => failure('INVALID_MINING_REQUEST');
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const between = (value,min,max) => typeof value === 'number'
  && Number.isFinite(value) && value >= min && value <= max;
const meaningful = (value,max) => typeof value === 'string'
  && value.length > 0 && value.length <= max
  && value.trim().length > 0 && !controlCharacters.test(value);
function validEventTime(time) {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,3}))?(Z|([+-])(\d\d):(\d\d))$/.exec(time);
  if (!match || !Number.isFinite(Date.parse(time))) return false;
  const [year,month,day,hour,minute,second] = match.slice(1,7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [0,31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month]
      || hour > 23 || minute > 59 || second > 59) return false;
  if (match[8] !== 'Z') {
    const zoneHour = Number(match[10]);
    const zoneMinute = Number(match[11]);
    if (zoneHour > 14 || zoneMinute > 59 || (zoneHour === 14 && zoneMinute !== 0)) return false;
  }
  return true;
}
function validRow(row) {
  if (!isRecord(row)) return false;
  if (requiredRow.some(key=>!Object.hasOwn(row,key))) return false;
  if (Object.keys(row).some(key=>!allowedRow.has(key))) return false;
  if (!meaningful(row.hazard,160)) return false;
  if (!between(row.exposure,0,1) || !between(row.severity,0,10) ||
      !between(row.likelihood,0,1) || !between(row.cost,0,Number.MAX_VALUE) ||
      !between(row.benefit,0,1)) return false;
  for(const name of ['record_id','asset_id','site']){
    if(Object.hasOwn(row,name) && !meaningful(row[name],160)) return false;
  }
  if(Object.hasOwn(row,'event_time')){
    const time=row.event_time;
    if (!meaningful(time,64) || !validEventTime(time)) return false;
  }
  const lat=Object.hasOwn(row,'latitude');
  const lon=Object.hasOwn(row,'longitude');
  if(lat !== lon) return false;
  if(lat && (!between(row.latitude,-90,90) || !between(row.longitude,-180,180))) return false;
  return true;
}

/** Caller must provide route-derived scope; returns errors only, never payloads. */
export function validateCustomerMiningBody(body,scope) {
  if(!isRecord(body)) return invalid();
  const isPlan=scope==='mining.plan';
  const isRisk=scope==='mining.risk';
  if(!isPlan && !isRisk) return {ok:false,status:403,error:'INSUFFICIENT_SCOPE'};
  const allowed=isPlan?new Set(['rows','budget']):new Set(['rows','run_id']);
  if(Object.keys(body).some(key=>!allowed.has(key))) return invalid();
  if(!Array.isArray(body.rows) || body.rows.length===0) return invalid();
  if(isRisk && body.rows.length!==1) return failure('RISK_SINGLE_ROW_REQUIRED');
  if(isPlan && body.rows.length>64) return invalid();
  if(isPlan && !between(body.budget,0,Number.MAX_VALUE)) return invalid();
  if(isRisk && (!meaningful(body.run_id,80) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(body.run_id))) return invalid();
  if(!body.rows.every(validRow)) return invalid();
  return {ok:true};
}
