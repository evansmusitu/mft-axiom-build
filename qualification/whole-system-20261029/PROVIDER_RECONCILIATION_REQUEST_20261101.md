# Cloudflare reconciliation packet — drafts, not submitted

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

The earlier read-only reconciliation is workflow `41348310191`, source
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

Latest delayed readback: workflow `41389928351`, source
`83e30800fc1f60a993e7684d30403fe2725ff23f`, at **2 November 2026,
04:42:28 UTC / 06:42:28 CAT**, via the existing GitHub Cloudflare secret.
The full 1 November UTC day still has two completed records and
52.20908737182617 neurons. Per-request rows through midnight still match only
the two saved successful response usage tuples. The current schema has no
requestId/rayId join field, so the diagnostic is explicitly
`PER_REQUEST_JOIN_KEY_UNAVAILABLE`; final aborted-request usage remains null.
The separate 2 November window has zero account-wide recorded neurons as of
04:42:23 UTC; it makes no statement about the prior day's aborted request.
Latest readback ZIP SHA256:
`e1b0dda507247a80c2461a94a6f2527f5516544cbfc1b33676e083072e76f6ce`.

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

## Channel routing and Free-plan entitlement

Cloudflare's published support policy limits Free-plan cases to billing,
account and registrar issues. The private account/request details above belong
in an authenticated usage/billing inquiry where Cloudflare permits it. No
charge or billing dispute is asserted, and case eligibility for this specific
question has not been established. Technical cancellation API questions belong
in the Community or Developer Discord; do not reclassify a technical issue to
bypass support entitlement. No paid upgrade is requested.

Source: https://developers.cloudflare.com/support/contacting-cloudflare-support/

## Public developer-channel draft — general capability question only

Subject: Workers AI native REST streaming: terminal cancellation and final usage

Is there a supported way to obtain an authenticated provider-terminal
cancellation acknowledgement and final usage after aborting a native Workers
AI REST stream for `@cf/google/gemma-4-26b-a4b-it`?

A bounded synthetic test observed a real content delta before AbortController
and reader cancellation. Application revocation succeeded, but that does not
confirm whether generation stopped on the provider. The inference analytics
schema available to the test exposes timing/error/usage fields and no
requestId/rayId field for correlating the aborted request. The two successful
responses have matching usage records; final usage for the aborted stream is
unresolved.

Please point to the supported cancellation/readback API, or confirm the
endpoint's limitation. In particular, can errorCode 3008 or final metering be
read back for the exact stream after disconnection? No new inference is needed
to answer the capability question.

This public draft contains no account ID, saved Ray, credential, customer input
or project artifact digest. It requests technical guidance; a general response
cannot establish the private saved request's terminal outcome. The private
usage inquiry and public capability question are separate drafts, neither sent.

The packet requests provider reconciliation only. It does not authorize
resource, identity, subscription or billing changes, deployment or release.
