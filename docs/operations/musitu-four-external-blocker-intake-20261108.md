# MUSITU — four external release blockers: owner action and evidence-intake packet

**8 November 2026 — non-enabling, source-only.** No release authorization, customer data, real credentials, production deployment, hosted database mutation or methane-model promotion is provided by this packet.

## Current decision

- The invitation-only Connect customer beta is **BLOCKED_PENDING_CUSTOMER_AND_OPERATIONS_EVIDENCE**. Existing previously authorized Connect→Axiom arithmetic continues, but is a separate scope.
- All four external blockers remain **BLOCKED_PENDING_INDEPENDENT_EVIDENCE**. A matching SHA-256 against an uploader-supplied hash proves byte consistency only; not who created or approved the evidence.
- Do not claim external approval from CI, self-filled references, synthetic tests, development OpenML telemetry, or local audit checkpoints.

## Evidence the accountable owners must obtain

### Customer admission — independent customer and tenant evidence

Receive named pilot-owner authorization, approved Connect-specific terms/privacy/DPA, actual tenant credentials/rotation and onboarding/offboarding acceptance. Hosted tenant isolation, quotas and accounting must be demonstrated on an authorized isolated environment before any pilot. 

| Required evidence receipt | Accountable owner role |
|---|---|
| `tenant_credentials_rotation` | `security_owner` |
| `hosted_tenant_isolation_usage` | `security_owner` |
| `per_tenant_quota_and_payload` | `security_owner` |
| `customer_onboarding_offboarding` | `pilot_customer_owner` |
| `approved_terms_privacy_dpa` | `legal_and_privacy_reviewer` |
| `pilot_customer_acceptance` | `pilot_customer_owner` |
| `product_scope_signoff` | `product_scope_owner` |
| `security_signoff` | `security_owner` |
| `legal_privacy_signoff` | `legal_and_privacy_reviewer` |
| `pilot_owner_signoff` | `pilot_customer_owner` |

**Acceptance boundary:** the 10 receipts above must be genuine, dated, independently corroborated source records and authenticated by the appropriate role outside this repository. The preflight never validates reviewer identity or independently confirms a role.

### Operational authorization — accountable human release owners

Receive real on-call paging/ack and recovery evidence; confirm accountable production operations owner and distinct new-beta release authority. The previously authorized arithmetic production runtime is not new beta authorization. 

| Required evidence receipt | Accountable owner role |
|---|---|
| `human_paging_acknowledgement` | `production_operations_owner` |
| `rollback_and_recovery_rehearsal` | `production_operations_owner` |
| `operations_owner_signoff` | `production_operations_owner` |
| `separate_release_authorization` | `separate_production_release_authorization` |

**Acceptance boundary:** the 4 receipts above must be genuine, dated, independently corroborated source records and authenticated by the appropriate role outside this repository. The preflight never validates reviewer identity or independently confirms a role.

### External audit custody — separate attestation owner and storage

An independent custodian must control an external latest-pointer/immutable retention mechanism and separate high-entropy signing-key custody. Local HMAC snapshots, SQLite checkpoints and owner-filled SHA manifests are not external storage or third-party authentication. 

| Required evidence receipt | Accountable owner role |
|---|---|
| `external_custodian_acceptance` | `independent_audit_custodian` |
| `independent_signing_key_custody` | `independent_audit_custodian` |
| `immutable_receipt_and_retention` | `independent_audit_custodian` |
| `independently_pinned_latest_attestation` | `independent_audit_custodian` |
| `restore_and_rollback_detection` | `independent_audit_custodian` |

**Acceptance boundary:** the 5 receipts above must be genuine, dated, independently corroborated source records and authenticated by the appropriate role outside this repository. The preflight never validates reviewer identity or independently confirms a role.

### Mine-specific chronological validation — independent source and frozen model

An independently licensed underground mine must provide original 1 Hz readings of all 28 measured canonical channels with calibration and custody. Preregister and independently timestamp the holdout before labels/model inspection; human-review distinct physical methane events. 

| Required evidence receipt | Accountable owner role |
|---|---|
| `source_rights_and_license` | `mine_data_owner` |
| `original_1hz_28_measured_channels` | `independent_mine_reviewer` |
| `source_sha_and_calibration_custody` | `independent_mine_reviewer` |
| `independent_physical_methane_events` | `independent_mine_reviewer` |
| `prospective_holdout_preaccess_seal` | `independent_mine_reviewer` |
| `frozen_model_sha_and_threshold` | `independent_mine_reviewer` |
| `chronological_folds_and_metrics` | `independent_mine_reviewer` |
| `independent_safety_and_alarm_review` | `independent_mine_reviewer` |

