import {encryptSupportPayload, decryptSupportPayload} from './crypto_envelope.js';
import {publicCaseView, sha256} from './control_plane.js';

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
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
