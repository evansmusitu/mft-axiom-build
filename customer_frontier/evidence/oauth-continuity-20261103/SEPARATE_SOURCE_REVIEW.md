# Separate source review — retained findings, NOT RELEASE

Reviewer: separate read-only Codex `review_customer_identity`, applying the
requesting-code-review skill. Baseline PR70 `627e075e400e4c24a9ba4fa944e19e207da8b23c`
through initial local `3a46338db3ba268489f12457d5b4a3335d0e2178`, followed by
focused source/test repairs. Initial remote same-tree commit:
`e6457e949f2fce7eb71ab7e0fa7a739216d3902b`.

## Findings accumulator

- **High / high confidence — FIXED:** A legacy code issued before suspension
  still minted active credentials afterward; UserInfo and refresh succeeded.
  Independently reproduced. Unconditional active-customer reads on all paths
  plus transactional API-key eligibility guards deny the path, including
  suspension injected during persistence. This is imported candidate legacy
  debt, not evidence of a newly introduced production regression.
- **Medium / high confidence — FIXED:** Immutable linkage could pair customer A's
  identity with customer B's code/key while foreign-key checks remained clean.
  The first repair rejected initial mismatched inserts but still allowed later
  parent reassignment. Regressions reproduced both cases, parent REPLACE and
  linked-key reactivation. Parent/customer matching, linked-parent immutability,
  REPLACE guards and terminal linked-key revocation now reject those cases.
  No current public HTTP pairing-write exploit was established.

Original failing executions remain in `review-legacy-suspension-red.log`,
`review-link-pairing-red.log` and `review-parent-pairing-red.log`.

Reviewer independently reran the final repaired working tree: Node24.22.1
**149/149**, zero failures/skips; Python3.12 **20/20**; focused suites passed.
No unresolved material source-review blocker was reported. The reviewer made
no source edits or external mutations.

## Verdict

Partial source-only acceptance for continued isolated draft integration, subject
to committing the reviewed repairs and matching-tree CI. This is not independent
human/security-authority acceptance or a real IdP/custody certificate.

Direct MCP enforcement of revocation originating in the separate canonical
database remains unproven. Real IdP sessions, production ownership, hosted D1
migrations/races/recovery, device/payment/usage receipts, custody, B27 and release
remain unearned. SQL evidence is from fresh local fixtures; legacy dirty-row or
previous-schema upgrade acceptance must be separately rehearsed before migration.
