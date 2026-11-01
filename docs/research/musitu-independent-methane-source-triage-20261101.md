# MUSITU frozen methane model — independent source triage (2026-11-01)

**Decision: no independent holdout cleared.** This is a source-discovery
inventory only. It does not amend the model, threshold, holdout protocol,
customer release gate, safety restrictions, or production prediction policy.

## Known development source — excluded

The published 2021 Mendeley Methane dataset, DOI
`10.17632/yd7vw4c5mk.1`, is the frozen-model development source
(Upper Silesia, Poland, ~9,199,930 one-second observations and 28 sensors).
The OpenML 42701 mirror is the same source identity, even if the archive
format or download transport is different. Successful November 2026
MUSITU Connect ingestion qualification is **not** an independent holdout.
Original research: https://pmc.ncbi.nlm.nih.gov/articles/PMC8526955/
and https://data.mendeley.com/datasets/yd7vw4c5mk/1 .

## Separately collected leads, not yet eligible

1. **Qianyingzi Mine, W3211 working face, Anhui Province, China.**
   The 2024 Scientific Reports paper
   https://www.nature.com/articles/s41598-024-64181-7
   describes original gas measurements from 1 May to 20 July 2021,
   reported as 3,407,328 data points, comparing them with the Polish
   data. The study says data are available **on request to the
   corresponding author**. Its analysis standardizes time to the minute
   level and does not establish independently obtained original
   **full 28-channel, 1 Hz** data, rights/redistribution approvals,
   frozen-site chronology, reviewer authentication or methane event labels.
   **Status: author-request lead only; no bytes, no license, no holdout.**

2. **Other Chinese longwall mine, 3 January 2022–12 May 2023.**
   `Online Deep Transfer Learning and Multi-Sensor Analysis for Enhanced
   Underground Monitoring`, IEEE 2025:
   https://ieeexplore.ieee.org/document/11193369/ .
   The study uses a second Chinese mine collected independently of
   the Polish source. The associated description reports ~710,367
   **one-minute** samples from approximately seven/eight channels
   (methane, wind speed, temperature). This is not the frozen model's
   full original 28-sensor, 1-second input contract. Independent raw
   source rights, calibration, chronology and physical exceedance
   verification are not established.
   **Status: incompatible published schema and cadence; not eligible.**

3. **2026 China mine-level emissions inventory**, DOI
   `10.5281/zenodo.21483131`:
   https://zenodo.org/records/21483131 .
   This is an emissions inventory at **monthly** frequency, not
   underground 1 Hz operational sensors.
   **Status: unsuitable for the methane early-warning holdout.**

## Required evidence to re-evaluate any lead

An eligible candidate requires **independent mine/site lineage**
and owner permission, original 1 Hz event-ordered measurements for all
28 required canonical sensor channels, documented calibration and
clock synchronization, provenance hashes and immutable chain of custody,
verifiable physical methane threshold exceedances reviewed by a separate
authority, and a sealed holdout declared before running predictions.
Do **not** upsample one-minute aggregates, fill invented channels,
join development observations, or tune the frozen threshold to fit
a new mine.

The frozen LightGBM SHA-256 remains
`3b51f3318fb59d2555b66cbbd41e371f9f0241d2137e5166c77e685f9ab030eb`.
Manifest SHA-256 remains
`f57fab879104a8307f0b472fc106d61c1aa7cf440811229b2221b2266ee779bf`.
Preserve the existing 600-second past, 180–360-second future,
30-second stride, measured methane >=1.0 and frozen
`0.022545819099925965` model threshold. The untouched chronological
and independent-reviewer acceptance protocol remains binding.
