/**
 * Capture the constructor-approved pg Pool connection settings without retaining
 * references to mutable nested configuration. No network calls, SQL, or secrets
 * are printed. A changed pg Pool configuration must never retain billing trust.
 *
 * This is a JS runtime mutation guard, NOT proof of TLS, DB privileges or any
 * live deployment/production acceptance gate.
 */
type Snapshot =
  | {kind:"value";value:unknown}
  | {kind:"bytes";proto:object|null;bytes:Uint8Array}
  | {kind:"date";time:number}
  | {kind:"regexp";source:string;flags:string;lastIndex:number}
  | {kind:"record";proto:object|null;properties:Array<{
      key:string|symbol;enumerable:boolean;configurable:boolean;writable:boolean;value:Snapshot
    }>};

function capture(value:unknown,seen:WeakSet<object>):Snapshot {
  if(value===null||(typeof value!=="object"))return {kind:"value",value};
  if(seen.has(value))throw new TypeError("Cyclic PostgreSQL Pool options are not safe to pin");
  seen.add(value);
  try{
    if(value instanceof Date)return {kind:"date",time:value.getTime()};
    if(value instanceof RegExp)return {kind:"regexp",source:value.source,flags:value.flags,lastIndex:value.lastIndex};
    if(value instanceof ArrayBuffer)return {kind:"bytes",proto:Object.getPrototypeOf(value),bytes:new Uint8Array(value.slice(0))};
    if(ArrayBuffer.isView(value))return {
      kind:"bytes",proto:Object.getPrototypeOf(value),
      bytes:Uint8Array.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))
    };
    const proto=Object.getPrototypeOf(value);
    if(proto!==Object.prototype&&proto!==null&&proto!==Array.prototype)
      throw new TypeError("Unsupported mutable PostgreSQL Pool option object; cannot safely pin connection");
    const properties:Extract<Snapshot,{kind:"record"}>["properties"]=[];
    for(const key of Reflect.ownKeys(value)){
      const d=Object.getOwnPropertyDescriptor(value,key);
      if(!d||!("value" in d))throw new TypeError("PostgreSQL Pool option accessor cannot be safely pinned");
      properties.push({key,enumerable:!!d.enumerable,configurable:!!d.configurable,
        writable:!!d.writable,value:capture(d.value,seen)});
    }
    return {kind:"record",proto,properties};
  }finally{seen.delete(value);}
}

function equalSnapshot(value:unknown,expected:Snapshot):boolean {
  if(expected.kind==="value")return Object.is(value,expected.value);
  if(value===null||typeof value!=="object")return false;
  if(expected.kind==="date")return value instanceof Date&&Object.is(value.getTime(),expected.time);
  if(expected.kind==="regexp")return value instanceof RegExp&&value.source===expected.source&&
    value.flags===expected.flags&&value.lastIndex===expected.lastIndex;
  if(expected.kind==="bytes"){
    if(Object.getPrototypeOf(value)!==expected.proto)return false;
    const bytes=value instanceof ArrayBuffer?new Uint8Array(value):
      ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):null;
    if(!bytes||bytes.byteLength!==expected.bytes.byteLength)return false;
    for(let i=0;i<bytes.byteLength;i++)if(bytes[i]!==expected.bytes[i])return false;
    return true;
  }
  if(Object.getPrototypeOf(value)!==expected.proto)return false;
  const keys=Reflect.ownKeys(value);
  if(keys.length!==expected.properties.length)return false;
  return expected.properties.every(p=>{
    const d=Object.getOwnPropertyDescriptor(value,p.key);
    return !!d&&"value" in d&&d.enumerable===p.enumerable&&
      d.configurable===p.configurable&&d.writable===p.writable&&
      equalSnapshot(d.value,p.value);
  });
}

/** Pin the exact current Pool.options graph, then reject replacements/mutations. */
export function pinPoolConnectionOptions(pool:{readonly options:object}):()=>boolean {
  if(!pool||typeof pool!=="object")throw new TypeError("PostgreSQL Pool object is required");
  const descriptor=Object.getOwnPropertyDescriptor(pool,"options");
  if(!descriptor||!("value" in descriptor)||!descriptor.value||typeof descriptor.value!=="object")
    throw new TypeError("PostgreSQL Pool options must be a stable owned data property");
  const original=descriptor.value;
  const pinned=capture(original,new WeakSet());
  return ()=>{
    try{
      const current=Object.getOwnPropertyDescriptor(pool,"options");
      return !!current&&"value" in current&&current.value===original&&
        equalSnapshot(original,pinned);
    }catch{return false;}
  };
}


/**
 * Pin a single configuration value (including nested TLS CA/key material)
 * against later substitutions. This does not inspect a live network peer.
 */
export function pinComparableConnectionValue(value:unknown):(candidate:unknown)=>boolean {
  const expected=capture(value,new WeakSet());
  return (candidate:unknown)=>{
    try{return equalSnapshot(candidate,expected);}
    catch{return false;}
  };
}
