# Studio V0.3 — emergency recovery freshness and offline God Mode CI coverage

Date: 25 October 2026. **Isolated experimental branch / source-only / production NO-GO.**

## Problem and fix

The read-only Neon canary rescue path acquired a durable fenced lease and checked owner approval and SQLite-source authority, but the owner verification, authority check and later route write could be separated by slow callbacks. A provider revocation, SQLite write-fence loss, route drift or incident replacement during that window could leave stale positive evidence authorizing a route CAS. The implementation now, **immediately before** any `NEON_CANARY_READONLY` to `SQLITE_DO` route CAS, re-reads the incident identity, confirms the current route, revalidates fresh signed owner approval and authenticated SQLite authority, and reasserts the fenced recovery lease. A changed incident, route, approval, authority or fence fails closed; the existing outer `finally` keeps the recovery lease held unless SQLite routing is independently read back.

The earlier production adapter remains mandatory: the application-level callbacks and boolean receipts are not independently verified Cloudflare provider evidence, and cannot create a production permission to migrate. This safeguard is a safety improvement to a **source-only** rescue interface, not a live recovery run.

The narrow read-only GitHub Actions workflow previously did not trigger on `creative/god_mode_2099/**` or changes to operational scripts, and did not run its separately available God Mode mock tests. It now watches those paths and runs the portable God Mode launcher mock suite, without needing Blender, credentials, network installation, billing, Cloudflare changes, or GPU execution. It retains read-only `contents` permissions and a single isolated branch constraint. This workflow is **not the full Edge test suite**, which still requires separate hosted dependency qualification.

## Red/green test evidence

Before fixes: four new recovery tests failed because owner revocation, SQLite authority loss, incident drift and route drift did not block CAS; one new offline-CI contract test failed because God Mode was not watched or tested. The same tests pass with the changes. These tests use synthetic callbacks and mock local executables and do not prove production access, immutable provider generations, owner browser signature, or backup recovery.

## Non-authorizations

No Studio V0.2, production SQLite Durable Object, R2 customer objects, Cloudflare Access, production routing, Axiom main, Neon networking, real Blender render, or paid Modal providers were changed or exercised. SQLite stays authoritative, and all production migration gates remain NO-GO.
