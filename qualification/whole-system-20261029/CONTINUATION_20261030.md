# Whole-system continuation — 30 October 2026

This source candidate continues d057d96 and does not grant release authority.

## Observable changes

- Governed deterministic HTTP decisions no longer require an unrelated protected-kernel service binding. Identity, policy, reservations and proof replay remain enforced.
- Two-state probability ranges now report utility ranges, robust/possible optimal actions and exact break-even comparisons. The complementary state uses 1-p. Range mode accepts at most 20 actions, contains the point prior and excludes signal models; unchanged point mode retains its existing 100-row limits and commitments. This bounds quadratic proof growth before storage.
- Circuit-breaker epoch and success-latency inputs reject nonfinite/overflowed numbers before state changes.
- Ten actual local workerd/D1 checks exercise populated schema reapplication, five-object links, concurrent call caps, atomic evidence rollback, observer disconnect/cancellation, lease generation fencing, retained consumption, tenant guards, runtime restart, tamper rejection and maximum supported range proof replay.
- The offline runner now executes 35 existing script-style contracts explicitly, plus 31 additional behavioral/oracle methods. Ordinary unittest discovery did not invoke those script main functions.
- Two historical distribution checks resolve exact pinned archival assets, retaining digest/version/policy assertions without installing an active marketplace or old workflows. The in-memory signing-key fixture expression was clarified to avoid a scanner false positive; no leaked credential or rotation is claimed.

## Fresh evidence

All 13 integrated command groups exited zero. Application 344/344, kernel 26/26, workers 189/189, Frontier regressions 23/23, extended methods 31/31, probability-range Python methods 8/8, existing script contracts 35/35, local D1 10/10, recovery 22/22 plus 6/6, provider-neutral 21/21; local qualification remains 23 cases across 11 families. Shared oracle cases and overlapping tests are not independent benchmark totals. Full commands, timings, fingerprints and scope are in continuation-verification-20261030.json. Remote CI status is reported on the draft PR after source publication.

Independent review found two evidence-quality gaps in the first D1 tests; both were corrected and rerun. A quadratic output-growth concern prompted the 20-action range bound and a real persisted maximum-size acceptance case. The exploratory oversized-payload persistence attempt did not establish a reliable hosted limit result; no hosted storage qualification follows from it.

## Skill and acceptance boundaries

The existing internal decision candidate gains probability-range instructions; no skill count is inflated. Recovery/reconciliation and evidence-preserving lifecycle adapters are genuine potential gaps, but distinct skill candidates require those actual governed seams before qualification. Generic sensitivity/data-quality/governance renames duplicate existing packages.

Hosted D1, production PostgreSQL/worker wiring, independent custody, global antirollback, real devices, finance/privacy and external model comparisons remain unqualified. OpenAI integration still requires the existing-key/new-key choice; no new OpenAI API-dependent implementation or provider workload was added. Main, PR #1, production and public profiles remain unchanged.
