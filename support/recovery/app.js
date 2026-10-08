const protectForm=document.querySelector('#protect-recovery-form');
const rotateForm=document.querySelector('#rotate-recovery-form');
const protectStatus=document.querySelector('#protect-status');
const rotateStatus=document.querySelector('#rotate-status');
const receipt=document.querySelector('#new-recovery-receipt');
const output=document.querySelector('#new-recovery-code');

const caseId=value=>String(value||'').trim().toUpperCase();
const recoveryCode=value=>String(value||'').trim().toUpperCase();

async function api(path,{headers={}}={}){
  const response=await fetch(path,{method:'POST',headers:{accept:'application/json',...headers}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(data.message||data.error||'Recovery request failed.');
    error.code=data.error; error.status=response.status; throw error;
  }
  return data;
}

protectForm?.addEventListener('submit',async event=>{
  event.preventDefault(); protectStatus.textContent=''; if(!protectForm.reportValidity())return;
  const data=new FormData(protectForm);
  const id=caseId(data.get('case_id')); const code=recoveryCode(data.get('recovery_code'));
  const button=protectForm.querySelector('button[type="submit"]'); button.disabled=true;
  protectStatus.textContent='Binding verified identity to this case…';
  try{
    const value=await api('/recovery/api/v1/cases/'+encodeURIComponent(id)+'/bind',{headers:{Authorization:'Support '+code}});
    protectStatus.textContent=value.already_bound?'This verified identity already protects this case.':'Case recovery protection enabled.';
    protectForm.querySelector('[name="recovery_code"]').value='';
  }catch(error){protectStatus.textContent=error.message;}
  finally{button.disabled=false;}
});

rotateForm?.addEventListener('submit',async event=>{
  event.preventDefault(); rotateStatus.textContent=''; receipt.hidden=true; output.textContent=''; if(!rotateForm.reportValidity())return;
  const data=new FormData(rotateForm); const id=caseId(data.get('case_id'));
  const button=rotateForm.querySelector('button[type="submit"]'); button.disabled=true;
  rotateStatus.textContent='Verifying recovery eligibility…';
  try{
    const value=await api('/recovery/api/v1/cases/'+encodeURIComponent(id)+'/rotate');
    output.textContent=value.recovery_code;
    receipt.hidden=false; receipt.focus();
    rotateStatus.textContent='Recovery code rotated successfully.';
  }catch(error){
    rotateStatus.textContent=error.code==='RECOVERY_APPROVAL_REQUIRED'
      ? 'Identity verified. Independent approval is required for this sensitive case; try again after support approves the request.'
      : error.message;
  }finally{button.disabled=false;}
});

document.querySelector('#copy-new-recovery-code')?.addEventListener('click',async()=>{
  const code=output.textContent;
  try{await navigator.clipboard.writeText(code);rotateStatus.textContent='New recovery code copied.';}
  catch{rotateStatus.textContent='Copy was unavailable. Select and save the code manually.';}
});
