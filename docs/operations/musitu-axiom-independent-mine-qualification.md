# MUSITU Axiom — One-pass independent methane qualification: evidence and decision

**As-of 2026-10-09. Research readiness, not production qualification.**

## Executive result

- The **general-purpose Connect → Axiom production computation** bridge is already separately authorized and recorded as enabled. Do not disable or alter that runtime because the methane research model has not qualified.
- The **frozen methane LightGBM research model** is checksum-pinned and has passed native loading and synthetic end-to-end replay.
- **Production operational methane prediction is NOT qualified.** No third-party independently validated one-second, full-28-sensor mine telemetry and verified physical-event outcomes are in the repository or connected research evidence. No production methane release is authorized.
- Existing development folds: LightGBM passed **one of four**. Only **two of four** folds have at least 500 positive labelled prediction windows; the existing 3-of-4 positive-support threshold is therefore unattainable on those exact folds. Do not change, relabel or recycle these folds to claim qualification.
- Source registry: `qualification/independent_mine_source_catalog_20261009.json`. The four candidates below were assessed from public metadata, **not admitted as independent datasets**.

## Examined external sources and why they cannot currently qualify the frozen model

| Public source | What it actually provides | Current decision |
| --- | --- | --- |
| Polish 2014 underground 28-sensor methane dataset, Mendeley Data DOI 10.17632/yd7vw4c5mk.1, https://pmc.ncbi.nlm.nih.gov/articles/PMC8526955/ | 9,199,930 one-second rows; **same training/development source** as the frozen model and the OpenML 42701 copy | **REJECT as independent validation**. Reproducing it from another site, DOI, paper or downloaded hash is not independence |
| No. 3209 mine, 6 February 2022, https://zenodo.org/records/6450554 | A 1.1 MB XLS file described as gas, temperature and wind observations for one day | **REAL XLS INSPECTED AND NOT ADMITTED**. Exact publisher MD5 matched, but inspected 5,753-row × 16-column XLS has no canonically named 28-sensor inventory in its first five rows. Its parsed time column had a modal positive step of 10 seconds and 1,447 non-increasing deltas; strict 1-Hz continuity was not established. Actual units, license, physical-event support and sensor topology remain unverified |
| Chinese longwall underground study (2026), https://www.sciencedirect.com/science/article/abs/pii/S0957582026006440 | Article describes 710,367 synchronized **one-minute** observations of **eight** sensor channels over 494 days | **REJECT for unchanged frozen-model inference**: incompatible 1-minute cadence and eight vs 28 channels. No interpolation or synthetic substitutes |
| U.S. MSHA open datasets, https://arlweb.msha.gov/OpenGovernmentData/OGIMSHA.asp | Mine registry, reports, inspections and regulatory records | **NOT the required mine sensor time series** |

Also considered: 2026 China's monthly mine emissions data (https://www.nature.com/articles/s41597-026-08394-7). Monthly emissions cannot substitute for one-second operational methane warning windows.

For these public sources, record only what the source actually supports. A dataset with unknown acquisition rights, unreviewed sensor topology or a missing raw stream **must not** receive a positive validation label.

## Actual independent-source binary forensic result — 9 October 2026

