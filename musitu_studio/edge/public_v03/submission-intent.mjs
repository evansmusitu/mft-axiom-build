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
