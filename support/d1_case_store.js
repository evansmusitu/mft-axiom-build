import {encryptSupportPayload, decryptSupportPayload} from './crypto_envelope.js';
import {SENSITIVE_ACTIONS, appendCaseEvent, assertTransition, createConversationMessage, publicCaseView, sha256, storageStateForPublicLabel} from './control_plane.js';

export class D1CaseStore {
  constructor({database, encryptionKey}) {
    if (!database?.prepare || !database?.batch) throw new TypeError('D1-compatible database binding required');
    if (!encryptionKey) throw new TypeError('support encryption key required');
    this.db = database;
    this.key = encryptionKey;
  }

  async create(bundle) {
    const {case_record: record, intake, initial_event: event} = bundle;
    const encrypted = await encryptSupportPayload({
      summary: intake.summary, description: intake.description, reproduction: intake.reproduction,
      impact: intake.impact, evidence_refs: intake.evidence_refs,
    }, {key: this.key, caseId: record.case_id});
    const publicJson = JSON.stringify(publicCaseView(record));
    const encryptedJson = JSON.stringify(encrypted);
    const eventJson = JSON.stringify(event.payload);
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_cases
        (case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,recovery_hash,public_json,encrypted_payload,last_event_hash,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        record.case_id, record.state, record.priority, record.surface, record.category,
        record.requester_ref, record.retention_class, record.human_approval_required ? 1 : 0,
        record.recovery_hash, publicJson, encryptedJson, record.last_event_hash, record.created_at, record.updated_at,
      ),
      this.db.prepare(`INSERT INTO support_case_events
        (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).bind(
        event.case_id, event.event_hash, event.prior_event_hash, event.type, event.actor,
        event.visibility, eventJson, event.at,
      ),
    ]);
    return publicCaseView(record);
  }

  async getAuthorized(caseId, recoveryCode) {
    const recoveryHash = await sha256(recoveryCode);
    const row = await this.db.prepare(`SELECT public_json, encrypted_payload, recovery_hash FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if (!row || !constantTimeEqual(String(row.recovery_hash), recoveryHash)) return null;
    const details = await decryptSupportPayload(JSON.parse(row.encrypted_payload), {key: this.key, caseId});
    return Object.freeze({case: JSON.parse(row.public_json), details});
  }


  async appendOperatorMessage(caseId, input, principal) {
    const row = await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,public_json,last_event_hash,created_at,updated_at
      FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if (!row) return null;
    const type = String(input?.type || '');
    const visibility = type === 'INTERNAL_NOTE' ? 'internal' : 'customer';
    const message = await createConversationMessage({
      caseId,
      type,
      actor: principal?.actor_ref,
      visibility,
      body: input?.body,
    });
    const encrypted = await encryptSupportPayload(
      {body: message.body},
      {key: this.key, caseId, schema: 'musitu.axiom.support-message-encrypted.v1'},
    );
    const event = await appendCaseEvent(row, {
      type: message.type,
      actor: message.actor,
      visibility: message.visibility,
      payload: {message_id: message.message_id},
    }, {at: message.created_at});
    const notificationId = type === 'AGENT_REPLY' ? 'AXN-' + randomToken(16) : null;
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_case_messages
        (message_id,case_id,type,actor,visibility,encrypted_payload,event_hash,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).bind(
        message.message_id,message.case_id,message.type,message.actor,message.visibility,
        JSON.stringify(encrypted),event.event_hash,message.created_at,
      ),
      this.db.prepare(`INSERT INTO support_case_events
        (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).bind(
        event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,
        JSON.stringify(event.payload),event.at,
      ),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?')
        .bind(event.event_hash,event.at,caseId),
      ...(notificationId ? [this.db.prepare(`INSERT INTO support_notification_outbox
        (notification_id,case_id,kind,audience,event_hash,created_at) VALUES (?,?,?,?,?,?)`)
        .bind(notificationId,caseId,'AGENT_REPLY_AVAILABLE','customer',event.event_hash,event.at)] : []),
    ]);
    return Object.freeze({message, notification_id: notificationId});
  }


  async getAuthorizedThread(caseId, recoveryCode) {
    const recoveryHash = await sha256(recoveryCode);
    const row = await this.db.prepare(`SELECT public_json, encrypted_payload, recovery_hash FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if (!row || !constantTimeEqual(String(row.recovery_hash), recoveryHash)) return null;
    const details = await decryptSupportPayload(JSON.parse(row.encrypted_payload), {key: this.key, caseId});
    const result = await this.db.prepare(`SELECT message_id,case_id,type,actor,visibility,encrypted_payload,event_hash,created_at
      FROM support_case_messages WHERE case_id=? AND visibility='customer' ORDER BY created_at ASC`).bind(caseId).all();
    const messages = [];
    for (const item of (result?.results || []).filter(value => value.visibility === 'customer')) {
      const payload = await decryptSupportPayload(JSON.parse(item.encrypted_payload), {key: this.key, caseId});
      messages.push(Object.freeze({
        message_id:item.message_id,case_id:item.case_id,type:item.type,actor:item.actor,visibility:item.visibility,
        body:String(payload?.body || ''),event_hash:item.event_hash,created_at:item.created_at,
      }));
    }
    return Object.freeze({case: JSON.parse(row.public_json), details, messages: Object.freeze(messages)});
  }

  async getOperatorCase(caseId) {
    const row = await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,
      public_json,encrypted_payload,last_event_hash,created_at,updated_at
      FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if (!row) return null;
    const details = await decryptSupportPayload(JSON.parse(row.encrypted_payload), {key: this.key, caseId});
    const result = await this.db.prepare(`SELECT message_id,case_id,type,actor,visibility,encrypted_payload,event_hash,created_at
      FROM support_case_messages WHERE case_id=? ORDER BY created_at ASC`).bind(caseId).all();
    const messages = [];
    for (const item of result?.results || []) {
      const payload = await decryptSupportPayload(JSON.parse(item.encrypted_payload), {key: this.key, caseId});
      messages.push(Object.freeze({
        message_id:item.message_id,case_id:item.case_id,type:item.type,actor:item.actor,visibility:item.visibility,
        body:String(payload?.body || ''),event_hash:item.event_hash,created_at:item.created_at,
      }));
    }
    return Object.freeze({case: JSON.parse(row.public_json), details, messages: Object.freeze(messages)});
  }

  async appendCustomerMessage(caseId, recoveryCode, input) {
    const recoveryHash = await sha256(recoveryCode);
    const row = await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,
      public_json,recovery_hash,last_event_hash,created_at,updated_at
      FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if (!row || !constantTimeEqual(String(row.recovery_hash), recoveryHash)) return null;
    const message = await createConversationMessage({
      caseId,type:'CUSTOMER_MESSAGE',actor:'requester',visibility:'customer',body:input?.body,
    });
    const encrypted = await encryptSupportPayload(
      {body: message.body},
      {key: this.key, caseId, schema: 'musitu.axiom.support-message-encrypted.v1'},
    );
    const event = await appendCaseEvent(row, {
      type: message.type, actor: message.actor, visibility: message.visibility,
      payload: {message_id: message.message_id},
    }, {at: message.created_at});
    const notificationId = 'AXN-' + randomToken(16);
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_case_messages
        (message_id,case_id,type,actor,visibility,encrypted_payload,event_hash,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).bind(
        message.message_id,message.case_id,message.type,message.actor,message.visibility,
        JSON.stringify(encrypted),event.event_hash,message.created_at,
      ),
      this.db.prepare(`INSERT INTO support_case_events
        (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).bind(
        event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,
        JSON.stringify(event.payload),event.at,
      ),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?')
        .bind(event.event_hash,event.at,caseId),
      this.db.prepare(`INSERT INTO support_notification_outbox
        (notification_id,case_id,kind,audience,event_hash,created_at) VALUES (?,?,?,?,?,?)`)
        .bind(notificationId,caseId,'CUSTOMER_REPLY_RECEIVED','operator',event.event_hash,event.at),
    ]);
    return Object.freeze({message, case: {...JSON.parse(row.public_json), updated_at:event.at}, notification_id:notificationId});
  }

  async transitionOperatorCase(caseId, label, principal) {
    const row = await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,
      public_json,last_event_hash,created_at,updated_at
      FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if (!row) return null;
    const next = storageStateForPublicLabel(label);
    assertTransition(String(row.state), next);
    const event = await appendCaseEvent(row, {
      type:'STATE_CHANGED',actor:principal?.actor_ref,visibility:'customer',
      payload:{from:String(row.state),to:next,public_label:String(label)},
    });
    const currentPublic = JSON.parse(row.public_json);
    const nextPublic = {...currentPublic,state:next,updated_at:event.at};
    await this.db.batch([
      this.db.prepare('UPDATE support_cases SET state=?,public_json=?,last_event_hash=?,updated_at=? WHERE case_id=?')
        .bind(next,JSON.stringify(nextPublic),event.event_hash,event.at,caseId),
      this.db.prepare(`INSERT INTO support_case_events
        (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).bind(
        event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,
        JSON.stringify(event.payload),event.at,
      ),
    ]);
    return Object.freeze({case_id:caseId,state:next,public_label:String(label),updated_at:event.at});
  }


  async assignOperatorCase(caseId, principal) {
    const row = await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,last_event_hash,created_at,updated_at
      FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if (!row) return null;
    const assigned = String(principal?.actor_ref || '');
    if (!/^support_agent:[a-z0-9._:-]{3,160}$/i.test(assigned)) throw new DOMException('operator assignment identity is invalid','NotAllowedError');
    const at = new Date().toISOString();
    const event = await appendCaseEvent(row,{type:'CASE_ASSIGNED',actor:assigned,visibility:'internal',payload:{assigned_operator_ref:assigned}},{at});
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_case_assignments
        (case_id,assigned_operator_ref,assigned_by,event_hash,created_at) VALUES (?,?,?,?,?)`)
        .bind(caseId,assigned,assigned,event.event_hash,at),
      this.db.prepare(`INSERT INTO support_case_events
        (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?').bind(event.event_hash,event.at,caseId),
    ]);
    return Object.freeze({case_id:caseId,assigned_operator_ref:assigned,assigned_at:at});
  }

