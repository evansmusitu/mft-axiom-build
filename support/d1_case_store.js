import {encryptSupportPayload, decryptSupportPayload} from './crypto_envelope.js';
import {appendCaseEvent, createConversationMessage, publicCaseView, sha256} from './control_plane.js';

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
    ]);
    return Object.freeze({message});
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
