import { randomUUID } from 'node:crypto';

export const TENANTS = Object.freeze({
  'creatix-demo-realty': {
    name:'Oak & Key Realty',industry:'Property services',accent:'#d5a45c',
    greeting:'Welcome to Oak & Key Realty. I am the JARVIS property assistant. I can answer basic questions and help arrange a callback. What is your name?',
    faq:{hours:'This is a fictional demonstration agency. Published business hours are not available. I can request a callback from a human.',location:'This fictional demonstration agency has no actual office address.',fees:'Fees are not available in this demo. A human agent must confirm all prices and fees.'}
  },
  'creatix-demo-home': {
    name:'Cedar Home Services',industry:'Home maintenance',accent:'#72d7d1',
    greeting:'Welcome to Cedar Home Services. I can collect a repair or maintenance inquiry for staff review. What name should I use?',
    faq:{hours:'This is a fictional demonstration business. A staff member must confirm its operating hours.',location:'This fictional demonstration business does not have a real address.',fees:'Service quotations are not provided in this demo. A human must confirm prices after checking the job.'}
  }
});

const STAGES = ['name','need','budget','timeline','contact','consent','complete'];
const PROMPTS = {
 need:'What service are you interested in?',
 budget:'What is your approximate budget? You may say "not sure".',
 timeline:'When would you like to get started?',
 contact:'What test email address or test phone number should a human use?',
 consent:'Do you consent to staff using these synthetic details to respond to your request? Answer YES or NO.'
};
export function newSessionId() { return randomUUID().replaceAll('-',''); }
export function validateInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_INPUT');
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 1000) throw new Error('INVALID_MESSAGE');
  if (body.session_id != null && (typeof body.session_id !== 'string' || !/^[a-zA-Z0-9_-]{8,70}$/.test(body.session_id))) throw new Error('INVALID_SESSION');
  return {message: body.message.trim().replace(/\s+/g,' '), sessionId:body.session_id??null};
}
function faq(message, cfg) {
 const m = message.toLowerCase();
 if (/\b(hours?|open|closing|when open)\b/.test(m)) return cfg.faq.hours;
 if (/\b(where|address|located|location)\b/.test(m)) return cfg.faq.location;
 if (/\b(fees?|cost|pricing|prices?)\b/.test(m)) return cfg.faq.fees;
 return null;
}
export function advance(tenant, previous, message) {
  const cfg = TENANTS[tenant];
  if (!cfg) throw new Error('UNKNOWN_TENANT');
  const state = {stage:previous?.stage ?? 'name', data:{...(previous?.data ?? {})},status:previous?.status ?? 'active'};
  const lower = message.toLowerCase();
  let action='answer', reply='', lead=null;
  if (state.status==='opted_out') { action='opted_out'; reply='This conversation is closed following the opt-out request.'; }
  else if (/\b(stop|unsubscribe|opt.?out|do not contact)\b/.test(lower)) {
    state.status='opted_out';action='opt_out';reply='Understood. No follow-up will be initiated. This synthetic conversation is closed.';
  }
  else if (/\b(human|real person|agent|representative)\b/.test(lower)) {
    state.status='handoff';action='handoff';reply='I have marked this conversation for human review in the demo. No notification was sent.';
  }
  else if (state.status==='handoff') { action='handoff_pending'; reply='This synthetic session is awaiting a human operator. No automatic follow-up is sent.'; }
  else if (state.stage==='name' && ['hello','hi','hey','good morning'].includes(lower)) {action='greeting';reply=cfg.greeting;}
  else if (state.stage==='complete') {reply=faq(message,cfg) ?? 'Your request is saved in this synthetic demo. No external actions will occur.';}
  else {
    const answer=faq(message,cfg);
    if (answer && (message.endsWith('?') || message.split(/\s+/).length<7)) {
      action='faq';reply=answer+' '+(state.stage==='name'?'What name should I use?':PROMPTS[state.stage]);
    } else if (state.stage==='consent') {
      if (['yes','yes i do','i consent','agree'].includes(lower)) {
        state.data.consent=true;state.stage='complete';state.status='qualified';action='lead_created';
        lead={name:state.data.name, need:state.data.need, budget:state.data.budget, timeline:state.data.timeline, contact:state.data.contact};
        reply='Thanks. Your synthetic lead has been saved for staff review. No real messages or appointments are created.';
      } else if (['no','no thanks','decline'].includes(lower)) {
        state.data.consent=false;state.stage='complete';state.status='declined';action='consent_declined';reply='No problem. No lead will be created.';
      } else { action='consent_wait';reply='Please answer YES to consent or NO to decline.'; }
    } else {
      state.data[state.stage]=state.stage==='name'?message.replace(/^my name is\s+/i,''):message;
      const next=STAGES[STAGES.indexOf(state.stage)+1];
      state.stage=next;action='intake';reply=next==='need'?'Thanks, '+state.data.name+'. '+PROMPTS.need:PROMPTS[next];
    }
  }
  return {state, action, reply, lead};
}
