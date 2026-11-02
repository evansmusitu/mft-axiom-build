# Cloudflare reconciliation request — draft, not submitted

Account: `93f395f5121954671f92fffa453d6b61`.
Provider-observed account name: MUSITU AXIOM Security Authority. This is the same
known production account ID; this request makes no independent-custody claim.
No API key, bearer credential, payment detail or customer row is included.

## Aborted Workers AI request

Please reconcile this saved native REST request using provider-side records:

- Endpoint: `POST /client/v4/accounts/93f395f5121954671f92fffa453d6b61/ai/run/@cf/google/gemma-4-26b-a4b-it`.
- Request started: **1 November 2026, 15:43:43.842 UTC**.
- Observed response `cf-ray`: **`a53c044b0eda9b36-IAD`**.
- Streaming inference, output cap 1,800 tokens; input was a generated cancellation
  fixture containing no customer data. A real content delta preceded client
  abort and application Work revocation.
- The application retained its one provider-call reservation and stored no
  successful Artifact for this cancellation control.

Account-wide analytics initially lagged. At 15:48:22.810 UTC and again at
16:58:32.384 UTC they showed exactly two completed requests and
52.20908737182617 neurons. Those two records match the separate successful
planning and synthesis responses. Request-level analytics for 15:42–15:46 UTC
also returned those two records, with sampleInterval 1 and errorCode 0.
No aborted-request record was returned. The exposed inference schema has no
requestId/rayId or queryable turn-cancellation status.

The latest read-only reconciliation is workflow `41348310191`, source
`f90e089aa8dbebd87df231805b36ea2fdb572551`, observed at
**1 November 2026, 20:43:42 UTC (22:43:42 CAT)**. It widened the exhausted
request-row query to **15:40:00–20:43:39 UTC**, still returning only these rows:

| Provider datetime | Input tokens | Output tokens | Neurons | Matching saved completed response |
| --- | ---: | ---: | ---: | --- |
| 15:43:13 UTC | 592 | 414 | 16.672725677490234 | Planning, Ray `a53c0350d8059b36-IAD`, completed 15:43:13.450 UTC |
| 15:43:43 UTC | 255 | 1218 | 35.53636169433594 | Synthesis, Ray `a53c038d1ace9b36-IAD`, completed 15:43:43.747 UTC |

Both rows have errorCode 0 and sampleInterval 1. Their usage exactly matches
the saved successful responses. The second row's time is close to the aborted
request's start, but it is not an identity match for the aborted request.
Please do not assign either successful response's usage to the aborted stream.
No request identity is exposed in these analytics rows; time proximity, absence
of a row and account totals cannot establish cancellation or zero usage.
Latest readback ZIP SHA256:
`c76c3f05c51915de42a76b613e65bc24c50a084c30280d26ebfff8c119e25530`.

Please provide:

1. The saved request's provider terminal state, including whether generation
   stopped because of this client abort and the provider-observed stop time.
2. Final input/output token counts, neurons and billable usage for that exact
   request, including an explicit authoritative zero if no usage is chargeable.
3. The supported native API for authenticated cancellation acknowledgement and
   final usage readback after a client stream abort, or confirmation that those
   properties are unavailable for this endpoint.

Application workflow: `41322607931`, source
`5273169f6f5ba8f9e595b6a2024022198ea660ea`.
Acceptance ZIP SHA256:
`52f4e67808a1f2b85c2e2cd74fd66dd3b72a7025d43ba6ea7c3bba973533cc50`.
Delayed forensic workflow: `41329030634`, ZIP SHA256:
`259350925a35915e8cae630de4a06bfe6626e787986c74b894d17cc7a4404ca2`.

## D1 context: no capacity action requested

The account lists 11 databases. Fresh isolated creation of
`axiom-acceptance-20261101-05` returned **HTTP403 / code7406** in workflow
`41330823895`. No database was created and migrations were not reached.
No database was created by that attempt. The owner subsequently selected the
existing `mft-axiom-claude-staging-20260927` database for qualification in the
`axiom_q06_` namespace. Seven live checks passed in workflow `41343885986`,
with original tables and existing Worker settings preserved. The temporary
qualification Worker was deleted and read back as absent. This later acceptance
is shared namespace isolation, not a separate physical database.

The earlier request for additional capacity is superseded by the owner's reuse
choice. This draft now requests only saved-request provider reconciliation.
Do not create/delete databases or change subscription or billing settings.

D1 source: `6601f2a8eb86a1d82a0002246696e27f8895ed39`.
D1 acceptance ZIP SHA256:
`2179ce317f629c98dd9916bc4a37e79ec4e6350485618dbf3d63652204885e02`.

This draft requests provider evidence and capacity clarification. It does not
authorize production deployment, publication, deletion of an existing database,
payment, a subscription upgrade or any release attestation.