The **published workbook bytes**, not merely web metadata, were obtained during
the read-only research GitHub run
[37992842532](https://github.com/evansmusitu/mft-axiom-build/actions/runs/37992842532).
Only an **aggregate forensic JSON** was archived (artifact 11645691981). The
original XLS was not uploaded into GitHub commits or workflow artifacts.

- Record DOI: `10.5281/zenodo.6450554`; file `Dataset on 6 Feb 2022.xls`.
- Published MD5 independently reproduced: `3186fe58543ec7f9fb4a7d71b99c02e1`.
- Full byte SHA-256: `18768c2555a63712c0da1e64430be1f6a53227712f9d9413f007ea5c26478559`.
- Byte size **1,065,472**; **1** sheet; **5,753** rows including any header rows;
  **16** columns; **0** exact canonical sensor names detected in the first five rows.
- In one parsed timestamp column (5,752 values), observed positive step mode
  **10 seconds**, **0** one-second deltas and **1,447** zero/backward deltas.
  This is a sampled time-column observation, **not** proof of the raw physical
  instrumentation's actual native capture rate or complete sensor semantics.
- Repository source/use rights were **not authenticated** by the available API
  metadata and no exact 28-channel calibration or independently annotated
  positive mine events were established.

**Decision:** `NOT_COMPATIBLE_FOR_UNCHANGED_FROZEN_MODEL`. Do not silently
rename 16 arbitrary channels into 28 inputs; fabricate the 12 missing fields;
upsample timestamps; or claim methane recall/F2. None of this public-candidate
forensic work is independent model validation.

The repo also enforces optional `xlrd`/`xlwt` contract tests in their own
research workflow. The normal Connect regression suite does not require
legacy XLS dependencies and skips those isolated-only tests.

## Exact missing external deliverable

Obtain a **separate, genuinely independent operating mine** with a data owner's authorization. The source owner supplies, in a private approved environment:

1. Original sensor data, a byte-level SHA-256 and acquisition-chain metadata, including timestamps, site identity, data collection period, data-use permission, and a cross-check that it is not the 2014 Polish development data.
2. A sensor inventory naming each of the frozen model's 28 required canonical inputs, their physically distinct source channels, locations, units, calibration records, allowable measured direction states, and how one-second timing and outage gaps are handled.
3. Genuine observed methane exceedance events with independent review (incident/event start/end, verification standards, censoring and observation uptime). Do not equate correlated future-label windows with physically independent events.
4. A **preregistered**, locked evaluation protocol and model SHA-256 published before any new external test labels are examined. Four non-leaking chronology partitions must be independently checked and at least three need the original minimum of **500 labelled positive forecast windows**. Support does not guarantee passing; required 90% recall, 10% precision and 5% F2 gain still apply.
5. An independent reviewer or mine engineer confirms sensor equivalence, source permission, site independence, event ground truth, data handling, replay reproducibility, missingness, alert lead-time limitations and operational fallback. The reviewer’s independent authorization must be verified out of band; a JSON boolean or self-provided reference cannot establish authenticity.
6. A controlled trial of mine-specific alarm delivery, escalation, paging, operator response, rollback and failure containment before safety deployment is considered.

Preserve the original known hard-warning system. A new prediction score may augment a safe control, but cannot suppress the observed-methane warning or automatically trip critical industrial equipment without a separately approved safety architecture.

## What has actually been completed in this one-pass engineering continuation

- Read-only source discovery covering four candidates with URLs and explicit incompatibility reasons; the exact published Zenodo XLS was also downloaded and inspected in an isolated research runner without uploading customer observations.
- New `benchmarks/mining_adapter/independent_mine_readiness.py`: deterministic fail-closed candidate metadata assessment, verifies exact 28-channel requirement, strict one-second cadence, original development-source SHA / DOI / OpenML alias reuse, frozen model manifest pin, chronology/support declarations, source-rights and independent review reference presence.
- The audit explicitly warns that self-provided links are not external proof and **ALWAYS returns blocked for production qualification**, even when all checkboxes, references and 3-of-4 support counts are self-asserted.
- Automated negative tests for known source aliases, wrong source type, duplicate/missing sensors, one-minute cadence, hash and model pin substitution, unreviewed support, false approvals, private reference non-disclosure and no report overwrite.
- GitHub CI uses only public-source descriptions and synthetic test descriptors; it neither calls private mine systems nor modifies the existing Connect-to-Axiom production integration.

## Run locally and independently check

```bash
python -m unittest tests.connect.test_independent_mine_readiness -v

python -m benchmarks.mining_adapter.independent_mine_readiness \
  --candidate /private/non-identifying-candidate-summary.json \
  --output /private/new-evidence-gap-report.json
```

The output is a **non-admission evidence-gap report**. It never grants actual rights, model accuracy, mine safety qualification or production access. Do not place unredacted source data, identity records or customer contracts in a public repository, issue or GitHub Actions artifact.

**Preserve:** PR #9 open/unmerged; sealed `main` unchanged; general Connect-to-Axiom production computation intact; experimental methane decision automation prohibited until authorized independent field and safety evidence exists.
