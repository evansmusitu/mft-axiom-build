/** Source-only, bounded R2 content verification for frozen Studio V0.3 ledgers.
 * No network, credentials, billing activation, Cloudflare binding or mutation.
 * readObject MUST be an independently authenticated, read-only provider reader
 * under an owner-authorized freeze. A caller-supplied reader is not provider proof.
 */
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {normalizeStudioLedgerSnapshot,attestStudioLedgerSnapshot} from './ledger_reconcile.mjs';

const fail=code=>{throw Error(code)};
const DEFAULT_BUDGET=128_000_000; // 128 MB; larger runs require an explicit budget.
const HARD_BUDGET=1_000_000_000_000;
// CPU and iterator-exhaustion guardrails independent of the byte budget.
// They bound per-object and aggregate chunk work, including tiny-byte chunks.
const DEFAULT_MAX_OBJECT_CHUNKS=65536, DEFAULT_MAX_TOTAL_CHUNKS=262144;
const HARD_MAX_CHUNKS=1_000_000, HARD_TOTAL_CHUNKS=2_000_000;
/**
 * Verify every referenced object by streaming its actual bytes, not trusting
 * R2 HTTP ETags, stored metadata, reported content lengths or file extensions.
 * No object contents, filenames, owner IDs or object keys are returned/logged.
 *
 * Read callback: readObject({object_key,job_id,filename,bytes,sha256}) ->
 * Uint8Array OR iterable/async iterable of Uint8Array chunks.
 * Provider identity, immutable object generation, source freeze, billing
 * protections and read-only transport must be established independently.
 */
export async function verifyStudioR2ObjectBytes(sourceSnapshot,{readObject,integrityKey,
  maxTotalBytes=DEFAULT_BUDGET,maxChunksPerObject=DEFAULT_MAX_OBJECT_CHUNKS,
  maxTotalChunks=DEFAULT_MAX_TOTAL_CHUNKS}={}){
  // Validate the COMPLETE ledger and exact V0.3 asset namespace first.
  const source=normalizeStudioLedgerSnapshot(sourceSnapshot);
  if(!(integrityKey instanceof Uint8Array)||integrityKey.byteLength<32)
    fail('STUDIO_R2_INTEGRITY_KEY_REQUIRED');
  if(typeof readObject!=='function')fail('STUDIO_R2_READER_REQUIRED');
  if(!Number.isSafeInteger(maxTotalBytes)||maxTotalBytes<1||maxTotalBytes>HARD_BUDGET)
    fail('STUDIO_R2_INVALID_BYTE_BUDGET');
  // All option validation happens before an authenticated provider read.
  if(!Number.isSafeInteger(maxChunksPerObject)||maxChunksPerObject<1||
     maxChunksPerObject>HARD_MAX_CHUNKS||
     !Number.isSafeInteger(maxTotalChunks)||maxTotalChunks<1||
     maxTotalChunks>HARD_TOTAL_CHUNKS)
    fail('STUDIO_R2_INVALID_CHUNK_BUDGET');
  const expectedBytes=source.assets.reduce((sum,asset)=>sum+asset.bytes,0);
  // Reject an impossible budget BEFORE ANY external provider callback.
  if(expectedBytes>maxTotalBytes)fail('STUDIO_R2_BYTE_BUDGET_EXCEEDED');
  const table=attestStudioLedgerSnapshot(source,{integrityKey});
  const objects=[];
  let verifiedBytes=0, totalChunks=0;
  for(const asset of source.assets){
    let stream;
    try {stream=await readObject({...asset});}
    catch {fail('STUDIO_R2_READ_FAILED')}
    if(stream==null)fail('STUDIO_R2_OBJECT_UNAVAILABLE');
    const iterator=stream instanceof Uint8Array?[stream]:stream;
    if(typeof iterator?.[Symbol.iterator]!=='function'&&
       typeof iterator?.[Symbol.asyncIterator]!=='function')
      fail('STUDIO_R2_STREAM_REQUIRED');
    let size=0, objectChunks=0;
    const hasher=createHash('sha256');
    try{
      for await(const chunk of iterator){
        if(!(chunk instanceof Uint8Array))fail('STUDIO_R2_INVALID_CHUNK');
        if(chunk.byteLength===0)fail('STUDIO_R2_EMPTY_CHUNK');
        if(++objectChunks>maxChunksPerObject)fail('STUDIO_R2_CHUNK_LIMIT_EXCEEDED');
        if(++totalChunks>maxTotalChunks)fail('STUDIO_R2_TOTAL_CHUNK_LIMIT_EXCEEDED');
        size+=chunk.byteLength;
        if(size>asset.bytes)fail('STUDIO_R2_CONTENT_SIZE_MISMATCH');
        verifiedBytes+=chunk.byteLength;
        if(verifiedBytes>maxTotalBytes)fail('STUDIO_R2_BYTE_BUDGET_EXCEEDED');
        hasher.update(chunk);
      }
    }catch(error){
      if(typeof error?.message==='string'&&error.message.startsWith('STUDIO_R2_'))
        throw error;
      fail('STUDIO_R2_READ_FAILED');
    }
    if(size!==asset.bytes)fail('STUDIO_R2_CONTENT_SIZE_MISMATCH');
    const actual=hasher.digest();
    if(!timingSafeEqual(actual,Buffer.from(asset.sha256,'hex')))
      fail('STUDIO_R2_CONTENT_HASH_MISMATCH');
    objects.push([asset.object_key,size,asset.sha256.toLowerCase()]);
  }
  const payload=JSON.stringify({schema:'musitu.studio.v03.r2-content.v1',
    freeze_id:source.freeze_id,assets_table_hmac:table.table_hmac.assets,objects});
  return Object.freeze({schema:'musitu.studio.v03.r2-content-receipt.v1',
    complete:true,verified:true,freeze_id:source.freeze_id,
    objects_verified:objects.length,bytes_verified:verifiedBytes,
    assets_table_hmac:table.table_hmac.assets,
    content_hmac:createHmac('sha256',integrityKey).update(payload).digest('hex'),
    customer_bytes_logged:false,provider_verified:false,cutover_authorized:false});
}
