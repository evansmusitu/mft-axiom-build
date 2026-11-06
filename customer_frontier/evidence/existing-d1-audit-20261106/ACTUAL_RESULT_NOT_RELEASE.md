# Actual audit: partial observation, no target admission

Run42243560034/job127979820881 executed reviewed source5e69ebf3 at PR90
event headcc70c52b. All three fixed catalogs were observed with changed_db=false,
changes=0 and rows_written=0. All67 listed Worker scripts and67 corresponding
service environment paths were observed. The provider confirmed zero writes.

Two candidates had matching current Worker and service environment bindings.
Candidate ccc473f1-fbb5-4b8d-8a24-45f3696ac10f had no match in those inspected
Worker surfaces. Its catalog contains three user tables, one user index and
the internal _cf_KV table. This does not prove it is unused or private.

The first Pages list request, page1/per_page100, returned HTTP400, with no
retained numeric error code. Pages therefore remains UNKNOWN and the audit
correctly exited1/PARTIAL_OBSERVATION. The response does not establish the
cause of rejection. A subsequent current Wrangler source inspection found its
Pages project list uses per_page10; a separate Pages-only diagnostic is the
next bounded step. Do not rerun the sealed catalog/Worker observation.

Source CI42243559906/job127979820348 passed197 Node,117 Python and16 local
workerd tests. Local workerd results are not hosted migrations or acceptance.
Exact decoded logs, observation JSON and log receipt are retained beside this
report. No target, backup/restore, migration or release qualification is granted.
No database/schema/data/deployment write, merge or publication occurred.

B27=FAILED_IN_SYNTHETIC_ATTACK; parity/superiority=NOT_CERTIFIED;
unavailable final usage=UNKNOWN. PR1 stays separate and its rejection persists.