**Acceptance boundary:** the 8 receipts above must be genuine, dated, independently corroborated source records and authenticated by the appropriate role outside this repository. The preflight never validates reviewer identity or independently confirms a role.

## Frozen independent mine protocol (no re-training or tuning)

The externally sourced test must use the frozen LightGBM model SHA-256 `3b51f3318fb59d2555b66cbbd41e371f9f0241d2137e5166c77e685f9ab030eb` and manifest SHA-256 `f57fab879104a8307f0b472fc106d61c1aa7cf440811229b2221b2266ee779bf`, with unchanged threshold `0.022545819099925965`. Do not use the known Polish OpenML 42701/Mendeley development source as independent.

Use 600 seconds of **past-only** features, a future 180–360-second horizon, 30-second stride, and measured methane ≥ 1.0 as the hard-warning reference. Freeze four strictly chronological test folds, with at least **500 future-positive windows** for each supported fold, and require at least **3 of 4** folds to achieve recall ≥ 0.90, precision ≥ 0.10, and F2 ≥ 1.05 × hard-warning F2. Label windows are not distinct physical events: obtain separate human event review and operational alarm verification.

Use the existing non-admitting `independent_holdout_protocol.py`, `independent_mine_readiness.py`, and evaluation reports; never infer that a preflight source hash or applicant-provided signoff establishes physical mine independence, lawful rights or safety qualification.

## How independent owners should exchange evidence

1. Keep original contracts, customer identifiers, keys, mine sensor streams and reviewer information in appropriately access-controlled owner storage **outside this public repository**. Never paste them into a commit, tool prompt, or GitHub issue.
2. Have each real owner validate the evidence in its native independent system, then produce a bounded, non-sensitive receipt file (for example an authorized, redacted approval record or externally signed manifest) and retain its original counterpart separately.
3. Create a private manifest using the empty template `examples/connect/external_blocker_receipts_template.json`. Every `receipt` needs `gate`, `requirement`, `owner_role`, `file`, lowercase `sha256`, and a **reference to independent custody**. The role text is only a declaration, not an authenticated identity.
4. Run the read-only local structural intake command after storing receipt files in a separate private folder. It rejects missing/duplicate JSON keys, wrong declared owner roles, unknown evidence slots, changed bytes, path traversal, symlinks, and nonstandard numbers.
5. Require the actual security, legal, operations, customer and mine safety reviewers to authenticate credentials, signatures, data provenance, mine-source independence, event validity, contractual rights and authorization independently. Only a separately authorized human release process can change a release state.

```bash
# Current source-only status, no private receipts required:
python qualification/external_blocker_preflight.py --output /tmp/musitu-four-gate-preflight.json

# After obtaining private owner-held receipts, still NON-ENABLING:
python qualification/external_blocker_preflight.py \
  --manifest /private/musitu/receipts.json \
  --evidence-root /private/musitu/files \
  --output /private/musitu/new-preflight-report.json
```

Reports always set `release_authorized: false`, `independent_authenticity_verified: false`, and every per-gate `qualified: false`, including when every provided receipt matches its **self-supplied** SHA-256. `complete_for_external_review` means the metadata packet is assembled, **not** that its authenticity has been established.

## How to make real progress on each blocker

| Order | Action / responsible owner | Closure evidence (not a tool-generated pass) |
|---|---|---|
| 1 | Pilot/contract + Connect security owners | Signed scope and rights, unique customer service identities, approved isolated staging tenant, externally witnessed cross-tenant denial, quota race/revoke proof |
| 2 | Production operations + separate release authority | Named on-call human ACK, bounded recovery/rollback drill, approved change window, distinct launch authorization (for new beta only) |
| 3 | Independent audit custodian + security | Separate signing-key management, immutable/latest-pointer storage and retention, custody/restore and rollback-detection witness receipts |
| 4 | Mine data owner + independent mining safety reviewer | Original licensed 1 Hz 28-channel source, calibration/chain-of-custody, physically adjudicated events, prospective sealed chronological holdout, frozen model metrics at original threshold |

These steps are operational prerequisites, **not** permission to execute them against live customer systems. Hosted Cloudflare D1, production account changes and real mine data require separate access authority and permission.

## Non-negotiable preservation

No changes to `main`, PR #9, existing production arithmetic, hosted D1/Neon or credentials, customer admissions, mine production predictions, frozen LightGBM and manifest, warning threshold, model score threshold, or chronological acceptance criteria. Synthetic research remains non-independent.
