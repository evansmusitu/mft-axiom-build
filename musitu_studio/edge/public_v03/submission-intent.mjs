/** Per-tab, never-persisted idempotency for authorized Studio job submissions. */
import {parsePreviewScene} from './scene-preview.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function submittedJobId(receipt){
  const id=receipt?.job_id??receipt?.job?.id;
  if(typeof id!=='string'||!UUID.test(id))throw Error('SUBMISSION_RECEIPT_INVALID');
  return id;
}
export function createSubmissionIntent(makeKey=()=>crypto.randomUUID().replaceAll('-','')){
  if(typeof makeKey!=='function')throw Error('SUBMISSION_KEY_GENERATOR_INVALID');
  let stored=null;
  return {
    prepare({projectId,scene}={}){
      if(typeof projectId!=='string'||!projectId)throw Error('SUBMISSION_PROJECT_REQUIRED');
      const normalized=parsePreviewScene(JSON.stringify(scene));
      const signature=JSON.stringify({project_id:projectId,scene:normalized,device:'CPU'});
      if(!stored||stored.signature!==signature){
        const key=makeKey();
        if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{12,100}$/.test(key))
          throw Error('SUBMISSION_KEY_INVALID');
        stored={signature,key};
      }
      return {project_id:projectId,scene:structuredClone(normalized),device:'CPU',
        submission_key:stored.key};
    },
    acknowledge(){stored=null},
  };
}

/** An accepted POST is not a completed submission until an independently authorized
 * readback proves that THIS actor owns THIS CPU job in THIS project and the UI
 * list has refreshed. Keep the exact same retry key after any ambiguous failure.
 * Server-side Access verification, project permission and idempotency are authoritative.
 * Callbacks are same-origin, authenticated, ephemeral and never persisted.
 */
export async function submitSceneWithIdempotentRefresh({intent,projectId,scene,post,readback,refresh}={}){
  if(!intent||typeof intent.prepare!=='function'||typeof intent.acknowledge!=='function'||
     typeof post!=='function'||typeof readback!=='function'||typeof refresh!=='function')
    throw Error('SUBMISSION_CALLBACK_INVALID');
  const payload=intent.prepare({projectId,scene});
  const receipt=await post(payload);
  const jobId=submittedJobId(receipt);
  const confirmed=await readback(jobId);
  if(confirmed?.ok!==true||confirmed?.job?.id!==jobId||
     confirmed.job.project_id!==payload.project_id||
     confirmed.job.device!=='CPU'||confirmed.job.created_by_me!==true)
    throw Error('SUBMISSION_READBACK_UNVERIFIED');
  await refresh();
  intent.acknowledge();
  return Object.freeze({jobId,duplicate:receipt.duplicate===true});
}