  async proposeSensitiveAction(caseId, input, principal) {
    const row = await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,last_event_hash,created_at,updated_at
      FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if (!row) return null;
    const action = String(input?.action || '');
    if (!SENSITIVE_ACTIONS.includes(action)) throw new TypeError('unknown sensitive action');
    const hashes = Array.isArray(input?.evidence_hashes) ? input.evidence_hashes.map(String) : [];
    if (!hashes.length || hashes.some(hash => !/^[a-f0-9]{64}$/i.test(hash))) throw new TypeError('approval evidence hashes are required');
    const proposerRef=String(principal?.actor_ref||''), proposerRole=String(principal?.role||'');
    if(!proposerRef||!proposerRole) throw new DOMException('proposal identity required','NotAllowedError');
    const approvalId='AXA-'+randomToken(16), at=new Date().toISOString();
    const event=await appendCaseEvent(row,{type:'SENSITIVE_ACTION_PROPOSED',actor:proposerRef,visibility:'internal',payload:{approval_id:approvalId,action,evidence_hashes:hashes}},{at});
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_case_approvals
        (approval_id,case_id,action,proposer_ref,proposer_role,evidence_hashes_json,event_hash,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(approvalId,caseId,action,proposerRef,proposerRole,JSON.stringify(hashes),event.event_hash,at),
      this.db.prepare(`INSERT INTO support_case_events
        (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?').bind(event.event_hash,event.at,caseId),
    ]);
    return Object.freeze({approval_id:approvalId,case_id:caseId,status:'PENDING',action,created_at:at});
  }

  async approveSensitiveAction(caseId, approvalId, input, principal) {
    const proposal = await this.db.prepare(`SELECT approval_id,case_id,action,proposer_ref,proposer_role,evidence_hashes_json,event_hash,created_at
      FROM support_case_approvals WHERE approval_id=? AND case_id=? LIMIT 1`).bind(approvalId,caseId).first();
    if(!proposal) return null;
    const approverRef=String(principal?.actor_ref||''), approverRole=String(principal?.role||'');
    if(!approverRef||!approverRole) throw new DOMException('approver identity required','NotAllowedError');
    if(approverRef===String(proposal.proposer_ref)) throw new DOMException('proposer cannot approve own sensitive action','NotAllowedError');
    const priorDecision=await this.db.prepare(`SELECT decision_id FROM support_case_approval_decisions WHERE approval_id=? LIMIT 1`).bind(approvalId).first();
    if(priorDecision) throw new DOMException('approval request already decided','InvalidStateError');
    const row=await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,last_event_hash,created_at,updated_at
      FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if(!row) return null;
    const decision=String(input?.decision||'APPROVED').toUpperCase();
    if(!['APPROVED','REJECTED'].includes(decision)) throw new TypeError('approval decision is invalid');
    const decisionId='AXD-'+randomToken(16),at=new Date().toISOString();
    const event=await appendCaseEvent(row,{type:'SENSITIVE_ACTION_'+decision,actor:approverRef,visibility:'internal',payload:{approval_id:approvalId,decision,action:proposal.action}},{at});
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_case_approval_decisions
        (decision_id,approval_id,case_id,decision,approver_ref,approver_role,event_hash,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(decisionId,approvalId,caseId,decision,approverRef,approverRole,event.event_hash,at),
      this.db.prepare(`INSERT INTO support_case_events
        (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?').bind(event.event_hash,event.at,caseId),
    ]);
    return Object.freeze({approval_id:approvalId,decision_id:decisionId,case_id:caseId,status:decision,action:proposal.action,decided_at:at});
  }

  async listOperatorCases({state = null, limit = 100} = {}) {
    const bounded = Math.max(1, Math.min(100, Number(limit) || 100));
    const fields = `SELECT case_id,state,priority,surface,category,retention_class,human_approval_required,created_at,updated_at
      FROM support_cases`;
    const statement = state
      ? this.db.prepare(fields + ' WHERE state=? ORDER BY updated_at DESC LIMIT ?').bind(state, bounded)
      : this.db.prepare(fields + ' ORDER BY updated_at DESC LIMIT ?').bind(bounded);
    const result = await statement.all();
    return Object.freeze((result?.results || []).map(row => Object.freeze({...row})));
  }
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function randomToken(length){const alphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ';const bytes=crypto.getRandomValues(new Uint8Array(length));return [...bytes].map(byte=>alphabet[byte%alphabet.length]).join('');}
