/** New process, existing authenticated storage only. Input credentials never persist. */
import {createRemoteD1} from './hosted-storage-client.mjs';
import {createD1ExecutionGovernance} from '../../ops/axiom_execution_contract.mjs';
import {verifyTaskCommitments} from '../../axiom_interface/vnext/execution_integrity.mjs';
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>4096)throw Error('bounded fresh-readback input required');}
const input=JSON.parse(raw),db=createRemoteD1({baseUrl:input.base_url,operatorToken:input.operator_token,runId:input.run_id,timeoutMs:20000});
const saved=await createD1ExecutionGovernance({db,customer:{customer_id:input.tenant_id}}).get(input.task_id);
if(saved?.status!=='COMPLETED'||!await verifyTaskCommitments(saved))throw Error('fresh process receipt verification failed');
process.stdout.write(JSON.stringify({status:saved.status,task_id:saved.task_id,receipt_sha256:saved.receipt.receipt_sha256,artifact_sha256:saved.receipt.artifact_sha256,receipt_verified:true}));
