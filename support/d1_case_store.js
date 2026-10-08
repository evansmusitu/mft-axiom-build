import {encryptSupportPayload, decryptSupportPayload} from './crypto_envelope.js';
import {SENSITIVE_ACTIONS, SecretMaterialError, appendCaseEvent, assertTransition, createConversationMessage, inspectSecretMaterial, newRecoveryCode, publicCaseView, recoveryIdentityHash, sha256, storageStateForPublicLabel} from './control_plane.js';
import {buildTriageEnvelope, buildWebhookEvent, computeSlaClock, createOperatorLease, escalationLane, normalizeLanguage, validateAttachmentMetadata, validateCsat, validateDiagnostics, validateQaReview} from './global_ops.js';

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
    const requestedPlan=String(intake.support_plan||'STANDARD').toUpperCase();
    const plan=['COMMUNITY','STANDARD','BUSINESS','ENTERPRISE'].includes(requestedPlan)?requestedPlan:'STANDARD';
    const language=normalizeLanguage(intake.language||'und');
    const sla=computeSlaClock({priority:record.priority,plan,createdAt:record.created_at});
    const triage=buildTriageEnvelope({
      case_id:record.case_id,priority:record.priority,category:record.category,surface:record.surface,language,
    });
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
      this.db.prepare(`INSERT INTO support_case_sla
        (case_id,plan,ack_due_at,update_due_at,resolve_target_at,acknowledged_at,last_meaningful_update_at,resolved_at,contractual,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(
        record.case_id,plan,sla.ack_due_at,sla.update_due_at,sla.resolve_target_at,null,null,null,sla.contractual?1:0,record.created_at,
      ),
      this.db.prepare(`INSERT INTO support_case_triage
        (case_id,lane,language,advisory_only,human_review_required,updated_at) VALUES (?,?,?,?,?,?)`).bind(
        record.case_id,triage.lane,triage.language,1,1,record.created_at,
      ),
      this.db.prepare(`INSERT INTO support_case_languages
        (case_id,language,detected_from,updated_at) VALUES (?,?,?,?)`).bind(
        record.case_id,language,intake.language?'customer':'unknown',record.created_at,
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
      this.db.prepare(`UPDATE support_case_sla
        SET acknowledged_at=COALESCE(acknowledged_at,?),last_meaningful_update_at=CASE WHEN ?='AGENT_REPLY' THEN ? ELSE last_meaningful_update_at END,updated_at=?
        WHERE case_id=?`).bind(event.at,type,event.at,event.at,caseId),
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
    const attachmentResult=await this.db.prepare(`SELECT attachment_id,filename,content_type,bytes,sha256,scan_state,created_at FROM support_attachments WHERE case_id=? AND visibility='customer' AND scan_state='CLEAN' ORDER BY created_at ASC`).bind(caseId).all();
    const attachments=Object.freeze((attachmentResult?.results||[]).map(item=>Object.freeze({...item,bytes:Number(item.bytes||0)})));
    return Object.freeze({case: JSON.parse(row.public_json), details, messages: Object.freeze(messages), attachments: Object.freeze(attachments)});
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
    const recoveryResult = await this.db.prepare(`SELECT request_id,evidence_hash,created_at
      FROM support_case_recovery_requests WHERE case_id=? ORDER BY created_at ASC`).bind(caseId).all();
    const approvalsResult = await this.db.prepare(`SELECT a.approval_id,a.action,a.proposer_ref,a.proposer_role,a.evidence_hashes_json,a.created_at,
      d.decision,d.approver_ref,d.approver_role,d.created_at AS decided_at
      FROM support_case_approvals a
      LEFT JOIN support_case_approval_decisions d ON d.approval_id=a.approval_id AND d.case_id=a.case_id
      WHERE a.case_id=? ORDER BY a.created_at ASC`).bind(caseId).all();
    const recoveryRequests = Object.freeze((recoveryResult?.results || []).map(item => Object.freeze({
      request_id:String(item.request_id),evidence_hash:String(item.evidence_hash),created_at:String(item.created_at),
    })));
    const approvals = Object.freeze((approvalsResult?.results || []).map(item => Object.freeze({
      approval_id:String(item.approval_id),action:String(item.action),proposer_ref:String(item.proposer_ref),
      proposer_role:String(item.proposer_role),evidence_hashes:Object.freeze(JSON.parse(String(item.evidence_hashes_json || '[]'))),
      created_at:String(item.created_at),decision:item.decision ? String(item.decision) : null,
      approver_ref:item.approver_ref ? String(item.approver_ref) : null,
      approver_role:item.approver_role ? String(item.approver_role) : null,
      decided_at:item.decided_at ? String(item.decided_at) : null,
    })));
    const attachmentResult=await this.db.prepare(`SELECT attachment_id,filename,content_type,bytes,sha256,storage_key,scan_state,visibility,created_at FROM support_attachments WHERE case_id=? ORDER BY created_at ASC`).bind(caseId).all();
    const attachments=Object.freeze((attachmentResult?.results||[]).map(item=>Object.freeze({...item,bytes:Number(item.bytes||0)})));
    return Object.freeze({case: JSON.parse(row.public_json), details, messages: Object.freeze(messages), recovery_requests: recoveryRequests, approvals, attachments});
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
      this.db.prepare("UPDATE support_cases SET state=?,public_json=?,last_event_hash=?,updated_at=?,closed_at=CASE WHEN ?='CLOSED' THEN ? ELSE closed_at END WHERE case_id=?")
        .bind(next,JSON.stringify(nextPublic),event.event_hash,event.at,next,event.at,caseId),
      this.db.prepare(`UPDATE support_case_sla SET resolved_at=CASE WHEN ? IN ('RESOLVED','CLOSED') THEN COALESCE(resolved_at,?) ELSE resolved_at END,updated_at=? WHERE case_id=?`)
        .bind(next,event.at,event.at,caseId),
      this.db.prepare(`INSERT INTO support_case_events
        (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).bind(
        event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,
        JSON.stringify(event.payload),event.at,
      ),
    ]);
    return Object.freeze({case_id:caseId,state:next,public_label:String(label),updated_at:event.at});
  }


  async bindRecoveryIdentity(caseId, recoveryCode, identity) {
    const recoveryHash = await sha256(recoveryCode);
    const identityHash = await recoveryIdentityHash(identity);
    const row = await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,recovery_hash,last_event_hash,created_at,updated_at
      FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if (!row || !constantTimeEqual(String(row.recovery_hash), recoveryHash)) return null;
    const existing = await this.db.prepare(`SELECT identity_hash,provider,created_at FROM support_case_recovery_bindings WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if (existing) {
      if (!constantTimeEqual(String(existing.identity_hash), identityHash)) return null;
      return Object.freeze({case_id:caseId,bound:true,already_bound:true,provider:String(existing.provider),bound_at:String(existing.created_at)});
    }
    const at = new Date().toISOString();
    const event = await appendCaseEvent(row,{
      type:'RECOVERY_IDENTITY_BOUND',actor:'requester',visibility:'customer',
      payload:{provider:'cloudflare_access'},
    },{at});
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_case_recovery_bindings
        (case_id,identity_hash,provider,event_hash,created_at) VALUES (?,?,?,?,?)`)
        .bind(caseId,identityHash,'cloudflare_access',event.event_hash,at),
      this.db.prepare(`INSERT INTO support_case_events
        (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?')
        .bind(event.event_hash,event.at,caseId),
    ]);
    return Object.freeze({case_id:caseId,bound:true,already_bound:false,provider:'cloudflare_access',bound_at:at});
  }

  async rotateRecoveryCredential(caseId, identity, {recoveryCode = newRecoveryCode()} = {}) {
    const identityHash = await recoveryIdentityHash(identity);
    const row = await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,recovery_hash,last_event_hash,created_at,updated_at
      FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if (!row) return null;
    const binding = await this.db.prepare(`SELECT identity_hash,provider,created_at FROM support_case_recovery_bindings WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if (!binding || !constantTimeEqual(String(binding.identity_hash), identityHash)) return null;

    let approvalId = null;
    if (Number(row.human_approval_required) === 1) {
      const approved = await this.db.prepare(`SELECT a.approval_id
        FROM support_case_approvals a
        JOIN support_case_approval_decisions d ON d.approval_id=a.approval_id AND d.case_id=a.case_id
        LEFT JOIN support_case_recovery_rotations r ON r.approval_id=a.approval_id
        WHERE a.case_id=? AND a.action='ACCOUNT_RECOVERY' AND d.decision='APPROVED' AND r.rotation_id IS NULL
        ORDER BY d.created_at DESC LIMIT 1`).bind(caseId).first();
      approvalId = approved ? String(approved.approval_id || '') : null;
      if (!approvalId) {
        const existingRequest = await this.db.prepare(`SELECT q.request_id,q.evidence_hash,q.created_at
          FROM support_case_recovery_requests q
          WHERE q.case_id=? AND q.identity_hash=?
            AND NOT EXISTS (
              SELECT 1 FROM support_case_recovery_rotations r
              WHERE r.case_id=q.case_id AND r.created_at >= q.created_at
            )
          ORDER BY q.created_at DESC LIMIT 1`).bind(caseId,identityHash).first();
        if (existingRequest) {
          return Object.freeze({
            case_id:caseId,status:'APPROVAL_REQUIRED',
            request_id:String(existingRequest.request_id),requested_at:String(existingRequest.created_at),
          });
        }

        const at = new Date().toISOString();
        const requestId = 'AXQ-' + randomToken(16);
        const evidenceHash = await sha256({
          schema:'musitu.axiom.support-recovery-request-evidence.v1',
          request_id:requestId,case_id:caseId,identity_hash:identityHash,created_at:at,
        });
        const event = await appendCaseEvent(row,{
          type:'RECOVERY_APPROVAL_REQUESTED',actor:'requester',visibility:'internal',
          payload:{request_id:requestId,evidence_hash:evidenceHash},
        },{at});
        const notificationId = 'AXN-' + randomToken(16);
        await this.db.batch([
          this.db.prepare(`INSERT INTO support_case_recovery_requests
            (request_id,case_id,identity_hash,evidence_hash,event_hash,created_at) VALUES (?,?,?,?,?,?)`)
            .bind(requestId,caseId,identityHash,evidenceHash,event.event_hash,at),
          this.db.prepare(`INSERT INTO support_case_events
            (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
            .bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
          this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?')
            .bind(event.event_hash,event.at,caseId),
          this.db.prepare(`INSERT INTO support_notification_outbox
            (notification_id,case_id,kind,audience,event_hash,created_at) VALUES (?,?,?,?,?,?)`)
            .bind(notificationId,caseId,'RECOVERY_APPROVAL_REQUIRED','operator',event.event_hash,at),
        ]);
        return Object.freeze({case_id:caseId,status:'APPROVAL_REQUIRED',request_id:requestId,requested_at:at});
      }
    }

    const priorRecoveryHash = String(row.recovery_hash || '');
    const newRecoveryHash = await sha256(recoveryCode);
    if (!/^[a-f0-9]{64}$/i.test(priorRecoveryHash) || !/^[a-f0-9]{64}$/i.test(newRecoveryHash)) throw new DOMException('recovery hash invariant failed','InvalidStateError');
    const at = new Date().toISOString();
    const rotationId = 'AXR-' + randomToken(16);
    const event = await appendCaseEvent(row,{
      type:'RECOVERY_CODE_ROTATED',actor:'requester',visibility:'customer',
      payload:{identity_verified:true,approval_id:approvalId},
    },{at});
    await this.db.batch([
      this.db.prepare('UPDATE support_cases SET recovery_hash=?,last_event_hash=?,updated_at=? WHERE case_id=?')
        .bind(newRecoveryHash,event.event_hash,event.at,caseId),
      this.db.prepare(`INSERT INTO support_case_recovery_rotations
        (rotation_id,case_id,approval_id,prior_recovery_hash,new_recovery_hash,event_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
        .bind(rotationId,caseId,approvalId,priorRecoveryHash,newRecoveryHash,event.event_hash,at),
      this.db.prepare(`INSERT INTO support_case_events
        (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
    ]);
    return Object.freeze({
      case_id:caseId,status:'ROTATED',recovery_code:recoveryCode,
      recovery_code_notice:'Save this new code now. It is shown once. The previous recovery code is invalid.',
      rotation_id:rotationId,approval_id:approvalId,rotated_at:at,
    });
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
      this.db.prepare('UPDATE support_case_sla SET acknowledged_at=COALESCE(acknowledged_at,?),updated_at=? WHERE case_id=?').bind(at,at,caseId),
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

  async recordDiagnostics(caseId,recoveryCode,input){
    const recoveryHash=await sha256(recoveryCode);
    const row=await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,recovery_hash,last_event_hash,created_at,updated_at
      FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if(!row||!constantTimeEqual(String(row.recovery_hash),recoveryHash))return null;
    const validated=validateDiagnostics(input);
    if(!validated.ok)throw new TypeError(validated.errors.join('; '));
    const diagnosticId='AXG-'+randomToken(16),at=new Date().toISOString();
    const event=await appendCaseEvent(row,{type:'DIAGNOSTICS_RECEIVED',actor:'requester',visibility:'internal',payload:{diagnostic_id:diagnosticId}},{at});
    const notificationId='AXN-'+randomToken(16);
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_diagnostics (diagnostic_id,case_id,consented,metadata_json,event_hash,created_at) VALUES (?,?,?,?,?,?)`)
        .bind(diagnosticId,caseId,1,JSON.stringify(validated.value),event.event_hash,at),
      this.db.prepare(`INSERT INTO support_case_events (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?').bind(event.event_hash,event.at,caseId),
      this.db.prepare(`INSERT INTO support_notification_outbox (notification_id,case_id,kind,audience,event_hash,created_at) VALUES (?,?,?,?,?,?)`)
        .bind(notificationId,caseId,'DIAGNOSTICS_RECEIVED','operator',event.event_hash,at),
    ]);
    return Object.freeze({diagnostic_id:diagnosticId,case_id:caseId,created_at:at});
  }

  async recordCsat(caseId,recoveryCode,input){
    const recoveryHash=await sha256(recoveryCode);
    const row=await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,recovery_hash,last_event_hash,created_at,updated_at
      FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if(!row||!constantTimeEqual(String(row.recovery_hash),recoveryHash))return null;
    const validated=validateCsat(input);if(!validated.ok)throw new TypeError(validated.errors.join('; '));
    const responseId='AXC-'+randomToken(16),at=new Date().toISOString();
    const encrypted=await encryptSupportPayload({reason:validated.value.reason},{key:this.key,caseId,schema:'musitu.axiom.support-csat-encrypted.v1'});
    const event=await appendCaseEvent(row,{type:'CSAT_RECEIVED',actor:'requester',visibility:'internal',payload:{response_id:responseId,score:validated.value.score}},{at});
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_csat (response_id,case_id,score,reason_encrypted,created_at) VALUES (?,?,?,?,?)`)
        .bind(responseId,caseId,validated.value.score,JSON.stringify(encrypted),at),
      this.db.prepare(`INSERT INTO support_case_events (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?').bind(event.event_hash,event.at,caseId),
    ]);
    return Object.freeze({response_id:responseId,case_id:caseId,score:validated.value.score,created_at:at});
  }

  async requestCustomerEscalation(caseId,recoveryCode,input={}){
    const recoveryHash=await sha256(recoveryCode);
    const row=await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,recovery_hash,last_event_hash,created_at,updated_at
      FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if(!row||!constantTimeEqual(String(row.recovery_hash),recoveryHash))return null;
    const lane=escalationLane(row),reason=String(input.reason_code||'CUSTOMER_ESCALATION').toUpperCase();
    if(!/^[A-Z][A-Z0-9_]{2,79}$/.test(reason))throw new TypeError('escalation reason invalid');
    const escalationId='AXE-'+randomToken(16),at=new Date().toISOString();
    const event=await appendCaseEvent(row,{type:'CUSTOMER_ESCALATION_REQUESTED',actor:'requester',visibility:'customer',payload:{escalation_id:escalationId,lane,reason_code:reason}},{at});
    const notificationId='AXN-'+randomToken(16);
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_case_escalations (escalation_id,case_id,lane,reason_code,requested_by,status,event_hash,created_at,closed_at) VALUES (?,?,?,?,?,'OPEN',?,?,NULL)`)
        .bind(escalationId,caseId,lane,reason,'requester',event.event_hash,at),
      this.db.prepare(`INSERT INTO support_case_events (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?').bind(event.event_hash,event.at,caseId),
      this.db.prepare(`INSERT INTO support_notification_outbox (notification_id,case_id,kind,audience,event_hash,created_at) VALUES (?,?,?,?,?,?)`)
        .bind(notificationId,caseId,'CUSTOMER_ESCALATION_REQUESTED','operator',event.event_hash,at),
    ]);
    return Object.freeze({escalation_id:escalationId,case_id:caseId,lane,reason_code:reason,status:'OPEN',created_at:at});
  }

  async prepareAttachment(caseId,recoveryCode,input={}){
    const recoveryHash=await sha256(recoveryCode);
    const row=await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,recovery_hash,last_event_hash,created_at,updated_at
      FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if(!row||!constantTimeEqual(String(row.recovery_hash),recoveryHash))return null;
    const attachmentId='AXF-'+randomToken(16);
    const validated=validateAttachmentMetadata({
      attachmentId,caseId,filename:input.filename,contentType:input.content_type,bytes:input.bytes,sha256:input.sha256,
      storageKey:'cases/'+caseId+'/'+attachmentId,
    });
    if(!validated.ok)throw new TypeError(validated.errors.join('; '));
    const at=new Date().toISOString();
    const event=await appendCaseEvent(row,{type:'ATTACHMENT_UPLOAD_PREPARED',actor:'requester',visibility:'customer',payload:{attachment_id:attachmentId,sha256:validated.value.sha256,bytes:validated.value.bytes}},{at});
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_attachments (attachment_id,case_id,filename,content_type,bytes,sha256,storage_key,scan_state,visibility,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(attachmentId,caseId,validated.value.filename,validated.value.content_type,validated.value.bytes,validated.value.sha256,validated.value.storage_key,'PENDING','customer',at),
      this.db.prepare(`INSERT INTO support_case_events (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?').bind(event.event_hash,event.at,caseId),
    ]);
    return Object.freeze({...validated.value,created_at:at});
  }

  async leaseOperatorCase(caseId,principal,{minutes=10}={}){
    const exists=await this.db.prepare('SELECT case_id FROM support_cases WHERE case_id=? LIMIT 1').bind(caseId).first();
    if(!exists)return null;
    const lease=createOperatorLease({caseId,operatorRef:principal?.actor_ref,at:new Date().toISOString(),minutes:Number(minutes)||10});
    const current=await this.db.prepare('SELECT case_id,operator_ref,acquired_at,expires_at FROM support_operator_leases WHERE case_id=? LIMIT 1').bind(caseId).first();
    if(current&&Date.parse(String(current.expires_at))>Date.now()&&String(current.operator_ref)!==lease.operator_ref)throw new DOMException('case is actively leased by another operator','InvalidStateError');
    await this.db.prepare(`INSERT INTO support_operator_leases (case_id,operator_ref,acquired_at,expires_at) VALUES (?,?,?,?)
      ON CONFLICT(case_id) DO UPDATE SET operator_ref=excluded.operator_ref,acquired_at=excluded.acquired_at,expires_at=excluded.expires_at`)
      .bind(caseId,lease.operator_ref,lease.acquired_at,lease.expires_at).run?.();
    return lease;
  }

  async handoffOperatorCase(caseId,input={},principal){
    const row=await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,last_event_hash,created_at,updated_at
      FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if(!row)return null;
    const toLane=String(input.to_lane||escalationLane(row)).toUpperCase();
    if(!/^[A-Z][A-Z0-9_]{2,79}$/.test(toLane))throw new TypeError('handoff lane invalid');
    const note=String(input.note||'').trim();if(!note||note.length>4000)throw new TypeError('handoff note required');
    const secret=inspectSecretMaterial({note});if(!secret.safe)throw new SecretMaterialError(secret.findings);
    const handoffId='AXH-'+randomToken(16),at=new Date().toISOString();
    const encrypted=await encryptSupportPayload({note},{key:this.key,caseId,schema:'musitu.axiom.support-handoff-encrypted.v1'});
    const event=await appendCaseEvent(row,{type:'CASE_HANDOFF',actor:principal?.actor_ref,visibility:'internal',payload:{handoff_id:handoffId,to_lane:toLane}},{at});
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_case_handoffs (handoff_id,case_id,from_ref,to_lane,note_encrypted,event_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
        .bind(handoffId,caseId,String(principal?.actor_ref||''),toLane,JSON.stringify(encrypted),event.event_hash,at),
      this.db.prepare(`INSERT INTO support_case_events (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?').bind(event.event_hash,event.at,caseId),
    ]);
    return Object.freeze({handoff_id:handoffId,case_id:caseId,to_lane:toLane,created_at:at});
  }

  async escalateOperatorCase(caseId,input={},principal){
    const row=await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,last_event_hash,created_at,updated_at
      FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if(!row)return null;
    const lane=String(input.lane||escalationLane(row)).toUpperCase(),reason=String(input.reason_code||'OPERATOR_ESCALATION').toUpperCase();
    if(!/^[A-Z][A-Z0-9_]{2,79}$/.test(lane)||!/^[A-Z][A-Z0-9_]{2,79}$/.test(reason))throw new TypeError('escalation metadata invalid');
    const escalationId='AXE-'+randomToken(16),at=new Date().toISOString();
    const event=await appendCaseEvent(row,{type:'CASE_ESCALATED',actor:principal?.actor_ref,visibility:'internal',payload:{escalation_id:escalationId,lane,reason_code:reason}},{at});
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_case_escalations (escalation_id,case_id,lane,reason_code,requested_by,status,event_hash,created_at,closed_at) VALUES (?,?,?,?,?,'OPEN',?,?,NULL)`)
        .bind(escalationId,caseId,lane,reason,String(principal?.actor_ref||''),event.event_hash,at),
      this.db.prepare(`INSERT INTO support_case_events (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?').bind(event.event_hash,event.at,caseId),
    ]);
    return Object.freeze({escalation_id:escalationId,case_id:caseId,lane,reason_code:reason,status:'OPEN',created_at:at});
  }

  async createIncident(input={},principal){
    const title=String(input.title||'').trim(),summary=String(input.public_summary||'').trim(),severity=String(input.severity||'P2').toUpperCase();
    if(!title||title.length>160||!summary||summary.length>2000||!['P0','P1','P2','P3'].includes(severity))throw new TypeError('incident metadata invalid');
    const secret=inspectSecretMaterial({title,summary});if(!secret.safe)throw new SecretMaterialError(secret.findings);
    const incidentId='AXI-'+randomToken(16),at=new Date().toISOString();
    await this.db.prepare(`INSERT INTO support_incidents (incident_id,title,severity,state,public_summary,created_at,updated_at) VALUES (?,?,?,'INVESTIGATING',?,?,?)`)
      .bind(incidentId,title,severity,summary,at,at).run?.();
    return Object.freeze({incident_id:incidentId,title,severity,state:'INVESTIGATING',public_summary:summary,created_at:at,updated_at:at});
  }

  async linkIncidentCase(incidentId,caseId,principal){
    const incident=await this.db.prepare('SELECT incident_id FROM support_incidents WHERE incident_id=? LIMIT 1').bind(incidentId).first();
    const supportCase=await this.db.prepare('SELECT case_id FROM support_cases WHERE case_id=? LIMIT 1').bind(caseId).first();
    if(!incident||!supportCase)return null;
    const at=new Date().toISOString();
    await this.db.prepare(`INSERT OR IGNORE INTO support_incident_cases (incident_id,case_id,linked_by,created_at) VALUES (?,?,?,?)`)
      .bind(incidentId,caseId,String(principal?.actor_ref||''),at).run?.();
    return Object.freeze({incident_id:incidentId,case_id:caseId,linked_at:at});
  }

  async listPublicIncidents(){
    const result=await this.db.prepare(`SELECT incident_id,title,severity,state,public_summary,created_at,updated_at FROM support_incidents
      WHERE state!='RESOLVED' ORDER BY CASE severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,updated_at DESC LIMIT 50`).all();
    return Object.freeze((result?.results||[]).map(row=>Object.freeze({...row})));
  }

  async listOperatorIncidents(){
    const result=await this.db.prepare(`SELECT i.incident_id,i.title,i.severity,i.state,i.public_summary,i.created_at,i.updated_at,
      (SELECT COUNT(*) FROM support_incident_cases c WHERE c.incident_id=i.incident_id) AS linked_cases
      FROM support_incidents i ORDER BY i.updated_at DESC LIMIT 100`).all();
    return Object.freeze((result?.results||[]).map(row=>Object.freeze({...row,linked_cases:Number(row.linked_cases||0)})));
  }

  async globalOpsAnalytics(){
    const row=await this.db.prepare(`SELECT
      (SELECT COUNT(*) FROM support_cases WHERE state NOT IN ('CLOSED','REJECTED','DUPLICATE')) AS open_cases,
      (SELECT COUNT(*) FROM support_case_sla s JOIN support_cases c ON c.case_id=s.case_id
        WHERE c.state NOT IN ('CLOSED','RESOLVED','REJECTED','DUPLICATE')
          AND ((s.acknowledged_at IS NULL AND s.ack_due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR s.resolve_target_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))) AS sla_breached,
      (SELECT ROUND(AVG(score),2) FROM support_csat) AS csat_average,
      (SELECT COUNT(*) FROM support_case_escalations WHERE status='OPEN') AS open_escalations,
      (SELECT COUNT(*) FROM support_incidents WHERE state!='RESOLVED') AS active_incidents,
      (SELECT COUNT(*) FROM support_attachments WHERE scan_state='PENDING') AS attachments_pending_scan`).first();
    return Object.freeze({
      schema:'musitu.axiom.support-analytics.v1',open_cases:Number(row?.open_cases||0),sla_breached:Number(row?.sla_breached||0),
      csat_average:row?.csat_average==null?null:Number(row.csat_average),open_escalations:Number(row?.open_escalations||0),
      active_incidents:Number(row?.active_incidents||0),attachments_pending_scan:Number(row?.attachments_pending_scan||0),
    });
  }

  async listPendingNotifications({limit=50}={}){
    const bounded=Math.max(1,Math.min(100,Number(limit)||50));
    const result=await this.db.prepare(`SELECT n.notification_id,n.case_id,n.kind,n.audience,n.event_hash,n.created_at,
        (SELECT COUNT(*) FROM support_notification_attempts a WHERE a.notification_id=n.notification_id) AS attempts
      FROM support_notification_outbox n
      WHERE NOT EXISTS (SELECT 1 FROM support_notification_attempts a WHERE a.notification_id=n.notification_id AND a.state='SENT')
        AND (SELECT COUNT(*) FROM support_notification_attempts a WHERE a.notification_id=n.notification_id) < 8
        AND (
          NOT EXISTS (SELECT 1 FROM support_notification_attempts a WHERE a.notification_id=n.notification_id)
          OR (SELECT MAX(a.attempted_at) FROM support_notification_attempts a WHERE a.notification_id=n.notification_id)
             <= strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes')
        )
      ORDER BY n.created_at ASC LIMIT ?`).bind(bounded).all();
    return Object.freeze((result?.results||[]).map(row=>Object.freeze({...row,attempts:Number(row.attempts||0)})));
  }

  async recordNotificationAttempt(notification,result){
    const attemptId='AXY-'+randomToken(16),at=new Date().toISOString();
    const state=result?.delivered?'SENT':result?.reason==='PROVIDER_UNAVAILABLE'?'RETRY':'FAILED';
    const providerHash=result?.receipt_id?await sha256(String(result.receipt_id)):null;
    await this.db.prepare(`INSERT INTO support_notification_attempts (attempt_id,notification_id,channel,state,provider_ref_hash,attempted_at) VALUES (?,?,?,?,?,?)`)
      .bind(attemptId,String(notification.notification_id),'email',state,providerHash,at).run?.();
    return Object.freeze({attempt_id:attemptId,state,attempted_at:at});
  }

  async listPendingWebhookDeliveries({limit=50}={}){
    const bounded=Math.max(1,Math.min(100,Number(limit)||50));
    const result=await this.db.prepare(`SELECT delivery_id,webhook_ref,case_id,event_type,payload_json,event_hash,state,attempts,next_attempt_at,created_at
      FROM support_webhook_outbox WHERE state IN ('PENDING','RETRY') AND (next_attempt_at IS NULL OR next_attempt_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ORDER BY created_at ASC LIMIT ?`).bind(bounded).all();
    return Object.freeze((result?.results||[]).map(row=>Object.freeze({...row,payload:JSON.parse(String(row.payload_json||'{}'))})));
  }

  async recordWebhookAttempt(delivery,result){
    const delivered=result?.delivered===true,attempts=Number(delivery?.attempts||0)+1;
    const state=delivered?'DELIVERED':attempts>=5?'DEAD':'RETRY';
    const at=new Date().toISOString();
    const next=delivered||state==='DEAD'?null:new Date(Date.now()+Math.min(3600,Math.pow(2,attempts)*60)*1000).toISOString();
    await this.db.prepare(`UPDATE support_webhook_outbox SET state=?,attempts=?,next_attempt_at=?,delivered_at=? WHERE delivery_id=?`)
      .bind(state,attempts,next,delivered?at:null,String(delivery.delivery_id)).run?.();
    return Object.freeze({delivery_id:String(delivery.delivery_id),state,attempts,next_attempt_at:next,delivered_at:delivered?at:null});
  }


  async reopenCustomerCase(caseId,recoveryCode){
    const recoveryHash=await sha256(recoveryCode);
    const row=await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,recovery_hash,public_json,last_event_hash,closed_at,created_at,updated_at FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();
    if(!row||!constantTimeEqual(String(row.recovery_hash),recoveryHash))return null;
    if(String(row.state)!=='CLOSED')throw new DOMException('only closed cases can be reopened','InvalidStateError');
    const closedAt=String(row.closed_at||row.updated_at||'');if(!closedAt||Date.now()-Date.parse(closedAt)>14*24*60*60*1000)throw new DOMException('case reopen window expired','InvalidStateError');
    const at=new Date().toISOString(),event=await appendCaseEvent(row,{type:'CASE_REOPENED',actor:'requester',visibility:'customer',payload:{prior_state:'CLOSED',new_state:'IN_PROGRESS'}},{at});
    const publicJson={...JSON.parse(row.public_json),state:'IN_PROGRESS',updated_at:at};
    const slaRow=await this.db.prepare('SELECT plan FROM support_case_sla WHERE case_id=? LIMIT 1').bind(caseId).first();
    const clock=computeSlaClock({priority:row.priority,plan:String(slaRow?.plan||'STANDARD'),createdAt:at});
    const notificationId='AXN-'+randomToken(16);
    await this.db.batch([
      this.db.prepare('UPDATE support_cases SET state=?,public_json=?,last_event_hash=?,updated_at=?,closed_at=NULL WHERE case_id=?').bind('IN_PROGRESS',JSON.stringify(publicJson),event.event_hash,at,caseId),
      this.db.prepare('UPDATE support_case_sla SET update_due_at=?,resolve_target_at=?,resolved_at=NULL,last_meaningful_update_at=NULL,updated_at=? WHERE case_id=?').bind(clock.update_due_at,clock.resolve_target_at,at,caseId),
      this.db.prepare(`INSERT INTO support_case_events (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
      this.db.prepare(`INSERT INTO support_notification_outbox (notification_id,case_id,kind,audience,event_hash,created_at) VALUES (?,?,?,?,?,?)`).bind(notificationId,caseId,'CASE_REOPENED','operator',event.event_hash,at),
    ]);
    return Object.freeze({case_id:caseId,state:'IN_PROGRESS',reopened:true,reopened_at:at});
  }

  async authorizeAttachmentUpload(caseId,recoveryCode,attachmentId){
    const recoveryHash=await sha256(recoveryCode);
    const row=await this.db.prepare(`SELECT a.attachment_id,a.case_id,a.content_type,a.bytes,a.sha256,a.storage_key,a.scan_state,c.recovery_hash
      FROM support_attachments a JOIN support_cases c ON c.case_id=a.case_id
      WHERE a.attachment_id=? AND a.case_id=? LIMIT 1`).bind(attachmentId,caseId).first();
    if(!row||!constantTimeEqual(String(row.recovery_hash),recoveryHash)||String(row.scan_state)!=='PENDING')return null;
    return Object.freeze({
      attachment_id:String(row.attachment_id),case_id:String(row.case_id),content_type:String(row.content_type),
      bytes:Number(row.bytes),sha256:String(row.sha256),storage_key:String(row.storage_key),scan_state:String(row.scan_state),
    });
  }

  async authorizeAttachmentDownload(caseId,recoveryCode,attachmentId){
    const recoveryHash=await sha256(recoveryCode);
    const row=await this.db.prepare(`SELECT a.attachment_id,a.case_id,a.filename,a.content_type,a.bytes,a.sha256,a.storage_key,a.scan_state,c.recovery_hash
      FROM support_attachments a JOIN support_cases c ON c.case_id=a.case_id
      WHERE a.attachment_id=? AND a.case_id=? AND a.visibility='customer' AND a.scan_state='CLEAN' LIMIT 1`).bind(attachmentId,caseId).first();
    if(!row||!constantTimeEqual(String(row.recovery_hash),recoveryHash))return null;
    return Object.freeze({
      attachment_id:String(row.attachment_id),case_id:String(row.case_id),filename:String(row.filename),content_type:String(row.content_type),
      bytes:Number(row.bytes),sha256:String(row.sha256),storage_key:String(row.storage_key),scan_state:'CLEAN',
    });
  }

  async markAttachmentUploaded(attachmentId,principal={actor_ref:'requester'}){
    const item=await this.db.prepare(`SELECT a.attachment_id,a.case_id,a.scan_state,c.state,c.priority,c.surface,c.category,c.requester_ref,c.retention_class,
      c.human_approval_required,c.last_event_hash,c.created_at,c.updated_at
      FROM support_attachments a JOIN support_cases c ON c.case_id=a.case_id WHERE a.attachment_id=? LIMIT 1`).bind(attachmentId).first();
    if(!item||String(item.scan_state)!=='PENDING')return null;
    const at=new Date().toISOString();
    const event=await appendCaseEvent(item,{type:'ATTACHMENT_UPLOADED',actor:String(principal?.actor_ref||'requester'),visibility:'internal',payload:{attachment_id:attachmentId,scan_state:'PENDING'}},{at});
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_case_events (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?').bind(event.event_hash,event.at,item.case_id),
    ]);
    return Object.freeze({attachment_id:attachmentId,case_id:String(item.case_id),scan_state:'PENDING',uploaded_at:at});
  }

  async recordAttachmentScan(attachmentId,input={},principal){
    const state=String(input.scan_state||'').toUpperCase(),scannerRef=String(input.scanner_ref||'');
    if(!['CLEAN','QUARANTINED','FAILED'].includes(state)||!/^scanner:[a-z0-9._:-]{6,180}$/i.test(scannerRef))throw new TypeError('attachment scan metadata invalid');
    const item=await this.db.prepare(`SELECT a.attachment_id,a.case_id,a.scan_state,c.state,c.priority,c.surface,c.category,c.requester_ref,c.retention_class,c.human_approval_required,c.last_event_hash,c.created_at,c.updated_at
      FROM support_attachments a JOIN support_cases c ON c.case_id=a.case_id WHERE a.attachment_id=? LIMIT 1`).bind(attachmentId).first();
    if(!item)return null;
    if(String(item.scan_state)!=='PENDING')throw new DOMException('attachment scan already finalized','InvalidStateError');
    const at=new Date().toISOString(),visibility=state==='CLEAN'?'customer':'internal';
    const event=await appendCaseEvent(item,{type:'ATTACHMENT_SCAN_'+state,actor:principal?.actor_ref||'system',visibility,payload:{attachment_id:attachmentId,scan_state:state,scanner_ref:scannerRef}},{at});
    await this.db.batch([
      this.db.prepare('UPDATE support_attachments SET scan_state=? WHERE attachment_id=?').bind(state,attachmentId),
      this.db.prepare(`INSERT INTO support_case_events (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?').bind(event.event_hash,event.at,item.case_id),
    ]);
    return Object.freeze({attachment_id:attachmentId,case_id:item.case_id,scan_state:state,scanned_at:at});
  }

  async scanSlaBreaches(){
    const result=await this.db.prepare(`SELECT c.case_id,c.state,c.priority,c.surface,c.category,c.requester_ref,c.retention_class,c.human_approval_required,
      c.last_event_hash,c.created_at,c.updated_at,s.ack_due_at,s.resolve_target_at,s.acknowledged_at
      FROM support_cases c JOIN support_case_sla s ON s.case_id=c.case_id
      WHERE c.state NOT IN ('CLOSED','RESOLVED','REJECTED','DUPLICATE')
        AND ((s.acknowledged_at IS NULL AND s.ack_due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          OR s.resolve_target_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).all();
    let created=0;
    for(const row of result?.results||[]){
      const breach=(!row.acknowledged_at&&Date.parse(String(row.ack_due_at))<=Date.now())?'SLA_ACK_BREACH':'SLA_RESOLUTION_TARGET_BREACH';
      const exists=await this.db.prepare(`SELECT escalation_id FROM support_case_escalations WHERE case_id=? AND reason_code=? AND status='OPEN' LIMIT 1`).bind(row.case_id,breach).first();
      if(exists)continue;
      const escalationId='AXE-'+randomToken(16),notificationId='AXN-'+randomToken(16),at=new Date().toISOString();
      const lane=escalationLane(row);
      const event=await appendCaseEvent(row,{type:breach,actor:'system',visibility:'internal',payload:{escalation_id:escalationId,lane}},{at});
      await this.db.batch([
        this.db.prepare(`INSERT INTO support_case_escalations (escalation_id,case_id,lane,reason_code,requested_by,status,event_hash,created_at,closed_at) VALUES (?,?,?,?,?,'OPEN',?,?,NULL)`).bind(escalationId,row.case_id,lane,breach,'system',event.event_hash,at),
        this.db.prepare(`INSERT INTO support_case_events (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
        this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?').bind(event.event_hash,event.at,row.case_id),
        this.db.prepare(`INSERT INTO support_notification_outbox (notification_id,case_id,kind,audience,event_hash,created_at) VALUES (?,?,?,?,?,?)`).bind(notificationId,row.case_id,breach,'operator',event.event_hash,at),
      ]);
      created+=1;
    }
    return Object.freeze({new_breaches:created,scanned:Number(result?.results?.length||0)});
  }

  async listSlaBreaches(){
    const result=await this.db.prepare(`SELECT c.case_id,c.priority,c.state,s.plan,s.ack_due_at,s.resolve_target_at,s.acknowledged_at,
      CASE WHEN s.acknowledged_at IS NULL AND s.ack_due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'ACK' ELSE 'RESOLUTION_TARGET' END AS breach
      FROM support_cases c JOIN support_case_sla s ON s.case_id=c.case_id
      WHERE c.state NOT IN ('CLOSED','RESOLVED','REJECTED','DUPLICATE')
        AND ((s.acknowledged_at IS NULL AND s.ack_due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR s.resolve_target_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ORDER BY c.priority ASC,c.created_at ASC LIMIT 100`).all();
    return Object.freeze((result?.results||[]).map(row=>Object.freeze({...row})));
  }

  async bindEmailThread(caseId,{thread_ref,address_hash,provider_thread_hash}={}){
    if(!/^thread:[a-z0-9._:-]{8,191}$/i.test(String(thread_ref||''))||!/^[a-f0-9]{64}$/i.test(String(address_hash||''))||!/^[a-f0-9]{64}$/i.test(String(provider_thread_hash||'')))throw new TypeError('email thread metadata invalid');
    const row=await this.db.prepare('SELECT case_id FROM support_cases WHERE case_id=? LIMIT 1').bind(caseId).first();if(!row)return null;
    const at=new Date().toISOString();
    await this.db.prepare(`INSERT INTO support_email_threads (thread_ref,case_id,address_hash,provider_thread_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(thread_ref) DO UPDATE SET updated_at=excluded.updated_at`).bind(thread_ref,caseId,String(address_hash).toLowerCase(),String(provider_thread_hash).toLowerCase(),at,at).run?.();
    return Object.freeze({thread_ref,case_id:caseId,created_at:at});
  }

  async appendInboundEmailByThread(threadRef,{sender_hash,body}={}){
    const thread=await this.db.prepare('SELECT thread_ref,case_id,address_hash FROM support_email_threads WHERE thread_ref=? LIMIT 1').bind(threadRef).first();
    if(!thread||!constantTimeEqual(String(thread.address_hash),String(sender_hash||'').toLowerCase()))return null;
    const row=await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,last_event_hash,created_at,updated_at FROM support_cases WHERE case_id=? LIMIT 1`).bind(thread.case_id).first();
    if(!row)return null;
    const message=await createConversationMessage({caseId:row.case_id,type:'CUSTOMER_MESSAGE',actor:'requester',visibility:'customer',body});
    const encrypted=await encryptSupportPayload({body:message.body},{key:this.key,caseId:row.case_id,schema:'musitu.axiom.support-message-encrypted.v1'});
    const event=await appendCaseEvent(row,{type:'CUSTOMER_MESSAGE',actor:'requester',visibility:'customer',payload:{message_id:message.message_id,channel:'email'}},{at:message.created_at});
    const notificationId='AXN-'+randomToken(16);
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_case_messages (message_id,case_id,type,actor,visibility,encrypted_payload,event_hash,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(message.message_id,message.case_id,message.type,message.actor,message.visibility,JSON.stringify(encrypted),event.event_hash,message.created_at),
      this.db.prepare(`INSERT INTO support_case_events (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?').bind(event.event_hash,event.at,row.case_id),
      this.db.prepare(`INSERT INTO support_notification_outbox (notification_id,case_id,kind,audience,event_hash,created_at) VALUES (?,?,?,?,?,?)`).bind(notificationId,row.case_id,'CUSTOMER_EMAIL_REPLY_RECEIVED','operator',event.event_hash,event.at),
    ]);
    return Object.freeze({message,case_id:row.case_id,notification_id:notificationId});
  }

  async upsertOrganization(input={},principal){
    const orgRef=String(input.org_ref||''),plan=String(input.plan||'STANDARD').toUpperCase(),status=String(input.status||'ACTIVE').toUpperCase();
    if(!/^org:[a-z0-9._:-]{6,180}$/i.test(orgRef)||!['COMMUNITY','STANDARD','BUSINESS','ENTERPRISE'].includes(plan)||!['ACTIVE','SUSPENDED'].includes(status))throw new TypeError('organization metadata invalid');
    const at=new Date().toISOString();
    await this.db.prepare(`INSERT INTO support_organizations (org_ref,plan,status,created_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(org_ref) DO UPDATE SET plan=excluded.plan,status=excluded.status,updated_at=excluded.updated_at`).bind(orgRef,plan,status,at,at).run?.();
    return Object.freeze({org_ref:orgRef,plan,status,updated_at:at});
  }

  async setOrganizationEntitlement(orgRef,input={},principal){
    if(!/^org:[a-z0-9._:-]{6,180}$/i.test(String(orgRef||'')))throw new TypeError('organization ref invalid');
    const capability=String(input.capability||'').toLowerCase();
    if(!/^[a-z][a-z0-9._:-]{2,79}$/.test(capability))throw new TypeError('entitlement capability invalid');
    const enabled=input.enabled===true,at=new Date().toISOString(),id='AXT-'+randomToken(16);
    const org=await this.db.prepare('SELECT org_ref FROM support_organizations WHERE org_ref=? LIMIT 1').bind(orgRef).first();if(!org)return null;
    await this.db.prepare(`INSERT INTO support_support_entitlements (entitlement_id,org_ref,capability,enabled,starts_at,ends_at,created_at) VALUES (?,?,?,?,?,?,?)`).bind(id,orgRef,capability,enabled?1:0,at,input.ends_at||null,at).run?.();
    return Object.freeze({entitlement_id:id,org_ref:orgRef,capability,enabled,starts_at:at,ends_at:input.ends_at||null});
  }

  async createWebhookSubscription(input={},principal){
    const webhookRef=String(input.webhook_ref||''),orgRef=String(input.org_ref||''),endpointRef=String(input.endpoint_ref||''),secretRef=String(input.secret_ref||'');
    const events=Array.isArray(input.event_types)?input.event_types.map(String):[];
    if(!/^webhook:[a-z0-9._:-]{6,180}$/i.test(webhookRef)||!/^org:[a-z0-9._:-]{6,180}$/i.test(orgRef)||!/^vault:[a-z0-9._:-]{6,180}$/i.test(endpointRef)||!/^vault:[a-z0-9._:-]{6,180}$/i.test(secretRef)||!events.length||events.some(x=>!/^case\.[a-z_]+$/.test(x)))throw new TypeError('webhook subscription invalid');
    const org=await this.db.prepare('SELECT org_ref FROM support_organizations WHERE org_ref=? LIMIT 1').bind(orgRef).first();if(!org)return null;
    const at=new Date().toISOString();
    await this.db.prepare(`INSERT INTO support_webhook_subscriptions (webhook_ref,org_ref,endpoint_ref,secret_ref,event_types_json,enabled,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)
      ON CONFLICT(webhook_ref) DO UPDATE SET org_ref=excluded.org_ref,endpoint_ref=excluded.endpoint_ref,secret_ref=excluded.secret_ref,event_types_json=excluded.event_types_json,enabled=1,updated_at=excluded.updated_at`).bind(webhookRef,orgRef,endpointRef,secretRef,JSON.stringify(events),at,at).run?.();
    return Object.freeze({webhook_ref:webhookRef,org_ref:orgRef,event_types:Object.freeze(events),enabled:true,updated_at:at});
  }

  async enqueueWebhookForCase(caseId,{type,state,priority,event_hash,at}={}){
    const row=await this.db.prepare('SELECT case_id,requester_ref,state,priority FROM support_cases WHERE case_id=? LIMIT 1').bind(caseId).first();
    if(!row||!String(row.requester_ref||'').startsWith('org:'))return Object.freeze({queued:0});
    const subs=await this.db.prepare('SELECT webhook_ref,event_types_json FROM support_webhook_subscriptions WHERE org_ref=? AND enabled=1').bind(row.requester_ref).all();
    let queued=0;
    for(const sub of subs?.results||[]){
      const types=JSON.parse(String(sub.event_types_json||'[]'));if(!types.includes(type))continue;
      const payload=buildWebhookEvent({type,caseId,state:state||row.state,priority:priority||row.priority,eventHash:event_hash,at});
      const deliveryId='AXW-'+randomToken(16);
      await this.db.prepare(`INSERT INTO support_webhook_outbox (delivery_id,webhook_ref,case_id,event_type,payload_json,event_hash,state,attempts,next_attempt_at,created_at,delivered_at) VALUES (?,?,?,?,?,?,'PENDING',0,NULL,?,NULL)`).bind(deliveryId,sub.webhook_ref,caseId,type,JSON.stringify(payload),event_hash,payload.created_at).run?.();
      queued+=1;
    }
    return Object.freeze({queued});
  }

  async createOperatorMacro(input={},principal){
    const name=String(input.name||'').trim(),body=String(input.body||'').trim();if(!name||name.length>80||!body||body.length>4000)throw new TypeError('macro name/body invalid');
    const check=inspectSecretMaterial({body});if(!check.safe)throw new SecretMaterialError(check.findings);
    const id='AXK-'+randomToken(16),at=new Date().toISOString();
    const encrypted=await encryptSupportPayload({body},{key:this.key,caseId:'AX-000000000000',schema:'musitu.axiom.support-macro-encrypted.v1'});
    await this.db.prepare(`INSERT INTO support_operator_macros (macro_id,owner_ref,name,body_encrypted,enabled,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`).bind(id,String(principal?.actor_ref||''),name,JSON.stringify(encrypted),at,at).run?.();
    return Object.freeze({macro_id:id,name,enabled:true,created_at:at});
  }

  async listOperatorMacros(principal){
    const result=await this.db.prepare('SELECT macro_id,name,body_encrypted,created_at,updated_at FROM support_operator_macros WHERE owner_ref=? AND enabled=1 ORDER BY name ASC LIMIT 100').bind(String(principal?.actor_ref||'')).all();
    const out=[];for(const row of result?.results||[]){const p=await decryptSupportPayload(JSON.parse(row.body_encrypted),{key:this.key,caseId:'AX-000000000000'});out.push(Object.freeze({macro_id:row.macro_id,name:row.name,body:String(p?.body||''),created_at:row.created_at,updated_at:row.updated_at}));}
    return Object.freeze(out);
  }

  async recordQaReview(caseId,input={},principal){
    const validated=validateQaReview({quality:input.quality,policy:input.policy,accuracy:input.accuracy,reviewerRef:principal?.actor_ref});if(!validated.ok)throw new TypeError(validated.errors.join('; '));
    const row=await this.db.prepare('SELECT case_id FROM support_cases WHERE case_id=? LIMIT 1').bind(caseId).first();if(!row)return null;
    const reviewId='AXJ-'+randomToken(16),at=new Date().toISOString();
    let notesEncrypted=null;if(String(input.notes||'').trim()){const check=inspectSecretMaterial({notes:String(input.notes)});if(!check.safe)throw new SecretMaterialError(check.findings);notesEncrypted=JSON.stringify(await encryptSupportPayload({notes:String(input.notes).trim()},{key:this.key,caseId,schema:'musitu.axiom.support-qa-encrypted.v1'}));}
    await this.db.prepare(`INSERT INTO support_qa_reviews (review_id,case_id,reviewer_ref,quality,policy,accuracy,notes_encrypted,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(reviewId,caseId,validated.value.reviewer_ref,validated.value.quality,validated.value.policy,validated.value.accuracy,notesEncrypted,at).run?.();
    return Object.freeze({review_id:reviewId,case_id:caseId,quality:validated.value.quality,policy:validated.value.policy,accuracy:validated.value.accuracy,created_at:at});
  }

  async updateIncidentStatus(incidentId,input={},principal){
    const incident=await this.db.prepare('SELECT incident_id,title,severity,state,public_summary,created_at,updated_at FROM support_incidents WHERE incident_id=? LIMIT 1').bind(incidentId).first();if(!incident)return null;
    const state=String(input.state||'').toUpperCase(),message=String(input.public_message||'').trim();if(!['INVESTIGATING','IDENTIFIED','MONITORING','RESOLVED'].includes(state)||!message||message.length>2000)throw new TypeError('incident status invalid');
    const check=inspectSecretMaterial({message});if(!check.safe)throw new SecretMaterialError(check.findings);
    const at=new Date().toISOString(),updateId='AXU-'+randomToken(16),eventHash=await sha256({schema:'musitu.axiom.status-update.v1',update_id:updateId,incident_id:incidentId,state,message,at});
    await this.db.batch([
      this.db.prepare('UPDATE support_incidents SET state=?,public_summary=?,updated_at=? WHERE incident_id=?').bind(state,message,at,incidentId),
      this.db.prepare(`INSERT INTO support_status_updates (update_id,incident_id,state,public_message,event_hash,created_at) VALUES (?,?,?,?,?,?)`).bind(updateId,incidentId,state,message,eventHash,at),
    ]);
    return Object.freeze({incident_id:incidentId,state,public_message:message,updated_at:at});
  }

  async setCaseTriage(caseId,input={},principal){
    const row=await this.db.prepare(`SELECT case_id,state,priority,surface,category,requester_ref,retention_class,human_approval_required,last_event_hash,created_at,updated_at FROM support_cases WHERE case_id=? LIMIT 1`).bind(caseId).first();if(!row)return null;
    const lane=String(input.lane||escalationLane(row)).toUpperCase(),language=normalizeLanguage(input.language);if(language==='und'&&!['und',''].includes(String(input.language||'').toLowerCase()))throw new TypeError('unsupported language');
    if(!/^[A-Z][A-Z0-9_]{2,79}$/.test(lane))throw new TypeError('triage lane invalid');
    const at=new Date().toISOString();
    const event=await appendCaseEvent(row,{type:'TRIAGE_UPDATED',actor:principal?.actor_ref,visibility:'internal',payload:{lane,language}},{at});
    await this.db.batch([
      this.db.prepare(`INSERT INTO support_case_triage (case_id,lane,language,advisory_only,human_review_required,updated_at) VALUES (?,?,?,1,1,?) ON CONFLICT(case_id) DO UPDATE SET lane=excluded.lane,language=excluded.language,updated_at=excluded.updated_at`).bind(caseId,lane,language,at),
      this.db.prepare(`INSERT INTO support_case_languages (case_id,language,detected_from,updated_at) VALUES (?,?, 'operator',?) ON CONFLICT(case_id) DO UPDATE SET language=excluded.language,detected_from='operator',updated_at=excluded.updated_at`).bind(caseId,language,at),
      this.db.prepare(`INSERT INTO support_case_events (case_id,event_hash,prior_event_hash,type,actor,visibility,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(event.case_id,event.event_hash,event.prior_event_hash,event.type,event.actor,event.visibility,JSON.stringify(event.payload),event.at),
      this.db.prepare('UPDATE support_cases SET last_event_hash=?,updated_at=? WHERE case_id=?').bind(event.event_hash,event.at,caseId),
    ]);
    return Object.freeze({case_id:caseId,lane,language,updated_at:at});
  }

  async listPendingAttachmentDeletions({limit=50}={}){
    const bounded=Math.max(1,Math.min(100,Number(limit)||50));
    const result=await this.db.prepare(`SELECT deletion_id,storage_key,sha256,state,attempts,next_attempt_at,created_at
      FROM support_attachment_deletion_outbox
      WHERE state IN ('PENDING','RETRY') AND (next_attempt_at IS NULL OR next_attempt_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ORDER BY created_at ASC LIMIT ?`).bind(bounded).all();
    return Object.freeze((result?.results||[]).map(row=>Object.freeze({...row,attempts:Number(row.attempts||0)})));
  }

  async recordAttachmentDeletionAttempt(item,result){
    const attempts=Number(item?.attempts||0)+1;
    const deleted=result?.deleted===true;
    const state=deleted?'DELETED':attempts>=8?'DEAD':'RETRY';
    const at=new Date().toISOString();
    const next=deleted||state==='DEAD'?null:new Date(Date.now()+Math.min(21600,Math.pow(2,Math.min(attempts,8))*60)*1000).toISOString();
    await this.db.prepare(`UPDATE support_attachment_deletion_outbox
      SET state=?,attempts=?,next_attempt_at=?,deleted_at=? WHERE deletion_id=?`)
      .bind(state,attempts,next,deleted?at:null,String(item.deletion_id)).run?.();
    return Object.freeze({deletion_id:String(item.deletion_id),state,attempts,next_attempt_at:next,deleted_at:deleted?at:null});
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
