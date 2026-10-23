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

/** A successful POST is not a complete UI commit until the signed job listing refreshes.
 * If the response was accepted but the refresh fails, preserve the submission key
 * for the retry. The server responds with a duplicate rather than writing a new job.
 * All callbacks are same-origin authenticated UI functions, never persisted.
 */
export async function submitSceneWithIdempotentRefresh({intent,projectId,scene,post,refresh}={}){
  if(!intent||typeof intent.prepare!=='function'||typeof intent.acknowledge!=='function'||
     typeof post!=='function'||typeof refresh!=='function')
    throw Error('SUBMISSION_CALLBACK_INVALID');
  const payload=intent.prepare({projectId,scene});
  const receipt=await post(payload);
  const jobId=submittedJobId(receipt);
  await refresh();
  intent.acknowledge();
  return Object.freeze({jobId,duplicate:receipt.duplicate===true});
}
